"use client";

import { useMemo, useState } from "react";
import { divePlaybook, chooseDivePivot } from "@/config/divePlaybook";
import {
  fallbackHealDenyGuide,
  healDenyGuideFor,
} from "@/config/healDenyPlaybook";
import {
  DRAFT_ORDER,
  explainCompHoles,
  extractLaneSplitNote,
  fillPlanHoles,
  heroHasWaveclear,
  heroIsOfflaner,
  heroIsRangedDamage,
  liveCompMatchupLine,
  normalizeBruiserLanes,
  planHasOfflane,
  planHasRangedDamage,
  planHasWaveclear,
  planSeatJob,
  solveSeatAssignments,
} from "@/lib/scoring/draftPlan";
import {
  gradeFinishedDraft,
  type DraftReportCard,
  type LetterGrade,
} from "@/lib/scoring/draftGrade";
import {
  credibleOpenCounters,
  counterPoolNote,
  counterRoleFillNote,
  earlyPickScore,
  formatCounter,
  heroDraftMeta,
  isFlexibleAnchorRole,
  isMapSpecialist,
  isOfflanePlanRole,
  liveAllySynergies,
  liveCountersUp,
  nakedOfflaneOpeningRisk,
  shouldTakeAndRebuild,
  type DraftMetaTable,
  type MatchupEdge,
} from "@/lib/scoring/draftMeta";
import {
  isDoublePickWindow,
  pairDuoSynergy,
  pairStructureDelta,
  rankDoublePickPairs,
  type PairSeatCand,
} from "@/lib/scoring/pickPairs";
import {
  assignUniqueOwners,
  bestFreeOwner,
  findEndDraftSwaps,
  findPickSwap,
  lockedPlayerIds,
  type DraftSwap,
  type LockedPick,
} from "@/lib/scoring/draftSwap";
import { heroKey, heroRole, heroTags } from "@/lib/scoring/heroMeta";
import { labelArchetypeTag } from "@/lib/scoring/glossary";
import type {
  DraftCompPick,
  DraftTreeAction,
  DraftTreeNode,
  OurCompBrief,
  PlayerScout,
} from "@/lib/scoring/types";
import { allDraftHeroes } from "@/lib/scoring/heroPortrait";
import { HeroFace } from "@/components/HeroFace";

type BoardAction = DraftTreeAction & { reason?: string };

type ScoreFactor = {
  id: string;
  label: string;
  points: number;
  detail: string;
  formula?: string;
};

type ScoredOption = {
  hero: string;
  total: number;
  factors: ScoreFactor[];
  /** Who should lock this — display name, no battletag. */
  player?: string | null;
  /** When set, this option is a double-pick pair: lock `hero`, then `pairWith`. */
  pairWith?: string;
  pairPlayer?: string | null;
  /**
   * Display label for deviation headers (e.g. "Auriel (1st of pair)").
   * Falls back to `hero` / `hero + pairWith`.
   */
  displayLabel?: string;
  /** Solo scorecard factors for the first of a pair — used in fair deviation. */
  firstSoloFactors?: ScoreFactor[];
  /** Solo scorecard factors for the follow-up of a pair. */
  secondSoloFactors?: ScoreFactor[];
};

function expandSoloFactors(
  factors: ScoreFactor[] | undefined,
  prefix: string,
): ScoreFactor[] {
  if (!factors?.length) return [];
  return factors.map((f) => ({
    ...f,
    id: `${prefix}:${f.id}`,
    label: f.label,
  }));
}

/**
 * When the suggestion was a pair but only one hero is locked:
 * - Locking the follow-up first = pair reorder (compare solos, not pair total).
 * - Locking something else = compare first-of-pair solo vs chosen solo.
 * Never leave "Then · Whitemane +31" stacked into Tyrael's column.
 */
function fairFirstLockDeviationCards(
  suggested: ScoredOption,
  chosen: ScoredOption,
): {
  suggested: ScoredOption;
  chosen: ScoredOption;
  note: string | null;
  /** True when they locked the suggested pair's follow-up first. */
  pairReorder: boolean;
} {
  const sugIsPair = Boolean(suggested.pairWith);
  const choseIsPair = Boolean(chosen.pairWith);
  if (!sugIsPair || choseIsPair) {
    return { suggested, chosen, note: null, pairReorder: false };
  }

  const follow = suggested.pairWith!;
  const lockedFollowUp =
    heroKey(chosen.hero) === heroKey(follow);

  const firstSoloPts =
    suggested.factors.find((f) => f.id === "first-solo")?.points ??
    suggested.firstSoloFactors?.reduce((s, f) => s + f.points, 0) ??
    0;
  const secondSoloPts =
    suggested.factors.find((f) => f.id === "second-solo")?.points ??
    suggested.secondSoloFactors?.reduce((s, f) => s + f.points, 0) ??
    0;

  const firstExpanded = expandSoloFactors(
    suggested.firstSoloFactors,
    "first",
  );
  const secondExpanded = expandSoloFactors(
    suggested.secondSoloFactors,
    "second",
  );

  if (lockedFollowUp) {
    // Show the missing first seat (Tyrael) vs what you locked (Whit) — solos only.
    const sugFirstFactors =
      firstExpanded.length > 0
        ? firstExpanded
        : [
            {
              id: "first-solo",
              label: `${suggested.hero} (still needed)`,
              points: Math.round(firstSoloPts),
              detail: "Solo value of the seat you have not locked yet",
            },
          ];
    return {
      suggested: {
        ...suggested,
        pairWith: undefined,
        pairPlayer: undefined,
        total: Math.round(firstSoloPts),
        factors: [
          ...sugFirstFactors,
          {
            id: "pair-omitted",
            label: "Pair order",
            points: 0,
            detail: `Suggested order was ${suggested.hero} then ${follow}. You locked the follow-up first — pair synergy / structure omitted. Still take ${suggested.hero} next.`,
          },
        ],
        displayLabel: `${suggested.hero} (still needed)`,
      },
      chosen: {
        ...chosen,
        displayLabel: `${chosen.hero} (locked first)`,
      },
      note: `Pair reorder — still lock ${suggested.hero} next for that seat.`,
      pairReorder: true,
    };
  }

  // Locked neither half of the pair — fair compare is first-of-pair solo only.
  const sugFirstFactors =
    firstExpanded.length > 0
      ? firstExpanded
      : [
          {
            id: "first-solo",
            label: `${suggested.hero} (1st of pair)`,
            points: Math.round(firstSoloPts),
            detail: "Solo value of the suggested first lock",
          },
        ];
  return {
    suggested: {
      ...suggested,
      pairWith: undefined,
      pairPlayer: undefined,
      total: Math.round(firstSoloPts),
      factors: [
        ...sugFirstFactors,
        {
          id: "pair-omitted",
          label: "Pair (omitted)",
          points: 0,
          detail: `Follow-up ${follow} not locked yet — pair synergy / structure / 2nd solo left out of this comparison`,
        },
      ],
      displayLabel: `${suggested.hero} (1st of pair)`,
    },
    chosen: {
      ...chosen,
      displayLabel: chosen.hero,
    },
    note: `Comparing first locks only — ${follow} was the suggested follow-up, but they have not locked a partner for ${chosen.hero} yet.`,
    pairReorder: false,
  };
}

type DeviationSeverity = "solid" | "minor" | "major" | "info";

type DeviationReport = {
  summary: string;
  severity: DeviationSeverity;
  /** Ban vs pick — drives "why you should have banned/picked" tooltip copy. */
  kind: "ban" | "pick";
  suggested: ScoredOption;
  chosen: ScoredOption;
};

/** Same two heroes as a suggested pair (either lock order). */
function pairHeroesMatch(
  option: ScoredOption | undefined,
  first: string,
  second: string,
): boolean {
  if (!option?.pairWith) return false;
  const a = heroKey(option.hero);
  const b = heroKey(option.pairWith);
  const x = heroKey(first);
  const y = heroKey(second);
  return (a === x && b === y) || (a === y && b === x);
}

function findPairOption(
  options: ScoredOption[],
  first: string,
  second: string,
): ScoredOption | undefined {
  return options.find((o) => pairHeroesMatch(o, first, second));
}

/** Build a pair scorecard when the locked duo was not among ranked options. */
function assemblePairScorecard(args: {
  first: ScoredOption;
  second: ScoredOption;
  table: DraftMetaTable | null | undefined;
  beforePlan: DraftCompPick[];
  projectBoth: (a: string, b: string) => DraftCompPick[];
  contested: (hero: string) => boolean;
}): ScoredOption {
  const duo = pairDuoSynergy(args.table, args.first.hero, args.second.hero);
  const structure = pairStructureDelta(
    args.beforePlan,
    args.projectBoth(args.first.hero, args.second.hero),
  );
  const total = Math.round(
    args.first.total +
      args.second.total +
      duo.points +
      structure.points,
  );
  return {
    hero: args.first.hero,
    pairWith: args.second.hero,
    player: args.first.player ?? null,
    pairPlayer: args.second.player ?? null,
    total,
    firstSoloFactors: args.first.factors,
    secondSoloFactors: args.second.factors,
    displayLabel: `${args.first.hero} + ${args.second.hero}`,
    factors: [
      {
        id: "duo",
        label: "Pair synergy",
        points: Math.round(duo.points),
        detail: duo.detail,
      },
      {
        id: "pair-structure",
        label: "Pair structure",
        points: Math.round(structure.points),
        detail: structure.bits.length
          ? structure.bits.join(" · ")
          : "No structural change",
      },
      {
        id: "first-solo",
        label: `First · ${args.first.hero}`,
        points: args.first.total,
        detail: "Solo base",
      },
      {
        id: "second-solo",
        label: `Then · ${args.second.hero}`,
        points: args.second.total,
        detail: "Solo base",
      },
    ],
  };
}

/**
 * Structural draft throws always major — never softened by a close scoreboard.
 * Score gap only decides minor vs major when the lock was structurally fine.
 */
function classifyDeviationSeverity(args: {
  solid?: boolean;
  /** Opened offlane, missed OP, walked into answers, etc. — primary criterion. */
  structural?: boolean;
  suggestedTotal: number;
  chosenTotal: number;
}): Exclude<DeviationSeverity, "info"> {
  if (args.solid) return "solid";
  // 1) Structure first — scores must not turn a throw into a judgment call.
  if (args.structural) return "major";
  // 2) Scoreboard only when the lock was structurally legal.
  const gap = args.suggestedTotal - args.chosenTotal;
  const bothStrong =
    args.suggestedTotal >= 28 && args.chosenTotal >= 22;
  const close = gap <= 12;
  const worthless =
    args.chosenTotal < 8 ||
    (args.suggestedTotal >= 30 && args.chosenTotal < 15) ||
    gap >= 22;
  if (worthless) return "major";
  if (bothStrong && close) return "minor";
  if (gap <= 15 && args.chosenTotal >= 15) return "minor";
  return "major";
}

export function formatScoreGapSentence(args: {
  suggested: string;
  chosen: string;
  suggestedTotal: number;
  chosenTotal: number;
}): string {
  const delta = args.suggestedTotal - args.chosenTotal;
  if (delta <= 0) {
    return `${args.chosen} was not worse than ${args.suggested}.`;
  }
  return `${args.chosen} was ${delta} points worse than ${args.suggested} (${args.suggestedTotal > 0 ? "+" : ""}${args.suggestedTotal} vs ${args.chosenTotal > 0 ? "+" : ""}${args.chosenTotal}).`;
}

function mistakeLabel(
  severity: "minor" | "major",
  kind: "ban" | "pick",
  chosen: string,
  suggested: string,
): string {
  const verb = kind === "ban" ? "banned" : "locked";
  if (severity === "minor") {
    return `Minor mistake: ${verb} ${chosen} over ${suggested}.`;
  }
  return `Major mistake: ${verb} ${chosen} over ${suggested}.`;
}

/** Slam the chosen score so a structural throw never looks like +50 vs +41. */
function applyStructuralThrowToCard(
  card: ScoredOption,
  reasons: string[],
): ScoredOption {
  if (!reasons.length) return card;
  const penalty = -Math.min(42, 24 + reasons.length * 8);
  const factor: ScoreFactor = {
    id: "structural",
    label: "Structural throw",
    points: penalty,
    detail: reasons.join(" · "),
  };
  const factors = [
    ...card.factors.filter((f) => f.id !== "structural"),
    factor,
  ];
  return {
    ...card,
    factors,
    total: factors.reduce((s, f) => s + f.points, 0),
  };
}

type Suggestion = {
  hero: string;
  reason: string;
  badge: string;
  /** When false, hide our plan seat list — their-turn read only. */
  showOurPlan: boolean;
  planPicks: DraftCompPick[];
  compLine: string | null;
  expectLine: string | null;
  cautionLine: string | null;
  swapLine: string | null;
  /** Top options for this step (usually 3), with measurable score breakdowns. */
  options: ScoredOption[];
};

export function buildOpeningBanHoldNote(args: {
  ourBanCount: number;
  hero: string;
  mutualFactor?: { points: number } | null;
}): string | null {
  if (args.ourBanCount !== 0) return null;
  if (!args.mutualFactor || args.mutualFactor.points >= 0) return null;
  return `If ${args.hero} is still up, hold it for opening ban round 2 (our second of two opening bans — not a free 3rd).`;
}

export function scoreProjectedCompStructure(args: {
  hero: string;
  livePicks: DraftCompPick[];
  projected: DraftCompPick[];
  table?: DraftMetaTable | null | undefined;
}): { extra: number; structureBits: string[] } {
  // The comp structure heuristics here were hardcoded and could wrongly label
  // valid patch structures (e.g. Deathwing + a bruiser frontline) as a major
  // throw. Keep the scorecard driven by real patch data instead of static
  // assumptions about ranged / offlane / all-melee composition.
  const heroValid = isValidStructureHero(args.hero, args.table);
  let extra = 0;
  const structureBits: string[] = [];

  if (!heroValid) {
    extra -= 12;
    structureBits.push(`${args.hero} is not a strong current-patch structure`);
  }

  return { extra, structureBits };
}

export function pairSuggestionCautionLine<T extends {
  first: string;
  second: string;
  pairFactors?: { id: string; label: string; points: number; detail: string }[];
}>(best: T, alternatives: readonly T[]): string | null {
  if (!alternatives.length) return null;

  const pairDetail =
    best.pairFactors?.find((factor) => factor.id === "pair-structure") ??
    best.pairFactors?.find((factor) => factor.id !== "order") ??
    best.pairFactors?.[0];
  const altText = alternatives
    .slice(0, 2)
    .map((pair) => `${pair.first} + ${pair.second}`)
    .join(" / ");

  const reason = pairDetail?.detail
    ? pairDetail.detail.toLowerCase()
    : "it matches the current comp best";

  return `Why not the other heroes: ${altText}? ${best.first} + ${best.second} fits better because ${reason}.`;
}

export function pairSeededPairOptions<T extends {
  first: string;
  second: string;
  total?: number;
  firstSolo?: number;
  secondSolo?: number;
  pairFactors?: { id: string; label: string; points: number; detail: string }[];
  firstPlayer?: string | null;
  secondPlayer?: string | null;
  firstRole?: string | null;
  secondRole?: string | null;
  firstFromAlt?: boolean;
  secondFromAlt?: boolean;
}>(args: {
  pairPick: string[];
  pairs: readonly T[];
}): T[] {
  const seed = args.pairPick[0];
  if (!seed) return [...args.pairs] as T[];

  const seedKey = heroKey(seed);
  const bestByPair = new Map<string, T>();

  for (const pair of args.pairs) {
    const firstIsSeed = heroKey(pair.first) === seedKey;
    const secondIsSeed = heroKey(pair.second) === seedKey;
    const seedIsSecond = !firstIsSeed && secondIsSeed;
    const displayFirst = firstIsSeed ? pair.first : seedIsSecond ? pair.second : seed;
    const displaySecond = firstIsSeed ? pair.second : seedIsSecond ? pair.first : pair.first;

    const normalized = {
      ...pair,
      first: displayFirst,
      second: displaySecond,
      firstSolo: seedIsSecond ? pair.secondSolo : pair.firstSolo,
      secondSolo: seedIsSecond ? pair.firstSolo : pair.secondSolo,
      firstPlayer: seedIsSecond ? pair.secondPlayer ?? null : pair.firstPlayer ?? null,
      secondPlayer: seedIsSecond ? pair.firstPlayer ?? null : pair.secondPlayer ?? null,
      firstRole: seedIsSecond ? pair.secondRole ?? null : pair.firstRole ?? null,
      secondRole: seedIsSecond ? pair.firstRole ?? null : pair.secondRole ?? null,
      firstFromAlt: seedIsSecond ? pair.secondFromAlt ?? false : pair.firstFromAlt ?? false,
      secondFromAlt: seedIsSecond ? pair.firstFromAlt ?? false : pair.secondFromAlt ?? false,
      pairFactors: (pair.pairFactors ?? []).map((factor) =>
        factor.id === "order"
          ? {
              ...factor,
              detail: `Lock ${displayFirst} now, then ${displaySecond}`,
            }
          : factor,
      ),
    } as T;

    const pairKey = [heroKey(normalized.first), heroKey(normalized.second)]
      .sort()
      .join("|");
    const prior = bestByPair.get(pairKey);
    if (
      !prior ||
      (typeof pair.total === "number" &&
        typeof prior.total === "number" &&
        pair.total > prior.total)
    ) {
      bestByPair.set(pairKey, normalized);
    }
  }

  const ranked = [...bestByPair.values()].sort((a, b) => {
    const aSeedFirst = heroKey(a.first) === seedKey;
    const bSeedFirst = heroKey(b.first) === seedKey;
    if (aSeedFirst !== bSeedFirst) return aSeedFirst ? -1 : 1;
    return (b.total ?? 0) - (a.total ?? 0);
  });

  const normalizedFallback = args.pairs.slice(0, 3).map((pair) => ({
    ...pair,
    first: seed,
    second: heroKey(pair.first) === seedKey ? pair.second : pair.first,
  } as T));

  return (ranked.length > 0 ? ranked : normalizedFallback).slice(0, 3);
}

export function resolvePairPickSelection(args: {
  current: string[];
  hero: string;
  pairWindow: boolean;
}): {
  action: "hold-pair" | "lock-pair" | "lock-single";
  picked: string[];
  pair: [string, string] | null;
} {
  if (!args.pairWindow) {
    return {
      action: "lock-single",
      picked: [args.hero],
      pair: null,
    };
  }
  if (args.current.length === 0) {
    return {
      action: "hold-pair",
      picked: [args.hero],
      pair: null,
    };
  }
  const first = args.current[0];
  if (heroKey(first) === heroKey(args.hero)) {
    return {
      action: "hold-pair",
      picked: [first],
      pair: null,
    };
  }
  return {
    action: "lock-pair",
    picked: [first, args.hero],
    pair: [first, args.hero],
  };
}

/** Heroes a roster actually plays (comfort pool) — open answers must hit these. */
function poolFromRoster(roster: PlayerScout[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of roster) {
    for (const h of p.topHeroes) {
      const k = heroKey(h.hero);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h.hero);
    }
  }
  return out;
}

function addFactor(
  factors: ScoreFactor[],
  id: string,
  label: string,
  points: number,
  detail: string,
  formula?: string,
) {
  factors.push({
    id,
    label,
    points: Math.round(points),
    detail,
    formula,
  });
}

function factorExplanation(factor: ScoreFactor | undefined): string {
  if (!factor) return "No factor value.";
  const value = `${factor.points > 0 ? "+" : ""}${factor.points}`;
  const calc = factor.formula ?? "This value was used as-is in the ranking.";
  return `${factor.label}: ${calc} (displayed as ${value}). ${factor.detail}`;
}

