"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { ReplayAction } from "@/lib/review/replayDraft";
import { UNSEEN_BAN } from "@/lib/lobby/screenLobby";
import { criticalTalentsFor } from "@/config/compCriticalTalents";
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
  type DraftStepScore,
  type LetterGrade,
} from "@/lib/scoring/draftGrade";
import {
  allyDuos,
  credibleOpenCounters,
  counterPoolNote,
  counterRoleFillNote,
  earlyPickScore,
  enemyDuos,
  counterPenalty,
  formatCounter,
  heroDraftMeta,
  duoMissingLine,
  isFlexibleAnchorRole,
  isMapSpecialist,
  isOfflanePlanRole,
  LIKELY_MATCHUP_DUO,
  MATCHUP_DUO,
  mapSpecialistTooltip,
  liveCountersUp,
  mergeLoadedMatchupRows,
  missingDuoLabel,
  missingDuoReason,
  MATCHUP_FETCH_BATCH,
  matchupFetchQueue,
  nakedOfflaneOpeningRisk,
  scoreDuos,
  shouldTakeAndRebuild,
  SYNERGY_DUO,
  type DraftMetaTable,
  type MatchupEdge,
} from "@/lib/scoring/draftMeta";
import {
  isDoublePickWindow,
  pairScoreFactors,
  rankDoublePickPairs,
  scoreOrderedPair,
  type PairSeatCand,
  type RankedPickPair,
  type PairScoreFactor,
} from "@/lib/scoring/pickPairs";
import {
  assignUniqueOwners,
  bestFreeOwner,
  displacedComfort,
  nextSeatLabels,
  findEndDraftSwaps,
  findPickSwap,
  lockedPlayerIds,
  type DraftSwap,
  type LockedPick,
} from "@/lib/scoring/draftSwap";
import {
  COMFORT_PICK_CAP,
  COMFORT_PICK_MULTIPLIER,
  comfortMeetsSuggestBar,
  comfortPickPoints,
  filterBanList,
  heroMeetsSuggestBar,
  heroUnplayedBy,
  pairHasDistinctOwners,
  playerComfortOn,
  playersMeetingSuggestBar,
  anySuggestablePair,
  slHeroSuggestions,
  suggestablePairOwners,
  UNPLAYED_PICK_PENALTY,
} from "@/lib/scoring/comfort";
import { heroKey, heroRole, heroTags } from "@/lib/scoring/heroMeta";
import { checkRequiredRoles, UNFILLABLE_ROLE_PENALTY } from "@/lib/scoring/roles";
import { labelArchetypeTag } from "@/lib/scoring/glossary";
import type {
  DraftCompPick,
  DraftTreeAction,
  DraftTreeNode,
  OurCompBrief,
  PlayerScout,
} from "@/lib/scoring/types";
import { allDraftHeroes } from "@/lib/scoring/heroPortrait";
import {
  percentileRank,
  roleMatchedPair,
  roleMatchedSingle,
} from "@/lib/scoring/roleBenchmark";
import { HeroFace } from "@/components/HeroFace";

type StepScore = {
  best: number;
  achieved: number;
  bestLabel: string;
  /** Share of comparable options this lock beat (0–100) — drives the letter grade. */
  percentile?: number;
  fieldSize?: number;
};

/** Factors shown on the decision scorecard, kept for the board portrait hover. */
export type BoardBreakdown = {
  total: number;
  factors: ScoreFactor[];
};

/** `score` sits on the first action of a step (both heroes of a double pick share it). */
type BoardAction = DraftTreeAction & {
  reason?: string;
  score?: StepScore;
  breakdown?: BoardBreakdown;
  /** Best owner when this hero was locked. Stays put when later rounds swap seats. */
  draftedFor?: string | null;
};

/**
 * One side of a double pick: that hero's solo scorecard, plus their share of
 * the pair-only factors (synergy and roles are split across the two locks).
 */
export function pairSideBreakdown(
  soloFactors: ScoreFactor[],
  pairFactors: PairScoreFactor[] | undefined,
  side: "first" | "second",
): BoardBreakdown {
  const share: ScoreFactor[] = [];
  for (const factor of pairFactors ?? []) {
    const points = side === "first" ? factor.firstPoints : factor.secondPoints;
    const detail =
      (side === "first" ? factor.firstDetail : factor.secondDetail) ||
      factor.detail;
    if (!points && !detail) continue;
    const label =
      factor.id === "duo"
        ? "Pair synergy"
        : factor.id === "roles"
          ? "Pair roles"
          : factor.label;
    share.push({ id: `pair-${factor.id}`, label, points, detail });
  }
  const factors = [...soloFactors, ...share];
  return {
    total: factors.reduce((sum, factor) => sum + factor.points, 0),
    factors,
  };
}

type ScoreFactor = {
  id: string;
  label: string;
  points: number;
  detail: string;
  formula?: string;
  /** Full per-duo breakdown (synergy / vs locked), one line per hero. */
  lines?: string[];
};

type MatchupTrackStage = "spotted" | "pulling" | "cached" | "scored" | "failed";