const SCORE_FACTOR_HELP: Record<string, string> = {
  wr: "Patch win rate is the hero’s current Storm League performance in the active patch. It is a strong baseline signal, but it should not override direct counters, seat ownership, or a player’s comfort on the pick.",
  influence: "Meta influence captures how central the hero is to the current drafting environment. It is best read as a popularity/impact signal rather than a direct ban rule, because very good heroes can still be poor picks if they are contested or misfit the board.",
  map: "Map fit measures whether the hero is a specialist on the chosen map. This matters for map-specific power, but it is only a small nudge unless the map is a known staple for that hero.",
  synergy: "Ally synergy reflects how well this hero performs with already-locked teammates in current win-rate samples. It is useful for pair planning, but it is not a ban heuristic by itself because team composition and role fill often matter more.",
  matchup: "Matchup value compares this hero against the enemy’s likely or locked picks. This is one of the most useful real-draft signals, but it should be interpreted as a contextual advantage check rather than a pure ban trigger.",
  answers: "Open answers risk asks whether the opposing side still has a clean counterpick available if we take this hero. This is a strong timing and ban signal, especially on first-pick openings or when the answer is already in the pool.",
  comfort: "Player comfort is the roster-specific fit for the player who would actually play this hero. It is a good pick signal because it captures skill, familiarity, and seat ownership, but it should not dominate hard meta or matchup logic.",
  deny: "Deny / contest captures whether the hero is a likely enemy priority or an early contest target. This is a useful board-state check, but it can overlap with ban priority and matchup pressure when the same hero is both strong and contested.",
  timing: "Pick priority reflects how early the hero matters in the current draft phase and whether it is a strong take-and-rebuild or flexible opening anchor. This is more of a sequencing signal than a pure power metric.",
  swap: "Swap value measures the benefit of keeping a seat flexible so the plan can adapt later. It is a planning signal, not a direct ban recommendation, because many heroes with high swap value are still poor bans.",
  banPri: "Ban priority is the current priority list for removing a hero from the draft. It is a valid ban signal when a hero is both strong and clearly being contested, but it only matters after the board state and lane roles are considered.",
  mutualBan: "Mutual ban timing refers to heroes that both sides are likely to remove, especially when one side plays them or they are repeatedly banned. This is a specific ban-timing rule, not a general measure of hero strength.",
};

function factorHelpText(id: string, label: string): string {
  return (
    SCORE_FACTOR_HELP[id] ??
    `This factor, ${label}, contributes to the current hero ranking. It is a contextual draft signal and should be read together with the rest of the board rather than as a standalone ban rule.`
  );
}

/** Measurable pick/ban scorecard for tooltips + ranking. */
function buildPickScorecard(args: {
  hero: string;
  table: DraftMetaTable | null | undefined;
  gone: Set<string>;
  map: string | null;
  ourPickCount: number;
  inPlan: boolean;
  fromAlt: boolean;
  planRole: string | null;
  lockedAllies: string[];
  /** Team that would pick open counters (role-fill filters apply here). */
  theirLocked: string[];
  /**
   * Heroes the answering team actually plays. When set, SL counters outside
   * this pool do not count as open-answer risk.
   */
  answeringTeamPool?: string[] | null;
  theirLikely: DraftCompPick[];
  banPriority: { hero: string; reason: string }[];
  comfort: number;
  /** Who owns the comfort signal (for the factor detail line). */
  comfortWho?: string | null;
  swapDelta: number;
  takeAndRebuild: boolean;
  kind: "ban" | "pick";
  /** Last pick of the draft — open counters cannot answer. */
  lastPick?: boolean;
  /**
   * Who would take the open counters into this hero.
   * `ours` = we answer their pick; `theirs` = they answer our pick.
   */
  answerPerspective?: "ours" | "theirs";
  /** Our bans already locked this draft (0 = first opening ban). */
  ourBanCount?: number;
  /** Heroes they commonly ban (may take a mutual deny for us). */
  theirCommonBans?: { hero: string; count: number }[];
  /** True when someone on our roster plays this hero. */
  wePlayHero?: boolean;
}): ScoredOption {
  const factors: ScoreFactor[] = [];
  const meta = heroDraftMeta(args.table, args.hero);

  const wrPts = (meta.winRate - 50) * 1.4;
  addFactor(
    factors,
    "wr",
    "Patch win rate",
    wrPts,
    `${meta.winRate.toFixed(1)}% WR · ${meta.games}g Storm League`,
    `(${meta.winRate.toFixed(1)} - 50) × 1.4 = ${wrPts.toFixed(2)} → rounded to ${Math.round(wrPts)}`,
  );

  const influencePts = Math.max(-12, Math.min(22, meta.influence / 18));
  addFactor(
    factors,
    "influence",
    "Meta influence",
    influencePts,
    `${meta.influence} influence · ${meta.popularity.toFixed(0)} popularity`,
    `clamp(${meta.influence} / 18, -12, 22) = ${influencePts.toFixed(2)} → rounded to ${Math.round(influencePts)}`,
  );

  const mapHit = isMapSpecialist(args.table, args.hero, args.map);
  const mapPts = mapHit ? 6 + Math.min(10, mapHit.deltaPp) : 0;
  addFactor(
    factors,
    "map",
    "Map fit",
    mapPts,
    mapHit
      ? `${mapHit.map}: ${mapHit.winRate}% WR (+${mapHit.deltaPp}pp, ${mapHit.games}g)`
      : args.map
        ? `No specialist edge on ${args.map}`
        : "No map selected",
    mapHit
      ? `6 + min(10, ${mapHit.deltaPp}) = ${mapPts.toFixed(2)} → rounded to ${Math.round(mapPts)}`
      : "0 because there is no specialist edge on this map",
  );

  // Ally synergy from Heroes Profile teammate WR (not shared tags).
  // Score absolute duo performance vs coin flip — not solo-delta alone.
  // Solo-delta punished strong solo heroes for merely-average pairs
  // (e.g. Tyrael+Dehaka 50.7% / −4.4pp scored worse than Falstad 47.9% / −3.1pp).
  const synEdges = liveAllySynergies(
    args.table,
    args.hero,
    args.lockedAllies,
  );
  let synPts = 0;
  const synBits: string[] = [];
  for (const edge of synEdges) {
    const vsCoin = edge.allyWinRate - 50;
    const pts = Math.max(-10, Math.min(12, vsCoin * 1.15));
    synPts += pts;
    const sign = edge.deltaPp >= 0 ? "+" : "";
    synBits.push(
      `${edge.hero} ${edge.allyWinRate}% together (${sign}${edge.deltaPp}pp vs solo, ${edge.games}g)`,
    );
  }
  const synergyPts = Math.max(-18, Math.min(18, synPts));
  addFactor(
    factors,
    "synergy",
    "Ally synergy",
    synergyPts,
    synBits.length
      ? synBits.slice(0, 3).join(" · ")
      : args.lockedAllies.length
        ? "No strong ally WR edge vs locked teammates yet"
        : "No allies locked yet",
    `sum of ally sample edges, clamped to [-18, 18] = ${synergyPts.toFixed(2)} → rounded to ${Math.round(synergyPts)}`,
  );

  // Matchup vs their locked picks (and soft: likely five if none locked).
  const enemies =
    args.theirLocked.length > 0
      ? args.theirLocked
      : args.theirLikely.map((p) => p.hero).slice(0, 5);
  let matchPts = 0;
  const matchBits: string[] = [];
  for (const enemy of enemies) {
    const weBeat = heroDraftMeta(args.table, enemy).counteredBy.find(
      (c) => heroKey(c.hero) === heroKey(args.hero),
    );
    const theyBeat = meta.counteredBy.find(
      (c) => heroKey(c.hero) === heroKey(enemy),
    );
    if (weBeat) {
      const gain = Math.min(14, (weBeat.theirWinRate - 50) * 0.55);
      matchPts += gain;
      matchBits.push(
        `+${args.hero} ${weBeat.theirWinRate}% into ${enemy} (${weBeat.games}g)`,
      );
    }
    if (theyBeat) {
      const hit = Math.min(14, (theyBeat.theirWinRate - 50) * 0.55);
      matchPts -= hit;
      matchBits.push(
        `−${enemy} ${theyBeat.theirWinRate}% into ${args.hero} (${theyBeat.games}g)`,
      );
    }
  }
  const matchupPts = Math.max(-24, Math.min(24, matchPts));
  addFactor(
    factors,
    "matchup",
    args.theirLocked.length ? "Vs their locked" : "Vs their likely",
    matchupPts,
    matchBits.length
      ? matchBits.slice(0, 4).join(" · ")
      : "No hard matchup edges in sample",
    `sum of matchup deltas, clamped to [-24, 24] = ${matchupPts.toFixed(2)} → rounded to ${Math.round(matchupPts)}`,
  );

  // Open counters still available to the answering side (risk).
  // Last pick: nobody answers. Role already filled: double-stack is free.
  // Pool filter: only fear counters they actually play.
  const rawAnswers = liveCountersUp(args.table, args.hero, args.gone);
  const openAnswers = args.lastPick
    ? []
    : credibleOpenCounters(
        rawAnswers,
        args.theirLocked,
        args.answeringTeamPool,
      );
  const fillNote = args.lastPick
    ? null
    : counterRoleFillNote(
        rawAnswers,
        args.theirLocked,
        args.answeringTeamPool,
      );
  const poolNote = args.lastPick
    ? null
    : counterPoolNote(rawAnswers, args.answeringTeamPool);
  const answerPts = openAnswers.reduce((s, c) => {
    return s - Math.min(8, (c.theirWinRate - 50) * 0.35 + c.games / 80);
  }, 0);
  const answerList = openAnswers
    .slice(0, 3)
    .map(formatCounter)
    .join(", ");
  const perspective = args.answerPerspective ?? "theirs";
  const answerDetail = args.lastPick
    ? "Last pick of the draft — nobody gets a pick after this, so counter-picks cannot answer."
    : openAnswers.length
      ? args.kind === "ban"
        ? perspective === "theirs"
          ? `If we had taken ${args.hero}, they could still answer with ${answerList} — lower ban urgency.`
          : `If they take ${args.hero}, we can still answer with ${answerList} — lower ban urgency.`
        : perspective === "ours"
          ? `We can still take ${answerList} into ${args.hero}. Locking ${args.hero} while that answer was open was soft for them — consider those counters on our next pick if the seat fits.`
          : `They can still answer ${args.hero} with ${answerList}. Do not lock ${args.hero} while those counters are still available.`
      : fillNote
        ? fillNote
        : poolNote
          ? poolNote
          : perspective === "ours"
            ? `No hard counters into ${args.hero} are left in our pool.`
            : `No hard counters into ${args.hero} are still available for them to take.`;
  const answerValue = args.lastPick ? 0 : Math.max(-22, answerPts);
  addFactor(
    factors,
    "answers",
    "Open answers risk",
    answerValue,
    answerDetail,
    args.lastPick
      ? "0 because last pick means nobody can answer afterwards"
      : `sum of remaining counter answer penalties = ${answerValue.toFixed(2)} → rounded to ${Math.round(answerValue)}`,
  );

  const comfortPts = Math.min(16, args.comfort * 40);
  addFactor(
    factors,
    "comfort",
    "Player comfort",
    comfortPts,
    args.comfort > 0.02
      ? `${args.comfortWho ? `${args.comfortWho} · ` : ""}seat comfort ${(args.comfort * 100).toFixed(0)}`
      : "No strong comfort signal",
    `min(16, ${args.comfort.toFixed(2)} × 40) = ${comfortPts.toFixed(2)} → rounded to ${Math.round(comfortPts)}`,
  );

  const block = theyMightTake(
    args.hero,
    args.theirLikely,
    args.banPriority,
  );
  const denyPts = block ? (isHealPick(args.hero, args.planRole) ? 16 : 10) : 0;
  addFactor(
    factors,
    "deny",
    "Deny / contest",
    denyPts,
    block
      ? block.via === "likely"
        ? `On their likely five${block.who ? ` (${block.who})` : ""} — comfort + block`
        : "On deny / ban priority — contest pick"
      : "Not a known contest for them",
    block
      ? `hero is a contest target → ${isHealPick(args.hero, args.planRole) ? 16 : 10}`
      : "0 because this hero is not a likely contest target",
  );

  const opening = args.ourPickCount === 0;
  let timingPts = 0;
  let timingDetail = "";
  if (args.takeAndRebuild) {
    timingPts = opening ? 28 : 18;
    timingDetail = "Take-and-rebuild priority / OP pocket";
  } else if (opening && isFlexibleAnchorRole(args.planRole)) {
    timingPts = 12;
    timingDetail = "Flexible early anchor seat";
  } else if (opening && isOfflanePlanRole(args.planRole)) {
    const risk = nakedOfflaneOpeningRisk({
      table: args.table,
      hero: args.hero,
      gone: args.gone,
      ourPickCount: args.ourPickCount,
      inPlan: args.inPlan,
      planRole: args.planRole,
      answeringTeamLocked: args.theirLocked,
      answeringTeamPool: args.answeringTeamPool,
      lastPick: args.lastPick,
    });
    timingPts = risk.points;
    timingDetail = risk.detail;
  }
  if (timingDetail) {
    addFactor(
      factors,
      "timing",
      "Pick priority",
      timingPts,
      timingDetail,
      `timing rule = ${timingPts.toFixed(2)} → rounded to ${Math.round(timingPts)}`,
    );
  }

  const swapPts = args.swapDelta > 0 ? 8 + args.swapDelta * 30 : 0;
  addFactor(
    factors,
    "swap",
    "Swap value",
    swapPts,
    args.swapDelta > 0
      ? `Post-lock comfort swap (+${args.swapDelta.toFixed(2)})`
      : "No comfort-positive swap unlocked",
    args.swapDelta > 0
      ? `8 + (${args.swapDelta.toFixed(2)} × 30) = ${swapPts.toFixed(2)} → rounded to ${Math.round(swapPts)}`
      : "0 because no comfort-positive swap is unlocked",
  );

  if (args.kind === "ban") {
    const idx = args.banPriority.findIndex(
      (b) => heroKey(b.hero) === heroKey(args.hero),
    );
    const banPriPts = idx >= 0 ? Math.max(4, 28 - idx * 6) : 0;
    addFactor(
      factors,
      "banPri",
      "Ban priority",
      banPriPts,
      idx >= 0
        ? `#${idx + 1} on ban list — ${args.banPriority[idx].reason}`
        : "Not on current ban priority",
      idx >= 0
        ? `max(4, 28 - ${idx} × 6) = ${banPriPts.toFixed(2)} → rounded to ${Math.round(banPriPts)}`
        : "0 because this hero is not on the current ban priority list",
    );

    // Mutual deny: we should ban it, but they may ban it for us. Hold on
    // opening ban round 1; clean it up on opening ban round 2 if they leave it.
    // (Only two opening bans — this is not a third ban later.)
    const banCount = args.theirCommonBans?.find(
      (b) => heroKey(b.hero) === heroKey(args.hero),
    )?.count;
    const theyBanIt = (banCount ?? 0) > 0;
    const mutual =
      idx >= 0 && (Boolean(args.wePlayHero) || theyBanIt);
    const ourBans = args.ourBanCount ?? 0;
    if (mutual && ourBans === 0) {
      addFactor(
        factors,
        "mutualBan",
        "Mutual ban timing",
        -36,
        theyBanIt && args.wePlayHero
          ? `They ban ${args.hero} (${banCount}) and we play it — hold for opening ban round 2 (not a 3rd ban)`
          : theyBanIt
            ? `They often ban ${args.hero} (${banCount}) — may take it for us; hold for opening ban round 2 (not a 3rd ban)`
            : `We play ${args.hero} too — they may ban it for us; hold for opening ban round 2 (not a 3rd ban)`,
        "-36 because this is a mutual deny case and we should wait until opening ban round 2, not spend a third ban on it",
      );
    } else if (mutual && ourBans === 1) {
      addFactor(
        factors,
        "mutualBan",
        "Mutual ban timing",
        22,
        `Still up — this is our opening ban round 2; take ${args.hero} now`,
        "+22 because this is now the round-2 opening ban slot and the mutual deny should be resolved here",
      );
    }
  }

  const total = factors.reduce((s, f) => s + f.points, 0);
  return { hero: args.hero, total, factors };
}

/** Display name of who owns this hero on their likely five. */
function theirOwnerName(
  hero: string,
  theirLikely: DraftCompPick[],
): string | null {
  const who = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
  return displayPlayer(who?.player ?? null);
}

/** Best comfort on this hero in the roster (optionally pinned to one player). */
function comfortSignal(
  roster: PlayerScout[],
  hero: string,
  player: string | null,
): { comfort: number; who: string | null } {
  if (!roster.length) return { comfort: 0, who: null };
  const want = displayPlayer(player)?.toLowerCase();
  let best: { comfort: number; who: string | null } = {
    comfort: 0,
    who: null,
  };
  for (const p of roster) {
    const name = displayPlayer(p.battletag);
    const nameKey = name?.toLowerCase();
    if (want && nameKey !== want) continue;
    const hit = p.topHeroes.find((h) => heroKey(h.hero) === heroKey(hero));
    if (!hit) {
      if (want) return { comfort: 0, who: name };
      continue;
    }
    if (want) return { comfort: hit.comfort, who: name };
    if (hit.comfort > best.comfort) {
      best = { comfort: hit.comfort, who: name };
    }
  }
  return best;
}

/** Lightweight live read of what shape a hero list is building. */
function liveArchetype(
  heroes: string[],
  scouted: string | null | undefined,
): string {
  const usable = heroes.filter(Boolean);
  if (usable.length >= 2) {
    const supports = usable.filter((h) => {
      const r = heroRole(h);
      return r === "Healer" || r === "Support";
    }).length;
    if (supports >= 2) return "double support / sustain";

    const tagCounts = new Map<string, number>();
    for (const h of usable) {
      for (const t of heroTags(h)) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const ranked = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    if (ranked.includes("dive") && ranked.includes("assassin")) return "dive";
    if (ranked.includes("siege") || ranked.includes("poke")) return "poke/siege";
    if (ranked.includes("hypercarry")) return "hypercarry protect";
    if (ranked.includes("solo") && ranked.includes("engage"))
      return "bruiser frontline";
    if (ranked[0]) return labelArchetypeTag(ranked[0]);
  }

  const fb = scouted?.trim();
  if (
    fb &&
    fb !== "unclear" &&
    fb !== "unknown" &&
    fb !== "flexible / mixed"
  ) {
    return fb;
  }
  return "still unclear";
}

function theirCompRead(
  history: BoardAction[],
  theirLikely: DraftCompPick[],
  gone: Set<string>,
  scouted: string | null | undefined,
): string {
  const locked = history
    .filter((a) => a.side === "their" && a.kind === "pick")
    .map((a) => a.hero);
  const projected = [
    ...locked,
    ...theirLikely.map((p) => p.hero).filter((h) => !isGone(h, gone)),
  ].slice(0, 5);
  return liveArchetype(projected.length ? projected : locked, scouted);
}

function uniqueHeroes(heroes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hero of heroes) {
    const key = heroKey(hero);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hero);
  }
  return out;
}

function joinHeroNames(heroes: string[]): string {
  return uniqueHeroes(heroes).join(" / ");
}

function projectedTheirHeroes(
  history: BoardAction[],
  theirLikely: DraftCompPick[],
  gone: Set<string>,
): string[] {
  const locked = history
    .filter((a) => a.side === "their" && a.kind === "pick")
    .map((a) => a.hero);
  return uniqueHeroes([
    ...locked,
    ...theirLikely.map((p) => p.hero).filter((h) => !isGone(h, gone)),
  ]).slice(0, 5);
}

export function explainTheirArchetypeRead(
  theirLabel: string,
  archetype: string,
  heroes: string[],
): string {
  const projected = uniqueHeroes(heroes).slice(0, 5);
  if (archetype === "dive") {
    const diveHeroes = projected.filter((hero) => heroTags(hero).includes("dive"));
    const assassinHeroes = projected.filter((hero) => heroTags(hero).includes("assassin"));
    const bits: string[] = [];
    if (diveHeroes.length) bits.push(`dive tags on ${joinHeroNames(diveHeroes)}`);
    if (assassinHeroes.length) {
      bits.push(`assassin pressure from ${joinHeroNames(assassinHeroes)}`);
    }
    if (bits.length) {
      return `${theirLabel} project as dive: ${bits.join(" and ")}.`;
    }
  }
  if (projected.length) {
    return `${theirLabel} project as ${archetype}: ${joinHeroNames(projected.slice(0, 3))}.`;
  }
  return `${theirLabel} project as ${archetype}.`;
}

export function explainTheirLikelyBan(
  theirLabel: string,
  hero: string,
  player: string | null,
  archetype: string,
): string {
  const base = `Likely ban: ${hero}${player ? ` (${player})` : ""}.`;
  if (
    archetype === "dive" &&
    divePlaybook.antiDiveHeroes.some((name) => heroKey(name) === heroKey(hero))
  ) {
    return `${base} ${hero} is an anti-dive counter, so ${theirLabel} should remove it to keep the dive shell live.`;
  }
  return base;
}

function isLateDiveAssassin(hero: string): boolean {
  // Priority cores (Qhira) are never "late" — take them and rebuild.
  if (shouldTakeAndRebuild(null, hero)) return false;
  return divePlaybook.lateDiveAssassins.some(
    (h) => heroKey(h) === heroKey(hero),
  );
}

/** Promote an OP / priority dive core into the visible plan seat. */
function rebuildPlanAroundCore(
  picks: DraftCompPick[],
  core: string,
  gone: Set<string>,
): DraftCompPick[] {
  const live = livePlanPicks(picks, gone);
  if (live.some((p) => heroKey(p.hero) === heroKey(core))) {
    return normalizeBruiserLanes(
      live.map((p) =>
        heroKey(p.hero) === heroKey(core)
          ? { ...p, note: "priority dive — rebuild around this" }
          : p,
      ),
    );
  }

  for (let i = 0; i < live.length; i++) {
    const p = live[i];
    const alt = p.alternatives?.find(
      (a) => heroKey(a.hero) === heroKey(core) && !isGone(a.hero, gone),
    );
    if (!alt) continue;
    return normalizeBruiserLanes(
      live.map((row, j) =>
        j === i
          ? {
              ...row,
              hero: alt.hero,
              player: alt.player ?? row.player,
              note: "priority dive — rebuild around this",
            }
          : row,
      ),
    );
  }

  // Force the core onto the best damage seat even if alts omitted it.
  const seatIndex = live.findIndex((p) => {
    const r = p.role.toLowerCase();
    return (
      r.includes("flex") ||
      r.includes("range") ||
      r.includes("follow") ||
      r.includes("burst") ||
      r.includes("clean") ||
      r.includes("4-man")
    );
  });
  if (seatIndex < 0) return normalizeBruiserLanes(live);
  return normalizeBruiserLanes(
    live.map((row, j) =>
      j === seatIndex
        ? {
            ...row,
            hero: core,
            note: "priority dive — rebuild around this",
          }
        : row,
    ),
  );
}

/** Swap banned/picked plan heroes for their next alt still on the board. */
function livePlanPicks(
  picks: DraftCompPick[],
  gone: Set<string>,
): DraftCompPick[] {
  const pivoted = picks.map((p) => {
    if (!isGone(p.hero, gone)) return p;
    const alt = p.alternatives?.find((a) => !isGone(a.hero, gone));
    if (!alt) return p;
    return {
      ...p,
      hero: alt.hero,
      player: alt.player ?? p.player,
      note: p.note
        ? `${p.note}; pivoted off ${p.hero}`
        : `pivoted off ${p.hero}`,
    };
  });
  return normalizeBruiserLanes(pivoted);
}

function samePlayer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    (displayPlayer(a) ?? a).toLowerCase() ===
    (displayPlayer(b) ?? b).toLowerCase()
  );
}

function isDamageSeatRole(role: string): boolean {
  const r = role.toLowerCase();
  return (
    r.includes("flex") ||
    r.includes("range") ||
    r.includes("follow") ||
    r.includes("burst") ||
    r.includes("clean") ||
    r.includes("4-man") ||
    r.includes("assassin")
  );
}

/** Does this hero fill the same job as a planned seat (tank for tank, etc.)? */
function heroFillsPlanSeat(hero: string, seat: DraftCompPick): boolean {
  if (heroKey(seat.hero) === heroKey(hero)) return true;
  const hr = heroRole(hero);
  const seatJob = planSeatJob(seat).toLowerCase();
  if (hr === "Tank" && seatJob === "tank") return true;
  if (
    (hr === "Healer" || hr === "Support") &&
    (seatJob === "healer" || seatJob === "support")
  ) {
    return true;
  }
  if (heroIsOfflaner(hero) && seatJob === "offlane") return true;
  if (
    isDamageSeatRole(seat.role) &&
    (hr.includes("Assassin") ||
      hr.includes("Ranged") ||
      hr === "Bruiser" ||
      hr.includes("Melee"))
  ) {
    // Don't count a tank/healer as their damage seat.
    if (hr === "Tank" || hr === "Healer" || hr === "Support") return false;
    return true;
  }
  return false;
}

/**
 * Match a hero to their likely five — exact hero first, else same seat role
 * (Tyrael and Anub'arak are equal tank-plan fits).
 */
function matchTheirPlanSeat(
  hero: string,
  theirLikely: DraftCompPick[],
): { seat: DraftCompPick; exact: boolean } | null {
  const exact = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
  if (exact) return { seat: exact, exact: true };
  const byRole = theirLikely.find((p) => heroFillsPlanSeat(hero, p));
  if (byRole) return { seat: byRole, exact: false };
  return null;
}

/**
 * After we lock a hero, stamp it onto that player's plan seat so the plan
 * stops listing their old hero (e.g. Qhira locked → MrHustler no longer "on Valla").
 * Open seats that still pointed at a taken player get reassigned to a free owner.
 * Then rewrite open seats to fill structural holes (ranged / clear).
 */
function applyLockedToPlan(
  picks: DraftCompPick[],
  locked: LockedPick[],
  home: PlayerScout[] = [],
  gone: Set<string> = new Set(),
): DraftCompPick[] {
  const next = picks.map((p) => ({ ...p }));
  const used = new Set<number>();
  const goneAll = new Set(gone);
  for (const L of locked) goneAll.add(heroKey(L.hero));

  for (const L of locked) {
    let idx = -1;
    if (L.player) {
      idx = next.findIndex(
        (p, i) => !used.has(i) && samePlayer(p.player, L.player),
      );
    }
    if (idx < 0) {
      idx = next.findIndex(
        (p, i) =>
          !used.has(i) &&
          (heroKey(p.hero) === heroKey(L.hero) ||
            p.alternatives?.some((a) => heroKey(a.hero) === heroKey(L.hero))),
      );
    }
    if (idx < 0 && shouldTakeAndRebuild(null, L.hero)) {
      idx = next.findIndex(
        (p, i) => !used.has(i) && isDamageSeatRole(p.role),
      );
    }
    if (idx < 0) {
      idx = next.findIndex((p, i) => !used.has(i));
    }
    if (idx < 0) continue;
    used.add(idx);
    const seat = next[idx];
    next[idx] = {
      ...seat,
      hero: L.hero,
      player: seat.player ?? L.player,
      note: "locked",
    };
  }

  const taken = lockedPlayerIds(locked);
  for (let i = 0; i < next.length; i++) {
    if (used.has(i)) continue;
    const seat = next[i];
    const who = displayPlayer(seat.player);
    if (who && taken.has(who.toLowerCase())) {
      const freeOwner =
        home.length > 0 ? bestFreeOwner(home, seat.hero, taken) : null;
      next[i] = {
        ...seat,
        player: freeOwner,
        note: freeOwner
          ? `was ${who}'s seat — now ${freeOwner}`
          : `was ${who}'s seat — need a free player`,
      };
      if (freeOwner) taken.add(freeOwner.toLowerCase());
    }
  }
  return fillPlanHoles(normalizeBruiserLanes(next), home, goneAll);
}

export function isLockedPlanSeat(p: DraftCompPick): boolean {
  return Boolean(p.note && /\b(?:locked|blocked)\b/i.test(p.note));
}

export function isValidStructureHero(
  hero: string,
  table: DraftMetaTable | null | undefined,
): boolean {
  if (!table) return true;
  const meta = heroDraftMeta(table, hero);
  if (meta.games < 60) return true;
  return (
    meta.winRate >= 46 ||
    meta.popularity >= 12 ||
    meta.influence >= -50
  );
}

/** Plan heroes still up, plus same-seat alternatives (e.g. Qhira under Valla). */
function pickCandidates(
  picks: DraftCompPick[],
  gone: Set<string>,
): { hero: string; role: string; player: string | null; fromAlt: boolean }[] {
  const out: {
    hero: string;
    role: string;
    player: string | null;
    fromAlt: boolean;
  }[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    if (isLockedPlanSeat(p)) continue;
    const add = (
      hero: string,
      player: string | null,
      fromAlt: boolean,
    ) => {
      const k = heroKey(hero);
      if (seen.has(k) || isGone(hero, gone)) return;
      seen.add(k);
      out.push({ hero, role: p.role, player, fromAlt });
    };
    add(p.hero, p.player, false);
    for (const a of p.alternatives ?? []) {
      add(a.hero, a.player ?? p.player, true);
    }
  }

  // Always surface priority dive cores (Qhira) even if the cached plan forgot them.
  for (const core of divePlaybook.priorityDiveCores) {
    if (seen.has(heroKey(core)) || isGone(core, gone)) continue;
    const seat =
      picks.find((p) => {
        if (isLockedPlanSeat(p)) return false;
        return isDamageSeatRole(p.role);
      }) ?? picks.find((p) => !isLockedPlanSeat(p));
    if (!seat) continue;
    seen.add(heroKey(core));
    out.push({
      hero: core,
      role: seat.role,
      player: seat.player,
      fromAlt: true,
    });
  }

  // Missing offlane → surface real offlaners on the offlane / open seat.
  if (!planHasOfflane(picks)) {
    const laneSeat =
      picks.find((p) => {
        if (isLockedPlanSeat(p)) return false;
        const r = p.role.toLowerCase();
        return r.includes("off") || r.includes("solo") || r.includes("clear");
      }) ?? picks.find((p) => !isLockedPlanSeat(p));
    if (laneSeat) {
      for (const h of [
        "Malthael",
        "Leoric",
        "Sonya",
        "Blaze",
        "Xul",
        "Dehaka",
        "Hogger",
      ]) {
        if (seen.has(heroKey(h)) || isGone(h, gone) || !heroIsOfflaner(h)) {
          continue;
        }
        seen.add(heroKey(h));
        out.push({
          hero: h,
          role: "Offlane",
          player: laneSeat.player,
          fromAlt: true,
        });
      }
    }
  }
  return out;
}

/** Open plan seats with their hero + alt candidates (for double-pick pairs). */
function seatPairCandidates(
  picks: DraftCompPick[],
  gone: Set<string>,
  takenPlayers: Set<string>,
): { role: string; player: string | null; cands: PairSeatCand[] }[] {
  const seats: { role: string; player: string | null; cands: PairSeatCand[] }[] =
    [];
  for (const p of picks) {
    if (isLockedPlanSeat(p)) continue;
    const who = displayPlayer(p.player);
    if (who && takenPlayers.has(who.toLowerCase())) continue;
    const cands: PairSeatCand[] = [];
    const seen = new Set<string>();
    const add = (hero: string, player: string | null, fromAlt: boolean) => {
      const k = heroKey(hero);
      if (seen.has(k) || isGone(hero, gone)) return;
      seen.add(k);
      cands.push({
        hero,
        role: p.role,
        player: displayPlayer(player) ?? player,
        fromAlt,
      });
    };
    add(p.hero, p.player, false);
    for (const a of p.alternatives ?? []) {
      add(a.hero, a.player ?? p.player, true);
    }
    // Offlane seat — surface real offlaners even if plan primary is stale.
    const roleL = p.role.toLowerCase();
    const offlaneSeat =
      roleL.includes("off") ||
      roleL.includes("solo") ||
      roleL.includes("clear") ||
      heroIsOfflaner(p.hero);
    if (offlaneSeat) {
      for (const h of [
        "Malthael",
        "Leoric",
        "Sonya",
        "Blaze",
        "Xul",
        "Dehaka",
        "Hogger",
      ]) {
        if (!heroIsOfflaner(h)) continue;
        add(h, p.player, true);
      }
    }
    // Tank seat — common shells so E.T.C. can beat a stale Stitches primary.
    if (heroRole(p.hero) === "Tank" || roleL.includes("tank")) {
      for (const h of [
        "E.T.C.",
        "Stitches",
        "Garrosh",
        "Anub'arak",
        "Diablo",
        "Johanna",
        "Mal'Ganis",
        "Arthas",
        "Tyrael",
      ]) {
        if (heroRole(h) !== "Tank") continue;
        add(h, p.player, true);
      }
    }
    if (cands.length) {
      seats.push({ role: p.role, player: displayPlayer(p.player), cands });
    }
  }
  return seats;
}

function heroFromTitle(title: string): string | null {
  const m =
    title.match(/^(?:Expected|Plan):\s*(.+)$/i) ||
    title.match(/:\s*([^:]+)$/) ||
    title.match(/If .+?:\s*(.+)$/i);
  const hero = m?.[1]?.trim();
  if (!hero || hero.startsWith("Flex")) return null;
  return hero;
}

function nodeAction(node: DraftTreeNode): DraftTreeAction | null {
  if (node.action) return node.action;
  const hero = heroFromTitle(node.title);
  if (!hero) return null;
  const side = /their/i.test(node.title)
    ? "their"
    : /our/i.test(node.title)
      ? "our"
      : node.branch
        ? "their"
        : null;
  const kind = /ban/i.test(node.title)
    ? "ban"
    : /pick/i.test(node.title)
      ? "pick"
      : null;
  if (!side || !kind) return null;
  return { side, kind, ordinal: 0, hero, player: null };
}