type MatchupTrack = {
  stage: MatchupTrackStage;
  heroes: string[];
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
  /** Pair-only factors, split between the first and follow-up heroes. */
  pairFactors?: PairScoreFactor[];
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

export function gradePairSelection(
  suggested: ScoredOption,
  chosen: ScoredOption,
): DeviationReport {
  const suggestedLabel =
    suggested.displayLabel ?? `${suggested.hero} + ${suggested.pairWith}`;
  const chosenLabel = chosen.displayLabel ?? `${chosen.hero} + ${chosen.pairWith}`;
  const matchesTopPair = pairHeroesMatch(
    suggested,
    chosen.hero,
    chosen.pairWith ?? chosen.hero,
  );
  const gap = suggested.total - chosen.total;
  const severity: DeviationSeverity =
    matchesTopPair || gap <= 10
      ? "solid"
      : gap <= 24
        ? "minor"
        : "major";
  const summary = matchesTopPair
    ? `${chosenLabel} was the top-scored duo at ${chosen.total > 0 ? "+" : ""}${chosen.total} — good pair to lock.`
    : gap <= 0
      ? `${chosenLabel} scored at least as well as the suggested ${suggestedLabel} (${chosen.total > 0 ? "+" : ""}${chosen.total} vs ${suggested.total > 0 ? "+" : ""}${suggested.total}) — good pair to lock.`
      : `${chosenLabel} scored ${gap} points below the suggested ${suggestedLabel} (${chosen.total > 0 ? "+" : ""}${chosen.total} vs ${suggested.total > 0 ? "+" : ""}${suggested.total}).`;

  return {
    summary,
    severity,
    kind: "pick",
    suggested: { ...suggested, displayLabel: suggestedLabel },
    chosen: { ...chosen, displayLabel: chosenLabel },
  };
}

function signedPoints(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function pairRolesLabel(option: ScoredOption): string {
  const roles = [option.hero, option.pairWith ?? option.hero].map(heroRole);
  return roles[0] === roles[1] ? `double ${roles[0]}` : roles.join(" + ");
}

/** Build a pair scorecard when the locked duo was not among ranked options. */
function assemblePairScorecard(args: {
  first: ScoredOption;
  second: ScoredOption;
  table: DraftMetaTable | null | undefined;
  projectBoth: (a: string, b: string) => DraftCompPick[];
  contested: (hero: string) => boolean;
}): ScoredOption {
  const projected = args.projectBoth(args.first.hero, args.second.hero);
  const pairFactors = pairScoreFactors({
    table: args.table,
    after: projected,
    first: args.first.hero,
    second: args.second.hero,
  });
  const total = Math.round(
    args.first.total +
      args.second.total +
      pairFactors.reduce((sum, factor) => sum + factor.points, 0),
  );
  return {
    hero: args.first.hero,
    pairWith: args.second.hero,
    player: args.first.player ?? null,
    pairPlayer: args.second.player ?? null,
    total,
    firstSoloFactors: args.first.factors,
    secondSoloFactors: args.second.factors,
    pairFactors,
    displayLabel: `${args.first.hero} + ${args.second.hero}`,
    factors: [
      ...pairFactors,
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
  /**
   * Double-pick windows: the top pair before any hero was clicked. Options get
   * re-seeded around the first click; grading still compares to this.
   */
  originalPair?: ScoredOption;
};

/** Single-lock Roles factor: 0 unless the team can no longer be completed. */
export function withRolesFactor(
  card: ScoredOption,
  lockedHeroes: readonly string[],
): ScoredOption {
  if (card.factors.some((factor) => factor.id === "roles")) return card;
  const heroes = [...lockedHeroes, card.hero];
  const check = checkRequiredRoles(heroes);
  const role = check.filledBy.get(heroes.length - 1);
  const covers = role ? `Covers ${role}` : "Flex — no required role";
  const factors = [...card.factors];
  addFactor(
    factors,
    "roles",
    "Roles",
    check.points,
    `${covers} · ${check.detail}`,
    check.unfillable
      ? `${check.unfillable} required role(s) can't fit in ${check.picksLeft} remaining pick(s) × -${UNFILLABLE_ROLE_PENALTY}`
      : "0 while every missing required role still fits in the remaining picks",
  );
  return { ...card, factors, total: card.total + check.points };
}

export function pairSuggestionCautionLine<T extends {
  first: string;
  second: string;
  pairFactors?: { id: string; label: string; points: number; detail: string }[];
}>(best: T, alternatives: readonly T[]): string | null {
  if (!alternatives.length) return null;

  const pairDetail =
    best.pairFactors?.find((factor) => factor.id === "roles") ??
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
  /**
   * Score the displayed (seed, partner) order. Without it, pairs that did not
   * contain the seed keep the source pair's structure/synergy/total.
   */
  rescore?: (first: string, second: string) => T;
}): T[] {
  const seed = args.pairPick[0];
  if (!seed) return [...args.pairs] as T[];

  const seedKey = heroKey(seed);
  const bestByPair = new Map<string, T>();
  const swapFactorSides = <F extends object>(factor: F): F =>
    "firstPoints" in factor
      ? ({
          ...factor,
          firstPoints: (factor as { secondPoints?: number }).secondPoints,
          secondPoints: (factor as { firstPoints?: number }).firstPoints,
          firstDetail: (factor as { secondDetail?: string }).secondDetail,
          secondDetail: (factor as { firstDetail?: string }).firstDetail,
        } as F)
      : factor;

  for (const pair of args.pairs) {
    const firstIsSeed = heroKey(pair.first) === seedKey;
    const secondIsSeed = heroKey(pair.second) === seedKey;
    const seedIsSecond = !firstIsSeed && secondIsSeed;
    const displayFirst = firstIsSeed ? pair.first : seedIsSecond ? pair.second : seed;
    const displaySecond = firstIsSeed ? pair.second : seedIsSecond ? pair.first : pair.first;

    if (args.rescore && !firstIsSeed) {
      const rescored = args.rescore(displayFirst, displaySecond);
      const pairKey = [heroKey(rescored.first), heroKey(rescored.second)]
        .sort()
        .join("|");
      const prior = bestByPair.get(pairKey);
      if (!prior || (rescored.total ?? 0) > (prior.total ?? 0)) {
        bestByPair.set(pairKey, rescored);
      }
      continue;
    }

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
          : seedIsSecond
            ? swapFactorSides(factor)
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

/** Repeated clicks on a duo card advance through its displayed pick order. */
export function pairCardClickHero(
  first: string,
  second: string | null | undefined,
  current: string[],
): string {
  return second && heroKey(current[0] ?? "") === heroKey(first)
    ? second
    : first;
}

/** Heroes a roster actually plays (comfort pool) — open answers must hit these. */
function poolFromRoster(roster: PlayerScout[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of roster) {
    for (const h of p.topHeroes) {
      if (!comfortMeetsSuggestBar(h.comfort)) continue;
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
  lines?: string[],
) {
  factors.push({
    id,
    label,
    points: Math.round(points),
    detail,
    formula,
    ...(lines?.length ? { lines } : {}),
  });
}

function factorExplanation(factor: ScoreFactor | undefined): string {
  if (!factor) return "No factor value.";
  const value = `${factor.points > 0 ? "+" : ""}${factor.points}`;
  const calc = factor.formula ?? "This value was used as-is in the ranking.";
  const head = `${factor.label}: ${calc} (displayed as ${value}).`;
  return factor.lines?.length
    ? `${head}\n${factor.lines.join("\n")}`
    : `${head} ${factor.detail}`;
}

const SCORE_FACTOR_HELP: Record<string, string> = {
  wr: "Patch win rate is the hero’s current Storm League performance in the active patch. It is a strong baseline signal, but it should not override direct counters, seat ownership, or a player’s comfort on the pick.",
  influence: "Meta influence captures how central the hero is to the current drafting environment. It is best read as a popularity/impact signal rather than a direct ban rule, because very good heroes can still be poor picks if they are contested or misfit the board.",
  map: "Map fit measures whether the hero is a specialist on the chosen map. This matters for map-specific power, but it is only a small nudge unless the map is a known staple for that hero.",
  synergy: "Ally synergy reflects how well this hero performs with already-locked teammates in current win-rate samples. It is useful for pair planning, but it is not a ban heuristic by itself because team composition and role fill often matter more.",
  matchup: "Vs their locked compares this hero with heroes the other side has already locked. It is a full-weight matchup check because those heroes are definite.",
  likely: "Vs their likely compares this hero with heroes the other side is still expected to pick. It uses the same matchup samples as locked, at half the range, because those heroes are not definite.",
  answers: "Hard counters asks whether the opposing side still has a counter in its played pool. The penalty scales with how far that hero beats this one past its normal loss rate, and a thin Storm League sample counts for less. Heroes they do not play are named and then ignored.",
  roles: "Roles checks tank, healer, offlane and ranged damage. It is 0 as long as every missing role still fits in the remaining picks, even with no room to spare, and only goes negative when a lock makes the team impossible to complete.",
  comfort: "Player comfort is the roster-specific fit for the player who would actually play this hero. It is a good pick signal because it captures skill, familiarity, and seat ownership, but it should not dominate hard meta or matchup logic.",
  deny: "Deny / contest is the HP-backed contest signal: if the hero is strong and likely to be prioritized by the other side, we should either take it early or ban it. This is not generic draft logic; it reflects current pick/ban pressure from the data and the board state.",
  swap: "Swap value is the comfort change on heroes that change hands when this lock reseats the five. A player pushed onto a hero they play worse lowers the score by that comfort gap. The new hero's own comfort stays on the player-comfort line.",
  banPri: "Ban priority is the current priority list for removing a hero from the draft. It is a valid ban signal when a hero is both strong and clearly being contested, but it only matters after the board state and lane roles are considered.",
};

function factorHelpText(id: string, label: string): string {
  return (
    SCORE_FACTOR_HELP[id] ??
    `This factor, ${label}, contributes to the current hero ranking. It is a contextual draft signal and should be read together with the rest of the board rather than as a standalone ban rule.`
  );
}

/** Measurable pick/ban scorecard for tooltips + ranking. */
export function buildPickScorecard(args: {
  hero: string;
  table: DraftMetaTable | null | undefined;
  gone: Set<string>;
  map: string | null;
  ourPickCount: number;
  inPlan: boolean;
  fromAlt: boolean;
  planRole: string | null;
  /**
   * Locked heroes on the team that would play this hero. For a ban that is
   * the opponent of the banning side, not the banner's own locks.
   */
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
  /**
   * Set when this lock moves someone already seated. The points are the
   * comfort gap on those earlier heroes, on the same scale as player comfort.
   */
  swapNote?: string | null;
  takeAndRebuild: boolean;
  kind: "ban" | "pick";
  /** Last pick of the draft — open counters cannot answer. */
  lastPick?: boolean;
  /**
   * Who would take the open counters into this hero.
   * `ours` = we answer their pick; `theirs` = they answer our pick.
   */
  answerPerspective?: "ours" | "theirs";
  /** Opponent roster — deny/contest only applies to heroes they actually play. */
  theirRoster?: PlayerScout[];
  /** Nobody on the five that would play this hero has it on record. */
  unplayed?: boolean;
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
      ? mapSpecialistTooltip(mapHit)
      : args.map
        ? `No specialist edge on ${args.map}`
        : "No map selected",
    mapHit
      ? `6 + min(10, ${mapHit.deltaPp}) = ${mapPts.toFixed(2)} → rounded to ${Math.round(mapPts)}; ${mapSpecialistTooltip(mapHit)}`
      : "0 because there is no specialist edge on this map",
  );

  // One duo per locked teammate (no 3–5 hero data exists), each scored
  // against what the two solo WRs predict.
  const synergy = scoreDuos(
    allyDuos(args.table, args.hero, args.lockedAllies),
    SYNERGY_DUO,
    "together",
    args.lockedAllies,
  );
  addFactor(
    factors,
    "synergy",
    "Ally synergy",
    synergy.points,
    synergy.summary ||
      (args.lockedAllies.length
        ? "No sampled duos with locked teammates"
        : "No allies locked yet"),
    synergy.math,
    synergy.lines,
  );

  // A pick plays into heroes they have locked and heroes they are still
  // expected to lock. Likely is half the locked range. A ban is not scored
  // as a teammate of their five — ban urgency comes from deny, comfort, map,
  // and meta evidence instead.
  if (args.kind === "pick") {
    const self = heroKey(args.hero);
    const lockedEnemies = args.theirLocked.filter((enemy) => heroKey(enemy) !== self);
    const lockedKeys = new Set(lockedEnemies.map((enemy) => heroKey(enemy)));
    const likelySeen = new Set<string>();
    const likelyEnemies = args.lastPick
      ? []
      : args.theirLikely
          .map((pick) => pick.hero)
          .filter((enemy) => {
            const key = heroKey(enemy);
            if (key === self || lockedKeys.has(key) || isGone(enemy, args.gone)) return false;
            if (likelySeen.has(key)) return false;
            likelySeen.add(key);
            return true;
          });
    const into = (enemies: string[], weights: typeof MATCHUP_DUO) =>
      scoreDuos(
        enemyDuos(args.table, args.hero, enemies),
        weights,
        "into",
        enemies,
        (enemy) => duoMissingLine(args.table, args.hero, enemy, "into"),
      );
    if (lockedEnemies.length) {
      const matchup = into(lockedEnemies, MATCHUP_DUO);
      addFactor(
        factors,
        "matchup",
        "Vs their locked",
        matchup.points,
        matchup.summary || "No sampled matchups against these heroes",
        matchup.math,
        matchup.lines,
      );
    }
    if (likelyEnemies.length) {
      const likely = into(likelyEnemies, LIKELY_MATCHUP_DUO);
      addFactor(
        factors,
        "likely",
        "Vs their likely",
        likely.points,
        likely.summary || "No sampled matchups against these heroes",
        `${likely.math}. Half of the locked range because these picks are not definite`,
        likely.lines,
      );
    }
  }

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
        args.answerPerspective ?? "theirs",
      );
  const poolNote = args.lastPick
    ? null
    : counterPoolNote(
        rawAnswers,
        args.answeringTeamPool,
        args.answerPerspective ?? "theirs",
      );
  const rankedAnswers = [...openAnswers].sort(
    (a, b) => counterPenalty(b) - counterPenalty(a) || b.games - a.games,
  );
  const answerPts = rankedAnswers.reduce((sum, c) => sum - counterPenalty(c), 0);
  const answerList = rankedAnswers
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
    "Hard counters",
    answerValue,
    answerDetail,
    args.lastPick
      ? "0 because last pick means nobody can answer afterwards"
      : `each live counter min(8, 0.8 × edge over normal loss rate × sample confidence); sum ${answerPts.toFixed(2)} capped at -22 → ${Math.round(answerValue)}`,
  );

  const comfortPts = comfortPickPoints(args.comfort);
  addFactor(
    factors,
    "comfort",
    "Player comfort",
    comfortPts,
    args.comfort > 0.02
      ? `${args.comfortWho ? `${args.comfortWho} · ` : ""}seat comfort ${(args.comfort * 100).toFixed(0)}`
      : "No strong comfort signal",
    `min(${COMFORT_PICK_CAP}, ${args.comfort.toFixed(2)} × ${COMFORT_PICK_MULTIPLIER}) = ${comfortPts.toFixed(2)} → rounded to ${Math.round(comfortPts)}`,
  );

  if (args.kind === "pick" && args.unplayed) {
    addFactor(
      factors,
      "unplayed",
      "Unplayed",
      UNPLAYED_PICK_PENALTY,
      `Nobody on this five has ${args.hero} on record — whoever is left over plays it blind.`,
      `flat ${UNPLAYED_PICK_PENALTY} because no roster player has ever logged ${args.hero}`,
    );
  }

  const block = theyMightTake(
    args.hero,
    args.theirLikely,
    args.banPriority,
    args.theirRoster ?? [],
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

  const reseat = args.swapNote != null && args.swapNote !== "";
  const swapRaw = reseat
    ? args.swapDelta * COMFORT_PICK_MULTIPLIER
    : args.swapDelta > 0
      ? 8 + args.swapDelta * 30
      : 0;
  const swapPts = Math.round(swapRaw);
  addFactor(
    factors,
    "swap",
    "Swap value",
    swapPts,
    reseat
      ? args.swapNote!
      : args.swapDelta > 0
        ? `Post-lock comfort swap (+${args.swapDelta.toFixed(2)})`
        : "No comfort-positive swap unlocked",
    reseat
      ? `${args.swapDelta.toFixed(2)} comfort on seats that moved × ${COMFORT_PICK_MULTIPLIER} = ${swapRaw.toFixed(2)} → rounded to ${swapPts}`
      : args.swapDelta > 0
        ? `8 + (${args.swapDelta.toFixed(2)} × 30) = ${swapRaw.toFixed(2)} → rounded to ${swapPts}`
        : "0 because no comfort-positive swap is unlocked",
  );

  if (args.kind === "ban") {
    const idx = args.banPriority.findIndex(
      (b) => heroKey(b.hero) === heroKey(args.hero),
    );
    // The ban list is derived from the scorecard's primary evidence (comfort,
    // contest, map fit, and meta). Use it to select/explain a ban, but never
    // score it again as an independent reason to ban the same hero.

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
      player: L.player ?? seat.player,
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

/** Plan heroes still up, plus same-seat alternatives (e.g. Qhira under Valla). */
function pickCandidates(
  picks: DraftCompPick[],
  gone: Set<string>,
  comfortRoster?: PlayerScout[] | null,
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
      if (
        comfortRoster?.length &&
        !heroMeetsSuggestBar(comfortRoster, hero, player)
      ) {
        return;
      }
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
  comfortRoster?: PlayerScout[] | null,
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
      const who = displayPlayer(player) ?? player;
      if (
        comfortRoster?.length &&
        !heroMeetsSuggestBar(comfortRoster, hero, who)
      ) {
        return;
      }
      seen.add(k);
      cands.push({
        hero,
        role: p.role,
        player: who,
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

/** Heroes that must have SL matchup rows before this step can be scored. */
export function matchupHeroesForStep(args: {
  step: (typeof DRAFT_ORDER)[number] | null;
  stepIndex: number;
  ours: boolean;
  gone: Set<string>;
  history: BoardAction[];
  theirLikely: DraftCompPick[];
  planPicks: DraftCompPick[];
  livePicks: DraftCompPick[];
  planned: { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[];
  playableBanPriority: { hero: string }[];
  theirRoster: PlayerScout[];
  homeRoster: PlayerScout[];
  locked: { hero: string }[];
  takenPlayers: Set<string>;
}): { names: string[]; priority: string[] } {
  const names: string[] = [];
  const priority: string[] = [];
  const seen = new Set<string>();
  const add = (hero: string, pri = false) => {
    if (!hero || heroRole(hero) === "Unknown") return;
    const key = heroKey(hero);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(hero);
    if (pri) priority.push(hero);
  };

  for (const pick of args.theirLikely) add(pick.hero, true);
  for (const action of args.history) {
    if (action.kind === "pick") add(action.hero, true);
  }
  for (const pick of args.planPicks) add(pick.hero);

  if (!args.step) return { names, priority };

  if (args.ours && args.step.kind === "ban") {
    const ourPlanned = new Set(args.livePicks.map((p) => heroKey(p.hero)));
    const banPool = [
      ...args.playableBanPriority.map((b) => b.hero),
      ...args.theirLikely.map((p) => p.hero),
    ]
      .filter((h, i, arr) => {
        if (isGone(h, args.gone)) return false;
        if (ourPlanned.has(heroKey(h))) return false;
        return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
      })
      .filter((h) => theirPlaysHero(args.theirRoster, h, args.theirLikely));
    const treeBan = args.planned[args.stepIndex];
    if (
      treeBan?.side === "our" &&
      treeBan.kind === "ban" &&
      !isGone(treeBan.hero, args.gone) &&
      theirPlaysHero(args.theirRoster, treeBan.hero, args.theirLikely) &&
      !banPool.some((h) => heroKey(h) === heroKey(treeBan.hero))
    ) {
      banPool.unshift(treeBan.hero);
    }
    for (const h of banPool) add(h, true);
    return { names, priority };
  }

  if (args.ours && args.step.kind === "pick") {
    const candMeta = pickCandidates(
      args.livePicks,
      args.gone,
      args.homeRoster,
    ).filter((c) => {
      const who = displayPlayer(c.player);
      return !(who && args.takenPlayers.has(who.toLowerCase()));
    });
    for (const c of candMeta) add(c.hero, true);
    if (
      isDoublePickWindow(DRAFT_ORDER, args.stepIndex) &&
      args.livePicks.filter((p) => !isLockedPlanSeat(p)).length >= 2
    ) {
      for (const seat of seatPairCandidates(
        args.livePicks,
        args.gone,
        args.takenPlayers,
        args.homeRoster,
      )) {
        for (const c of seat.cands) add(c.hero, true);
      }
    }
    return { names, priority };
  }

  if (!args.ours) {
    const pool = [
      ...(args.planned[args.stepIndex]?.side === "their" &&
      !isGone(args.planned[args.stepIndex].hero, args.gone)
        ? [args.planned[args.stepIndex].hero]
        : []),
      ...args.theirLikely.map((p) => p.hero),
    ]
      .filter((h, i, arr) => {
        if (isGone(h, args.gone)) return false;
        return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
      })
      .filter((h) =>
        args.step?.kind === "ban"
          ? !args.homeRoster.length ||
            heroMeetsSuggestBar(args.homeRoster, h, null)
          : theirPlaysHero(args.theirRoster, h, args.theirLikely),
      );
    for (const h of pool) add(h, true);
  }

  return { names, priority };
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

/** Heroes already locked on screen that the turn order has not placed yet. */
function fillUnplacedLocks(
  slots: (BoardAction | null)[],
  heroes: readonly string[],
  players: readonly (string | null)[],
  side: "our" | "their",
): (BoardAction | null)[] {
  if (!heroes.length) return slots;
  const next = [...slots];
  const have = new Set(
    next.flatMap((slot) =>
      slot && slot.hero !== UNSEEN_BAN ? [heroKey(slot.hero)] : [],
    ),
  );
  for (let i = 0; i < heroes.length; i++) {
    const hero = heroes[i];
    if (!hero || have.has(heroKey(hero))) continue;
    const hole = next.findIndex((slot) => !slot);
    if (hole < 0) break;
    const player = players[i] ?? null;
    next[hole] = {
      side,
      kind: "pick",
      ordinal: hole + 1,
      hero,
      player,
      draftedFor: player,
      reason: "Locked on the shared screen",
    };
    have.add(heroKey(hero));
  }
  return next;
}

function goneKeys(history: BoardAction[]): Set<string> {
  return new Set(
    history.filter((action) => action.hero !== UNSEEN_BAN).map((action) => heroKey(action.hero)),
  );
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

/** Heroes a side has actually locked, shaped for role checks. */
function ordinalWord(n: number): string {
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** e.g. "Our 2nd + 3rd picks — tap the two heroes we lock". */
export function stepHeading(args: {
  ours: boolean;
  kind: "ban" | "pick";
  ordinal: number;
  pair: boolean;
  watch?: boolean;
}): string {
  const side = args.ours ? "Our" : "Their";
  const who = args.ours ? "we" : "they";
  if (args.watch) {
    if (args.kind === "ban") {
      return `${side} ${ordinalWord(args.ordinal)} ban — waiting for it on screen`;
    }
    if (args.pair) {
      return `${side} ${ordinalWord(args.ordinal)} + ${ordinalWord(args.ordinal + 1)} picks — waiting for them on screen`;
    }
    return `${side} ${ordinalWord(args.ordinal)} pick — waiting for it on screen`;
  }
  if (args.kind === "ban") {
    return `${side} ${ordinalWord(args.ordinal)} ban — tap the hero ${who} ban${args.ours ? "" : "ned"}`;
  }
  if (args.pair) {
    return `${side} ${ordinalWord(args.ordinal)} + ${ordinalWord(args.ordinal + 1)} picks — tap the two heroes ${who} lock${args.ours ? "" : "ed"}`;
  }
  return `${side} ${ordinalWord(args.ordinal)} pick — tap the hero ${who} lock${args.ours ? "" : "ed"}`;
}

/** How many history entries Undo removes: both heroes of a double pick, else one. */
export function undoCount(historyLength: number): number {
  return historyLength >= 2 && isDoublePickWindow(DRAFT_ORDER, historyLength - 2)
    ? 2
    : 1;
}

export function lockedHeroPicks(heroes: readonly string[]): DraftCompPick[] {
  return heroes.map((hero) => ({
    hero,
    role: heroRole(hero),
    player: null,
    note: "locked",
  }));
}

export function pairSeatCandidate(
  seats: { role: string; player: string | null; cands: PairSeatCand[] }[],
  hero: string,
): PairSeatCand {
  for (const seat of seats) {
    const cand = seat.cands.find((c) => heroKey(c.hero) === heroKey(hero));
    if (cand) return { ...cand, player: cand.player ?? seat.player };
  }
  return { hero, role: heroRole(hero), player: null, fromAlt: false };
}

export function pairStructureProjection(
  locked: DraftCompPick[],
  seats: { role: string; player: string | null; cands: PairSeatCand[] }[],
  first: string,
  second: string,
): DraftCompPick[] {
  const candidateFor = (hero: string) =>
    seats.flatMap((seat) => seat.cands).find(
      (candidate) => heroKey(candidate.hero) === heroKey(hero),
    );
  return [first, second].reduce(
    (picks, hero) => {
      const candidate = candidateFor(hero);
      return [
        ...picks,
        {
          hero,
          role: candidate?.role ?? heroRole(hero),
          player: candidate?.player ?? null,
          note: "locked",
        },
      ];
    },
    locked,
  );
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
  theirRoster: PlayerScout[],
): { who: string | null; via: "likely" | "deny" } | null {
  const who = theirOwnerName(hero, theirLikely);
  if (
    theirRoster.length &&
    !heroMeetsSuggestBar(theirRoster, hero, who)
  ) {
    return null;
  }
  const likely = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
  if (likely) {
    return { who: displayPlayer(likely.player), via: "likely" };
  }
  const deny = banPriority.find((b) => heroKey(b.hero) === heroKey(hero));
  if (deny) return { who: null, via: "deny" };
  return null;
}

function theirPlaysHero(
  roster: PlayerScout[],
  hero: string,
  theirLikely: DraftCompPick[],
): boolean {
  if (!roster.length) return true;
  return heroMeetsSuggestBar(
    roster,
    hero,
    theirOwnerName(hero, theirLikely),
  );
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
  theirRoster?: PlayerScout[];
}): boolean {
  const outs = damageOutsStillUp(
    args.planPicks,
    args.gone,
    args.damageHero,
  );
  // Plenty of second-damage pivots — do not force damage before heal.
  if (outs.length >= 2) return false;

  const healThreat = args.healHero
    ? theyMightTake(
        args.healHero,
        args.theirLikely,
        args.banPriority,
        args.theirRoster ?? [],
      )
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
    `Offlane is ~half the game; first-picking your real offlane into live hard counters is how you lose the draft before level 1. ` +
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
    (a, b) => counterPenalty(b) - counterPenalty(a) || b.games - a.games,
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
  theirRoster?: PlayerScout[];
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
          theirRoster: args.theirRoster ?? [],
        })
      ) {
        parts.push(damageBeforeHealWhy(args.hero, withWho));
      } else if (openHeal) {
        const threat = theyMightTake(
          openHeal.hero,
          args.theirLikely ?? [],
          args.banPriority ?? [],
          args.theirRoster ?? [],
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
        ? `Hard counters still up: ${threats
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
export function gradeDeviation(args: {
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
  /** Opponent roster — contest/deny only counts heroes they actually play. */
  theirRoster?: PlayerScout[];
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
    // Ban-list membership is already scored through player comfort, deny, and
    // ban-priority factors. It explains the recommendation; it is not an
    // illegal draft state and must not add a second structural-throw penalty.
    const structuralReasons: string[] = [];
    const severity = classifyDeviationSeverity({
      structural: false,
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
    ? theyMightTake(
        args.chosen,
        args.theirLikely,
        args.banPriority,
        args.theirRoster ?? [],
      )
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
    theirRoster: args.theirRoster,
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
      `Locked into live hard counters (${choseThreats
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
      `${args.suggested} scored harder this step on patch power, timing, and hard counters.`,
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

/**
 * Re-stamp every pick on a side. Tournament mode moves players whenever the
 * new assignment has a higher comfort total; the owner at lock time stays on
 * `draftedFor`.
 */
function restampSidePlayers(
  history: BoardAction[],
  side: "our" | "their",
  roster: PlayerScout[],
  planHints: DraftCompPick[],
  /** heroKey → player known for certain (e.g. from a replay); never re-guessed. */
  pinned?: ReadonlyMap<string, string>,
  reshuffle = true,
  /** False keeps the name under the portrait and does not invent a comfort owner. */
  guess = true,
): BoardAction[] {
  const sidePicks = history.filter((a) => a.side === side && a.kind === "pick");
  if (!sidePicks.length) return history;
  if (!guess) {
    return history.map((action) => {
      if (action.side !== side || action.kind !== "pick") return action;
      const pinnedPlayer = pinned?.get(heroKey(action.hero));
      if (!pinnedPlayer) return action;
      return { ...action, player: pinnedPlayer, draftedFor: pinnedPlayer };
    });
  }
  if (pinned?.size) {
    const guessed = restampSidePlayers(
      history,
      side,
      roster,
      planHints,
      undefined,
      reshuffle,
    );
    return guessed.map((a) =>
      a.side === side && a.kind === "pick" && pinned.has(heroKey(a.hero))
        ? {
            ...a,
            player: pinned.get(heroKey(a.hero))!,
            draftedFor: pinned.get(heroKey(a.hero))!,
          }
        : a,
    );
  }

  const labels = nextSeatLabels({
    picks: sidePicks.map((a) => ({
      hero: a.hero,
      draftedFor: a.draftedFor ?? null,
    })),
    roster,
    planHints,
    reshuffle,
  });
  let pickIndex = 0;
  return history.map((a) => {
    if (a.side !== side || a.kind !== "pick") return a;
    const label = labels[pickIndex++];
    if (!label) return a;
    return { ...a, player: label.player, draftedFor: label.draftedFor };
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
  ourMmr = null,
  theirMmr = null,
  allowSeatReshuffle = true,
  replay = null,
  screen = null,
  observedPicks = null,
  watchOnly = false,
  tournamentMode,
  onTournamentModeChange,
  stormLeagueOnly = false,
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
  /** NGS team-average Heroes Profile MMR. */
  ourMmr?: number | null;
  theirMmr?: number | null;
  /** Tournament mode reoptimizes the full seat map when a new pick changes the best fit. */
  allowSeatReshuffle?: boolean;
  /** A played draft (DRAFT_ORDER) to lock in automatically, graded like live clicks. */
  replay?: readonly ReplayAction[] | null;
  /** Locks read off the shared draft screen, in draft order. Ignored while a replay is playing. */
  screen?: readonly ReplayAction[] | null;
  /** Every hero already locked on screen, even if the turn order has not reached it. */
  observedPicks?: {
    ourPicks: readonly string[];
    theirPicks: readonly string[];
    ourPickPlayers: readonly (string | null)[];
    theirPickPlayers: readonly (string | null)[];
  } | null;
  /** Screen watch fills every lock. Recommendations stay; clicks cannot add a hero. */
  watchOnly?: boolean;
  /**
   * When set, the parent owns the checkbox. On uses NGS pools. Off uses Storm
   * League history only.
   */
  tournamentMode?: boolean;
  onTournamentModeChange?: (on: boolean) => void;
  /** Stay on Storm League suggestions even if tournament mode is checked, until NGS pools are ready. */
  stormLeagueOnly?: boolean;
}) {
  const [history, setHistory] = useState<BoardAction[]>([]);
  const [tournamentDraftModeState, setTournamentDraftModeState] = useState(
    () => (screen ? false : allowSeatReshuffle),
  );
  const tournamentDraftMode = tournamentMode ?? tournamentDraftModeState;
  const useStormLeague = stormLeagueOnly || !tournamentDraftMode;
  const setTournamentDraftMode = (on: boolean) => {
    onTournamentModeChange?.(on);
    if (tournamentMode === undefined) setTournamentDraftModeState(on);
  };
  const [filter, setFilter] = useState("");
  /** During consecutive double-picks: heroes selected for the pair lock (max 2). */
  const [pairPick, setPairPick] = useState<string[]>([]);
  /** Why the last off-suggestion lock was worse / not quite as good. */
  const [deviationNote, setDeviationNote] = useState<DeviationReport | null>(
    null,
  );
  const [matchupPatch, setMatchupPatch] = useState<DraftMetaTable | null>(null);
  const [matchupPending, setMatchupPending] = useState<string[]>([]);
  const [matchupError, setMatchupError] = useState<string | null>(null);
  const [matchupTrack, setMatchupTrack] = useState<MatchupTrack | null>(null);
  const scoringMeta = matchupPatch ?? draftMeta;
  const screenDefaulted = useRef(Boolean(screen));
  useEffect(() => {
    if (tournamentMode !== undefined) return;
    if (!screen || screenDefaulted.current) return;
    screenDefaulted.current = true;
    setTournamentDraftModeState(false);
  }, [screen, tournamentMode]);
  const allHeroes = useMemo(() => allDraftHeroes(), []);
  const replaySeats = useMemo(() => {
    const seats = new Map<string, string>();
    for (const a of replay ?? []) {
      if (a.kind === "pick" && a.player) seats.set(heroKey(a.hero), a.player);
    }
    // The name under the portrait is who locked it. Comfort must not replace it.
    for (const a of screen ?? []) {
      if (a.kind === "pick" && a.player) seats.set(heroKey(a.hero), a.player);
    }
    return seats;
  }, [replay, screen]);
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
    // The scout already seat-optimized these with the plan's style bonuses;
    // re-solving here without them swaps heroes and contradicts "Overall plan".
    if (
      !tournamentDraftMode ||
      !homeRoster.length ||
      normalized.every((p) => p.player)
    ) {
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
  const gone = useMemo(() => {
    const keys = goneKeys(history);
    if (watchOnly && observedPicks) {
      for (const hero of [...observedPicks.ourPicks, ...observedPicks.theirPicks]) {
        if (hero) keys.add(heroKey(hero));
      }
    }
    return keys;
  }, [history, watchOnly, observedPicks]);
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
      if (!heroMeetsSuggestBar(theirRoster, p.hero, displayPlayer(p.player))) {
        continue;
      }
      seen.add(k);
      out.push(p.hero);
    }
    return out;
  }, [theirRoster, theirLikely]);

  const playableBanPriority = useMemo(
    () =>
      filterBanList(theirRoster, banPriority, (h) =>
        theirOwnerName(h, theirLikely),
      ),
    [theirRoster, banPriority, theirLikely],
  );

  // One player per hero — specialist locks can steal earlier flex seats.
  // A live screen with tournament mode off keeps the name under the portrait.
  const guessSeats = !watchOnly || tournamentDraftMode;
  const stampedHistory = useMemo(() => {
    let h = history;
    h = restampSidePlayers(
      h,
      "our",
      homeRoster,
      planPicks,
      replaySeats,
      tournamentDraftMode,
      guessSeats,
    );
    h = restampSidePlayers(
      h,
      "their",
      theirRoster,
      theirLikely,
      replaySeats,
      tournamentDraftMode,
      guessSeats,
    );
    return h;
  }, [
    history,
    homeRoster,
    theirRoster,
    planPicks,
    theirLikely,
    replaySeats,
    tournamentDraftMode,
    guessSeats,
  ]);

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

  // Suggesting and grading share these scorers, so taking the top suggestion
  // always grades as the top option open — no hidden better hero in the field.

  /** Every hero a lock this step is ranked against. We never grade banning our own plan. */
  function gradeField(sugg: Suggestion): string[] {
    const ownPlan =
      ours && step?.kind === "ban"
        ? new Set(sugg.planPicks.map((p) => heroKey(p.hero)))
        : null;
    return allHeroes.filter(
      (h) => !isGone(h, gone) && !(ownPlan?.has(heroKey(h)) ?? false),
    );
  }

  /**
   * Tournament mode swaps every seat at the end, so the owner of a hero being
   * drafted is whoever the comfort-max assignment gives it.
   */
  function seatedOwner(
    roster: PlayerScout[],
    lockedHeroes: string[],
    hero: string,
    hints: DraftCompPick[],
  ): { player: string | null; comfort: number } | null {
    if (!tournamentDraftMode || !roster.length) return null;
    const heroes = lockedHeroes.some((h) => heroKey(h) === heroKey(hero))
      ? lockedHeroes
      : [...lockedHeroes, hero];
    const assigned = assignUniqueOwners({
      locked: heroes.map((h) => ({ hero: h })),
      roster,
      planHints: hints,
    });
    const player =
      assigned.find((a) => heroKey(a.hero) === heroKey(hero))?.player ?? null;
    return {
      player,
      comfort: player ? playerComfortOn(roster, hero, player) : 0,
    };
  }

  /** Comfort gap on heroes this lock pushes someone else onto. */
  function reseatFor(
    roster: PlayerScout[],
    locked: LockedPick[],
    hero: string,
    hints: DraftCompPick[],
  ): { swapDelta: number; swapNote: string | null } {
    if (!tournamentDraftMode || !roster.length) {
      return { swapDelta: 0, swapNote: null };
    }
    const move = displacedComfort({ roster, locked, hero, planHints: hints });
    if (!move.detail) return { swapDelta: 0, swapNote: null };
    return { swapDelta: move.delta, swapNote: move.detail };
  }

  function singleScorer(sugg: Suggestion): (h: string) => ScoredOption {
    const kind = step?.kind ?? "pick";
    const isLastStep = stepIndex === DRAFT_ORDER.length - 1;
    const ourLockedHeroes = history
      .filter((a) => a.side === "our" && a.kind === "pick")
      .map((a) => a.hero);
    const theirLockedHeroes = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    // Ban: answering side is the team that didn't ban (denial target's answers).
    // Pick: answering side is the opponent of the locker.
    const weAnswer = (ours && kind === "ban") || (!ours && kind === "pick");
    const answeringTeamLocked = weAnswer ? ourLockedHeroes : theirLockedHeroes;
    const answeringPool = weAnswer ? ourHeroPool : theirHeroPool;
    const answerPerspective = weAnswer ? "ours" : "theirs";
    return (h: string): ScoredOption => {
      const fromOpts = sugg.options.find((o) => heroKey(o.hero) === heroKey(h));
      if (fromOpts && !fromOpts.pairWith) return fromOpts;
      if (!ours) {
        const matched = matchTheirPlanSeat(h, theirLikely);
        const seated =
          kind === "pick"
            ? seatedOwner(theirRoster, theirLockedHeroes, h, theirLikely)
            : null;
        const seatWho = seated?.player ?? theirOwnerName(h, theirLikely);
        const sig = seated?.player
          ? { comfort: seated.comfort, who: seated.player }
          : comfortSignal(
              kind === "ban" ? homeRoster : theirRoster,
              h,
              kind === "ban" ? null : seatWho,
            );
        const theirSeats: LockedPick[] = history
          .filter((a) => a.side === "their" && a.kind === "pick")
          .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) }));
        const reseat =
          kind === "pick"
            ? reseatFor(theirRoster, theirSeats, h, theirLikely)
            : { swapDelta: 0, swapNote: null };
        return {
          ...buildPickScorecard({
            hero: h,
            table: scoringMeta,
            gone,
            map: map ?? null,
            ourPickCount: theirPickCount,
            inPlan: Boolean(matched),
            fromAlt: Boolean(matched && !matched.exact),
            planRole: matched?.seat.role ?? null,
            lockedAllies: kind === "ban" ? ourLockedHeroes : theirLockedHeroes,
            theirLocked: answeringTeamLocked,
            answeringTeamPool: answeringPool,
            answerPerspective,
            theirLikely: kind === "pick" ? planPicks : [],
            banPriority: [],
            comfort: sig.comfort,
            comfortWho: sig.who,
            swapDelta: reseat.swapDelta,
            swapNote: reseat.swapNote,
            takeAndRebuild: false,
            kind,
            lastPick: isLastStep,
            unplayed: kind === "pick" && heroUnplayedBy(theirRoster, h),
          }),
          player: kind === "ban" ? null : seatWho,
        };
      }
      const seat = findSeatForCandidate(
        sugg.planPicks.length ? sugg.planPicks : planPicks,
        h,
      );
      const preferred = seat ? displayPlayer(seat.seat.player) : null;
      const taken = lockedPlayerIds(ourLockedPicks(history, planPicks, homeRoster));
      const qualified =
        kind === "pick"
          ? playersMeetingSuggestBar(homeRoster, h, taken)
          : [];
      const preferredHit = preferred
        ? qualified.find((o) => o.player.toLowerCase() === preferred.toLowerCase())
        : undefined;
      const seated =
        kind === "pick"
          ? seatedOwner(homeRoster, ourLockedHeroes, h, planPicks)
          : null;
      const owner = seated?.player
        ? { player: seated.player, comfort: seated.comfort }
        : (preferredHit ?? qualified[0] ?? null);
      const sig = owner
        ? { comfort: owner.comfort, who: owner.player }
        : comfortSignal(
            kind === "ban" ? theirRoster : homeRoster,
            h,
            kind === "ban" ? null : preferred,
          );
      const reseat =
        kind === "pick"
          ? reseatFor(
              homeRoster,
              ourLockedPicks(history, planPicks, homeRoster),
              h,
              planPicks,
            )
          : { swapDelta: 0, swapNote: null };
      const ourCard = buildPickScorecard({
        hero: h,
        table: scoringMeta,
        gone,
        map: map ?? null,
        ourPickCount,
        inPlan: Boolean(seat),
        fromAlt: Boolean(seat?.asAlt),
        planRole: seat?.seat.role ?? null,
        lockedAllies: kind === "ban" ? theirLockedHeroes : ourLockedHeroes,
        theirLocked: answeringTeamLocked,
        answeringTeamPool: answeringPool,
        answerPerspective,
        theirLikely,
        banPriority: playableBanPriority,
        theirRoster,
        comfort: sig.comfort,
        comfortWho: sig.who,
        swapDelta: reseat.swapDelta,
        swapNote: reseat.swapNote,
        takeAndRebuild: shouldTakeAndRebuild(scoringMeta, h),
        kind,
        lastPick: isLastStep,
        unplayed: kind === "pick" && heroUnplayedBy(homeRoster, h),
      });
      return {
        ...(kind === "pick" ? withRolesFactor(ourCard, ourLockedHeroes) : ourCard),
        player: kind === "ban" ? null : (seated?.player ?? owner?.player ?? preferred),
      };
    };
  }

  function pairScoring() {
    const locked = ourLockedPicks(history, planPicks, homeRoster);
    const ourLockedHeroes = history
      .filter((action) => action.side === "our" && action.kind === "pick")
      .map((action) => action.hero);
    const theirLockedHeroes = history
      .filter((action) => action.side === "their" && action.kind === "pick")
      .map((action) => action.hero);
    const beforePlan = ours
      ? applyLockedToPlan(livePlanPicks(planPicks, gone), locked, homeRoster, gone)
      : theirLikely.map((pick) =>
          theirLockedHeroes.some((hero) => heroKey(hero) === heroKey(pick.hero))
            ? { ...pick, note: "locked" }
            : pick,
        );
    const scoreSolo = (hero: string, forcedOwner?: string): ScoredOption => {
      if (ours) {
        const seat = findSeatForCandidate(beforePlan, hero);
        const preferred = displayPlayer(seat?.seat.player ?? null);
        const taken = lockedPlayerIds(locked);
        const seated = forcedOwner
          ? null
          : seatedOwner(homeRoster, ourLockedHeroes, hero, planPicks);
        const qualified = playersMeetingSuggestBar(homeRoster, hero, taken);
        const wanted = forcedOwner ?? preferred;
        const preferredHit = wanted
          ? qualified.find(
              (o) => o.player.toLowerCase() === wanted.toLowerCase(),
            )
          : undefined;
        const owner = seated?.player
          ? { player: seated.player, comfort: seated.comfort }
          : forcedOwner
            ? {
                player: forcedOwner,
                comfort: playerComfortOn(homeRoster, hero, forcedOwner),
              }
            : (preferredHit ?? qualified[0] ?? null);
        const sig = owner
          ? { comfort: owner.comfort, who: owner.player }
          : comfortSignal(homeRoster, hero, wanted);
        const reseat = reseatFor(homeRoster, locked, hero, planPicks);
        return {
          ...buildPickScorecard({
            hero,
            table: scoringMeta,
            gone,
            map: map ?? null,
            ourPickCount,
            inPlan: Boolean(seat),
            fromAlt: Boolean(seat?.asAlt),
            planRole: seat?.seat.role ?? null,
            lockedAllies: ourLockedHeroes,
            theirLocked: theirLockedHeroes,
            answeringTeamPool: theirHeroPool,
            answerPerspective: "theirs",
            theirLikely,
            banPriority: playableBanPriority,
            theirRoster,
            comfort: sig.comfort,
            comfortWho: sig.who,
            swapDelta: reseat.swapDelta,
            swapNote: reseat.swapNote,
            takeAndRebuild: shouldTakeAndRebuild(scoringMeta, hero),
            kind: "pick",
            lastPick: false,
            unplayed: heroUnplayedBy(homeRoster, hero),
          }),
          player: owner?.player ?? preferred,
        };
      }
      const matched = matchTheirPlanSeat(hero, theirLikely);
      const seated = forcedOwner
        ? null
        : seatedOwner(theirRoster, theirLockedHeroes, hero, theirLikely);
      const player =
        forcedOwner ?? seated?.player ?? theirOwnerName(hero, theirLikely);
      const sig =
        forcedOwner || seated?.player
          ? { comfort: playerComfortOn(theirRoster, hero, player), who: player }
          : comfortSignal(theirRoster, hero, player);
      const theirSeats: LockedPick[] = history
        .filter((a) => a.side === "their" && a.kind === "pick")
        .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) }));
      const reseat = reseatFor(theirRoster, theirSeats, hero, theirLikely);
      return {
        ...buildPickScorecard({
          hero,
          table: scoringMeta,
          gone,
          map: map ?? null,
          ourPickCount: theirPickCount,
          inPlan: Boolean(matched),
          fromAlt: Boolean(matched && !matched.exact),
          planRole: matched?.seat.role ?? null,
          lockedAllies: theirLockedHeroes,
          theirLocked: ourLockedHeroes,
          answeringTeamPool: ourHeroPool,
          answerPerspective: "ours",
          theirLikely: planPicks,
          banPriority: [],
          comfort: sig.comfort,
          comfortWho: sig.who,
          swapDelta: reseat.swapDelta,
          swapNote: reseat.swapNote,
          takeAndRebuild: false,
          kind: "pick",
          lastPick: false,
          unplayed: heroUnplayedBy(theirRoster, hero),
        }),
        player,
      };
    };
    const soloCache = new Map<string, ScoredOption>();
    const solo = (hero: string, forcedOwner?: string) => {
      const k = forcedOwner
        ? `${heroKey(hero)}@${forcedOwner.toLowerCase()}`
        : heroKey(hero);
      const hit = soloCache.get(k);
      if (hit) return hit;
      const card = scoreSolo(hero, forcedOwner);
      soloCache.set(k, card);
      return card;
    };
    const sideLocked = ours ? ourLockedHeroes : theirLockedHeroes;
    const sideRoster = ours ? homeRoster : theirRoster;
    const sideTaken = ours
      ? lockedPlayerIds(locked)
      : lockedPlayerIds(
          history
            .filter((a) => a.side === "their" && a.kind === "pick")
            .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) })),
        );
    /**
     * Solo cards pick each hero's best owner on its own, so a duo can land on
     * one player twice (HuckIt Tyrande + HuckIt Tyrael). Seat the pair on two
     * different players and rescore comfort for whoever really plays it.
     */
    const seatPair = (a: string, b: string): [ScoredOption, ScoredOption] => {
      if (tournamentDraftMode && sideRoster.length) {
        const assigned = assignUniqueOwners({
          locked: [...sideLocked, a, b]
            .filter(
              (h, i, all) =>
                all.findIndex((x) => heroKey(x) === heroKey(h)) === i,
            )
            .map((hero) => ({ hero })),
          roster: sideRoster,
          planHints: ours ? planPicks : theirLikely,
        });
        const who = (hero: string) =>
          assigned.find((row) => heroKey(row.hero) === heroKey(hero))?.player ??
          undefined;
        const firstWho = who(a);
        const secondWho = who(b);
        return [
          firstWho ? solo(a, firstWho) : solo(a),
          secondWho ? solo(b, secondWho) : solo(b),
        ];
      }
      const first = solo(a);
      const second = solo(b);
      const same =
        first.player &&
        second.player &&
        first.player.toLowerCase() === second.player.toLowerCase();
      if (!same || !sideRoster.length) return [first, second];
      const owners = suggestablePairOwners(
        sideRoster,
        a,
        b,
        first.player,
        second.player,
        sideTaken,
      );
      if (!owners) return [first, second];
      return [
        ours ? solo(a, owners.first.player) : { ...first, player: owners.first.player },
        ours
          ? solo(b, owners.second.player)
          : { ...second, player: owners.second.player },
      ];
    };
    const assemble = (a: string, b: string) => {
      const [first, second] = seatPair(a, b);
      return assemblePairScorecard({
        first,
        second,
        table: scoringMeta,
        projectBoth: (x, y) =>
          pairStructureProjection(lockedHeroPicks(sideLocked), [], x, y),
        contested: (hero) =>
          ours &&
          Boolean(
            theyMightTake(hero, theirLikely, playableBanPriority, theirRoster),
          ),
      });
    };
    return { solo, assemble, sideLocked };
  }

  /** Roster and already-seated players for the side picking this step. */
  function pickingSide(): { roster: PlayerScout[]; taken: Set<string> } {
    if (ours) {
      return {
        roster: homeRoster,
        taken: lockedPlayerIds(ourLockedPicks(history, planPicks, homeRoster)),
      };
    }
    const theirLocked: LockedPick[] = history
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) ?? null }));
    return { roster: theirRoster, taken: lockedPlayerIds(theirLocked) };
  }

  /**
   * Heroes this side may be suggested: someone still unseated must clear the
   * comfort bar. Falls back to the open field only when nothing is legal.
   */
  function comfortGatedField(heroes: string[], pair: boolean): string[] {
    if (step?.kind !== "pick") return heroes;
    const { roster, taken } = pickingSide();
    if (!roster.length) return heroes;
    // Tournament mode can move anyone, so a seated player still counts.
    const gateTaken = tournamentDraftMode ? undefined : taken;
    const legal = heroes.filter(
      (h) => playersMeetingSuggestBar(roster, h, gateTaken).length > 0,
    );
    if (!legal.length) return heroes;
    if (pair && !anySuggestablePair(roster, legal, gateTaken)) return heroes;
    return legal;
  }

  /** Promote any open hero (or pair) that outscores the shortlist's top. */
  function sweepSuggestion(base: Suggestion | null): Suggestion | null {
    if (useStormLeague) return base;
    if (!base || !step || !base.options.length) return base;
    const cardLimit = ours ? 6 : 3;
    const top = base.options[0];
    const open = gradeField(base);
    const field = comfortGatedField(open, Boolean(top.pairWith));
    const relaxed = field.length === open.length;

    if (top.pairWith) {
      const scoring = pairScoring();
      const { roster, taken } = pickingSide();
      const inField = (hero: string) =>
        field.some((h) => heroKey(h) === heroKey(hero));
      // One player cannot lock both halves of a double pick.
      const seatable = (a: string, b: string) =>
        relaxed ||
        !roster.length ||
        pairHasDistinctOwners(
          roster,
          a,
          b,
          tournamentDraftMode ? undefined : taken,
        );
      let best: ScoredOption | null =
        (relaxed || (inField(top.hero) && inField(top.pairWith))) &&
        seatable(top.hero, top.pairWith)
          ? scoring.assemble(top.hero, top.pairWith)
          : null;
      const consider = (a: string, b: string) => {
        if (heroKey(a) === heroKey(b)) return;
        if (!inField(a) || !inField(b)) return;
        if (!seatable(a, b)) return;
        for (const card of [scoring.assemble(a, b), scoring.assemble(b, a)]) {
          if (!best || card.total > best.total) best = card;
        }
      };
      const head = [...field]
        .sort((a, b) => scoring.solo(b).total - scoring.solo(a).total)
        .slice(0, 20);
      for (let i = 0; i < head.length; i++) {
        for (let j = i + 1; j < head.length; j++) consider(head[i], head[j]);
      }
      if (!best) return base;
      const seededBest = best;
      // Grading ranks against every pair with the same two roles — cover it all.
      const r1 = heroRole(seededBest.hero);
      const r2 = heroRole(seededBest.pairWith ?? seededBest.hero);
      const firsts = field.filter((h) => heroRole(h) === r1);
      const seconds = field.filter((h) => heroRole(h) === r2);
      for (const a of firsts) for (const b of seconds) consider(a, b);
      if (!best) return base;
      const chosen = best;

      // The benchmark stays the board's best pair; the cards only offer partners for the held hero.
      const seed = pairPick[0];
      if (seed) {
        const completions = field
          .filter(
            (h) =>
              heroKey(h) !== heroKey(seed) && inField(h) && seatable(seed, h),
          )
          .map((h) => scoring.assemble(seed, h))
          .sort((a, b) => b.total - a.total);
        if (!completions.length) return { ...base, originalPair: chosen };
        return {
          ...base,
          hero: seed,
          options: completions.slice(0, cardLimit),
          originalPair: chosen,
        };
      }
      const samePair =
        heroKey(chosen.hero) === heroKey(top.hero) &&
        heroKey(chosen.pairWith ?? "") === heroKey(top.pairWith);
      const rest = base.options
        .filter(
          (o) =>
            o.pairWith &&
            inField(o.hero) &&
            inField(o.pairWith) &&
            seatable(o.hero, o.pairWith) &&
            !(
              heroKey(o.hero) === heroKey(chosen.hero) &&
              heroKey(o.pairWith) === heroKey(chosen.pairWith ?? "")
            ),
        )
        .map((o) => scoring.assemble(o.hero, o.pairWith!))
        .sort((a, b) => b.total - a.total);
      return {
        ...base,
        hero: chosen.hero,
        options: [chosen, ...rest].slice(0, cardLimit),
        originalPair: chosen,
        reason: samePair
          ? base.reason
          : `${chosen.hero} + ${chosen.pairWith} scores ${signedPoints(chosen.total)} on this board — more than the plan's ${top.hero} + ${top.pairWith}.`,
      };
    }

    const score = singleScorer(base);
    // Pair window fell back to single cards: the held hero cannot be its own
    // partner, and one player cannot own both halves.
    const seed = pairWindow ? pairPick[0] : undefined;
    const partnerOk = (h: string) => {
      if (!seed) return true;
      if (heroKey(h) === heroKey(seed)) return false;
      const { roster, taken } = pickingSide();
      return (
        relaxed ||
        !roster.length ||
        pairHasDistinctOwners(
          roster,
          seed,
          h,
          tournamentDraftMode ? undefined : taken,
        )
      );
    };
    const singleField = field.filter(partnerOk);
    const topLegal = singleField.some((h) => heroKey(h) === heroKey(top.hero));
    let best = topLegal ? score(top.hero) : null;
    for (const h of singleField) {
      const card = score(h);
      if (!best || card.total > best.total) best = card;
    }
    if (!best) return base;
    const chosen = best;
    const rankedField = singleField
      .map((hero) => score(hero))
      .sort((a, b) => b.total - a.total || a.hero.localeCompare(b.hero));
    if (heroKey(chosen.hero) === heroKey(top.hero)) {
      if (!ours) return base;
      const seen = new Set<string>();
      const options = [...base.options, ...rankedField].filter((option) => {
        if (seen.has(heroKey(option.hero))) return false;
        seen.add(heroKey(option.hero));
        return true;
      });
      return { ...base, options: options.slice(0, cardLimit) };
    }
    const seedHeld = seed && heroKey(top.hero) === heroKey(seed);
    const seen = new Set<string>();
    const options = [
      chosen,
      ...base.options.filter(
        (o) =>
          heroKey(o.hero) !== heroKey(chosen.hero) &&
          singleField.some((h) => heroKey(h) === heroKey(o.hero)),
      ),
      ...rankedField,
    ].filter((option) => {
      if (seen.has(heroKey(option.hero))) return false;
      seen.add(heroKey(option.hero));
      return true;
    });
    return {
      ...base,
      hero: chosen.hero,
      options: options.slice(0, cardLimit),
      reason: seedHeld
        ? `${seed} is held — ${chosen.hero} scores ${signedPoints(chosen.total)} as the second half of the pair.`
        : `${chosen.hero} scores ${signedPoints(chosen.total)} on this board — more than the plan's ${top.hero} (${signedPoints(score(top.hero).total)}).`,
    };
  }

  const matchupScope = useMemo(() => {
    if (!step) return { names: [] as string[], priority: [] as string[] };
    const locked = ourLockedPicks(history, planPicks, homeRoster);
    const livePicks = applyLockedToPlan(
      livePlanPicks(planPicks, gone),
      locked,
      homeRoster,
      gone,
    );
    return matchupHeroesForStep({
      step,
      stepIndex,
      ours,
      gone,
      history,
      theirLikely,
      planPicks,
      livePicks,
      planned,
      playableBanPriority,
      theirRoster,
      homeRoster,
      locked,
      takenPlayers: lockedPlayerIds(locked),
    });
  }, [
    step,
    stepIndex,
    ours,
    gone,
    history,
    theirLikely,
    planPicks,
    planned,
    playableBanPriority,
    theirRoster,
    homeRoster,
  ]);

  const scopeMissing = useMemo(
    () =>
      matchupFetchQueue(scoringMeta, matchupScope.names, matchupScope.priority),
    [scoringMeta, matchupScope],
  );

  const matchupFetchFailed =
    Boolean(matchupError) || matchupTrack?.stage === "failed";

  const provisional = useMemo(
    () =>
      watchOnly || scopeMissing.length === 0 || matchupFetchFailed
        ? sweepSuggestion(baseSuggestion())
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      scopeMissing.length,
      matchupFetchFailed,
      watchOnly,
      step,
      planned,
      stepIndex,
      gone,
      ours,
      playableBanPriority,
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
      scoringMeta,
      homeRoster,
      theirRoster,
      theirCommonBans,
      theirHeroPool,
      ourHeroPool,
      leaveDiveLive,
      pairPick,
      tournamentDraftMode,
    ],
  );

  const suggestionHeroes = useMemo(() => {
    const names: string[] = [];
    for (const opt of provisional?.options ?? []) {
      names.push(opt.hero);
      if (opt.pairWith) names.push(opt.pairWith);
    }
    if (provisional?.originalPair) {
      names.push(provisional.originalPair.hero);
      if (provisional.originalPair.pairWith) names.push(provisional.originalPair.pairWith);
    }
    return names;
  }, [provisional]);

  const optionMissing = useMemo(
    () => matchupFetchQueue(scoringMeta, suggestionHeroes, suggestionHeroes),
    [scoringMeta, suggestionHeroes],
  );

  const matchupMissing = scopeMissing.length ? scopeMissing : optionMissing;
  const matchupTargetKey = matchupMissing.join("|");
  const matchupsLoading = matchupMissing.length > 0 && !matchupFetchFailed;
  const suggestion =
    !watchOnly && optionMissing.length > 0 && !matchupFetchFailed
      ? null
      : provisional;

  useEffect(() => {
    setMatchupPatch(null);
    setMatchupPending([]);
    setMatchupError(null);
    setMatchupTrack(null);
  }, [draftMeta]);

  useEffect(() => {
    const batch = matchupTargetKey.split("|").filter(Boolean).slice(0, MATCHUP_FETCH_BATCH);
    if (!batch.length) {
      setMatchupPending([]);
      setMatchupTrack((current) =>
        current?.stage === "pulling" ? null : current,
      );
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    setMatchupPending(batch);
    setMatchupError(null);
    const url = `/api/matchups?heroes=${encodeURIComponent(batch.join("|"))}`;
    const secret = process.env.NEXT_PUBLIC_SCOUT_API_SECRET?.trim();
    fetch(url, {
      signal: ctrl.signal,
      headers: secret ? { "x-scout-secret": secret } : {},
    })
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json()) as {
          patch?: string;
          byHero?: DraftMetaTable["byHero"];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Matchup fetch failed");
        const rows = body.byHero ?? {};
        if (Object.keys(rows).length) {
          setMatchupPatch((prev) =>
            mergeLoadedMatchupRows(prev ?? draftMeta, rows, body.patch ?? ""),
          );
        }
        const returned = new Set(Object.keys(rows).map((key) => heroKey(key)));
        const failed = batch.filter((hero) => !returned.has(heroKey(hero)));
        if (failed.length) {
          setMatchupError(
            `Could not load Storm League matchups for ${failed.join(", ")}. Those duos stay at 0.`,
          );
          setMatchupTrack({ stage: "failed", heroes: failed });
          setMatchupPending([]);
          return;
        }
        setMatchupPending([]);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Matchup fetch failed";
        setMatchupError(message);
        setMatchupTrack({ stage: "failed", heroes: batch });
        setMatchupPending([]);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [matchupTargetKey, draftMeta]);

  useEffect(() => {
    if (
      !matchupTrack ||
      matchupTrack.stage === "failed" ||
      matchupTrack.stage === "pulling"
    ) {
      return;
    }
    if (matchupTrack.stage === "cached") {
      const id = window.setTimeout(() => {
        setMatchupTrack((current) =>
          current?.stage === "cached" ? { ...current, stage: "scored" } : current,
        );
      }, 700);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setMatchupTrack((current) => (current?.stage === "scored" ? null : current));
      setMatchupPending([]);
    }, 1100);
    return () => window.clearTimeout(id);
  }, [matchupTrack]);

  function baseSuggestion(): Suggestion | null {
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

    function watchSlSuggestion(
      roster: PlayerScout[],
      kind: "ban" | "pick",
      takenPlayers: Set<string>,
    ): Suggestion | null {
      const targets = slHeroSuggestions({ roster, gone, takenPlayers });
      if (!targets.length) return null;
      const ourLockedHeroes = history
        .filter((a) => a.side === "our" && a.kind === "pick")
        .map((a) => a.hero);
      const theirLockedHeroes = history
        .filter((a) => a.side === "their" && a.kind === "pick")
        .map((a) => a.hero);
      const banning = kind === "ban";
      const options = targets.map((target) => ({
        ...buildPickScorecard({
          hero: target.hero,
          table: scoringMeta,
          gone,
          map,
          ourPickCount,
          inPlan: false,
          fromAlt: false,
          planRole: null,
          lockedAllies: banning ? theirLockedHeroes : ourLockedHeroes,
          theirLocked: banning ? ourLockedHeroes : theirLockedHeroes,
          answeringTeamPool: banning ? ourHeroPool : theirHeroPool,
          answerPerspective: banning ? "ours" : "theirs",
          theirLikely,
          banPriority: playableBanPriority,
          theirRoster,
          comfort: target.comfort,
          comfortWho: target.player,
          swapDelta: 0,
          takeAndRebuild: false,
          kind,
          lastPick,
        }),
        player: target.player,
      }));
      const first = targets[0];
      const games =
        first.games > 0 ? ` (${first.games} Storm League games)` : "";
      return {
        hero: first.hero,
        badge: banning ? "Suggested bans" : "Suggested picks",
        showOurPlan: true,
        planPicks: livePicks,
        compLine: comp,
        expectLine: expect,
        cautionLine: null,
        swapLine: null,
        reason: banning
          ? `Ban ${first.hero} — ${first.player} is comfortable on it in Storm League${games}. One suggestion per opponent.`
          : `${first.player}: ${first.hero} from Storm League history${games}. One suggestion per player.`,
        options,
      };
    }

    if (useStormLeague && !ours) {
      const theirTaken = lockedPlayerIds(
        history
          .filter((action) => action.side === "their" && action.kind === "pick")
          .map((action) => ({ hero: action.hero, player: action.player ?? null })),
      );
      return watchSlSuggestion(
        step.kind === "ban" ? homeRoster : theirRoster,
        step.kind,
        step.kind === "pick" ? theirTaken : new Set(),
      );
    }

    if (ours && step.kind === "ban") {
      if (useStormLeague) return watchSlSuggestion(theirRoster, "ban", new Set());
      const ourLockedHeroes = history
        .filter((a) => a.side === "our" && a.kind === "pick")
        .map((a) => a.hero);
      const theirLockedHeroes = history
        .filter((a) => a.side === "their" && a.kind === "pick")
        .map((a) => a.hero);
      const ourPlanned = new Set(livePicks.map((p) => heroKey(p.hero)));
      const banPool = [
        ...playableBanPriority.map((b) => b.hero),
        ...theirLikely.map((p) => p.hero),
      ]
        .filter((h, i, arr) => {
          if (isGone(h, gone)) return false;
          if (ourPlanned.has(heroKey(h))) return false;
          return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
        })
        .filter((h) => theirPlaysHero(theirRoster, h, theirLikely));
      const treeBan = planned[stepIndex];
      if (
        treeBan?.side === "our" &&
        treeBan.kind === "ban" &&
        !isGone(treeBan.hero, gone) &&
        theirPlaysHero(theirRoster, treeBan.hero, theirLikely) &&
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
          return {
            ...buildPickScorecard({
              hero: h,
              table: scoringMeta,
              gone,
              map,
              ourPickCount,
              inPlan: false,
              fromAlt: false,
              planRole: null,
              // Synergy the ban denies: they would play it with their locks.
              lockedAllies: theirLockedHeroes,
              // answering side = us (open counters we can still take)
              theirLocked: ourLockedHeroes,
              answeringTeamPool: ourHeroPool,
              answerPerspective: "ours",
              theirLikely,
              banPriority: playableBanPriority,
              theirRoster,
              comfort: sig.comfort,
              comfortWho: sig.who,
              swapDelta: 0,
              takeAndRebuild: false,
              kind: "ban",
              lastPick,
            }),
            player: theirOwnerName(h, theirLikely),
          };
        })
        .sort((a, b) => b.total - a.total || a.hero.localeCompare(b.hero))
        .slice(0, 6);
      const hero = options[0]?.hero;
      if (!hero) return null;
      const banReason =
        playableBanPriority.find((b) => heroKey(b.hero) === heroKey(hero))
          ?.reason ??
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
        cautionLine: null,
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
      ]
        .filter((h, i, arr) => {
          if (isGone(h, gone)) return false;
          return arr.findIndex((x) => heroKey(x) === heroKey(h)) === i;
        })
        .filter((h) =>
          step.kind === "ban"
            ? !homeRoster.length ||
              heroMeetsSuggestBar(homeRoster, h, null)
            : theirPlaysHero(theirRoster, h, theirLikely),
        );
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
            theirRoster,
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
              const theirSeats: LockedPick[] = history
                .filter((a) => a.side === "their" && a.kind === "pick")
                .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) }));
              const reseat = reseatFor(theirRoster, theirSeats, hero, theirLikely);
              const card = buildPickScorecard({
                hero,
                table: scoringMeta,
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
                theirLikely: planPicks,
                banPriority: [],
                comfort: sig.comfort,
                comfortWho: sig.who,
                swapDelta: reseat.swapDelta,
                swapNote: reseat.swapNote,
                takeAndRebuild: false,
                kind: "pick",
                lastPick: false,
                unplayed: heroUnplayedBy(theirRoster, hero),
              });
              soloCache.set(k, card);
              return card;
            };
            const pairs = rankDoublePickPairs({
              seats,
              soloScore: (h) => soloFor(h).total,
              contested: () => false,
              projectBoth: (first, second) =>
                pairStructureProjection(
                  lockedHeroPicks(theirLockedHeroes),
                  seats,
                  first,
                  second,
                ),
              table: scoringMeta,
            });
            if (pairs.length) {
              const pairSet = pairSeededPairOptions({
                pairPick,
                pairs,
                rescore: (first, second) =>
                  scoreOrderedPair({
                    first: pairSeatCandidate(seats, first),
                    second: pairSeatCandidate(seats, second),
                    soloScore: (h) => soloFor(h).total,
                    projectBoth: (a, b) =>
                      pairStructureProjection(
                        lockedHeroPicks(theirLockedHeroes),
                        seats,
                        a,
                        b,
                      ),
                    table: scoringMeta,
                  }),
              });
              const toOption = (pair: RankedPickPair): ScoredOption => {
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
                  pairFactors: pair.pairFactors,
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
              };
              const options = pairSet.slice(0, 3).map(toOption);
              const originalPair = toOption(pairs[0]);
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
                originalPair,
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
          const theirSeats: LockedPick[] = history
            .filter((a) => a.side === "their" && a.kind === "pick")
            .map((a) => ({ hero: a.hero, player: displayPlayer(a.player) }));
          const reseat =
            step.kind === "pick"
              ? reseatFor(theirRoster, theirSeats, h, theirLikely)
              : { swapDelta: 0, swapNote: null };
          return {
            ...buildPickScorecard({
              hero: h,
              table: scoringMeta,
              gone,
              map,
              ourPickCount: theirPickCount,
              inPlan: Boolean(matched),
              fromAlt: Boolean(matched && !matched.exact),
              planRole: matched?.seat.role ?? null,
              lockedAllies: theyAnswer ? ourLockedHeroes : theirLockedHeroes,
              theirLocked: theyAnswer ? theirLockedHeroes : ourLockedHeroes,
              answeringTeamPool: theyAnswer ? theirHeroPool : ourHeroPool,
              answerPerspective: theyAnswer ? "theirs" : "ours",
              theirLikely: step.kind === "pick" ? planPicks : [],
              banPriority: [],
              comfort: sig.comfort,
              comfortWho: sig.who,
              swapDelta: reseat.swapDelta,
              swapNote: reseat.swapNote,
              takeAndRebuild: false,
              kind: step.kind,
              lastPick,
              unplayed: step.kind === "pick" && heroUnplayedBy(theirRoster, h),
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
    if (useStormLeague) return watchSlSuggestion(homeRoster, "pick", takenPlayers);
    const candMeta = pickCandidates(livePicks, gone, homeRoster).filter((c) => {
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
      const seats = seatPairCandidates(
        livePicks,
        gone,
        takenPlayers,
        homeRoster,
      );
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
          const reseat = reseatFor(homeRoster, locked, hero, planPicks);
          const card = buildPickScorecard({
            hero,
            table: scoringMeta,
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
            banPriority: playableBanPriority,
            theirRoster,
            comfort: sig.comfort,
            comfortWho: sig.who,
            swapDelta: reseat.swapDelta,
            swapNote: reseat.swapNote,
            takeAndRebuild: shouldTakeAndRebuild(scoringMeta, hero),
            kind: "pick",
            lastPick: false,
            unplayed: heroUnplayedBy(homeRoster, hero),
          });
          soloCache.set(k, card);
          return card;
        };
        const pairs = rankDoublePickPairs({
          seats,
          soloScore: (h) => soloFor(h).total,
          contested: (h) =>
            Boolean(
              theyMightTake(h, theirLikely, playableBanPriority, theirRoster),
            ),
          projectBoth: (first, second) =>
            pairStructureProjection(
              lockedHeroPicks(ourLockedForPairs),
              seats,
              first,
              second,
            ),
          table: scoringMeta,
        });
        if (pairs.length) {
          const seeded = pairSeededPairOptions({
            pairPick,
            pairs,
            rescore: (first, second) =>
              scoreOrderedPair({
                first: pairSeatCandidate(seats, first),
                second: pairSeatCandidate(seats, second),
                soloScore: (h) => soloFor(h).total,
                projectBoth: (a, b) =>
                  pairStructureProjection(
                    lockedHeroPicks(ourLockedForPairs),
                    seats,
                    a,
                    b,
                  ),
                table: scoringMeta,
              }),
          });
          const pairSet = seeded.length > 0 ? seeded : pairs;
          const toOption = (pair: RankedPickPair): ScoredOption => {
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
              pairFactors: pair.pairFactors,
            };
          };
          const options = pairSet.slice(0, 6).map(toOption);
          const originalPair = toOption(pairs[0]);
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
            originalPair,
          };
        }
      }
    }

    const candidates = candMeta.map((c) => c.hero);
    if (!candidates.length) {
      const fallback = homeRoster
        .flatMap((p) =>
          p.topHeroes
            .filter((h) => comfortMeetsSuggestBar(h.comfort))
            .map((h) => h.hero),
        )
        .find((h) => !isGone(h, gone));
      if (!fallback) return null;
      const fallbackSig = comfortSignal(homeRoster, fallback, null);
      const opt = buildPickScorecard({
        hero: fallback,
        table: scoringMeta,
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
        banPriority: playableBanPriority,
        theirRoster,
        comfort: fallbackSig.comfort,
        comfortWho: fallbackSig.who,
        swapDelta: 0,
        takeAndRebuild: false,
        kind: "pick",
        lastPick,
        unplayed: heroUnplayedBy(homeRoster, fallback),
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
      const reseat = reseatFor(homeRoster, locked, hero, planPicks);
      const swap = reseat.swapNote ? null : swapFor(hero);
      const sig = comfortSignal(
        homeRoster,
        hero,
        seatPlayerOf(hero) ?? cand?.player ?? null,
      );
      const card = withRolesFactor(
        buildPickScorecard({
          hero,
          table: scoringMeta,
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
          banPriority: playableBanPriority,
          theirRoster,
          comfort: sig.comfort,
          comfortWho: sig.who,
          swapDelta: reseat.swapNote ? reseat.swapDelta : (swap?.comfortDelta ?? 0),
          swapNote: reseat.swapNote,
          takeAndRebuild: shouldTakeAndRebuild(scoringMeta, hero),
          kind: "pick",
          lastPick,
          unplayed: heroUnplayedBy(homeRoster, hero),
        }),
        ourLockedHeroes,
      );
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
        shouldTakeAndRebuild(scoringMeta, h),
      );
      if (takeNow.length) {
        ranked = [
          ...takeNow,
          ...ranked.filter((h) => !shouldTakeAndRebuild(scoringMeta, h)),
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
      .slice(0, 6);

    const hero = options[0]?.hero ?? ranked[0];
    const cand = metaOf(hero);
    const seatWho = seatPlayerOf(hero);
    const foundSeat = findSeatForCandidate(livePicks, hero);
    const swap = swapFor(hero);
    const takeAndRebuild =
      !swap && shouldTakeAndRebuild(scoringMeta, hero);
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
      table: scoringMeta,
      hero,
      ourPickCount,
      gone,
      map,
      planPicks: shownPlan,
      expectLine: expect,
      theirLikely,
      banPriority: playableBanPriority,
      theirRoster,
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
        liveCountersUp(scoringMeta, skipped, gone),
        theirLockedHeroes,
        theirHeroPool,
      );
      const skipMeta = heroDraftMeta(scoringMeta, skipped);
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
        skipNote = `Holding ${skipped} as the real offlane — do not first-pick the lane into live hard counters.`;
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
  }

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
    const steps: DraftStepScore[] = [];
    history.forEach((action, index) => {
      if (!action.score) return;
      const partner =
        action.kind === "pick" && isDoublePickWindow(DRAFT_ORDER, index)
          ? history[index + 1]
          : undefined;
      steps.push({
        side: action.side,
        kind: action.kind,
        label: partner
          ? `Picks ${action.ordinal} + ${partner.ordinal}`
          : `${action.kind === "ban" ? "Ban" : "Pick"} ${action.ordinal}`,
        locked: partner ? `${action.hero} + ${partner.hero}` : action.hero,
        bestLabel: action.score.bestLabel,
        best: action.score.best,
        achieved: action.score.achieved,
        percentile: action.score.percentile,
        fieldSize: action.score.fieldSize,
      });
    });
    return gradeFinishedDraft({
      ourLocked,
      theirLocked,
      steps,
      ourMmr,
      theirMmr,
      homeRoster,
      theirRoster,
      table: scoringMeta,
      map: map ?? null,
      ourLabel,
      theirLabel,
    });
  }, [
    done,
    history,
    planPicks,
    homeRoster,
    theirRoster,
    scoringMeta,
    map,
    ourLabel,
    theirLabel,
    ourMmr,
    theirMmr,
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
      ourHeals.find((a) =>
        theyMightTake(a.hero, theirLikely, playableBanPriority, theirRoster),
      ) ?? ourHeals[0];
    const wasDeny = Boolean(
      theyMightTake(
        denyPick.hero,
        theirLikely,
        playableBanPriority,
        theirRoster,
      ),
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
  }, [done, history, theirLikely, playableBanPriority, theirRoster]);

  const compTalents = useMemo(() => {
    if (!done) return [];
    const ourPicks = stampedHistory.filter((a) => a.side === "our" && a.kind === "pick");
    const ourFive = ourPicks.map((a) => a.hero);
    const theirFive = stampedHistory
      .filter((a) => a.side === "their" && a.kind === "pick")
      .map((a) => a.hero);
    return ourPicks.flatMap((a) =>
      criticalTalentsFor(a.hero, ourFive, theirFive).map((t) => ({
        ...t,
        player: displayPlayer(a.player ?? null),
      })),
    );
  }, [done, stampedHistory]);

  const remainingBans = playableBanPriority.filter(
    (b) => !isGone(b.hero, gone),
  );

  const available = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allHeroes.filter((h) => {
      if (isGone(h, gone)) return false;
      if (!q) return true;
      return h.toLowerCase().includes(q);
    });
  }, [allHeroes, gone, filter]);

  function lock(hero: string, reason?: string, fromWatch = false) {
    if (watchOnly && !fromWatch) return;
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
        const pairOptions = suggestion?.options.filter((option) => option.pairWith) ?? [];
        const scoring = pairScoring();
        let bestPair: ScoredOption | undefined =
          suggestion?.originalPair ?? pairOptions[0];
        if (!bestPair && suggestion) {
          // The plan had no seat pairs left (e.g. its last seat was banned) so
          // the cards fell back to singles — still grade the lock as a pair.
          const { roster, taken } = pickingSide();
          const ranked = comfortGatedField(gradeField(suggestion), true)
            .map((h) => scoring.solo(h))
            .sort((a, b) => b.total - a.total)
            .slice(0, 12);
          let top: ScoredOption | null = null;
          for (let i = 0; i < ranked.length; i++) {
            for (let j = i + 1; j < ranked.length; j++) {
              const a = ranked[i].hero;
              const b = ranked[j].hero;
              if (roster.length && !pairHasDistinctOwners(roster, a, b, taken)) {
                continue;
              }
              for (const card of [scoring.assemble(a, b), scoring.assemble(b, a)]) {
                if (!top || card.total > top.total) top = card;
              }
            }
          }
          bestPair = top ?? undefined;
        }
        const assembled = scoring.assemble(firstHero, secondHero);
        const firstBreakdown = pairSideBreakdown(
          assembled.firstSoloFactors ?? scoring.solo(firstHero).factors,
          assembled.pairFactors,
          "first",
        );
        const secondBreakdown = pairSideBreakdown(
          assembled.secondSoloFactors ?? scoring.solo(secondHero).factors,
          assembled.pairFactors,
          "second",
        );
        let pairScore: StepScore | undefined;
        if (bestPair) {
          // Same scorer the suggestion sweep ranked with, so totals compare like for like.
          const chosenPair = assembled;
          const { benchmark, roleMatched, field } = roleMatchedPair({
            best: bestPair,
            chosen: { ...chosenPair, pairWith: chosenPair.pairWith ?? secondHero },
            pool: suggestion
              ? comfortGatedField(gradeField(suggestion), true)
              : allHeroes.filter((h) => !isGone(h, gone)),
            soloTotal: (h) => scoring.solo(h).total,
            assemble: scoring.assemble,
            roleBlocked:
              checkRequiredRoles([...scoring.sideLocked, firstHero, secondHero])
                .unfillable > 0,
          });
          const note = gradePairSelection(benchmark, chosenPair);
          setDeviationNote(
            roleMatched && heroKey(benchmark.hero) !== heroKey(bestPair.hero)
              ? {
                  ...note,
                  summary: `${note.summary} Graded against the best ${pairRolesLabel(benchmark)} pair, not the overall top ${bestPair.hero} + ${bestPair.pairWith} (${signedPoints(bestPair.total)}), which fills different roles.`,
                }
              : note,
          );
          pairScore = {
            best: benchmark.total,
            achieved: chosenPair.total,
            bestLabel: benchmark.pairWith
              ? `${benchmark.hero} + ${benchmark.pairWith}`
              : benchmark.hero,
            percentile: percentileRank(chosenPair.total, field),
            fieldSize: field.length,
          };
        } else {
          setDeviationNote(null);
        }
        const nextHistory = [
          { side: ours ? "our" : "their", kind: "pick", ordinal: (ours ? ourPickCount : theirPickCount) + 1, hero: firstHero, score: pairScore, breakdown: firstBreakdown },
          { side: ours ? "our" : "their", kind: "pick", ordinal: (ours ? ourPickCount : theirPickCount) + 2, hero: secondHero, breakdown: secondBreakdown },
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
            replaySeats,
            tournamentDraftMode,
            guessSeats,
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
    const sideKey = ours ? "our" : "their";
    const plated = step.kind === "pick" ? platePlayer(sideKey, hero) : null;
    const player =
      step.kind !== "pick"
        ? null
        : fromWatch
          ? plated
          : ours
            ? ownerForHero(hero, planPicks, homeRoster, lockedSoFar)
            : theirOwnerForHero(hero, theirLikely, history, theirRoster);

    let stepScore: StepScore | undefined;
    let breakdown: BoardBreakdown | undefined;
    if (suggestion) {
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
      const scoreHero = singleScorer(suggestion);
      const cardFor = (h: string): ScoredOption =>
        suggestion.options.find((o) => heroKey(o.hero) === heroKey(h)) ??
        scoreHero(h);
      const suggestedCard = cardFor(suggestion.hero);
      let chosenCard = cardFor(hero);
      // Pair suggestions vs a lone first lock: never stack pair total / Then ·
      // into the suggested column. Locking the follow-up first = reorder.
      const fair = fairFirstLockDeviationCards(suggestedCard, chosenCard);
      chosenCard = fair.chosen;
      breakdown = { total: chosenCard.total, factors: chosenCard.factors };
      const {
        benchmark: fairSuggested,
        roleMatched,
        field,
      } = roleMatchedSingle({
        best: fair.suggested,
        chosen: chosenCard,
        pool: comfortGatedField(gradeField(suggestion), false),
        score: cardFor,
        byRole: step.kind === "pick" && !fair.pairReorder,
        roleBlocked:
          step.kind === "pick" &&
          checkRequiredRoles([
            ...(ours ? ourLockedHeroes : theirLockedHeroes),
            hero,
          ]).unfillable > 0,
      });
      const benchmarkHero = fairSuggested.hero;
      const overallNote = roleMatched
        ? `The overall top pick was ${suggestion.hero} (${signedPoints(fair.suggested.total)}), a ${heroRole(suggestion.hero)} — graded against the best ${heroRole(hero)} instead.`
        : null;
      stepScore = {
        best: fairSuggested.total,
        achieved: chosenCard.total,
        bestLabel: benchmarkHero,
        percentile: percentileRank(chosenCard.total, field),
        fieldSize: field.length,
      };

      if (heroKey(hero) === heroKey(suggestion.hero)) {
        setDeviationNote(null);
      } else if (roleMatched && heroKey(hero) === heroKey(benchmarkHero)) {
        setDeviationNote({
          summary: `${hero} was the best ${heroRole(hero)} available (${signedPoints(chosenCard.total)}). ${overallNote}`,
          severity: "solid",
          kind: step.kind,
          suggested: fair.suggested,
          chosen: chosenCard,
        });
      } else if (fair.pairReorder) {
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
          suggested: benchmarkHero,
          chosen: hero,
          planPicks: suggestion.planPicks.length
            ? suggestion.planPicks
            : planPicks,
          banPriority: playableBanPriority,
          theirLikely,
          theirRoster,
          table: scoringMeta,
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
          const summary = [graded.summary, fair.note, overallNote]
            .filter(Boolean)
            .join(" ");
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
          draftedFor: player,
          reason,
          score: stepScore,
          breakdown,
        },
      ];
      if (step.kind !== "pick") return next;
      return restampSidePlayers(
        next,
        ours ? "our" : "their",
        ours ? homeRoster : theirRoster,
        ours ? planPicks : theirLikely,
        replaySeats,
        tournamentDraftMode,
        guessSeats,
      );
    });
    setFilter("");
  }

  function platePlayer(side: "our" | "their", hero: string): string | null {
    const heroes = side === "our" ? observedPicks?.ourPicks : observedPicks?.theirPicks;
    const players =
      side === "our" ? observedPicks?.ourPickPlayers : observedPicks?.theirPickPlayers;
    if (!heroes) return null;
    const index = heroes.findIndex((name) => heroKey(name) === heroKey(hero));
    if (index < 0) return null;
    const name = players?.[index]?.trim();
    return name || null;
  }

  /** Next replay action to play; stays put after undo so the user can explore alternatives. */
  const replayCursor = useRef(0);
  const [replayStop, setReplayStop] = useState<string | null>(null);
  const replayIndex = history.length + pairPick.length;
  useEffect(() => {
    if (!replay || !step || replayStop) return;
    if (replayIndex !== replayCursor.current || replayIndex >= replay.length) return;
    const next = replay[replayIndex];
    if (next.kind !== step.kind || next.side !== (ours ? "our" : "their")) {
      setReplayStop(`Replay step ${replayIndex + 1} doesn't match the draft order.`);
      return;
    }
    if (isGone(next.hero, gone)) {
      setReplayStop(`${next.hero} was already taken by step ${replayIndex + 1}.`);
      return;
    }
    replayCursor.current = replayIndex + 1;
    lock(next.hero, "Played in the replay");
  });

  const screenCursor = useRef(0);
  const screenHadLocks = useRef(false);
  const screenIndex = history.length + pairPick.length;
  useEffect(() => {
    if (replay || !screen) return;
    if (screen.length === 0) {
      screenCursor.current = 0;
      if (screenHadLocks.current) {
        screenHadLocks.current = false;
        setHistory([]);
        setPairPick([]);
      }
      return;
    }
    screenHadLocks.current = true;
    setHistory((prev) => {
      let changed = false;
      const next = prev.map((action, index) => {
        const fromScreen = screen[index];
        if (
          !fromScreen ||
          fromScreen.kind !== action.kind ||
          fromScreen.side !== action.side
        ) {
          return action;
        }
        const heroArrived =
          action.hero === UNSEEN_BAN &&
          fromScreen.hero !== UNSEEN_BAN;
        const plated = platePlayer(action.side, action.hero);
        const playerArrived =
          (heroKey(action.hero) === heroKey(fromScreen.hero) &&
            Boolean(fromScreen.player) &&
            fromScreen.player !== action.player) ||
          Boolean(plated && plated !== action.player);
        if (!heroArrived && !playerArrived) return action;
        changed = true;
        const player = plated ?? fromScreen.player ?? action.player;
        return {
          ...action,
          hero: heroArrived ? fromScreen.hero : action.hero,
          player,
          draftedFor: player ?? action.draftedFor,
          reason: "Locked on the shared screen",
        };
      });
      return changed ? next : prev;
    });
    if (screenIndex !== screenCursor.current || screenIndex >= screen.length || !step) return;
    const next = screen[screenIndex];
    if (next.kind !== step.kind || next.side !== (ours ? "our" : "their")) return;
    if (next.hero === UNSEEN_BAN) {
      screenCursor.current = screenIndex + 1;
      setHistory((prev) => [
        ...prev,
        {
          side: next.side,
          kind: "ban",
          ordinal:
            prev.filter((action) => action.side === next.side && action.kind === "ban").length +
            1,
          hero: UNSEEN_BAN,
          player: null,
          reason: "Already locked before it was on screen",
        },
      ]);
      return;
    }
    if (isGone(next.hero, gone)) return;
    screenCursor.current = screenIndex + 1;
    lock(next.hero, "Locked on the shared screen", true);
  });

  function undo() {
    if (pairPick.length) {
      setPairPick([]);
      return;
    }
    setHistory((prev) => {
      if (!prev.length) return prev;
      const removed = prev[prev.length - 1];
      // A double pick is locked as one action, so it undoes as one.
      const count = undoCount(prev.length);
      const next = prev.slice(0, -count);
      if (removed.kind !== "pick") return next;
      return restampSidePlayers(
        next,
        removed.side,
        removed.side === "our" ? homeRoster : theirRoster,
        removed.side === "our" ? planPicks : theirLikely,
        replaySeats,
        tournamentDraftMode,
        guessSeats,
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
  const ourPicks = watchOnly
    ? fillUnplacedLocks(
        slotsFor(stampedHistory, "our", "pick", 5),
        observedPicks?.ourPicks ?? [],
        observedPicks?.ourPickPlayers ?? [],
        "our",
      )
    : slotsFor(stampedHistory, "our", "pick", 5);
  const theirPicks = watchOnly
    ? fillUnplacedLocks(
        slotsFor(stampedHistory, "their", "pick", 5),
        observedPicks?.theirPicks ?? [],
        observedPicks?.theirPickPlayers ?? [],
        "their",
      )
    : slotsFor(stampedHistory, "their", "pick", 5);
  const heldHero = pairWindow ? pairPick[0] : undefined;
  const heldSlots = ours ? ourPicks : theirPicks;
  const heldIndex = heldHero ? heldSlots.indexOf(null) : -1;
  if (heldHero && heldIndex >= 0) {
    heldSlots[heldIndex] = {
      side: ours ? "our" : "their",
      kind: "pick",
      ordinal: heldIndex + 1,
      hero: heldHero,
      player: null,
      reason: "Selected — tap the second hero to lock both",
    };
  }

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
    : stepHeading({
        ours,
        kind: step.kind,
        ordinal: stepOrdinal,
        pair: pairWindow,
        watch: watchOnly,
      });

  return (
    <div className="relative space-y-4 overflow-visible rounded-md border border-[#2a3a48] bg-[#0f1821] p-4 text-[#e8eef2]">
      {matchupTrack?.stage === "failed" ? (
        <MatchupTracker
          track={matchupTrack}
          error={matchupError}
          onDismiss={() => setMatchupTrack(null)}
        />
      ) : null}
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
          {!watchOnly && (
            <>
              <button
                type="button"
                onClick={undo}
                disabled={history.length === 0 && pairPick.length === 0}
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
            </>
          )}
        </div>
      </div>

      <DraftSideRow
        label={theirLabel}
        bans={theirBans}
        picks={theirPicks}
        heldIndex={ours ? -1 : heldIndex}
        accent="enemy"
        roster={theirRoster}
      />
      <DraftSideRow
        label={ourLabel}
        bans={ourBans}
        picks={ourPicks}
        heldIndex={ours ? heldIndex : -1}
        accent="ally"
        roster={homeRoster}
      />

      {remainingBans.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
            Ban priority still up
          </p>
          <ul className="flex flex-wrap gap-3">
            {remainingBans.map((b, i) => (
              <li key={b.hero} className="flex flex-col items-center gap-1">
                {watchOnly ? (
                  <HeroFace
                    hero={b.hero}
                    kind="select"
                    size="sm"
                    banned
                    label={`${i + 1}. ${b.hero}`}
                    title={b.reason}
                  />
                ) : (
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
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {replayStop && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {replayStop} Finish the rest by hand to get a grade.
        </p>
      )}
      <div className="rounded-md border border-[#3d5163] bg-[#162230] px-4 py-4">
        {done ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-[#9dceb0]">
              {watchOnly
                ? "Draft complete. Grade and win chance are from the heroes on screen."
                : "Draft walk complete. Undo if something was logged wrong."}
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
            <div className="space-y-2 rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[#8aa0b2]">
                Must-take talents
              </p>
              {compTalents.length ? (
                <ul className="space-y-1.5">
                  {compTalents.map((t) => (
                    <li
                      key={`${t.hero}-${t.talent}`}
                      className="text-sm leading-snug text-[#c5d4e0]"
                    >
                      <span className="font-semibold text-[#e8eef2]">
                        {t.player ? `${t.player} (${t.hero})` : t.hero}: {t.talent}{" "}
                        at {t.level}
                      </span>{" "}
                      — {t.why}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#c5d4e0]">
                  No single talent makes or breaks this comp. Take your usual
                  builds.
                </p>
              )}
            </div>
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
              </p>
              <p className="text-xs text-[#8aa0b2]">
                Step {stepIndex + 1} / {DRAFT_ORDER.length}
              </p>
            </div>
            {watchOnly && (
              <p className="text-sm text-[#c5d4e0]">
                {tournamentDraftMode && !stormLeagueOnly
                  ? "Tournament mode uses NGS hero pools. Heroes lock from the shared screen."
                  : tournamentDraftMode
                    ? "Loading NGS hero pools. Heroes lock from the shared screen."
                  : ours && step?.kind === "ban"
                    ? "Ban suggestions are each opponent's Storm League comfort. Heroes lock from the shared screen."
                    : ours && step?.kind === "pick"
                      ? "One Storm League suggestion for each player still to lock. Heroes lock from the shared screen."
                      : "Storm League history only. Heroes lock from the shared screen."}
              </p>
            )}

            {deviationNote && <DeviationCallout note={deviationNote} />}
            {pairWindow && pairPick.length > 0 && (
              <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-2 text-sm text-[#9dceb0]">
                {watchOnly
                  ? `Pair in progress: ${pairPick.join(" + ")} — the next lock from the screen completes it.`
                  : `Pair in progress: ${pairPick.join(" + ")} — choose one more hero to lock the duo.`}
              </div>
            )}

            {!watchOnly && (
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
            )}

            {matchupsLoading && !watchOnly ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-[#3d5163] bg-[#162230] px-3 py-3 text-sm text-[#dfeaf4]"
              >
                <p className="font-semibold text-[#e8eef2]">
                  Loading Storm League matchups before scoring…
                </p>
                <p className="mt-1 text-[#c5d4e0]">
                  {matchupPending.length > 0
                    ? `Pulling ${matchupPending.join(", ")} (${matchupMissing.length} left in queue)`
                    : `${matchupMissing.length} hero${matchupMissing.length === 1 ? "" : "es"} queued`}
                </p>
              </div>
            ) : null}

            {watchOnly && !suggestion && step ? (
              <p className="text-sm text-[#c5d4e0]">
                Reading the names on screen. A Storm League suggestion for each player shows up as soon as those histories load.
              </p>
            ) : null}

            {suggestion && (
              <div className="flex flex-wrap items-start gap-4 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-3">
                <MissingDuoBanner
                  options={suggestion.options}
                  pending={matchupPending}
                  error={matchupError}
                />
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
                      canLock={!watchOnly}
                      onLock={() =>
                        lock(
                          pairCardClickHero(opt.hero, opt.pairWith, pairPick),
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
                  {!watchOnly && (
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
                  )}
                </div>
              </div>
            )}

            {!watchOnly && (
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
            )}
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

/** `pct` is P(we win); shown from the favoured side's view. */
function WinChance({
  label,
  pct,
  ours,
  theirs,
  title,
}: {
  label: string;
  pct: number;
  ours: string;
  theirs: string;
  title: string;
}) {
  const who =
    pct === 50 ? "Even" : `${pct > 50 ? ours : theirs} favoured`;
  const shown = `${pct >= 50 ? pct : 100 - pct}%`;
  return (
    <div title={title}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
        {label}
      </p>
      <p
        className={`text-3xl font-bold tabular-nums leading-none ${winPctTone(pct)}`}
      >
        {shown}
      </p>
      <p className="mt-0.5 text-[11px] text-[#8aa0b2]">{who}</p>
    </div>
  );
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
          <p className="mt-1 max-w-xl text-xs leading-snug text-[#8aa0b2]">
            Each ban and pick is ranked against every option open at that
            moment (picks only against heroes in the same role): top 10% is an
            A, next 10% a B, down to F for anything below 60%. Win chance only
            compares the two finished fives. A team can draft loosely and
            still end up with the stronger five.
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <WinChance
            label="Win chance · final fives"
            pct={report.draftWinPct}
            ours={report.ours.label}
            theirs={report.theirs.label}
            title="Compares the two finished fives (comfort, synergy, matchups, map, roles). Not affected by the letter grades."
          />
          {report.mmrWinPct !== null && (
            <WinChance
              label="Win chance · fives + MMR"
              pct={report.mmrWinPct}
              ours={report.ours.label}
              theirs={report.theirs.label}
              title={`Final-five odds shifted by the NGS team-average MMR gap (${report.mmrGap! >= 0 ? "+" : ""}${report.mmrGap}). MMR weight fit on 406 NGS Season 22 games: a 75 MMR edge alone wins about 73%.`}
            />
          )}
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
                title="Draft decisions: average share of comparable options each ban and pick beat (90%+ A, 80%+ B, 70%+ C, 60%+ D)"
              >
                {side.grade}
              </span>
            </div>
            <p className="mt-1 text-xs tabular-nums text-[#8aa0b2]">
              Decisions beat {side.percentile}% of options on average
              {" · "}final five strength {side.quality}/100
            </p>
            <ul className="mt-2 space-y-1">
              {side.notes.map((n) => (
                <li
                  key={n}
                  className={
                    n.startsWith("Unplayed:")
                      ? "rounded border-2 border-red-500 bg-red-950 px-2 py-1.5 text-sm font-bold leading-snug text-red-50"
                      : "text-sm leading-snug text-[#c5d4e0]"
                  }
                >
                  {n}
                </li>
              ))}
            </ul>
            {side.steps.length > 0 && (
              <ol className="mt-2 space-y-1 border-t border-[#2a3a48] pt-2">
                {side.steps.map((s) => (
                  <li
                    key={s.label}
                    className="flex items-center gap-2 text-xs leading-snug text-[#c5d4e0]"
                    title={[
                      s.fieldSize
                        ? `Beat ${s.percentile}% of ${s.fieldSize - 1} other options`
                        : null,
                      `Score ${Math.round(s.achieved)} of a best ${Math.round(Math.max(0, s.best, s.achieved))}`,
                      s.achieved >= s.best
                        ? "Took the top option"
                        : `Top option: ${s.bestLabel} (${Math.round(s.best)})`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <span
                      className={`inline-flex w-8 shrink-0 justify-center rounded border py-px text-[11px] font-bold ${gradeTone(s.grade)}`}
                    >
                      {s.grade}
                    </span>
                    <span className="w-20 shrink-0 text-[#8aa0b2]">{s.label}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.locked}
                      {s.achieved < s.best && (
                        <span className="text-[#8aa0b2]"> · best {s.bestLabel}</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-[#8aa0b2]">
                      {s.achieved >= s.best ? "top pick" : `beat ${s.percentile}%`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
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

  const isPairComparison = Boolean(
    note.suggested.pairWith && note.chosen.pairWith,
  );
  const title =
    isPairComparison
      ? severity === "solid"
        ? "Good pair to lock"
        : severity === "minor"
          ? "Viable pair, below the top choice"
          : "Weak pair vs the top choice"
      : severity === "solid"
      ? "Solid call vs suggestion"
      : severity === "minor"
        ? "Judgment call vs suggestion"
        : severity === "major"
          ? "Major miss vs suggestion"
          : "Last lock vs suggestion";

  if (isPairComparison) {
    return (
      <PairDeviationCallout
        note={note}
        shell={shell}
        eyebrow={eyebrow}
        body={body}
        title={title}
      />
    );
  }

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
            title={`Why you should have ${verb} ${note.suggested.displayLabel ?? note.suggested.hero}`}
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
                ? `Why ${note.chosen.displayLabel ?? note.chosen.hero} scored`
                : `Why ${note.chosen.displayLabel ?? note.chosen.hero} scored instead`
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
                  <HoverExplain
                    help={labelHelp}
                    className="cursor-help underline decoration-dotted underline-offset-2"
                  >
                    {label}
                  </HoverExplain>
                </div>
                <div className="group relative border-t border-[#2a3a48]/80 py-1 text-right font-mono tabular-nums">
                  <HoverExplain
                    help={sugHelp}
                    className={`cursor-help underline decoration-dotted underline-offset-2 ${ptsClass(sugPts)}`}
                  >
                    {sugPts > 0 ? `+${sugPts}` : sugPts}
                  </HoverExplain>
                </div>
                <div className="border-t border-[#2a3a48]/80 py-1 leading-snug text-[#8aa0b2]">
                  {whyCell(sug)}
                </div>
                <div className="group relative border-t border-[#2a3a48]/80 py-1 text-right font-mono tabular-nums">
                  <HoverExplain
                    help={choseHelp}
                    className={`cursor-help underline decoration-dotted underline-offset-2 ${ptsClass(chosePts)}`}
                  >
                    {chosePts > 0 ? `+${chosePts}` : chosePts}
                  </HoverExplain>
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

type PairFactorRow = {
  id: string;
  label: string;
  suggestedFirst?: ScoreFactor;
  suggestedSecond?: ScoreFactor;
  chosenFirst?: ScoreFactor;
  chosenSecond?: ScoreFactor;
};

function pairFactorRows(note: DeviationReport): PairFactorRow[] {
  const rows = new Map<string, PairFactorRow>();
  const add = (
    id: string,
    label: string,
    column: keyof Omit<PairFactorRow, "id" | "label">,
    factor: ScoreFactor,
  ) => {
    const row = rows.get(id) ?? { id, label };
    row[column] = factor;
    rows.set(id, row);
  };
  const addCard = (
    card: ScoredOption,
    firstColumn: "suggestedFirst" | "chosenFirst",
    secondColumn: "suggestedSecond" | "chosenSecond",
  ) => {
    for (const factor of card.pairFactors ?? []) {
      const rowId = factor.id === "duo" ? "solo:synergy" : `pair:${factor.id}`;
      add(rowId, factor.label, firstColumn, {
        id: factor.id,
        label: factor.label,
        points: factor.firstPoints,
        detail: factor.firstDetail ?? factor.detail,
      });
      add(rowId, factor.label, secondColumn, {
        id: factor.id,
        label: factor.label,
        points: factor.secondPoints,
        detail: factor.secondDetail ?? factor.detail,
      });
    }
    for (const factor of card.firstSoloFactors ?? []) {
      if (factor.id === "synergy") continue;
      add(`solo:${factor.id}`, factor.label, firstColumn, factor);
    }
    for (const factor of card.secondSoloFactors ?? []) {
      if (factor.id === "synergy") continue;
      add(`solo:${factor.id}`, factor.label, secondColumn, factor);
    }
  };

  addCard(note.suggested, "suggestedFirst", "suggestedSecond");
  addCard(note.chosen, "chosenFirst", "chosenSecond");
  return [...rows.values()];
}

function PairDeviationCallout({
  note,
  shell,
  eyebrow,
  body,
  title,
}: {
  note: DeviationReport;
  shell: string;
  eyebrow: string;
  body: string;
  title: string;
}) {
  const rows = pairFactorRows(note);
  const columns = [
    {
      hero: note.suggested.hero,
      key: "suggestedFirst" as const,
    },
    {
      hero: note.suggested.pairWith ?? "Follow-up",
      key: "suggestedSecond" as const,
    },
    {
      hero: note.chosen.hero,
      key: "chosenFirst" as const,
    },
    {
      hero: note.chosen.pairWith ?? "Follow-up",
      key: "chosenSecond" as const,
    },
  ];
  const pointsClass = (points: number) =>
    points > 0
      ? "text-[#9dceb0]"
      : points < 0
        ? "text-amber-200/90"
        : "text-[#8aa0b2]";

  return (
    <div className={shell}>
      <p className={eyebrow}>{title}</p>
      <p className={body}>{note.summary}</p>
      <div className="mt-2 w-full overflow-x-auto">
        <div className="grid min-w-[58rem] grid-cols-[minmax(6.5rem,auto)_minmax(24rem,1fr)_minmax(24rem,1fr)] gap-x-2 text-xs">
          <div className="py-1 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Factor
          </div>
          <div className="rounded-t-md border border-b-0 border-teal-500/40 bg-teal-950/20 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-[#9dceb0]">
            Suggested duo: {note.suggested.hero} + {note.suggested.pairWith}
          </div>
          <div className="rounded-t-md border border-b-0 border-amber-500/40 bg-amber-950/20 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-amber-100/90">
            Locked duo: {note.chosen.hero} + {note.chosen.pairWith}
          </div>
          <div />
          <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,1fr)] border-x border-teal-500/40 bg-teal-950/20 py-1 text-[10px] font-bold uppercase tracking-wide text-[#9dceb0]">
            <div className="col-span-2 pr-1 text-right">{columns[0].hero}</div>
            <div className="col-span-2 pl-1">{columns[1].hero}</div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,1fr)] border-x border-amber-500/40 bg-amber-950/20 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-100/90">
            <div className="col-span-2 pr-1 text-right">{columns[2].hero}</div>
            <div className="col-span-2 pl-1">{columns[3].hero}</div>
          </div>
          {rows.map((row) => {
            const suggestedFirst = row.suggestedFirst;
            const suggestedSecond = row.suggestedSecond;
            const chosenFirst = row.chosenFirst;
            const chosenSecond = row.chosenSecond;
            const detail = (factor: ScoreFactor | undefined) =>
              factor ? (
                <span className="min-w-0 leading-snug text-[#8aa0b2]">
                  {factor.detail}
                </span>
              ) : (
                <span className="text-[#5a6b78]">-</span>
              );
            const score = (factor: ScoreFactor | undefined) =>
              factor ? (
                <span className={`text-center font-mono font-semibold tabular-nums ${pointsClass(factor.points)}`}>
                  {factor.points > 0 ? "+" : ""}{factor.points}
                </span>
              ) : (
                <span className="text-center text-[#5a6b78]">-</span>
              );
            return (
              <div key={row.id} className="contents">
                <div className="border-t border-[#2a3a48]/80 py-1 font-semibold text-[#e8eef2]">
                  {row.label}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,1fr)] border-x border-t border-teal-500/40 bg-teal-950/20 py-1">
                  {detail(suggestedFirst)}
                  {score(suggestedFirst)}
                  {score(suggestedSecond)}
                  {detail(suggestedSecond)}
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_2.75rem_minmax(0,1fr)] border-x border-t border-amber-500/40 bg-amber-950/20 py-1">
                  {detail(chosenFirst)}
                  {score(chosenFirst)}
                  {score(chosenSecond)}
                  {detail(chosenSecond)}
                </div>
              </div>
            );
          })}
          <div className="border-t border-[#3d5163] py-1 font-bold text-[#e8eef2]">Pair total</div>
          <div className="grid grid-cols-4 rounded-b-md border border-t-0 border-teal-500/40 bg-teal-950/20 py-1 text-center font-mono text-sm font-bold tabular-nums text-[#9dceb0]">
            <span className="col-span-4">{note.suggested.total > 0 ? "+" : ""}{note.suggested.total}</span>
          </div>
          <div className="grid grid-cols-4 rounded-b-md border border-t-0 border-amber-500/40 bg-amber-950/20 py-1 text-center font-mono text-sm font-bold tabular-nums text-amber-100/90">
            <span className="col-span-4">{note.chosen.total > 0 ? "+" : ""}{note.chosen.total}</span>
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

/** Pointer must rest this long before a hover card opens. Usual tooltip delay. */
const TOOLTIP_HOVER_MS = 400;

function useDelayedTooltip() {
  const timer = useRef<number | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const open = useRef(false);

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clearTimer, []);

  return {
    /** Begin the delay. Moves before it opens only change where it will land. */
    hover(x: number, y: number, show: (x: number, y: number) => void) {
      point.current = { x, y };
      if (open.current) {
        show(x, y);
        return;
      }
      if (timer.current != null) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        open.current = true;
        show(point.current.x, point.current.y);
      }, TOOLTIP_HOVER_MS);
    },
    focus(x: number, y: number, show: (x: number, y: number) => void) {
      clearTimer();
      open.current = true;
      show(x, y);
    },
    /** Pointer left before the card opened. */
    cancelPending() {
      clearTimer();
    },
    close() {
      clearTimer();
      open.current = false;
    },
  };
}

function HoverExplain({
  help,
  className,
  children,
}: {
  help: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 12, top: 12 });
  const tip = useDelayedTooltip();

  const place = (x: number, y: number) => {
    const width = 352;
    const estimatedHeight = 148;
    const pad = 12;
    const offsetX = 18;
    const offsetY = 60;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x + offsetX;
    let top = y + offsetY;
    left = Math.max(pad, Math.min(left, vw - width - pad));
    if (top + estimatedHeight > vh - pad) {
      top = Math.max(pad, y - estimatedHeight - 18);
    }
    setPos({ left, top });
  };

  const reveal = (x: number, y: number) => {
    place(x, y);
    setOpen(true);
  };

  const onMouse = (event: MouseEvent<HTMLSpanElement>) => {
    tip.hover(event.clientX, event.clientY, reveal);
  };

  const onFocus = (event: FocusEvent<HTMLSpanElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    tip.focus(rect.left + rect.width / 2, rect.bottom, reveal);
  };

  return (
    <>
      <span
        className={className}
        aria-label={help}
        onMouseEnter={onMouse}
        onMouseMove={onMouse}
        onMouseLeave={() => {
          tip.close();
          setOpen(false);
        }}
        onFocus={onFocus}
        onBlur={() => {
          tip.close();
          setOpen(false);
        }}
      >
        {children}
      </span>
      {open ? (
        <div
          className="pointer-events-none fixed z-50 w-[min(22rem,calc(100vw-2rem))] whitespace-pre-line rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 text-left text-xs leading-snug text-[#c5d4e0] shadow-xl"
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        >
          {help}
        </div>
      ) : null}
    </>
  );
}

function ScoredHeroOption({
  option,
  rank,
  badge,
  banned,
  canLock = true,
  onLock,
}: {
  option: ScoredOption;
  rank: number;
  badge: string;
  banned: boolean;
  canLock?: boolean;
  onLock: () => void;
}) {
  const primary = rank === 1;
  const pair = option.pairWith;
  const pairFactors = option.pairFactors ?? [];
  const [showScorecard, setShowScorecard] = useState(false);
  const [scorecardPos, setScorecardPos] = useState({ left: 12, top: 12 });
  const tip = useDelayedTooltip();

  const placeScorecard = (x: number, y: number) => {
    const pad = 12;
    const width = Math.min(pair ? 704 : 352, window.innerWidth - pad * 2);
    const left = Math.max(
      pad,
      Math.min(x - width / 2, window.innerWidth - width - pad),
    );
    setScorecardPos({ left, top: y + 16 });
  };

  const revealScorecard = (x: number, y: number) => {
    placeScorecard(x, y);
    setShowScorecard(true);
  };

  const openScorecard = (event: MouseEvent<HTMLButtonElement>) => {
    tip.hover(event.clientX, event.clientY, revealScorecard);
  };

  const focusScorecard = (event: FocusEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    tip.focus(rect.left + rect.width / 2, rect.bottom, revealScorecard);
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={canLock ? onLock : undefined}
        onMouseEnter={openScorecard}
        onMouseMove={openScorecard}
        onMouseLeave={() => {
          tip.close();
          setShowScorecard(false);
        }}
        onFocus={focusScorecard}
        onBlur={() => {
          tip.close();
          setShowScorecard(false);
        }}
        className={`flex w-[12.5rem] flex-col items-center gap-1 rounded-md p-1.5 ${
          canLock ? "transition hover:bg-[#1e3040]/80" : "cursor-default"
        } ${
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
      {showScorecard ? (
        <div
          className={`pointer-events-none fixed z-30 rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 shadow-xl ${
            pair ? "w-[min(44rem,calc(100vw-2rem))]" : "w-[min(22rem,calc(100vw-2rem))]"
          }`}
          style={{ left: `${scorecardPos.left}px`, top: `${scorecardPos.top}px` }}
        >
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Score breakdown · total {option.total}
            {pair ? ` · lock ${option.hero} first` : ""}
          </p>
          {pair ? (
            <>
              <ScoreFactorList factors={pairFactors} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="border border-teal-500/35 bg-teal-950/20 px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#9dceb0]">
                    {option.hero}
                  </p>
                  <ScoreFactorList factors={option.firstSoloFactors ?? []} />
                </div>
                <div className="border border-teal-500/35 bg-teal-950/20 px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#9dceb0]">
                    {pair}
                  </p>
                  <ScoreFactorList factors={option.secondSoloFactors ?? []} />
                </div>
              </div>
            </>
          ) : (
            <ScoreFactorList factors={option.factors} />
          )}
        </div>
      ) : null}
    </div>
  );
}

const MATCHUP_TRACK_STEPS: { id: MatchupTrackStage; title: string; detail: string }[] = [
  { id: "spotted", title: "Spotted", detail: "Duo has no sample" },
  { id: "pulling", title: "Pulling", detail: "Storm League" },
  { id: "cached", title: "Cached", detail: "Saved for drafts" },
  { id: "scored", title: "Scored", detail: "Board updated" },
];

function MatchupTracker({
  track,
  error,
  onDismiss,
}: {
  track: MatchupTrack;
  error: string | null;
  onDismiss: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (track.stage !== "pulling") return;
    const id = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [track.stage, track.heroes]);

  const failed = track.stage === "failed";
  const index = failed
    ? 1
    : MATCHUP_TRACK_STEPS.findIndex((step) => step.id === track.stage);
  const fill = track.stage === "scored" ? 100 : (Math.max(0, index) / 3) * 100;
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const status = failed
    ? error || "Storm League did not return these duos."
    : track.stage === "pulling"
      ? `Pulling ${track.heroes.join(", ")} · ${clock}`
      : track.stage === "cached"
        ? "Saved in the draft cache. Scoring the board."
        : track.stage === "scored"
          ? "These duos are in the score now."
          : "These locked duos had no Storm League sample.";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#070d12]/80 p-4">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-xl rounded-lg border border-[#3d5163] bg-[#101a24] px-5 py-5 shadow-2xl"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8aa0b2]">
          Matchup tracker
        </p>
        <div className="relative mt-6">
          <div className="absolute top-3 right-[12%] left-[12%] h-1 bg-[#2a3a48]">
            <div
              className={`h-full transition-all duration-500 ${failed ? "bg-red-500" : "bg-[#72d1b1]"}`}
              style={{ width: `${fill}%` }}
            />
          </div>
          <ol className="relative grid grid-cols-4">
            {MATCHUP_TRACK_STEPS.map((step, i) => {
              const done = !failed && (i < index || track.stage === "scored");
              const current = i === index && track.stage !== "scored";
              return (
                <li key={step.id} className="flex flex-col items-center px-1">
                  <span
                    className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold ${
                      failed && current
                        ? "border-red-400 bg-red-950 text-red-100"
                        : done
                          ? "border-[#72d1b1] bg-[#135246] text-[#d8fff1]"
                          : current
                            ? "border-[#72d1b1] bg-[#101a24] text-[#d8fff1] ring-4 ring-[#72d1b1]/30"
                            : "border-[#3d5163] bg-[#101a24] text-[#8aa0b2]"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <p
                    className={`mt-2 text-center text-xs font-bold ${
                      current || done ? "text-[#e8eef2]" : "text-[#8aa0b2]"
                    }`}
                  >
                    {step.title}
                  </p>
                  <p className="text-center text-[10px] leading-tight text-[#8aa0b2]">
                    {step.detail}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-5 text-sm font-semibold text-[#e8eef2]">{status}</p>
        <p className="mt-1 text-sm text-[#c5d4e0]">{track.heroes.join(" · ")}</p>
        {failed ? (
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 rounded-md border border-red-400/70 px-3 py-1.5 text-sm font-semibold text-red-100"
          >
            Keep drafting
          </button>
        ) : null}
      </div>
    </div>
  );
}

function missingDuoEntriesForOption(
  option: ScoredOption,
): { label: string; reason: string }[] {
  const texts: string[] = [];
  const take = (factors?: { detail: string; lines?: string[] }[]) => {
    for (const factor of factors ?? []) {
      texts.push(factor.detail);
      if (factor.lines) texts.push(...factor.lines);
    }
  };
  take(option.factors);
  take(option.firstSoloFactors);
  take(option.secondSoloFactors);
  take(option.pairFactors);
  const out: { label: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const label = missingDuoLabel(text);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      reason: missingDuoReason(text) ?? "scored as 0",
    });
  }
  return out;
}

function MissingDuoBanner({
  options,
  pending,
  error,
}: {
  options: ScoredOption[];
  pending: string[];
  error: string | null;
}) {
  const seen = new Set<string>();
  const entries: { label: string; reason: string }[] = [];
  for (const opt of options) {
    for (const entry of missingDuoEntriesForOption(opt)) {
      if (seen.has(entry.label)) continue;
      seen.add(entry.label);
      entries.push(entry);
    }
  }
  const stillFetching = entries.filter((e) => /fetching/i.test(e.reason));
  const settled = entries.filter((e) => !/fetching/i.test(e.reason));
  if (!entries.length && !error && !pending.length) return null;
  return (
    <div
      role="alert"
      className="basis-full rounded-md border-2 border-red-500 bg-red-950 px-3 py-3 text-red-50"
    >
      <p className="text-sm font-bold uppercase tracking-wide text-red-300">
        Matchup data gap
      </p>
      {pending.length > 0 ? (
        <p className="mt-1 text-base font-semibold leading-snug">
          Fetching Storm League: {pending.join(", ")}…
        </p>
      ) : null}
      {stillFetching.length > 0 && pending.length === 0 ? (
        <p className="mt-1 text-base font-semibold leading-snug">
          {stillFetching.map((e) => `${e.label} (${e.reason})`).join(" · ")}
        </p>
      ) : null}
      {settled.length > 0 ? (
        <ul className="mt-1 space-y-1 text-base font-semibold leading-snug">
          {settled.map((e) => (
            <li key={e.label}>
              {e.label}: {e.reason} → scored as 0
            </li>
          ))}
        </ul>
      ) : null}
      {error && pending.length === 0 ? (
        <p className="mt-1 text-sm font-semibold text-red-200">{error}</p>
      ) : null}
    </div>
  );
}

function ScoreFactorList({ factors }: { factors: ScoreFactor[] }) {
  return (
    <ul className="space-y-1">
      {factors.map((factor) => {
        const lines = factor.lines ?? [];
        const missing = lines.filter((line) => missingDuoLabel(line));
        const present = lines.filter((line) => !missingDuoLabel(line));
        const detailMissing = missingDuoLabel(factor.detail) !== null;
        return (
          <li key={factor.id} className="text-xs leading-snug text-[#c5d4e0]">
            <span className="flex justify-between gap-2 font-semibold text-[#e8eef2]">
              <span>{factor.label}</span>
              <span
                className={
                  factor.points > 0
                    ? "text-[#9dceb0]"
                    : factor.points < 0
                      ? "text-amber-200/90"
                      : "text-[#8aa0b2]"
                }
              >
                {factor.points > 0 ? `+${factor.points}` : factor.points}
              </span>
            </span>
            {detailMissing ? (
              <span className="mt-1 block rounded border-2 border-red-500 bg-red-950 px-1.5 py-1 text-[11px] font-bold text-red-100">
                {factor.detail}
              </span>
            ) : (
              <span className="block text-[#8aa0b2]">{factor.detail}</span>
            )}
            {present.length ? (
              <ul className="mt-0.5 space-y-px pl-2 font-mono text-[10.5px] text-[#8aa0b2]">
                {present.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {missing.length ? (
              <div className="mt-1 rounded border-2 border-red-500 bg-red-950 px-2 py-1.5 text-[11px] font-bold leading-snug text-red-50">
                <p className="uppercase tracking-wide text-red-300">
                  No matchup data — scored as 0
                </p>
                <ul className="mt-0.5">
                  {missing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Finished board: comfort is whoever plays the hero now, not who it was drafted for. */
function breakdownForCurrentSeat(
  action: BoardAction,
  roster: PlayerScout[],
): BoardBreakdown | undefined {
  const breakdown = action.breakdown;
  if (!breakdown || action.kind !== "pick" || !roster.length) return breakdown;
  const who = displayPlayer(action.player);
  if (!who) return breakdown;
  const comfort = playerComfortOn(roster, action.hero, who);
  const points = Math.round(comfortPickPoints(comfort));
  const factors = breakdown.factors.map((factor) =>
    factor.id !== "comfort"
      ? factor
      : {
          ...factor,
          points,
          detail: `${who} · seat comfort ${(comfort * 100).toFixed(0)}`,
          formula: `min(${COMFORT_PICK_CAP}, ${comfort.toFixed(2)} × ${COMFORT_PICK_MULTIPLIER}) = ${comfortPickPoints(comfort).toFixed(2)} → rounded to ${points}`,
        },
  );
  if (!factors.some((factor) => factor.id === "comfort")) return breakdown;
  return {
    total: factors.reduce((sum, factor) => sum + factor.points, 0),
    factors,
  };
}

function DraftSideRow({
  label,
  bans,
  picks,
  heldIndex = -1,
  accent,
  roster = [],
}: {
  label: string;
  bans: (BoardAction | null)[];
  picks: (BoardAction | null)[];
  /** Slot showing the first hero of a double pick that is not locked yet. */
  heldIndex?: number;
  accent: "ally" | "enemy";
  /** This side's five — marks seats whose owner has no games on the hero. */
  roster?: PlayerScout[];
}) {
  const banRing = accent === "enemy" ? "ring-red-700/80" : "ring-teal-700/80";
  const blind = (p: BoardAction | null) =>
    Boolean(
      p &&
        p.kind === "pick" &&
        p.player &&
        roster.length &&
        playerComfortOn(roster, p.hero, displayPlayer(p.player)) <= 0,
    );
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
              action={
                p
                  ? { ...p, breakdown: breakdownForCurrentSeat(p, roster) }
                  : p
              }
              ring={
                accent === "enemy" ? "ring-red-500/50" : "ring-teal-500/50"
              }
              placeholder="Pick"
              held={i === heldIndex}
              blind={blind(p)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function placeScorecardNear(x: number, y: number) {
  const pad = 12;
  const width = Math.min(352, window.innerWidth - pad * 2);
  const left = Math.max(
    pad,
    Math.min(x - width / 2, window.innerWidth - width - pad),
  );
  const estimated = Math.min(520, window.innerHeight - pad * 2);
  let top = y + 18;
  if (top + estimated > window.innerHeight - pad) {
    top = Math.max(pad, y - estimated - 14);
  }
  return { left, top };
}

function EmptyOrFace({
  action,
  banned,
  ring,
  placeholder,
  held,
  blind,
}: {
  action: BoardAction | null;
  banned?: boolean;
  ring: string;
  placeholder: string;
  held?: boolean;
  /** Seated, but the owner has no games on this hero. */
  blind?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 12, top: 12 });
  const closeTimer = useRef<number | null>(null);
  const tip = useDelayedTooltip();
  const breakdown = action?.breakdown;

  const cancelClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    cancelClose();
    tip.cancelPending();
    closeTimer.current = window.setTimeout(() => {
      tip.close();
      setOpen(false);
    }, 120);
  };
  const showAt = (x: number, y: number) => {
    if (!breakdown?.factors.length) return;
    cancelClose();
    tip.hover(x, y, (px, py) => {
      setPos(placeScorecardNear(px, py));
      setOpen(true);
    });
  };
  const showNow = (x: number, y: number) => {
    if (!breakdown?.factors.length) return;
    cancelClose();
    tip.focus(x, y, (px, py) => {
      setPos(placeScorecardNear(px, py));
      setOpen(true);
    });
  };

  if (!action || action.hero === UNSEEN_BAN) {
    return (
      <div
        className={`flex h-20 w-14 items-center justify-center rounded-sm border border-dashed border-[#3d5163] bg-[#162230] text-[10px] uppercase tracking-wide text-[#5a6b78] ring-1 ${ring}`}
        title={action ? "Ban already locked before it was on screen" : undefined}
      >
        {action ? "—" : placeholder}
      </div>
    );
  }
  const who =
    !banned && action.kind === "pick"
      ? displayPlayer(action.player)
      : null;
  const draftedFor =
    !banned && action.kind === "pick"
      ? displayPlayer(action.draftedFor ?? null)
      : null;
  const moved = Boolean(draftedFor && who && draftedFor !== who);
  const nativeTitle = breakdown
    ? undefined
    : `${action.kind} · ${action.hero}${who ? ` (${who})` : ""}${
        moved ? `, drafted for ${draftedFor}` : ""
      }${action.reason ? ` — ${action.reason}` : ""}`;
  return (
    <div
      className={`flex flex-col items-center rounded-sm ${
        held ? "animate-pulse ring-2 ring-amber-300/80" : `ring-2 ${ring}`
      }`}
      onMouseEnter={(event) => showAt(event.clientX, event.clientY)}
      onMouseLeave={scheduleClose}
      onFocus={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        showNow(rect.left + rect.width / 2, rect.bottom);
      }}
      onBlur={scheduleClose}
      tabIndex={breakdown ? 0 : undefined}
      aria-label={
        breakdown
          ? `${action.hero} score breakdown, total ${breakdown.total}`
          : undefined
      }
    >
      <HeroFace
        hero={action.hero}
        kind="draft"
        size="md"
        banned={banned}
        label={action.hero}
        title={nativeTitle}
      />
      {open && breakdown ? (
        <div
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="pointer-events-auto fixed z-50 max-h-[min(32.5rem,calc(100vh-1.5rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-[#3d5163] bg-[#0f1821] px-3 py-2 shadow-xl"
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        >
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8aa0b2]">
            Score breakdown · total {breakdown.total}
          </p>
          <ScoreFactorList factors={breakdown.factors} />
        </div>
      ) : null}
      {held && (
        <span className="mt-0.5 text-center text-[10px] font-semibold uppercase leading-tight text-amber-200">
          Selected
        </span>
      )}
      {who ? (
        <span
          className={`mt-0.5 max-w-[3.75rem] truncate text-center text-[10px] font-semibold leading-tight ${
            blind ? "text-amber-300" : "text-[#9dceb0]"
          }`}
          title={
            moved
              ? `Drafted for ${draftedFor}. Now ${who}${
                  blind ? " (no games on it)" : ""
                } — seats moved because the five's comfort total is higher.`
              : blind
                ? `${who} has no games on ${action.hero} — blind pick`
                : undefined
          }
        >
          {blind ? `${who} · blind` : who}
          {moved ? (
            <span className="block truncate text-[9px] font-medium text-[#8aa0b2]">
              was {draftedFor}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