/** Flatten the expected path of the tree into ordered hero suggestions. */
function expectedPath(root: DraftTreeNode): { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[] {
  const out: { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[] = [];
  let node: DraftTreeNode | null = root;
  while (node) {
    const kids: DraftTreeNode[] = node.children ?? [];
    const expected: DraftTreeNode | undefined =
      kids.find((c: DraftTreeNode) => c.branch === "expected") ??
      kids.find((c: DraftTreeNode) => /^(Expected|Plan):/i.test(c.title));
    const adjust: DraftTreeNode | undefined =
      kids.find((c: DraftTreeNode) => c.branch === "adjust") ??
      kids.find((c: DraftTreeNode) => /^If /i.test(c.title));
    if (expected && adjust) {
      const act = nodeAction(expected);
      if (act) out.push({ hero: act.hero, side: act.side, kind: act.kind });
      node = expected.children?.[0] ?? null;
      continue;
    }
    const act = nodeAction(node);
    if (act) out.push({ hero: act.hero, side: act.side, kind: act.kind });
    node = kids[0] ?? null;
  }
  return out;
}

function slotsFor(
  history: BoardAction[],
  side: "our" | "their",
  kind: "ban" | "pick",
  count: number,
): (BoardAction | null)[] {
  const got = history.filter((a) => a.side === side && a.kind === kind);
  return Array.from({ length: count }, (_, i) => got[i] ?? null);
}

function goneKeys(history: BoardAction[]): Set<string> {
  return new Set(history.map((a) => heroKey(a.hero)));
}

function isGone(hero: string, gone: Set<string>): boolean {
  return gone.has(heroKey(hero));
}

function displayPlayer(tag: string | null): string | null {
  if (!tag) return null;
  return tag.split("#")[0]?.trim() || tag.trim() || null;
}

export function pairProgressPlanPicks(
  picks: DraftCompPick[],
  pairPick: string[],
): DraftCompPick[] {
  if (!pairPick.length) return picks;
  const projected = showSuggestionOnPlan(picks, pairPick[0], null);
  const locked = new Set(pairPick.map((h) => heroKey(h)));
  return projected.map((p) =>
    locked.has(heroKey(p.hero)) ? { ...p, note: "locked" } : p,
  );
}

export function planPickLabel(p: DraftCompPick): string {
  const who = displayPlayer(p.player);
  const job = planSeatJob(p);
  const base = who ? `${job} — ${who} · ${p.hero}` : `${job} — ${p.hero}`;
  if (isLockedPlanSeat(p)) return `LOCKED  ${base}`;
  const altOf = p.note?.match(/suggesting instead of\s+(.+)/i)?.[1]?.trim();
  if (altOf) return `SUGGEST ${base} (instead of ${altOf})`;
  return `NEED    ${base}`;
}

/** Resolve which plan seat a candidate belongs to.
 * Same-role swaps are only valid when the suggestion is for the same player on that seat.
 * A generic role match alone should not rewrite another player's seat. */
export function findSeatForCandidate(
  picks: DraftCompPick[],
  hero: string,
  player?: string | null,
): { seat: DraftCompPick; asAlt: boolean; replaces: string | null } | null {
  for (const p of picks) {
    if (isLockedPlanSeat(p)) continue;
    if (heroKey(p.hero) === heroKey(hero)) {
      return { seat: p, asAlt: false, replaces: null };
    }
  }
  for (const p of picks) {
    if (isLockedPlanSeat(p)) continue;
    if (p.alternatives?.some((a) => heroKey(a.hero) === heroKey(hero))) {
      return { seat: p, asAlt: true, replaces: p.hero };
    }
  }
  for (const p of picks) {
    if (isLockedPlanSeat(p)) continue;
    const samePlayerSeat =
      !player ||
      !p.player ||
      samePlayer(player, p.player) ||
      samePlayer(displayPlayer(player), displayPlayer(p.player));
    if (samePlayerSeat && heroFillsPlanSeat(hero, p)) {
      return { seat: p, asAlt: true, replaces: p.hero };
    }
  }
  return null;
}

/** Put the suggested hero on its seat so the plan list matches the card. */
export function showSuggestionOnPlan(
  picks: DraftCompPick[],
  hero: string,
  player: string | null,
): DraftCompPick[] {
  const found = findSeatForCandidate(picks, hero, player);
  if (!found) return picks;
  return picks.map((p) => {
    if (p !== found.seat) return p;
    return {
      ...p,
      hero,
      player: player ?? found.seat.player ?? p.player,
      note: found.asAlt
        ? `suggesting instead of ${found.replaces}`
        : p.note,
    };
  });
}

/** Name our shape and how it answers their likely archetype. */
function compMatchupLine(
  brief: OurCompBrief | null,
  theirArchetype: string | null,
  archetypeCounter: string | null,
  /** Live five when the suggestion has already swapped an alt onto the plan. */
  livePicks?: DraftCompPick[] | null,
  theirLikely?: DraftCompPick[],
): string | null {
  if (livePicks?.length) {
    return liveCompMatchupLine({
      picks: livePicks,
      theirLikely,
      theirArchetype,
      fallbackCounter: archetypeCounter ?? brief?.whyItWorks ?? null,
    });
  }
  if (!brief && !archetypeCounter) return null;
  const our = brief?.kind ?? "Our five";
  const theirRaw = theirArchetype?.trim() ?? "";
  const theirOk =
    theirRaw &&
    theirRaw !== "unclear" &&
    theirRaw !== "unknown" &&
    theirRaw !== "flexible / mixed";
  const their = theirOk ? `their ${theirRaw}` : "their likely shape";
  const head = `${our} into ${their}`;
  if (archetypeCounter) return `${head} — ${archetypeCounter}`;
  if (brief?.whyItWorks) return `${head} — ${brief.whyItWorks}`;
  return `${head}.`;
}

export function expectTheirNext(
  planned: { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[],
  historyLen: number,
  gone: Set<string>,
  theirLikely: DraftCompPick[],
  currentStepIsOurBan?: boolean,
): string | null {
  if (currentStepIsOurBan) return null;
  for (let i = historyLen; i < planned.length; i++) {
    const step = planned[i];
    if (step.side !== "their") continue;
    if (isGone(step.hero, gone)) continue;
    const who = theirLikely.find(
      (p) => heroKey(p.hero) === heroKey(step.hero),
    );
    const verb = step.kind === "ban" ? "ban" : "pick";
    return `Expect them to ${verb} ${step.hero} next${who?.player ? ` (${displayPlayer(who.player)})` : ""}.`;
  }
  const nextLikely = theirLikely.find((p) => !isGone(p.hero, gone));
  if (nextLikely) {
    const who = displayPlayer(nextLikely.player);
    return `Expect them toward ${nextLikely.hero}${who ? ` (${who})` : ""} from their likely five.`;
  }
  return null;
}

/** Later offlane outs if we open a bruiser as flex bait. */
function offlaneFollowUps(
  hero: string,
  planPicks: DraftCompPick[],
  gone: Set<string>,
): string[] {
  const slot = planPicks.find((p) => heroKey(p.hero) === heroKey(hero));
  const fromAlts =
    slot?.alternatives
      ?.map((a) => a.hero)
      .filter((h) => !isGone(h, gone) && heroKey(h) !== heroKey(hero)) ?? [];
  const defaults = ["Sonya", "Dehaka", "Malthael", "Blaze", "Hogger"].filter(
    (h) => !isGone(h, gone) && heroKey(h) !== heroKey(hero),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [...fromAlts, ...defaults]) {
    const k = heroKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= 3) break;
  }
  return out;
}

/** Heal / support seat or hero. */
function isHealPick(hero: string, role?: string | null): boolean {
  const job = (role ?? "").toLowerCase();
  if (job.includes("heal") || job.includes("support")) return true;
  const r = heroRole(hero);
  return r === "Healer" || r === "Support";
}

/** They want this hero (comfort five or deny ban list) — picking it blocks them. */
function theyMightTake(
  hero: string,
  theirLikely: DraftCompPick[],
  banPriority: { hero: string; reason: string }[],
): { who: string | null; via: "likely" | "deny" } | null {
  const likely = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
  if (likely) {
    return { who: displayPlayer(likely.player), via: "likely" };
  }
  const deny = banPriority.find((b) => heroKey(b.hero) === heroKey(hero));
  if (deny) return { who: null, via: "deny" };
  return null;
}

/** Other damage-seat options still open (excluding one hero). */
function damageOutsStillUp(
  planPicks: DraftCompPick[],
  gone: Set<string>,
  exclude?: string | null,
): string[] {
  const ex = exclude ? heroKey(exclude) : "";
  return pickCandidates(planPicks, gone)
    .filter(
      (c) =>
        heroKey(c.hero) !== ex &&
        (isDamageSeatRole(c.role) || shouldTakeAndRebuild(null, c.hero)),
    )
    .map((c) => c.hero);
}

/**
 * Prefer second damage before heal only when damage is scarce *and* the heal
 * is not a deny/comfort block on them.
 */
function shouldPreferDamageBeforeHeal(args: {
  damageHero: string;
  healHero?: string | null;
  planPicks: DraftCompPick[];
  gone: Set<string>;
  theirLikely: DraftCompPick[];
  banPriority: { hero: string; reason: string }[];
}): boolean {
  const outs = damageOutsStillUp(
    args.planPicks,
    args.gone,
    args.damageHero,
  );
  // Plenty of second-damage pivots — do not force damage before heal.
  if (outs.length >= 2) return false;

  const healThreat = args.healHero
    ? theyMightTake(args.healHero, args.theirLikely, args.banPriority)
    : null;
  // Even one damage out left: if heal is a deny/comfort block, heal-first is fine.
  if (healThreat && outs.length >= 1) return false;

  // Scarce damage (0–1 other outs) and no heal-block signal → prefer damage.
  return true;
}

/** Why lock a second damage seat before the healer (when that rule applies). */
function damageBeforeHealWhy(
  damageHero: string,
  withDamage: string[],
): string {
  const withLine =
    withDamage.length > 0
      ? ` with ${withDamage.join(" + ")} already locked`
      : "";
  return (
    `Take ${damageHero} before the healer${withLine}: ` +
    `second damage finishes kills and is scarce this step (few outs left), ` +
    `while healer pools are deep — you can still land a strong heal later without losing the win condition.`
  );
}

function healBlockWhy(
  healHero: string,
  threat: { who: string | null; via: "likely" | "deny" },
  damageOuts: string[],
): string {
  const who = threat.who ? ` (${threat.who})` : "";
  const deny =
    threat.via === "likely"
      ? `${healHero}${who} is on their likely five — locking it is a comfort pick and a block`
      : `${healHero} is a deny target — locking it keeps it off them`;
  const outs =
    damageOuts.length > 0
      ? ` Second damage still has outs (${damageOuts.slice(0, 4).join(", ")}).`
      : "";
  return `${deny}.${outs}`;
}

function offlaneBaitReason(
  hero: string,
  threats: MatchupEdge[],
  followUps: string[],
): string {
  const later =
    followUps.length > 0
      ? followUps.slice(0, 3).join(" / ")
      : "a real offlaner later";
  const bite =
    threats.length > 0
      ? `If they bite with ${threats
          .slice(0, 2)
          .map((t) => t.hero)
          .join(" / ")}, play ${hero} in the 4-man and take ${later} as the actual offlane — their "counter" is then stuck in a bad lane.`
      : `If they answer offlane into ${hero}, play ${hero} in the 4-man and take ${later} as the actual offlane — punish the lane they just declared.`;
  return (
    `Lock ${hero} as a flex bait — not as our committed offlaner. ` +
    `Offlane is ~half the game; first-picking your real offlane into open answers is how you lose the draft before level 1. ` +
    bite
  );
}

/** Blunt warning when suggested pick still loses hard to heroes up. */
function hardCounterCaution(
  hero: string,
  threats: MatchupEdge[],
  theirLocked: string[] = [],
  answeringTeamPool?: string[] | null,
): string | null {
  const live = credibleOpenCounters(
    threats,
    theirLocked,
    answeringTeamPool,
  );
  if (!live.length) return null;
  const ranked = [...live].sort(
    (a, b) =>
      b.games - a.games || b.theirWinRate - a.theirWinRate || a.hero.localeCompare(b.hero),
  );
  const top = ranked[0];
  const list = ranked.slice(0, 3).map(formatCounter).join(", ");
  const fill = counterRoleFillNote(threats, theirLocked, answeringTeamPool);
  return (
    `Don't lock ${hero} into these — still available: ${list}. ` +
    `Ban or force them off first. ${top.hero} wins this matchup ${top.theirWinRate}% across ${top.games}g SL.` +
    (fill ? ` ${fill}` : "")
  );
}

function pickReason(args: {
  table: DraftMetaTable | null | undefined;
  hero: string;
  ourPickCount: number;
  gone: Set<string>;
  map: string | null;
  planPicks: DraftCompPick[];
  expectLine: string | null;
  theirLikely?: DraftCompPick[];
  banPriority?: { hero: string; reason: string }[];
  /** True when we are opening offlane as intentional bait, not as the lane lock. */
  offlaneBait?: boolean;
  /** OP / priority pocket — take it and rebuild the five. */
  takeAndRebuild?: boolean;
  /** Anti-dive already shown — rebuild into pivot shell, not pure dive. */
  leaveDive?: boolean;
  leaveDivePivot?: string | null;
  /** Heroes already locked on our side — used to say "with Qhira", not "instead of". */
  locked?: LockedPick[];
  /** Their locked heroes — drop counter-warnings for roles they already filled. */
  theirLocked?: string[];
  /** Heroes they actually play — open answers must be in this pool. */
  answeringTeamPool?: string[] | null;
  /** Seat owner from candidate meta (primary or alt). */
  seatPlayer?: string | null;
  seatRole?: string | null;
  asAlt?: boolean;
  replaces?: string | null;
}): { reason: string; cautionLine: string | null } {
  const meta = heroDraftMeta(args.table, args.hero);
  const found = findSeatForCandidate(args.planPicks, args.hero);
  const slot = found?.seat ?? null;
  const role = args.seatRole ?? slot?.role ?? null;
  const who =
    displayPlayer(args.seatPlayer ?? null) ??
    displayPlayer(slot?.player ?? null);
  const replacing =
    args.replaces ??
    (found?.asAlt ? found.replaces : null) ??
    null;
  const isAlt = Boolean(args.asAlt || found?.asAlt || replacing);
  const theirLocked = args.theirLocked ?? [];
  const threats = credibleOpenCounters(
    liveCountersUp(args.table, args.hero, args.gone),
    theirLocked,
    args.answeringTeamPool,
  );
  const mapHit = isMapSpecialist(args.table, args.hero, args.map);
  const parts: string[] = [];
  const opening = args.ourPickCount === 0;
  const offlaneSeat = isOfflanePlanRole(role);
  const lockedDamage = (args.locked ?? []).filter((l) => {
    const r =
      args.planPicks.find((p) => heroKey(p.hero) === heroKey(l.hero))?.role ??
      heroRole(l.hero);
    return isDamageSeatRole(r) || shouldTakeAndRebuild(null, l.hero);
  });

  if (args.takeAndRebuild) {
    if (args.leaveDive) {
      const pivot = args.leaveDivePivot ?? "the leave-dive pivot";
      parts.push(
        `Take ${args.hero} now${who ? ` for ${who}` : ""} — still our best pocket. ` +
          `Do not rebuild as Genji-dive: fill ${pivot} around her (peel/poke tank + zone heal + ranged squeeze).`,
      );
    } else {
      parts.push(
        `Take ${args.hero} now${who ? ` for ${who}` : ""} — strongest dive in our pool and the pick you rebuild around. ` +
          `Fill engage tank + enable heal + waveclear offlane to support ${args.hero}.`,
      );
    }
  } else if (opening && (args.offlaneBait || offlaneSeat)) {
    parts.push(
      offlaneBaitReason(
        args.hero,
        threats,
        offlaneFollowUps(args.hero, args.planPicks, args.gone),
      ),
    );
    if (who) parts.push(`${who} shows it; they do not have to end on it.`);
  } else if (isAlt && who && replacing) {
    const job = slot ? planSeatJob(slot) : role ?? "that seat";
    parts.push(
      `${args.hero} for ${who} (${job}) — plan alt instead of ${replacing} (${meta.winRate.toFixed(1)}% WR this patch).`,
    );
  } else if (slot || who || role) {
    const job = slot ? planSeatJob(slot) : role ?? "open seat";
    if (opening && isFlexibleAnchorRole(role)) {
      parts.push(
        `${args.hero} for ${who ?? "us"} (${job}) — flexible early lock (${meta.winRate.toFixed(1)}% WR, ${meta.influence} influence, ${meta.games}g SL).`,
      );
    } else if (opening && who) {
      parts.push(
        `${args.hero} for ${who} (${job}) — ${meta.winRate.toFixed(1)}% WR, ${meta.influence} influence (${meta.games}g SL).`,
      );
    } else if (who) {
      parts.push(
        `${args.hero} for ${who} (${job}) — ${meta.winRate.toFixed(1)}% WR this patch.`,
      );
    } else {
      parts.push(
        `${args.hero} fills ${job} next — ${meta.winRate.toFixed(1)}% WR this patch.`,
      );
    }
    if (lockedDamage.length && role && isDamageSeatRole(role)) {
      const withWho = lockedDamage.map((l) => {
        const n = displayPlayer(l.player);
        return n ? `${l.hero} (${n})` : l.hero;
      });
      parts.push(
        `This is ${args.hero} *with* ${withWho.join(" + ")} — a second damage seat, not a replacement for their pick.`,
      );
      const openHeal = args.planPicks.find((p) => {
        if (isLockedPlanSeat(p)) return false;
        return isHealPick(p.hero, p.role);
      });
      if (
        openHeal &&
        shouldPreferDamageBeforeHeal({
          damageHero: args.hero,
          healHero: openHeal.hero,
          planPicks: args.planPicks,
          gone: args.gone,
          theirLikely: args.theirLikely ?? [],
          banPriority: args.banPriority ?? [],
        })
      ) {
        parts.push(damageBeforeHealWhy(args.hero, withWho));
      } else if (openHeal) {
        const threat = theyMightTake(
          openHeal.hero,
          args.theirLikely ?? [],
          args.banPriority ?? [],
        );
        const outs = damageOutsStillUp(
          args.planPicks,
          args.gone,
          args.hero,
        );
        if (threat && outs.length >= 1) {
          parts.push(
            `Heal can come first if you want — ${healBlockWhy(openHeal.hero, threat, [args.hero, ...outs].slice(0, 4))}`,
          );
        }
      }
    }
  } else {
    parts.push(
      `No plan seat claims ${args.hero} — prefer a NEED seat above so someone owns the pick.`,
    );
  }

  if (mapHit) {
    parts.push(
      `Map specialist on ${mapHit.map}: ${mapHit.winRate}% WR (+${mapHit.deltaPp}pp vs baseline, ${mapHit.games}g).`,
    );
  }

  if (args.expectLine) parts.push(args.expectLine);

  let caution: string | null = null;
  if (args.takeAndRebuild) {
    caution = args.leaveDive
      ? `Plan is now ${args.hero} inside ${args.leaveDivePivot ?? "the anti-dive pivot"} — not a pure dive shell.` +
        (threats.length
          ? ` ${hardCounterCaution(args.hero, threats, theirLocked, args.answeringTeamPool) ?? ""}`
          : "")
      : `Plan is now ${args.hero}-dive. Fill tank / heal / offlane to enable them.` +
        (threats.length
          ? ` ${hardCounterCaution(args.hero, threats, theirLocked, args.answeringTeamPool) ?? ""}`
          : "");
  } else if (opening && (args.offlaneBait || offlaneSeat)) {
    caution =
      `Do not play ${args.hero} as the offlaner if they take a lane answer — that is the bait working. ` +
      (threats.length
        ? `Open answers still up: ${threats
            .slice(0, 3)
            .map(formatCounter)
            .join(", ")}.`
        : `Hold a real offlaner for after they declare the lane.`);
  } else {
    caution = hardCounterCaution(
      args.hero,
      threats,
      theirLocked,
      args.answeringTeamPool,
    );
  }

  return { reason: parts.join(" "), cautionLine: caution };
}

/**
 * After locking something other than the suggestion — say why that was a
 * minor/major miss (power, timing, answers). No seat / NEED bookkeeping.
 */
function gradeDeviation(args: {
  ours: boolean;
  kind: "ban" | "pick";
  suggested: string;
  chosen: string;
  planPicks: DraftCompPick[];
  banPriority: { hero: string; reason: string }[];
  theirLikely: DraftCompPick[];
  table: DraftMetaTable | null | undefined;
  gone: Set<string>;
  map: string | null;
  ourPickCount: number;
  /** True when this lock finishes the draft (no deny / pick left). */
  isLastStep?: boolean;
  /** Team that would answer open counters (role-fill filters). */
  answeringTeamLocked?: string[];
  /** Heroes the answering team actually plays. */
  answeringTeamPool?: string[] | null;
  /** Scorecard totals — drive minor vs major when both options are fine. */
  suggestedTotal: number;
  chosenTotal: number;
}): { summary: string; severity: DeviationSeverity; structuralReasons: string[] } | null {
  if (heroKey(args.suggested) === heroKey(args.chosen)) return null;

  if (!args.ours) {
    const did = args.kind === "ban" ? "banned" : "picked";
    if (args.isLastStep) {
      return {
        summary: `They ${did} ${args.chosen} — they should have ${did} ${args.suggested}. Last pick of the draft; nothing left to deny.`,
        severity: "info",
        structuralReasons: [],
      };
    }
    return {
      summary: `They ${did} ${args.chosen} — they should have ${did} ${args.suggested}.`,
      severity: "info",
      structuralReasons: [],
    };
  }

  if (args.kind === "ban") {
    const sug = args.banPriority.find(
      (b) => heroKey(b.hero) === heroKey(args.suggested),
    );
    const chose = args.banPriority.find(
      (b) => heroKey(b.hero) === heroKey(args.chosen),
    );
    // Off the ban list while the suggestion was on it = worthless slot.
    const structuralReasons =
      sug && !chose
        ? [`${args.chosen} was not on the ban list; ${args.suggested} was`]
        : [];
    const severity = classifyDeviationSeverity({
      structural: structuralReasons.length > 0,
      suggestedTotal: args.suggestedTotal,
      chosenTotal: args.chosenTotal,
    });
    const labelSev = severity === "solid" ? "minor" : severity;
    const bits: string[] = [
      mistakeLabel(labelSev, "ban", args.chosen, args.suggested),
    ];
    if (sug) bits.push(sug.reason);
    else bits.push(`${args.suggested} was the higher-value deny this step.`);
    if (!chose) {
      bits.push(`${args.chosen} was not worth the ban slot over that.`);
    } else if (severity === "minor") {
      bits.push(
        `Both were fine denies (${args.chosenTotal > 0 ? "+" : ""}${args.chosenTotal} vs ${args.suggestedTotal > 0 ? "+" : ""}${args.suggestedTotal}) — preference more than a throw.`,
      );
    }
    return { summary: bits.join(" "), severity, structuralReasons };
  }

  const sugSeat = findSeatForCandidate(args.planPicks, args.suggested);
  const choseSeat = findSeatForCandidate(args.planPicks, args.chosen);
  const sugMeta = heroDraftMeta(args.table, args.suggested);
  const choseMeta = heroDraftMeta(args.table, args.chosen);
  const sugThreats = args.isLastStep
    ? []
    : credibleOpenCounters(
        liveCountersUp(args.table, args.suggested, args.gone),
        args.answeringTeamLocked ?? [],
        args.answeringTeamPool,
      );
  const choseThreats = args.isLastStep
    ? []
    : credibleOpenCounters(
        liveCountersUp(args.table, args.chosen, args.gone),
        args.answeringTeamLocked ?? [],
        args.answeringTeamPool,
      );
  const sugRole = sugSeat?.seat.role ?? null;
  const choseRole = choseSeat?.seat.role ?? null;
  const sugJob = (sugSeat ? planSeatJob(sugSeat.seat) : sugRole ?? "").toLowerCase();
  const choseJob = (choseSeat ? planSeatJob(choseSeat.seat) : choseRole ?? "").toLowerCase();
  const missedOp =
    shouldTakeAndRebuild(args.table, args.suggested) &&
    !shouldTakeAndRebuild(args.table, args.chosen);
  const openedOfflane =
    args.ourPickCount === 0 &&
    isOfflanePlanRole(choseRole) &&
    !shouldTakeAndRebuild(args.table, args.chosen);

  const lockedDamage = args.planPicks.filter((p) => {
    if (!isLockedPlanSeat(p)) return false;
    return (
      isDamageSeatRole(p.role) || shouldTakeAndRebuild(null, p.hero)
    );
  });
  const sugIsDamage =
    isDamageSeatRole(sugRole ?? "") ||
    shouldTakeAndRebuild(args.table, args.suggested);
  const choseIsHeal = isHealPick(args.chosen, choseRole ?? choseJob);
  const sugIsHeal = isHealPick(args.suggested, sugRole ?? sugJob);

  const damageOuts = damageOutsStillUp(
    args.planPicks,
    args.gone,
    args.suggested,
  );
  const healThreat = choseIsHeal
    ? theyMightTake(args.chosen, args.theirLikely, args.banPriority)
    : null;
  const ourPlanHeal =
    choseIsHeal &&
    choseSeat &&
    !choseSeat.asAlt &&
    isHealPick(choseSeat.seat.hero, choseSeat.seat.role);
  const preferDamage = shouldPreferDamageBeforeHeal({
    damageHero: args.suggested,
    healHero: args.chosen,
    planPicks: args.planPicks,
    gone: args.gone,
    theirLikely: args.theirLikely,
    banPriority: args.banPriority,
  });
  const healFirstOk =
    sugIsDamage &&
    choseIsHeal &&
    !sugIsHeal &&
    !preferDamage &&
    damageOuts.length >= 1 &&
    Boolean(healThreat || ourPlanHeal);

  // Comfort/deny heal with damage outs left — not a mistake.
  if (healFirstOk) {
    if (healThreat) {
      return {
        summary:
          `Solid: locked ${args.chosen} over ${args.suggested}. ` +
          healBlockWhy(args.chosen, healThreat, [
            args.suggested,
            ...damageOuts,
          ]),
        severity: "solid",
        structuralReasons: [],
      };
    }
    return {
      summary:
        `Solid: locked ${args.chosen} over ${args.suggested}. ` +
        `Comfort heal now is fine — second damage still has outs (${[
          args.suggested,
          ...damageOuts,
        ]
          .slice(0, 4)
          .join(", ")}), so you are not forced to take damage before heal.`,
      severity: "solid",
      structuralReasons: [],
    };
  }

  const forceDamageFirst =
    sugIsDamage &&
    choseIsHeal &&
    !sugIsHeal &&
    preferDamage;

  const walkedIntoAnswers =
    (choseThreats.length >= 2 && sugThreats.length === 0) ||
    (choseThreats.length >= 2 &&
      choseThreats.length >= sugThreats.length + 2);

  const structuralReasons: string[] = [];
  if (missedOp) {
    structuralReasons.push(
      `Passed the take-and-rebuild pocket (${args.suggested})`,
    );
  }
  if (openedOfflane) {
    structuralReasons.push(
      isFlexibleAnchorRole(sugRole)
        ? `Opened committed offlane instead of flexible ${args.suggested}`
        : `Opened committed offlane into answers`,
    );
  }
  if (forceDamageFirst) {
    structuralReasons.push(
      `Took heal before damage while ${args.suggested} (and outs) were still open`,
    );
  }
  if (walkedIntoAnswers) {
    structuralReasons.push(
      `Locked into open answers (${choseThreats
        .slice(0, 2)
        .map((t) => t.hero)
        .join(", ")})`,
    );
  }

  const structural = structuralReasons.length > 0;
  const severity = classifyDeviationSeverity({
    structural,
    suggestedTotal: args.suggestedTotal,
    chosenTotal: args.chosenTotal,
  });

  const bits: string[] = [
    mistakeLabel(
      severity === "solid" ? "minor" : severity,
      "pick",
      args.chosen,
      args.suggested,
    ),
  ];
  if (args.suggestedTotal > args.chosenTotal) {
    bits.push(
      formatScoreGapSentence({
        suggested: args.suggested,
        chosen: args.chosen,
        suggestedTotal: args.suggestedTotal,
        chosenTotal: args.chosenTotal,
      }),
    );
  }

  if (missedOp) {
    bits.push(
      `${args.suggested} was the take-and-rebuild pocket — strongest thing still open; passing wastes the window.`,
    );
  }

  if (openedOfflane && isFlexibleAnchorRole(sugRole)) {
    bits.push(
      `First-picking the offlane commit lets them answer the lane; ${args.suggested} keeps the offlaner hidden.`,
    );
  } else if (openedOfflane && choseThreats.length > 0) {
    bits.push(
      `${args.chosen} as the opening offlane walks into ${choseThreats
        .slice(0, 2)
        .map(formatCounter)
        .join(", ")}.`,
    );
  } else if (openedOfflane) {
    bits.push(
      `First-picking the offlane commit shows the lane before they have to.`,
    );
  }

  if (forceDamageFirst) {
    const withWho = lockedDamage.map((p) => {
      const n = displayPlayer(p.player);
      return n ? `${p.hero} (${n})` : p.hero;
    });
    bits.push(damageBeforeHealWhy(args.suggested, withWho));
  }

  if (choseThreats.length > sugThreats.length) {
    bits.push(
      `${args.chosen} is more answerable right now (${choseThreats
        .slice(0, 2)
        .map(formatCounter)
        .join(", ")})` +
        (sugThreats.length
          ? ` than ${args.suggested} (${sugThreats
              .slice(0, 2)
              .map(formatCounter)
              .join(", ")}).`
          : ` than ${args.suggested}.`),
    );
  } else if (
    choseThreats.length > 0 &&
    sugThreats.length === 0 &&
    !openedOfflane
  ) {
    bits.push(
      `${args.chosen} still loses hard to ${formatCounter(choseThreats[0])}; ${args.suggested} was cleaner.`,
    );
  }

  const wrGap = sugMeta.winRate - choseMeta.winRate;
  if (wrGap >= 1.5 && !healFirstOk) {
    bits.push(
      `${args.suggested} is stronger this patch (${sugMeta.winRate.toFixed(1)}% vs ${choseMeta.winRate.toFixed(1)}% WR).`,
    );
  }

  const sugMap = isMapSpecialist(args.table, args.suggested, args.map);
  const choseMap = isMapSpecialist(args.table, args.chosen, args.map);
  if (sugMap && !choseMap) {
    bits.push(
      `${args.suggested} is a ${sugMap.map} specialist (+${sugMap.deltaPp}pp); ${args.chosen} is not.`,
    );
  }

  const sugScore = earlyPickScore(args.table, args.suggested, {
    gone: args.gone,
    map: args.map,
    ourPickCount: args.ourPickCount,
    inPlan: Boolean(sugSeat),
    planRole: sugRole,
    answeringTeamLocked: args.answeringTeamLocked,
    answeringTeamPool: args.answeringTeamPool,
    lastPick: args.isLastStep,
  });
  const choseScore = earlyPickScore(args.table, args.chosen, {
    gone: args.gone,
    map: args.map,
    ourPickCount: args.ourPickCount,
    inPlan: Boolean(choseSeat),
    planRole: choseRole,
    answeringTeamLocked: args.answeringTeamLocked,
    answeringTeamPool: args.answeringTeamPool,
    lastPick: args.isLastStep,
  });
  if (bits.length === 1 && sugScore > choseScore) {
    bits.push(
      `${args.suggested} scored harder this step on patch power, timing, and open answers.`,
    );
  } else if (bits.length === 1) {
    bits.push(
      `${args.suggested} was the higher-value lock on timing and contest risk.`,
    );
  }

  // Never paint a structural throw as "both scored well".
  if (severity === "minor" && !structural) {
    bits.push(
      `Both scored well (${args.chosenTotal > 0 ? "+" : ""}${args.chosenTotal} vs ${args.suggestedTotal > 0 ? "+" : ""}${args.suggestedTotal}) — judgment call more than a throw.`,
    );
  }

  return { summary: bits.join(" "), severity, structuralReasons };
}

function ownerForHero(
  hero: string,
  planPicks: DraftCompPick[],
  home: PlayerScout[],
  locked: LockedPick[],
): string | null {
  const taken = lockedPlayerIds(locked);
  const free = (name: string | null) =>
    Boolean(name) && !taken.has(name!.toLowerCase());

  const fromPlan = planPicks.find(
    (p) => heroKey(p.hero) === heroKey(hero) && p.player,
  )?.player;
  const fromPlanName = displayPlayer(fromPlan ?? null);
  if (fromPlanName && free(fromPlanName)) return fromPlanName;

  const fromAlt = planPicks.find((p) =>
    p.alternatives?.some(
      (a) => heroKey(a.hero) === heroKey(hero) && (a.player || p.player),
    ),
  );
  if (fromAlt) {
    const alt = fromAlt.alternatives?.find(
      (a) => heroKey(a.hero) === heroKey(hero),
    );
    const name = displayPlayer(alt?.player ?? fromAlt.player);
    if (name && free(name)) return name;
  }

  // Priority dive cores → planned flex / damage seat if still free.
  if (shouldTakeAndRebuild(null, hero)) {
    const seat = planPicks.find(
      (p) => p.player && isDamageSeatRole(p.role),
    );
    const name = displayPlayer(seat?.player ?? null);
    if (name && free(name)) return name;
  }

  return bestFreeOwner(home, hero, taken);
}

function theirOwnerForHero(
  hero: string,
  theirLikely: DraftCompPick[],
  history: BoardAction[],
  theirRoster: PlayerScout[] = [],
): string | null {
  const used = lockedPlayerIds(
    history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => ({
        hero: a.hero,
        player: displayPlayer(a.player),
      })),
  );

  const direct = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
  const directName = displayPlayer(direct?.player ?? null);
  if (directName && !used.has(directName.toLowerCase())) return directName;

  if (theirRoster.length) {
    return bestFreeOwner(theirRoster, hero, used);
  }

  const next = theirLikely.find((p) => {
    const who = displayPlayer(p.player);
    return who && !used.has(who.toLowerCase());
  });
  return displayPlayer(next?.player ?? null);
}

/** Re-stamp every pick on a side so each player owns at most one hero. */
function restampSidePlayers(
  history: BoardAction[],
  side: "our" | "their",
  roster: PlayerScout[],
  planHints: DraftCompPick[],
): BoardAction[] {
  const sidePicks = history.filter((a) => a.side === side && a.kind === "pick");
  if (!sidePicks.length) return history;

  const assigned = assignUniqueOwners({
    locked: sidePicks.map((a) => ({ hero: a.hero })),
    roster,
    planHints,
    previous: sidePicks.map((a) => ({
      hero: a.hero,
      player: displayPlayer(a.player),
    })),
  });
  const byHero = new Map(
    assigned.map((a) => [heroKey(a.hero), a.player] as const),
  );

  return history.map((a) => {
    if (a.side !== side || a.kind !== "pick") return a;
    const nextPlayer = byHero.get(heroKey(a.hero));
    if (nextPlayer === undefined) return a;
    return { ...a, player: nextPlayer };
  });
}

function ourLockedPicks(
  history: BoardAction[],
  planPicks: DraftCompPick[],
  home: PlayerScout[],
): LockedPick[] {
  const out: LockedPick[] = [];
  for (const a of history) {
    if (a.side !== "our" || a.kind !== "pick") continue;
    const player =
      displayPlayer(a.player) ??
      ownerForHero(a.hero, planPicks, home, out);
    out.push({ hero: a.hero, player });
  }
  return out;
}

export function InteractiveDraft({
  tree,
  weFirst,
  banPriority = [],
  ourPickPlan = [],
  ourLikely = [],
  theirLikely = [],
  ourBrief = null,
  theirArchetype = null,
  archetypeCounter = null,
  leaveDive = false,
  leaveDivePivot = null,
  map = null,
  draftMeta = null,
  homeRoster = [],
  theirRoster = [],
  theirCommonBans = [],
  ourLabel = "Us",
  theirLabel = "Them",
  allowSeatReshuffle = true,
}: {
  tree: DraftTreeNode;
  weFirst: boolean;
  banPriority?: { hero: string; reason: string }[];
  /** @deprecated prefer ourLikely */
  ourPickPlan?: string[];
  ourLikely?: DraftCompPick[];
  theirLikely?: DraftCompPick[];
  ourBrief?: OurCompBrief | null;
  /** Their draft identity from the scout report. */
  theirArchetype?: string | null;
  /** How our answer-archetype beats theirs (from the playbook counter). */
  archetypeCounter?: string | null;
  /** Leave pure dive — anti-dive already in their pool; keep Qhira in the pivot shell. */
  leaveDive?: boolean;
  leaveDivePivot?: string | null;
  map?: string | null;
  draftMeta?: DraftMetaTable | null;
  homeRoster?: PlayerScout[];
  theirRoster?: PlayerScout[];
  /** Heroes they commonly ban — mutual denies they may take for us. */
  theirCommonBans?: { hero: string; count: number }[];
  ourLabel?: string;
  theirLabel?: string;
  /** Tournament mode reoptimizes the full seat map when a new pick changes the best fit. */
  allowSeatReshuffle?: boolean;
}) {
  const [history, setHistory] = useState<BoardAction[]>([]);
  const [tournamentDraftMode, setTournamentDraftMode] = useState(
    allowSeatReshuffle,
  );
  const [filter, setFilter] = useState("");
  /** During consecutive double-picks: heroes selected for the pair lock (max 2). */
  const [pairPick, setPairPick] = useState<string[]>([]);
  /** Why the last off-suggestion lock was worse / not quite as good. */
  const [deviationNote, setDeviationNote] = useState<DeviationReport | null>(
    null,
  );
  const allHeroes = useMemo(() => allDraftHeroes(), []);
  const planned = useMemo(() => expectedPath(tree), [tree]);
  const planPicks = useMemo(() => {
    const raw = ourLikely.length
      ? ourLikely
      : ourPickPlan.map((hero) => ({
          hero,
          role: heroRole(hero),
          player: null,
          note: null,
        }));
    const normalized = normalizeBruiserLanes(raw);
    if (!tournamentDraftMode || !homeRoster.length) {
      return normalized;
    }

    const slots = normalized.map((pick) => ({
      role: pick.role,
      heroes: [pick.hero],
      why: pick.note ?? "",
    }));
    const tuned = solveSeatAssignments({
      players: homeRoster,
      slots,
      preferredTags: [],
      allowSeatReshuffle: true,
    });
    return tuned.map((pick) => ({
      role: pick.role,
      hero: pick.hero,
      player: pick.player,
      note: pick.player ? "seat optimized" : "recommended",
    }));
  }, [homeRoster, ourLikely, ourPickPlan, tournamentDraftMode]);

  const stepIndex = history.length;
  const done = stepIndex >= DRAFT_ORDER.length;
  const step = done ? null : DRAFT_ORDER[stepIndex];
  const ours = step ? (step.side === "fp") === weFirst : false;
  const gone = goneKeys(history);
  /** Same-side pick-pick — always lock both together, never one at a time. */
  const pairWindow = Boolean(
    step &&
      step.kind === "pick" &&
      isDoublePickWindow(DRAFT_ORDER, stepIndex),
  );

  const ourBanCount = history.filter((a) => a.side === "our" && a.kind === "ban")
    .length;
  const theirBanCount = history.filter(
    (a) => a.side === "their" && a.kind === "ban",
  ).length;
  const ourPickCount = history.filter(
    (a) => a.side === "our" && a.kind === "pick",
  ).length;
  const theirPickCount = history.filter(
    (a) => a.side === "their" && a.kind === "pick",
  ).length;

  /** Comfort pools — open answers must be heroes the answering side plays. */
  const ourHeroPool = useMemo(() => poolFromRoster(homeRoster), [homeRoster]);
  const theirHeroPool = useMemo(() => {
    const fromRoster = poolFromRoster(theirRoster);
    // Likely five is also evidence they play it (even if outside topHeroes trim).
    const seen = new Set(fromRoster.map((h) => heroKey(h)));
    const out = [...fromRoster];
    for (const p of theirLikely) {
      const k = heroKey(p.hero);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p.hero);
    }
    return out;
  }, [theirRoster, theirLikely]);

  // One player per hero — specialist locks can steal earlier flex seats.
  const stampedHistory = useMemo(() => {
    let h = history;
    h = restampSidePlayers(h, "our", homeRoster, planPicks);
    h = restampSidePlayers(h, "their", theirRoster, theirLikely);
    return h;
  }, [history, homeRoster, theirRoster, planPicks, theirLikely]);

  const leaveDiveLive = useMemo(() => {
    const locked = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    const pool = [
      ...locked,
      ...theirLikely.map((p) => p.hero),
    ].filter((h, i, arr) =>
      (divePlaybook.antiDiveHeroes as readonly string[]).includes(h) &&
      arr.indexOf(h) === i,
    );
    if (leaveDive || pool.length > 0) {
      const chosen = pool.length ? chooseDivePivot(pool) : null;
      return {
        leave: true as const,
        pivot: leaveDivePivot ?? chosen?.pivot.name ?? null,
      };
    }
    return { leave: false as const, pivot: null as string | null };
  }, [history, theirLikely, leaveDive, leaveDivePivot]);

  const suggestion = useMemo((): Suggestion | null => {
    if (!step) return null;
    const lastPick = stepIndex === DRAFT_ORDER.length - 1;
    const locked = ourLockedPicks(history, planPicks, homeRoster);
    const livePicks = applyLockedToPlan(
      livePlanPicks(planPicks, gone),
      locked,
      homeRoster,
      gone,
    );
    const comp = compMatchupLine(
      ourBrief,
      theirArchetype,
      archetypeCounter,
      livePicks,
      theirLikely,
    );
    const expect = expectTheirNext(
      planned,
      stepIndex,
      gone,
      theirLikely,
      ours && step.kind === "ban",
    );

    if (ours && step.kind === "ban") {
      const ourLockedHeroes = history
        .filter((a) => a.side === "our" && a.kind === "pick")
        .map((a) => a.hero);
      const banPool = [
        ...banPriority.map((b) => b.hero),
        ...theirLikely.map((p) => p.hero),
      ].filter((h, i, arr) => {
        if (isGone(h, gone)) return false;
        return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
      });
      const treeBan = planned[stepIndex];
      if (
        treeBan?.side === "our" &&
        treeBan.kind === "ban" &&
        !isGone(treeBan.hero, gone) &&
        !banPool.some((h) => heroKey(h) === heroKey(treeBan.hero))
      ) {
        banPool.unshift(treeBan.hero);
      }
      if (!banPool.length) return null;
      const options = banPool
        .map((h) => {
          const sig = comfortSignal(
            theirRoster,
            h,
            theirOwnerName(h, theirLikely),
          );
          const wePlay =
            comfortSignal(homeRoster, h, null).comfort > 0;
          return {
            ...buildPickScorecard({
              hero: h,
              table: draftMeta,
              gone,
              map,
              ourPickCount,
              inPlan: false,
              fromAlt: false,
              planRole: null,
              lockedAllies: ourLockedHeroes,
              // answering side = us (open counters we can still take)
              theirLocked: ourLockedHeroes,
              answeringTeamPool: ourHeroPool,
              answerPerspective: "ours",
              theirLikely,
              banPriority,
              comfort: sig.comfort,
              comfortWho: sig.who,
              swapDelta: 0,
              takeAndRebuild: false,
              kind: "ban",
              lastPick,
              ourBanCount,
              theirCommonBans,
              wePlayHero: wePlay,
            }),
            player: theirOwnerName(h, theirLikely),
          };
        })
        .sort((a, b) => b.total - a.total || a.hero.localeCompare(b.hero))
        .slice(0, 3);
      const hero = options[0]?.hero;
      if (!hero) return null;
      const mutualFactor = options[0]?.factors.find((f) => f.id === "mutualBan");
      const holdNote = buildOpeningBanHoldNote({
        ourBanCount,
        hero,
        mutualFactor,
      });
      const banReason =
        mutualFactor?.detail ??
        banPriority.find((b) => heroKey(b.hero) === heroKey(hero))?.reason ??
        `Ban ${hero} before they can take it.`;
      return {
        hero,
        badge:
          ourBanCount === 0
            ? "Suggested ban · opening round 1"
            : ourBanCount === 1
              ? "Suggested ban · opening round 2"
              : "Suggested ban",
        showOurPlan: true,
        planPicks: livePicks,
        compLine: comp,
        expectLine: expect,
        cautionLine: holdNote,
        swapLine: null,
        reason: banReason,
        options,
      };
    }

    if (!ours) {
      const pool = [
        ...(planned[stepIndex]?.side === "their" &&
        !isGone(planned[stepIndex].hero, gone)
          ? [planned[stepIndex].hero]
          : []),
        ...theirLikely.map((p) => p.hero),
      ].filter((h, i, arr) => {
        if (isGone(h, gone)) return false;
        return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
      });
      if (!pool.length) return null;
      const ourLockedHeroes = history
        .filter((a) => a.side === "our" && a.kind === "pick")
        .map((a) => a.hero);
      const theirLockedHeroes = history
        .filter((a) => a.side === "their" && a.kind === "pick")
        .map((a) => a.hero);

      // Their consecutive double — expect a pair, not one hero at a time.
      if (
        step.kind === "pick" &&
        isDoublePickWindow(DRAFT_ORDER, stepIndex) &&
        theirLikely.length >= 2
      ) {
        const theirMarked: DraftCompPick[] = theirLikely.map((p) => {
          const filled = theirLockedHeroes.some(
            (h) =>
              heroKey(h) === heroKey(p.hero) ||
              (p.alternatives ?? []).some(
                (a) => heroKey(a.hero) === heroKey(h),
              ),
          );
          return filled ? { ...p, note: "locked" } : p;
        });
        const openCount = theirMarked.filter((p) => !isLockedPlanSeat(p))
          .length;
        if (openCount >= 2) {
          const seats = seatPairCandidates(
            theirMarked,
            gone,
            new Set(),
          );
          if (seats.length >= 2) {
            const soloCache = new Map<string, ScoredOption>();
            const soloFor = (hero: string) => {
              const k = heroKey(hero);
              const hit = soloCache.get(k);
              if (hit) return hit;
              const matched = matchTheirPlanSeat(hero, theirLikely);
              const seatWho = theirOwnerName(hero, theirLikely);
              const sig = comfortSignal(theirRoster, hero, seatWho);
              const card = buildPickScorecard({
                hero,
                table: draftMeta,
                gone,
                map,
                ourPickCount: theirPickCount,
                inPlan: Boolean(matched),
                fromAlt: Boolean(matched && !matched.exact),
                planRole: matched?.seat.role ?? null,
                lockedAllies: theirLockedHeroes,
                theirLocked: ourLockedHeroes,
                answeringTeamPool: ourHeroPool,
                answerPerspective: "ours",
                theirLikely: [],
                banPriority: [],
                comfort: sig.comfort,
                comfortWho: sig.who,
                swapDelta: 0,
                takeAndRebuild: false,
                kind: "pick",
                lastPick: false,
              });
              soloCache.set(k, card);
              return card;
            };
            const pairs = rankDoublePickPairs({
              seats,
              soloScore: (h) => soloFor(h).total,
              contested: () => false,
              beforePlan: theirMarked,
              projectBoth: (first, second) => {
                const p1 = seats
                  .flatMap((s) => s.cands)
                  .find((c) => heroKey(c.hero) === heroKey(first));
                const p2 = seats
                  .flatMap((s) => s.cands)
                  .find((c) => heroKey(c.hero) === heroKey(second));
                return showSuggestionOnPlan(
                  showSuggestionOnPlan(
                    theirMarked,
                    first,
                    p1?.player ?? null,
                  ),
                  second,
                  p2?.player ?? null,
                );
              },
              table: draftMeta,
            });
            if (pairs.length) {
              const pairSet = pairSeededPairOptions({
                pairPick,
                pairs,
              });
              const options: ScoredOption[] = pairSet.slice(0, 3).map((pair) => {
                const firstCard = soloFor(pair.first);
                const secondCard = soloFor(pair.second);
                return {
                  hero: pair.first,
                  pairWith: pair.second,
                  player: theirOwnerName(pair.first, theirLikely),
                  pairPlayer: theirOwnerName(pair.second, theirLikely),
                  total: pair.total,
                  firstSoloFactors: firstCard.factors,
                  secondSoloFactors: secondCard.factors,
                  factors: [
                    ...pair.pairFactors,
                    {
                      id: "first-solo",
                      label: `First · ${pair.first}`,
                      points: pair.firstSolo,
                      detail: "Their likely first of the double",
                    },
                    {
                      id: "second-solo",
                      label: `Then · ${pair.second}`,
                      points: pair.secondSolo,
                      detail: "Their likely follow-up",
                    },
                  ],
                };
              });
              const best = pairSet[0] ?? pairs[0];
              const who = theirOwnerName(best.first, theirLikely);
              const who2 = theirOwnerName(best.second, theirLikely);
              const theirProjected = projectedTheirHeroes(
                history,
                theirLikely,
                gone,
              );
              const archetype = theirCompRead(
                history,
                theirLikely,
                gone,
                theirArchetype,
              );
              return {
                hero: best.first,
                badge: "Their pair",
                showOurPlan: false,
                planPicks: [],
                compLine: explainTheirArchetypeRead(
                  theirLabel,
                  archetype,
                  theirProjected,
                ),
                expectLine: null,
                cautionLine: null,
                swapLine: null,
                reason: `Likely pair: ${best.first}${who ? ` (${who})` : ""} then ${best.second}${who2 ? ` (${who2})` : ""}.`,
                options,
              };
            }
          }
        }
      }

      const options = pool
        .map((h) => {
          const matched = matchTheirPlanSeat(h, theirLikely);
          const seatWho = theirOwnerName(h, theirLikely);
          // Ban denies our pockets; pick uses their comfort.
          const sig = comfortSignal(
            step.kind === "ban" ? homeRoster : theirRoster,
            h,
            step.kind === "ban" ? null : seatWho,
          );
          // Ban: if we take it, they answer. Pick: if they take it, we answer.
          const theyAnswer = step.kind === "ban";
          return {
            ...buildPickScorecard({
              hero: h,
              table: draftMeta,
              gone,
              map,
              ourPickCount: theirPickCount,
              inPlan: Boolean(matched),
              fromAlt: Boolean(matched && !matched.exact),
              planRole: matched?.seat.role ?? null,
              lockedAllies: theirLockedHeroes,
              theirLocked: theyAnswer ? theirLockedHeroes : ourLockedHeroes,
              answeringTeamPool: theyAnswer ? theirHeroPool : ourHeroPool,
              answerPerspective: theyAnswer ? "theirs" : "ours",
              theirLikely: [],
              banPriority: [],
              comfort: sig.comfort,
              comfortWho: sig.who,
              swapDelta: 0,
              takeAndRebuild: false,
              kind: step.kind,
              lastPick,
            }),
            player: seatWho,
          };
        })
        .sort((a, b) => b.total - a.total || a.hero.localeCompare(b.hero))
        .slice(0, 3);
      const hero = options[0]?.hero;
      if (!hero) return null;
      const who = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
      const whoName = displayPlayer(who?.player ?? null);
      const theirProjected = projectedTheirHeroes(
        history,
        theirLikely,
        gone,
      );
      const archetype = theirCompRead(
        history,
        theirLikely,
        gone,
        theirArchetype,
      );
      const verb = step.kind === "ban" ? "ban" : "pick";
      return {
        hero,
        badge: step.kind === "ban" ? "Their ban" : "Their pick",
        showOurPlan: false,
        planPicks: [],
        compLine: explainTheirArchetypeRead(
          theirLabel,
          archetype,
          theirProjected,
        ),
        expectLine: null,
        cautionLine: null,
        swapLine: null,
        reason:
          step.kind === "ban"
            ? explainTheirLikelyBan(theirLabel, hero, whoName, archetype)
            : `Likely ${verb}: ${hero}${whoName ? ` (${whoName})` : ""}.`,
        options,
      };
    }

    // Our pick — plan heroes + seat alternatives, scored for this step.
    const takenPlayers = lockedPlayerIds(locked);
    const candMeta = pickCandidates(livePicks, gone).filter((c) => {
      const who = displayPlayer(c.player);
      // Seat already filled — don't offer another hero for that player.
      if (who && takenPlayers.has(who.toLowerCase())) return false;
      return true;
    });

    // Consecutive double-pick: rank seat pairs (e.g. Malthael + E.T.C.), not
    // one hero that leaves the plan stuck on a stale Stitches primary.
    const theirLockedForPairs = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    const ourLockedForPairs = locked.map((l) => l.hero);
    if (
      step.kind === "pick" &&
      isDoublePickWindow(DRAFT_ORDER, stepIndex) &&
      livePicks.filter((p) => !isLockedPlanSeat(p)).length >= 2
    ) {
      const seats = seatPairCandidates(livePicks, gone, takenPlayers);
      if (seats.length >= 2) {
        const soloCache = new Map<string, ScoredOption>();
        const soloFor = (hero: string) => {
          const k = heroKey(hero);
          const hit = soloCache.get(k);
          if (hit) return hit;
          const meta = seats
            .flatMap((s) => s.cands)
            .find((c) => heroKey(c.hero) === k);
          const sig = comfortSignal(homeRoster, hero, meta?.player ?? null);
          const card = buildPickScorecard({
            hero,
            table: draftMeta,
            gone,
            map,
            ourPickCount,
            // Seat shell alts (Tyrael on a tank seat) are still on-plan;
            // fromAlt only softens the prior, it must not zero Plan fit.
            inPlan: Boolean(meta),
            fromAlt: Boolean(meta?.fromAlt),
            planRole: meta?.role ?? null,
            lockedAllies: ourLockedForPairs,
            theirLocked: theirLockedForPairs,
            answeringTeamPool: theirHeroPool,
            answerPerspective: "theirs",
            theirLikely,
            banPriority,
            comfort: sig.comfort,
            comfortWho: sig.who,
            swapDelta: 0,
            takeAndRebuild: shouldTakeAndRebuild(draftMeta, hero),
            kind: "pick",
            lastPick: false,
          });
          soloCache.set(k, card);
          return card;
        };
        const pairs = rankDoublePickPairs({
          seats,
          soloScore: (h) => soloFor(h).total,
          contested: (h) => Boolean(theyMightTake(h, theirLikely, banPriority)),
          beforePlan: livePicks,
          projectBoth: (first, second) => {
            const p1 = seats
              .flatMap((s) => s.cands)
              .find((c) => heroKey(c.hero) === heroKey(first));
            const p2 = seats
              .flatMap((s) => s.cands)
              .find((c) => heroKey(c.hero) === heroKey(second));
            return showSuggestionOnPlan(
              showSuggestionOnPlan(livePicks, first, p1?.player ?? null),
              second,
              p2?.player ?? null,
            );
          },
          table: draftMeta,
        });
        if (pairs.length) {
          const seeded = pairSeededPairOptions({
            pairPick,
            pairs,
          });
          const pairSet = seeded.length > 0 ? seeded : pairs;
          const options: ScoredOption[] = pairSet.slice(0, 3).map((pair) => {
            const firstCard = soloFor(pair.first);
            const secondCard = soloFor(pair.second);
            const factors: ScoreFactor[] = [
              ...pair.pairFactors,
              {
                id: "first-solo",
                label: `First · ${pair.first}`,
                points: pair.firstSolo,
                detail:
                  firstCard.factors
                    .filter((f) => f.points !== 0)
                    .slice(0, 3)
                    .map(
                      (f) =>
                        `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`,
                    )
                    .join(" · ") || "Solo base",
              },
              {
                id: "second-solo",
                label: `Then · ${pair.second}`,
                points: pair.secondSolo,
                detail:
                  secondCard.factors
                    .filter((f) => f.points !== 0)
                    .slice(0, 3)
                    .map(
                      (f) =>
                        `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`,
                    )
                    .join(" · ") || "Solo base",
              },
            ];
            return {
              hero: pair.first,
              pairWith: pair.second,
              player: displayPlayer(pair.firstPlayer) ?? pair.firstPlayer,
              pairPlayer:
                displayPlayer(pair.secondPlayer) ?? pair.secondPlayer,
              total: pair.total,
              factors,
              firstSoloFactors: firstCard.factors,
              secondSoloFactors: secondCard.factors,
            };
          });
          const best = pairSet[0];
          const shownPlan = showSuggestionOnPlan(
            showSuggestionOnPlan(livePicks, best.first, best.firstPlayer),
            best.second,
            best.secondPlayer,
          );
          const whoFirst = displayPlayer(best.firstPlayer);
          const whoSecond = displayPlayer(best.secondPlayer);
          const pairWhy = pairSuggestionCautionLine(best, pairSet.slice(1));
          return {
            hero: best.first,
            badge: "Suggested pair",
            showOurPlan: true,
            planPicks: shownPlan,
            compLine: compMatchupLine(
              ourBrief,
              theirArchetype,
              archetypeCounter,
              shownPlan,
              theirLikely,
            ),
            expectLine: expect,
            cautionLine: pairWhy,
            swapLine: null,
            reason: `Lock ${best.first}${whoFirst ? ` (${whoFirst})` : ""} now, then ${best.second}${whoSecond ? ` (${whoSecond})` : ""} — scored as a pair for these two picks.`,
            options,
          };
        }
      }
    }

    const candidates = candMeta.map((c) => c.hero);
    if (!candidates.length) {
      const fallback = allHeroes.find((h) => !isGone(h, gone));
      if (!fallback) return null;
      const fallbackSig = comfortSignal(homeRoster, fallback, null);
      const opt = buildPickScorecard({
        hero: fallback,
        table: draftMeta,
        gone,
        map,
        ourPickCount,
        inPlan: false,
        fromAlt: false,
        planRole: null,
        lockedAllies: locked.map((l) => l.hero),
        theirLocked: history
          .filter((a) => a.side === "their" && a.kind === "pick")
          .map((a) => a.hero),
        answeringTeamPool: theirHeroPool,
        answerPerspective: "theirs",
        theirLikely,
        banPriority,
        comfort: fallbackSig.comfort,
        comfortWho: fallbackSig.who,
        swapDelta: 0,
        takeAndRebuild: false,
        kind: "pick",
        lastPick,
      });
      return {
        hero: fallback,
        badge: "Suggested pick",
        showOurPlan: true,
        planPicks: livePicks,
        compLine: comp,
        expectLine: expect,
        cautionLine: null,
        swapLine: null,
        reason: `Plan heroes are gone — ${fallback} is still up.`,
        options: [{ ...opt, player: null }],
      };
    }

    const metaOf = (hero: string) =>
      candMeta.find((c) => heroKey(c.hero) === heroKey(hero));
    const roleOf = (hero: string) => metaOf(hero)?.role ?? null;
    const seatPlayerOf = (hero: string) =>
      displayPlayer(metaOf(hero)?.player ?? null);

    const swapFor = (hero: string): DraftSwap | null => {
      if (!homeRoster.length || locked.length === 0) return null;
      return findPickSwap({
        home: homeRoster,
        locked,
        neededHero: hero,
        seatPlayer: seatPlayerOf(hero),
      });
    };

    const theirLockedHeroesEarly = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    const ourLockedHeroes = locked.map((l) => l.hero);

    const scorecards = candidates.map((hero) => {
      const cand = metaOf(hero);
      const swap = swapFor(hero);
      const sig = comfortSignal(
        homeRoster,
        hero,
        seatPlayerOf(hero) ?? cand?.player ?? null,
      );
      const card = buildPickScorecard({
        hero,
        table: draftMeta,
        gone,
        map,
        ourPickCount,
        inPlan: Boolean(cand),
        fromAlt: Boolean(cand?.fromAlt),
        planRole: roleOf(hero),
        lockedAllies: ourLockedHeroes,
        theirLocked: theirLockedHeroesEarly,
        answeringTeamPool: theirHeroPool,
        answerPerspective: "theirs",
        theirLikely,
        banPriority,
        comfort: sig.comfort,
        comfortWho: sig.who,
        swapDelta: swap?.comfortDelta ?? 0,
        takeAndRebuild: shouldTakeAndRebuild(draftMeta, hero),
        kind: "pick",
        lastPick,
      });
      // Structure vs the five *after* this lock. Prefer fixing holes; never
      // invent one (e.g. Thrall over Malthael, or Leoric when the five is
      // already all-melee with no ranged seat left).
      const projected = showSuggestionOnPlan(
        livePicks,
        hero,
        seatPlayerOf(hero) ?? cand?.player ?? null,
      );
      const score = scoreProjectedCompStructure({
        hero,
        livePicks,
        projected,
      });
      let extra = score.extra;
      const structureBits = [...score.structureBits];

      if (
        ourPickCount === 0 &&
        isLateDiveAssassin(hero) &&
        !shouldTakeAndRebuild(draftMeta, hero)
      ) {
        extra -= 28;
        structureBits.push("Late dive assassin on pick 1");
      }
      const block = theyMightTake(hero, theirLikely, banPriority);
      if (isHealPick(hero, roleOf(hero))) {
        const outs = damageOutsStillUp(livePicks, gone, null);
        if (outs.length >= 2) {
          if (block) extra += 12;
          else if (!cand?.fromAlt) extra += 8;
          if (block || !cand?.fromAlt) {
            structureBits.push(
              block ? "Heal deny / contest" : "Heal seat while damage outs remain",
            );
          }
        }
      }
      if (extra !== 0) {
        addFactor(
          card.factors,
          "structure",
          "Comp structure",
          extra,
          structureBits.length
            ? structureBits.join(" · ")
            : extra > 0
              ? "Fills a structural hole"
              : "Creates or ignores a structural hole",
        );
        return {
          ...card,
          total: card.total + Math.round(extra),
          player: seatPlayerOf(hero) ?? displayPlayer(cand?.player ?? null),
        };
      }
      return {
        ...card,
        player: seatPlayerOf(hero) ?? displayPlayer(cand?.player ?? null),
      };
    });

    const scoreOf = (hero: string) =>
      scorecards.find((s) => heroKey(s.hero) === heroKey(hero))?.total ?? 0;

    let ranked = [...candidates].sort(
      (a, b) => scoreOf(b) - scoreOf(a) || a.localeCompare(b),
    );

    // OP / priority dive open → hard-force to the front (score already boosted).
    if (ourPickCount === 0) {
      const takeNow = ranked.filter((h) =>
        shouldTakeAndRebuild(draftMeta, h),
      );
      if (takeNow.length) {
        ranked = [
          ...takeNow,
          ...ranked.filter((h) => !shouldTakeAndRebuild(draftMeta, h)),
        ];
      }
    }

    // Display order = score order. Structural offlane / plan-fit live in the
    // scorecard — do not put a lower-scored plan primary above a higher alt.
    const options = ranked
      .slice(0, 8)
      .map((h) => {
        const card = scorecards.find((s) => heroKey(s.hero) === heroKey(h));
        if (card) return card;
        return {
          hero: h,
          total: scoreOf(h),
          factors: [],
          player: seatPlayerOf(h),
        };
      })
      .sort((a, b) => b.total - a.total || a.hero.localeCompare(b.hero))
      .slice(0, 3);

    const hero = options[0]?.hero ?? ranked[0];
    const cand = metaOf(hero);
    const seatWho = seatPlayerOf(hero);
    const foundSeat = findSeatForCandidate(livePicks, hero);
    const swap = swapFor(hero);
    const takeAndRebuild =
      !swap && shouldTakeAndRebuild(draftMeta, hero);
    const basePlan = applyLockedToPlan(
      takeAndRebuild
        ? rebuildPlanAroundCore(planPicks, hero, gone)
        : livePlanPicks(planPicks, gone),
      locked,
      homeRoster,
      gone,
    );
    const shownPlan = showSuggestionOnPlan(basePlan, hero, seatWho);
    const offlaneBait =
      !takeAndRebuild &&
      !swap &&
      ourPickCount === 0 &&
      isOfflanePlanRole(roleOf(hero));
    const holdingDive =
      !takeAndRebuild &&
      !swap &&
      ourPickCount === 0 &&
      candMeta.some(
        (c) => isLateDiveAssassin(c.hero) && heroKey(c.hero) !== heroKey(hero),
      );
    const theirLockedHeroes = theirLockedHeroesEarly;
    const { reason, cautionLine } = pickReason({
      table: draftMeta,
      hero,
      ourPickCount,
      gone,
      map,
      planPicks: shownPlan,
      expectLine: expect,
      theirLikely,
      banPriority,
      offlaneBait,
      takeAndRebuild,
      leaveDive: leaveDiveLive.leave,
      leaveDivePivot: leaveDiveLive.pivot,
      locked,
      theirLocked: theirLockedHeroes,
      answeringTeamPool: theirHeroPool,
      seatPlayer: seatWho ?? cand?.player ?? null,
      seatRole: cand?.role ?? foundSeat?.seat.role ?? null,
      asAlt: Boolean(cand?.fromAlt || foundSeat?.asAlt),
      replaces: foundSeat?.replaces ?? null,
    });

    const skipped = ranked.find((h) => h !== hero);
    let skipNote: string | null = null;
    if (takeAndRebuild || swap) {
      skipNote = null;
    } else if (holdingDive) {
      const diveHeld = candMeta
        .filter((c) => isLateDiveAssassin(c.hero))
        .map((c) =>
          c.player ? `${c.hero} (${displayPlayer(c.player)})` : c.hero,
        );
      skipNote = `Holding dive assassins for mid-draft: ${[...new Set(diveHeld)].join(", ")} — do not show them on pick 1.`;
    } else if (skipped && ourPickCount === 0) {
      const skipThreats = credibleOpenCounters(
        liveCountersUp(draftMeta, skipped, gone),
        theirLockedHeroes,
        theirHeroPool,
      );
      const skipMeta = heroDraftMeta(draftMeta, skipped);
      const skipRole = roleOf(skipped);
      if (offlaneBait && isFlexibleAnchorRole(skipRole)) {
        skipNote = `Holding ${skipped} (${skipRole}) until after they show whether they bite the offlane bait${
          skipThreats.length
            ? ` — still answered by ${skipThreats
                .slice(0, 2)
                .map(formatCounter)
                .join(", ")}`
            : ""
        }.`;
      } else if (isOfflanePlanRole(skipRole)) {
        skipNote = `Holding ${skipped} as the real offlane — do not first-pick the lane into open answers.`;
      } else if (skipMeta.timing === "late" || skipThreats.length > 0) {
        skipNote = `Holding ${skipped} (${skipMeta.winRate.toFixed(1)}% WR${
          skipThreats.length
            ? `; answered by ${skipThreats
                .slice(0, 2)
                .map(formatCounter)
                .join(", ")}`
            : ", situational first pick"
        }).`;
      }
    }

    const swapLine = swap
      ? `After lock — swap: ${swap.locker} (${swap.lockHero}) ↔ ${swap.specialist} (${swap.giveHero}). ${swap.reason}`
      : null;

    return {
      hero,
      badge: swap
        ? "Suggested pick · then swap"
        : takeAndRebuild
          ? "Suggested pick · take & rebuild"
          : offlaneBait
            ? "Suggested pick · offlane bait"
            : "Suggested pick",
      showOurPlan: true,
      planPicks: shownPlan,
      compLine: takeAndRebuild
        ? leaveDiveLive.leave
          ? `${hero} in ${leaveDiveLive.pivot ?? "the leave-dive pivot"} — keep the pocket, change the shell.`
          : `${hero}-dive — rebuild tank / heal / offlane to enable her.`
        : swap
          ? `Lock ${swap.lockHero} for the swap path — ${swap.specialist} ends on it, ${swap.locker} ends on ${swap.giveHero}.`
          : compMatchupLine(
              ourBrief,
              theirArchetype,
              archetypeCounter,
              shownPlan,
              theirLikely,
            ),
      expectLine: expect,
      cautionLine: [cautionLine, skipNote].filter(Boolean).join(" ") || null,
      swapLine,
      reason: swap
        ? [
            `${swap.locker} picks ${hero} here (not as their final seat).`,
            swap.reason,
          ]
            .filter(Boolean)
            .join(" ")
        : reason,
      options,
    };
  }, [
    step,
    planned,
    stepIndex,
    gone,
    ours,
    banPriority,
    planPicks,
    theirLikely,
    history,
    map,
    ourPickCount,
    theirPickCount,
    ourBanCount,
    allHeroes,
    ourBrief,
    theirArchetype,
    archetypeCounter,
    draftMeta,
    homeRoster,
    theirRoster,
    theirCommonBans,
    theirHeroPool,
    ourHeroPool,
    leaveDiveLive,
  ]);

  const endSwaps = useMemo(() => {
    if (!done || !homeRoster.length) return [];
    return findEndDraftSwaps({
      home: homeRoster,
      locked: ourLockedPicks(history, planPicks, homeRoster),
    });
  }, [done, homeRoster, history, planPicks]);

  /** Fantasy-football style grades + win% once all ten locks land. */
  const draftReport = useMemo((): DraftReportCard | null => {
    if (!done) return null;
    const ourLocked = ourLockedPicks(history, planPicks, homeRoster);
    const theirLocked = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => ({
        hero: a.hero,
        player: displayPlayer(a.player),
      }));
    if (ourLocked.length < 5 || theirLocked.length < 5) return null;
    return gradeFinishedDraft({
      ourLocked,
      theirLocked,
      ourOptimal: planPicks,
      theirOptimal: theirLikely,
      homeRoster,
      theirRoster,
      table: draftMeta,
      map: map ?? null,
      ourLabel,
      theirLabel,
    });
  }, [
    done,
    history,
    planPicks,
    theirLikely,
    homeRoster,
    theirRoster,
    draftMeta,
    map,
    ourLabel,
    theirLabel,
  ]);

  /** Heal we locked as comfort/deny — talents + teamfight script at the end. */
  const healDenyEnd = useMemo(() => {
    if (!done) return null;
    const ourHeals = history.filter(
      (a) =>
        a.side === "our" &&
        a.kind === "pick" &&
        isHealPick(a.hero, null),
    );
    if (!ourHeals.length) return null;
    // Prefer a heal they also wanted (true deny); else our first locked heal.
    const denyPick =
      ourHeals.find((a) => theyMightTake(a.hero, theirLikely, banPriority)) ??
      ourHeals[0];
    const wasDeny = Boolean(
      theyMightTake(denyPick.hero, theirLikely, banPriority),
    );
    const guide =
      healDenyGuideFor(denyPick.hero) ?? fallbackHealDenyGuide(denyPick.hero);
    const ourFive = history
      .filter((a) => a.side === "our" && a.kind === "pick")
      .map((a) => a.hero);
    const theirFive = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    return {
      ...guide,
      wasDeny,
      player: displayPlayer(denyPick.player),
      ourFive,
      theirFive,
    };
  }, [done, history, history, theirLikely, banPriority]);

  const remainingBans = banPriority.filter((b) => !isGone(b.hero, gone));

  const available = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allHeroes.filter((h) => {
      if (isGone(h, gone)) return false;
      if (!q) return true;
      return h.toLowerCase().includes(q);
    });
  }, [allHeroes, gone, filter]);

  function lock(hero: string, reason?: string) {
    if (!step || isGone(hero, gone)) return;

    if (pairWindow && step.kind === "pick") {
      const selected = resolvePairPickSelection({
        current: pairPick,
        hero,
        pairWindow,
      });
      if (selected.action === "hold-pair") {
        setPairPick(selected.picked);
        setFilter("");
        return;
      }
      if (selected.action === "lock-pair") {
        const [firstHero, secondHero] = selected.pair ?? selected.picked;
        const nextHistory = [
          { side: ours ? "our" : "their", kind: "pick", ordinal: (ours ? ourPickCount : theirPickCount) + 1, hero: firstHero },
          { side: ours ? "our" : "their", kind: "pick", ordinal: (ours ? ourPickCount : theirPickCount) + 2, hero: secondHero },
        ] as BoardAction[];
        setHistory((prev) => {
          const merged: BoardAction[] = [
            ...prev,
            ...nextHistory.map((a) => ({ ...a, player: null, reason })),
          ];
          return restampSidePlayers(
            merged,
            ours ? "our" : "their",
            ours ? homeRoster : theirRoster,
            ours ? planPicks : theirLikely,
          );
        });
        setPairPick([]);
        setFilter("");
        return;
      }
    }

    const ordinal =
      step.kind === "ban"
        ? (ours ? ourBanCount : theirBanCount) + 1
        : (ours ? ourPickCount : theirPickCount) + 1;
    const lockedSoFar = ourLockedPicks(history, planPicks, homeRoster);
    const player =
      step.kind !== "pick"
        ? null
        : ours
          ? ownerForHero(hero, planPicks, homeRoster, lockedSoFar)
          : theirOwnerForHero(hero, theirLikely, history, theirRoster);

    if (
      suggestion &&
      heroKey(hero) !== heroKey(suggestion.hero)
    ) {
      const isLastStep = stepIndex === DRAFT_ORDER.length - 1;
      const ourLockedHeroes = history
        .filter((a) => a.side === "our" && a.kind === "pick")
        .map((a) => a.hero);
      const theirLockedHeroes = history
        .filter((a) => a.side === "their" && a.kind === "pick")
        .map((a) => a.hero);
      // Ban: answering side is the team that didn't ban (denial target's answers).
      // Pick: answering side is the opponent of the locker.
      const weAnswer =
        (ours && step.kind === "ban") || (!ours && step.kind === "pick");
      const answeringTeamLocked = weAnswer
        ? ourLockedHeroes
        : theirLockedHeroes;
      const answeringPool = weAnswer ? ourHeroPool : theirHeroPool;
      const answerPerspective = weAnswer ? "ours" : "theirs";
      const cardFor = (h: string): ScoredOption => {
        const fromOpts = suggestion.options.find(
          (o) => heroKey(o.hero) === heroKey(h),
        );
        if (fromOpts) return fromOpts;
        if (!ours) {
          const matched = matchTheirPlanSeat(h, theirLikely);
          const seatWho = theirOwnerName(h, theirLikely);
          const sig = comfortSignal(
            step.kind === "ban" ? homeRoster : theirRoster,
            h,
            step.kind === "ban" ? null : seatWho,
          );
          return buildPickScorecard({
            hero: h,
            table: draftMeta,
            gone,
            map: map ?? null,
            ourPickCount: theirPickCount,
            inPlan: Boolean(matched),
            fromAlt: Boolean(matched && !matched.exact),
            planRole: matched?.seat.role ?? null,
            lockedAllies: theirLockedHeroes,
            theirLocked: answeringTeamLocked,
            answeringTeamPool: answeringPool,
            answerPerspective,
            theirLikely: [],
            banPriority: [],
            comfort: sig.comfort,
            comfortWho: sig.who,
            swapDelta: 0,
            takeAndRebuild: false,
            kind: step.kind,
            lastPick: isLastStep,
          });
        }
        const seat = findSeatForCandidate(
          suggestion.planPicks.length ? suggestion.planPicks : planPicks,
          h,
        );
        const seatWho = seat ? displayPlayer(seat.seat.player) : null;
        const sig = comfortSignal(
          step.kind === "ban" ? theirRoster : homeRoster,
          h,
          step.kind === "ban" ? null : seatWho,
        );
        return buildPickScorecard({
          hero: h,
          table: draftMeta,
          gone,
          map: map ?? null,
          ourPickCount,
          inPlan: Boolean(seat),
          fromAlt: Boolean(seat?.asAlt),
          planRole: seat?.seat.role ?? null,
          lockedAllies: ourLockedHeroes,
          theirLocked: answeringTeamLocked,
          answeringTeamPool: answeringPool,
          answerPerspective,
          theirLikely,
          banPriority,
          comfort: sig.comfort,
          comfortWho: sig.who,
          swapDelta: 0,
          takeAndRebuild: shouldTakeAndRebuild(draftMeta, h),
          kind: step.kind,
          lastPick: isLastStep,
        });
      };
      const suggestedCard = cardFor(suggestion.hero);
      let chosenCard = cardFor(hero);
      // Pair suggestions vs a lone first lock: never stack pair total / Then ·
      // into the suggested column. Locking the follow-up first = reorder.
      const fair = fairFirstLockDeviationCards(suggestedCard, chosenCard);
      const fairSuggested = fair.suggested;
      chosenCard = fair.chosen;

      if (fair.pairReorder) {
        setDeviationNote({
          summary: `Locked ${hero} before ${suggestion.hero} — that is the suggested pair in reverse. Still take ${suggestion.hero} next.`,
          severity: "info",
          kind: step.kind,
          suggested: fairSuggested,
          chosen: chosenCard,
        });
      } else {
        const graded = gradeDeviation({
          ours,
          kind: step.kind,
          suggested: suggestion.hero,
          chosen: hero,
          planPicks: suggestion.planPicks.length
            ? suggestion.planPicks
            : planPicks,
          banPriority,
          theirLikely,
          table: draftMeta,
          gone,
          map: map ?? null,
          ourPickCount,
          isLastStep,
          answeringTeamLocked,
          answeringTeamPool: answeringPool,
          suggestedTotal: fairSuggested.total,
          chosenTotal: chosenCard.total,
        });
        if (!graded) {
          setDeviationNote(null);
        } else {
          // Structural throws get a heavy score slam so the board never looks
          // like a close judgment call (+50 vs +41) when the pick was illegal.
          if (graded.structuralReasons.length) {
            chosenCard = applyStructuralThrowToCard(
              chosenCard,
              graded.structuralReasons,
            );
          }
          const summary = fair.note
            ? `${graded.summary} ${fair.note}`
            : graded.summary;
          setDeviationNote({
            summary,
            severity: graded.severity,
            kind: step.kind,
            suggested: fairSuggested,
            chosen: chosenCard,
          });
        }
      }
    } else {
      setDeviationNote(null);
    }

    setHistory((prev) => {
      const next: BoardAction[] = [
        ...prev,
        {
          side: ours ? "our" : "their",
          kind: step.kind,
          ordinal,
          hero,
          player,
          reason,
        },
      ];
      if (step.kind !== "pick") return next;
      return restampSidePlayers(
        next,
        ours ? "our" : "their",
        ours ? homeRoster : theirRoster,
        ours ? planPicks : theirLikely,
      );
    });
    setFilter("");
  }

  function undo() {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const removed = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      if (removed.kind !== "pick") return next;
      return restampSidePlayers(
        next,
        removed.side,
        removed.side === "our" ? homeRoster : theirRoster,
        removed.side === "our" ? planPicks : theirLikely,
      );
    });
    setDeviationNote(null);
  }

  function reset() {
    setHistory([]);
    setFilter("");
    setDeviationNote(null);
  }

  const ourBans = slotsFor(history, "our", "ban", 3);
  const theirBans = slotsFor(history, "their", "ban", 3);
  const ourPicks = slotsFor(stampedHistory, "our", "pick", 5);
  const theirPicks = slotsFor(stampedHistory, "their", "pick", 5);

  const stepOrdinal =
    step == null
      ? 0
      : (ours
          ? step.kind === "ban"
            ? ourBanCount
            : ourPickCount
          : step.kind === "ban"
            ? theirBanCount
            : theirPickCount) + 1;

  const stepLabel = !step
    ? null
    : `${ours ? "Our" : "Their"} ${stepOrdinal}${
        stepOrdinal === 1 ? "st" : stepOrdinal === 2 ? "nd" : stepOrdinal === 3 ? "rd" : "th"
      } ${step.kind}`;

  return (
    <div className="space-y-4 overflow-visible rounded-md border border-[#2a3a48] bg-[#0f1821] p-4 text-[#e8eef2]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
          Live draft board
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-md border border-[#3d5163] bg-[#162230] px-2.5 py-1.5 text-xs font-medium text-[#dfeaf4]">
            <input
              type="checkbox"
              checked={tournamentDraftMode}
              onChange={(event) => setTournamentDraftMode(event.target.checked)}
              className="h-3.5 w-3.5 accent-[#72d1b1]"
            />
            <span>Tournament draft mode</span>
          </label>
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            className="rounded-md border border-[#e11d48]/60 bg-[#e11d48]/15 px-3 py-1.5 text-sm font-semibold text-[#fecdd3] disabled:opacity-40"
          >
            Undo last
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={history.length === 0}
            className="rounded-md border border-[#3d5163] px-3 py-1.5 text-sm font-semibold text-[#c5d4e0] disabled:opacity-40"
          >
            Reset draft
          </button>
        </div>
      </div>

      <DraftSideRow
        label={theirLabel}
        bans={theirBans}
        picks={theirPicks}
        accent="enemy"
      />
      <DraftSideRow
        label={ourLabel}
        bans={ourBans}
        picks={ourPicks}
        accent="ally"
      />

      {remainingBans.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
            Ban priority still up
          </p>
          <ul className="flex flex-wrap gap-3">
            {remainingBans.map((b, i) => (
              <li key={b.hero} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={done || !step || step.kind !== "ban"}
                  onClick={() => lock(b.hero, b.reason)}
                  className="disabled:cursor-default"
                  title={b.reason}
                >
                  <HeroFace
                    hero={b.hero}
                    kind="select"
                    size="sm"
                    banned
                    label={`${i + 1}. ${b.hero}`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-[#3d5163] bg-[#162230] px-4 py-4">
        {done ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#9dceb0]">
              Draft walk complete. Undo if something was logged wrong.
            </p>
            {draftReport && <DraftReportCardView report={draftReport} />}
            {deviationNote && (
              <DeviationCallout note={deviationNote} />
            )}
            {endSwaps.length > 0 && (
              <div className="space-y-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
                  Comfort swaps — take these if they raise the win rate
                </p>
                <ul className="space-y-2">
                  {endSwaps.map((s) => (
                    <li
                      key={`${s.specialist}-${s.lockHero}-${s.locker}-${s.giveHero}`}
                      className="text-sm leading-snug text-[#e8eef2]"
                    >
                      <span className="font-semibold">
                        {s.specialist}&apos;s {s.giveHero} ↔ {s.locker}&apos;s{" "}
                        {s.lockHero}
                      </span>
                      <span className="text-[#c5d4e0]"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {healDenyEnd && (
              <div className="space-y-2 rounded-md border border-teal-500/40 bg-teal-950/30 px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-teal-200/90">
                  {healDenyEnd.wasDeny ? "Heal deny" : "Heal lock"} —{" "}
                  {healDenyEnd.hero}
                  {healDenyEnd.player ? ` (${healDenyEnd.player})` : ""}
                </p>
                <p className="text-sm font-semibold text-[#e8eef2]">
                  {healDenyEnd.role}
                </p>
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
                    Talent path
                    {healDenyEnd.player
                      ? ` — what ${healDenyEnd.player} takes`
                      : " — what to take"}
                  </p>
                  <p className="text-xs leading-snug text-[#8aa0b2]">
                    One pick per level. Alternates only when the note says so.
                  </p>
                  <ul className="space-y-2">
                    {healDenyEnd.talents.map((t) => (
                      <li
                        key={`${t.tier}-${t.take}`}
                        className="text-sm leading-snug text-[#c5d4e0]"
                      >
                        <p>
                          <span className="font-semibold text-[#e8eef2]">
                            Level {t.tier}: {t.take}
                          </span>
                          <span className="text-[#8aa0b2]"> — {t.why}</span>
                        </p>
                        {t.alt && t.altWhen ? (
                          <p className="mt-0.5 text-xs text-[#9dceb0]">
                            Or {t.alt} if {t.altWhen}.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
                    Teamfight plan
                  </p>
                  <p className="text-sm leading-snug text-[#e8eef2]">
                    {healDenyEnd.teamfight}
                  </p>
                  {healDenyEnd.theirFive.length > 0 && (
                    <p className="text-sm leading-snug text-[#9dceb0]">
                      Into {healDenyEnd.theirFive.join(", ")} with{" "}
                      {healDenyEnd.ourFive.join(", ")}.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[#e8eef2]">
                {stepLabel}
                {ours ? " — pick what we lock" : " — tap what they actually did"}
              </p>
              <p className="text-xs text-[#8aa0b2]">
                Step {stepIndex + 1} / {DRAFT_ORDER.length}
              </p>
            </div>

            {deviationNote && <DeviationCallout note={deviationNote} />}
            {pairWindow && pairPick.length > 0 && (
              <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm text-[#9dceb0]">
                Pair in progress: {pairPick.join(" + ")} — choose one more hero to lock the duo.
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="hero-search"
                className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]"
              >
                Search heroes
              </label>
              <input
                id="hero-search"
                type="search"
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const first = available[0];
                  if (first) lock(first);
                }}
                placeholder="Type a name — Enter locks the first match"
                className="h-11 w-full rounded-md border border-[#3d5163] bg-[#0f1821] px-3 text-base text-[#e8eef2] outline-none placeholder:text-[#5a6b78] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            {suggestion && (
              <div className="flex flex-wrap items-start gap-4 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  {suggestion.options.map((opt, i) => (
                    <ScoredHeroOption
                      key={
                        opt.pairWith
                          ? `${opt.hero}+${opt.pairWith}`
                          : opt.hero
                      }
                      option={opt}
                      rank={i + 1}
                      badge={
                        i === 0
                          ? suggestion.badge
                          : i === 1
                            ? opt.pairWith
                              ? "Alt pair #2"
                              : "Alt #2"
                            : opt.pairWith
                              ? "Alt pair #3"
                              : "Alt #3"
                      }
                      banned={step?.kind === "ban"}
                      onLock={() =>
                        lock(
                          opt.hero,
                          i === 0
                            ? suggestion.reason
                            : opt.pairWith
                              ? `${opt.hero} then ${opt.pairWith} scored ${opt.total}`
                              : `${opt.hero} scored ${opt.total}`,
                        )
                      }
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  {suggestion.showOurPlan && suggestion.planPicks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#e8eef2]">
                        Our current plan — who owns each seat:
                      </p>
                      <ul className="space-y-0.5 font-mono text-sm font-semibold text-[#e8eef2]">
                        {pairProgressPlanPicks(suggestion.planPicks, pairPick).map((p) => (
                          <li
                            key={`${p.role}-${p.hero}-${displayPlayer(p.player) ?? ""}`}
                            className={
                              isLockedPlanSeat(p)
                                ? "text-[#9dceb0]"
                                : undefined
                            }
                          >
                            {planPickLabel(p)}
                          </li>
                        ))}
                      </ul>
                      {(() => {
                        const lane = extractLaneSplitNote(suggestion.planPicks);
                        return lane ? (
                          <p className="text-sm font-normal leading-snug text-[#9dceb0]">
                            {lane}
                          </p>
                        ) : null;
                      })()}
                      {(() => {
                        // Always from the live five — never the stale scout brief.
                        const holes = explainCompHoles(suggestion.planPicks);
                        return holes ? (
                          <p className="text-sm font-normal leading-snug text-amber-200/90">
                            Hole: {holes}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  )}
                  {!suggestion.showOurPlan ? (
                    <>
                      <p className="text-sm font-semibold leading-snug text-[#e8eef2]">
                        {suggestion.reason}
                      </p>
                      {suggestion.compLine && (
                        <p className="text-sm leading-snug text-[#9dceb0]">
                          {suggestion.compLine}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {suggestion.compLine && (
                        <p className="text-sm leading-snug text-[#9dceb0]">
                          {suggestion.compLine}
                        </p>
                      )}
                      {suggestion.expectLine && (
                        <p className="text-sm text-[#8aa0b2]">
                          {suggestion.expectLine}
                        </p>
                      )}
                      <p className="text-sm leading-snug text-[#c5d4e0]">
                        {suggestion.reason}
                      </p>
                      {suggestion.cautionLine && (
                        <div className="rounded-md border border-amber-500/45 bg-amber-950/45 px-2.5 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-200/90">
                            Caution
                          </p>
                          <p className="mt-1 text-sm leading-snug text-amber-100/95">
                            {suggestion.cautionLine}
                          </p>
                        </div>
                      )}
                      {suggestion.swapLine && (
                        <p className="rounded-md border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2.5 py-2 text-sm leading-snug text-[#9dceb0]">
                          {suggestion.swapLine}
                        </p>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => lock(suggestion.hero, suggestion.reason)}
                    className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
                  >
                    {ours
                      ? step?.kind === "ban"
                        ? "Ban"
                        : suggestion.options[0]?.pairWith
                          ? "Lock first ·"
                          : "Lock"
                      : step?.kind === "ban"
                        ? "They banned"
                        : suggestion.options[0]?.pairWith
                          ? "They pick first ·"
                          : "They picked"}{" "}
                    {suggestion.hero}
                    {suggestion.options[0]?.pairWith
                      ? ` (then ${suggestion.options[0].pairWith})`
                      : ""}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
                All heroes still available
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2">
                {available.map((hero, i) => {
                  const fromSearch = Boolean(filter.trim()) && i === 0;
                  const fromSuggestion =
                    !filter.trim() &&
                    suggestion?.options.some(
                      (o) =>
                        heroKey(o.hero) === heroKey(hero) ||
                        (o.pairWith != null &&
                          heroKey(o.pairWith) === heroKey(hero)),
                    );
                  const highlighted = fromSearch || fromSuggestion;
                  return (
                    <button
                      key={hero}
                      type="button"
                      onClick={() => lock(hero)}
                      title={hero}
                      className={`rounded-md p-1 transition hover:bg-[#1e3040] ${
                        highlighted ? "ring-2 ring-[var(--accent)]" : ""
                      }`}
                    >
                      <HeroFace
                        hero={hero}
                        kind="select"
                        size="sm"
                        banned={step?.kind === "ban"}
                        label={hero}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function gradeTone(grade: LetterGrade): string {
  if (grade.startsWith("A")) return "border-emerald-500/50 bg-emerald-950/40 text-emerald-200";
  if (grade.startsWith("B")) return "border-sky-500/45 bg-sky-950/35 text-sky-200";
  if (grade.startsWith("C")) return "border-amber-500/45 bg-amber-950/35 text-amber-100";
  if (grade === "D") return "border-orange-500/50 bg-orange-950/40 text-orange-200";
  return "border-rose-500/50 bg-rose-950/40 text-rose-200";
}

function winPctTone(pct: number): string {
  if (pct >= 58) return "text-emerald-300";
  if (pct >= 48) return "text-[#e8eef2]";
  if (pct >= 40) return "text-amber-200";
  return "text-rose-300";
}

function DraftReportCardView({ report }: { report: DraftReportCard }) {
  return (
    <div className="space-y-3 rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Draft report card
          </p>
          <p className="mt-1 text-sm font-semibold text-[#e8eef2]">
            {report.headline}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Draft edge (est.)
          </p>
          <p
            className={`text-3xl font-bold tabular-nums leading-none ${winPctTone(report.winPct)}`}
            title="Heuristic from draft quality + matchups — not a calibrated win probability"
          >
            {report.winPct}%
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {[report.ours, report.theirs].map((side) => (
          <div
            key={side.label}
            className="rounded-md border border-[#2a3a48] bg-[#162230] px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
                {side.label}
              </p>
              <span
                className={`inline-flex min-w-[2.5rem] items-center justify-center rounded border px-2 py-0.5 text-lg font-bold tabular-nums ${gradeTone(side.grade)}`}
                title={`${side.fidelity}% of optimal · quality ${side.quality}/100`}
              >
                {side.grade}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#8aa0b2]">
              Quality {side.quality}
              {side.optimalQuality > 0
                ? ` / optimal ${side.optimalQuality}`
                : ""}
              {" · "}
              {side.fidelity}% of plan
            </p>
            <ul className="mt-2 space-y-1">
              {side.notes.map((n) => (
                <li
                  key={n}
                  className="text-sm leading-snug text-[#c5d4e0]"
                >
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {report.reasons.length > 0 && (
        <ul className="space-y-1 border-t border-[#2a3a48] pt-2">
          {report.reasons.map((r) => (
            <li key={r} className="text-xs leading-snug text-[#8aa0b2]">
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeviationCallout({ note }: { note: DeviationReport }) {
  const severity = note.severity;
  const verb = note.kind === "ban" ? "banned" : "picked";
  const factorIds = [
    ...new Set([
      ...note.suggested.factors.map((f) => f.id),
      ...note.chosen.factors.map((f) => f.id),
    ]),
  ];
  const sugById = new Map(note.suggested.factors.map((f) => [f.id, f]));
  const choseById = new Map(note.chosen.factors.map((f) => [f.id, f]));

  const factorLines = (card: ScoredOption) =>
    card.factors
      .filter((f) => f.detail?.trim())
      .map((f) => `${f.label}: ${f.detail}`);

  const whyCell = (factor: ScoreFactor | undefined) => {
    if (!factor) return "";
    // Usually hide empty 0-pt rows; keep pair-omitted so the fairness note shows.
    if (factor.points === 0 && factor.id !== "pair-omitted") return "";
    return factor.detail?.trim() ?? "";
  };

  const ptsClass = (pts: number) =>
    pts > 0
      ? "text-[#9dceb0]"
      : pts < 0
        ? "text-amber-200/90"
        : "text-[#8aa0b2]";

  const shell =
    severity === "solid"
      ? "rounded-md border border-teal-500/40 bg-teal-950/35 px-3 py-2.5"
      : severity === "minor"
        ? "rounded-md border border-sky-500/35 bg-sky-950/30 px-3 py-2.5"
        : severity === "major"
          ? "rounded-md border border-amber-500/45 bg-amber-950/40 px-3 py-2.5"
          : "rounded-md border border-[#3d5163] bg-[#0f1821]/80 px-3 py-2.5";

  const eyebrow =
    severity === "solid"
      ? "text-[10px] font-bold uppercase tracking-wide text-teal-200/90"
      : severity === "minor"
        ? "text-[10px] font-bold uppercase tracking-wide text-sky-200/90"
        : severity === "major"
          ? "text-[10px] font-bold uppercase tracking-wide text-amber-200/90"
          : "text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]";

  const body =
    severity === "solid"
      ? "mt-1 text-sm leading-snug text-teal-50/95"
      : severity === "minor"
        ? "mt-1 text-sm leading-snug text-sky-50/95"
        : severity === "major"
          ? "mt-1 text-sm leading-snug text-amber-100/95"
          : "mt-1 text-sm leading-snug text-[#c5d4e0]";

  const title =
    severity === "solid"
      ? "Solid call vs suggestion"
      : severity === "minor"
        ? "Judgment call vs suggestion"
        : severity === "major"
          ? "Major miss vs suggestion"
          : "Last lock vs suggestion";

  return (
    <div className={shell}>
      <p className={eyebrow}>{title}</p>
      <p className={body}>{note.summary}</p>

      <div className="mt-2 w-full overflow-x-auto">
        <div className="grid min-w-[36rem] grid-cols-[minmax(6.5rem,auto)_2.75rem_minmax(8rem,1fr)_2.75rem_minmax(8rem,1fr)] gap-x-2 text-xs">
          <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Factor
          </div>
          <DeviationWhyHeader
            hero={note.suggested.displayLabel ?? note.suggested.hero}
            total={note.suggested.total}
            title={`Why you should have ${verb} ${note.suggested.hero}`}
            lines={factorLines(note.suggested)}
            tone="suggest"
          />
          <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Why
          </div>
          <DeviationWhyHeader
            hero={note.chosen.displayLabel ?? note.chosen.hero}
            total={note.chosen.total}
            title={
              severity === "solid"
                ? `Why ${note.chosen.hero} scored`
                : `Why ${note.chosen.hero} scored instead`
            }
            lines={factorLines(note.chosen)}
            tone="chosen"
          />
          <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Why
          </div>

          {factorIds.map((id) => {
            const sug = sugById.get(id);
            const chose = choseById.get(id);
            const label = sug?.label ?? chose?.label ?? id;
            const sugPts = sug?.points ?? 0;
            const chosePts = chose?.points ?? 0;
            const labelHelp = factorHelpText(sug?.id ?? chose?.id ?? id, label);
            const sugHelp = factorExplanation(sug);
            const choseHelp = factorExplanation(chose);
            return (
              <div key={id} className="contents">
                <div className="group relative border-t border-[#2a3a48]/80 py-1 font-semibold text-[#e8eef2]">
                  <span
                    className="cursor-help underline decoration-dotted underline-offset-2"
                    title={labelHelp}
                    aria-label={labelHelp}
                  >
                    {label}
                  </span>
                  <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 text-left text-xs leading-snug text-[#c5d4e0] shadow-xl group-hover:block group-focus-within:block">
                    {labelHelp}
                  </div>
                </div>
                <div className="group relative border-t border-[#2a3a48]/80 py-1 text-right font-mono tabular-nums">
                  <span
                    className={`cursor-help underline decoration-dotted underline-offset-2 ${ptsClass(sugPts)}`}
                    title={sugHelp}
                    aria-label={sugHelp}
                  >
                    {sugPts > 0 ? `+${sugPts}` : sugPts}
                  </span>
                  <div className="pointer-events-none absolute right-0 top-full z-40 mt-1 hidden w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 text-left text-xs leading-snug text-[#c5d4e0] shadow-xl group-hover:block group-focus-within:block">
                    {sugHelp}
                  </div>
                </div>
                <div className="border-t border-[#2a3a48]/80 py-1 leading-snug text-[#8aa0b2]">
                  {whyCell(sug)}
                </div>
                <div className="group relative border-t border-[#2a3a48]/80 py-1 text-right font-mono tabular-nums">
                  <span
                    className={`cursor-help underline decoration-dotted underline-offset-2 ${ptsClass(chosePts)}`}
                    title={choseHelp}
                    aria-label={choseHelp}
                  >
                    {chosePts > 0 ? `+${chosePts}` : chosePts}
                  </span>
                  <div className="pointer-events-none absolute right-0 top-full z-40 mt-1 hidden w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 text-left text-xs leading-snug text-[#c5d4e0] shadow-xl group-hover:block group-focus-within:block">
                    {choseHelp}
                  </div>
                </div>
                <div className="border-t border-[#2a3a48]/80 py-1 leading-snug text-[#8aa0b2]">
                  {whyCell(chose)}
                </div>
              </div>
            );
          })}

          <div className="contents">
            <div className="border-t border-[#3d5163] py-1 font-bold text-[#e8eef2]">
              Total
            </div>
            <div className="border-t border-[#3d5163] py-1 text-right font-mono text-sm font-bold tabular-nums text-[#9dceb0]">
              {note.suggested.total > 0 ? "+" : ""}
              {note.suggested.total}
            </div>
            <div className="border-t border-[#3d5163] py-1" />
            <div className="border-t border-[#3d5163] py-1 text-right font-mono text-sm font-bold tabular-nums text-amber-100/90">
              {note.chosen.total > 0 ? "+" : ""}
              {note.chosen.total}
            </div>
            <div className="border-t border-[#3d5163] py-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviationWhyHeader({
  hero,
  total,
  title,
  lines,
  tone,
}: {
  hero: string;
  total: number;
  title: string;
  lines: string[];
  tone: "suggest" | "chosen";
}) {
  return (
    <div
      className={`py-1 text-right text-[10px] font-bold uppercase tracking-wide ${
        tone === "suggest" ? "text-[#9dceb0]" : "text-amber-100/90"
      }`}
    >
      <span aria-label={title}>
        {hero}{" "}
        <span className="font-mono tabular-nums normal-case">
          ({total > 0 ? "+" : ""}
          {total})
        </span>
      </span>
    </div>
  );
}

function ScoredHeroOption({
  option,
  rank,
  badge,
  banned,
  onLock,
}: {
  option: ScoredOption;
  rank: number;
  badge: string;
  banned: boolean;
  onLock: () => void;
}) {
  const primary = rank === 1;
  const pair = option.pairWith;
  return (
    <div className="group relative flex flex-col items-center">
      <button
        type="button"
        onClick={onLock}
        className={`flex w-[12.5rem] flex-col items-center gap-1 rounded-md p-1.5 transition hover:bg-[#1e3040]/80 ${
          primary ? "ring-2 ring-[var(--accent)]" : "ring-1 ring-[#3d5163]"
        }`}
      >
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            primary
              ? "bg-[var(--accent)] text-[var(--accent-ink)]"
              : "bg-[#243444] text-[#c5d4e0]"
          }`}
        >
          {badge}
        </span>
        {pair ? (
          <div className="flex items-center gap-1">
            <HeroFace
              hero={option.hero}
              kind="select"
              size="lg"
              banned={banned}
            />
            <span className="text-sm font-bold text-[#8aa0b2]">+</span>
            <HeroFace
              hero={pair}
              kind="select"
              size="lg"
              banned={banned}
            />
          </div>
        ) : (
          <HeroFace
            hero={option.hero}
            kind="select"
            size="lg"
            banned={banned}
          />
        )}
        <span className="max-w-[9rem] text-center text-sm font-semibold leading-tight text-[#e8eef2]">
          {pair ? `${option.hero} + ${pair}` : option.hero}
        </span>
        {pair ? (
          <span className="max-w-[9rem] truncate text-center text-[11px] leading-tight text-[#9dceb0]">
            {[option.player, option.pairPlayer].filter(Boolean).join(" · ") ||
              "then next pick"}
          </span>
        ) : option.player ? (
          <span className="max-w-[6.5rem] truncate text-center text-[11px] leading-tight text-[#9dceb0]">
            {option.player}
          </span>
        ) : null}
        <span
          className={`font-mono text-base font-bold tabular-nums ${
            option.total >= 0 ? "text-[#9dceb0]" : "text-amber-200/90"
          }`}
        >
          {option.total > 0 ? `+${option.total}` : option.total}
        </span>
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2 rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-within:opacity-100">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
          Score breakdown · total {option.total}
          {pair ? ` · lock ${option.hero} first` : ""}
        </p>
        <ul className="space-y-1">
          {option.factors.map((f) => (
            <li key={f.id} className="text-xs leading-snug text-[#c5d4e0]">
              <span className="flex justify-between gap-2 font-semibold text-[#e8eef2]">
                <span>{f.label}</span>
                <span
                  className={
                    f.points > 0
                      ? "text-[#9dceb0]"
                      : f.points < 0
                        ? "text-amber-200/90"
                        : "text-[#8aa0b2]"
                  }
                >
                  {f.points > 0 ? `+${f.points}` : f.points}
                </span>
              </span>
              <span className="block text-[#8aa0b2]">{f.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DraftSideRow({
  label,
  bans,
  picks,
  accent,
}: {
  label: string;
  bans: (BoardAction | null)[];
  picks: (BoardAction | null)[];
  accent: "ally" | "enemy";
}) {
  const banRing = accent === "enemy" ? "ring-red-700/80" : "ring-teal-700/80";
  return (
    <div className="space-y-2">
      <p
        className={`text-xs font-bold uppercase tracking-wide ${
          accent === "enemy" ? "text-red-300/90" : "text-teal-300/90"
        }`}
      >
        {label}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-1.5">
          {bans.map((b, i) => (
            <EmptyOrFace
              key={`ban-${i}`}
              action={b}
              banned
              ring={banRing}
              placeholder="Ban"
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          {picks.map((p, i) => (
            <EmptyOrFace
              key={`pick-${i}`}
              action={p}
              ring={
                accent === "enemy" ? "ring-red-500/50" : "ring-teal-500/50"
              }
              placeholder="Pick"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyOrFace({
  action,
  banned,
  ring,
  placeholder,
}: {
  action: BoardAction | null;
  banned?: boolean;
  ring: string;
  placeholder: string;
}) {
  if (!action) {
    return (
      <div
        className={`flex h-20 w-14 items-center justify-center rounded-sm border border-dashed border-[#3d5163] bg-[#162230] text-[10px] uppercase tracking-wide text-[#5a6b78] ring-1 ${ring}`}
      >
        {placeholder}
      </div>
    );
  }
  const who =
    !banned && action.kind === "pick"
      ? displayPlayer(action.player)
      : null;
  return (
    <div className={`flex flex-col items-center rounded-sm ring-2 ${ring}`}>
      <HeroFace
        hero={action.hero}
        kind="draft"
        size="md"
        banned={banned}
        label={action.hero}
        title={`${action.kind} · ${action.hero}${who ? ` (${who})` : ""}${action.reason ? ` — ${action.reason}` : ""}`}
      />
      {who && (
        <span className="mt-0.5 max-w-[3.75rem] truncate text-center text-[10px] font-semibold leading-tight text-[#9dceb0]">
          {who}
        </span>
      )}
    </div>
  );
}
