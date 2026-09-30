import {
  COMFORT_GRADE_CAP,
  COMFORT_GRADE_MULTIPLIER,
} from "@/lib/scoring/comfort";
import {
  allyDuos,
  enemyDuos,
  heroDraftMeta,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import { heroKey } from "@/lib/scoring/heroMeta";
import { checkRequiredRoles } from "@/lib/scoring/roles";
import type { PlayerScout } from "@/lib/scoring/types";

export type LetterGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

/** One draft step (ban, pick, or double pick) as scored when it was locked. */
export type DraftStepScore = {
  side: "our" | "their";
  kind: "ban" | "pick";
  /** e.g. "Ban 2", "Pick 1", "Picks 2 + 3". */
  label: string;
  /** Hero(es) actually locked, e.g. "Azmodan + D.Va". */
  locked: string;
  /** Top-scored option at that step. */
  bestLabel: string;
  best: number;
  achieved: number;
  /** Share of comparable options this lock beat (0–100). */
  percentile?: number;
  /** How many options it was ranked against, itself included. */
  fieldSize?: number;
};

export type SideDraftGrade = {
  label: string;
  grade: LetterGrade;
  /** Σ achieved over every ban and pick this side made. */
  points: number;
  /** Σ best available at each of those steps. */
  bestPoints: number;
  /** points / bestPoints as a percent. */
  pct: number;
  /** Average step percentile — drives the letter grade. */
  percentile: number;
  /** Strength of the locked five (0–100) — drives the draft win %. */
  quality: number;
  notes: string[];
  steps: GradedStep[];
};

export type GradedStep = DraftStepScore & {
  pct: number;
  percentile: number;
  grade: LetterGrade;
};

export type DraftReportCard = {
  ours: SideDraftGrade;
  theirs: SideDraftGrade;
  /** P(we win) from the two drafts alone (0–100). */
  draftWinPct: number;
  /** P(we win) from the drafts plus team MMR gap, when both MMRs are known. */
  mmrWinPct: number | null;
  mmrGap: number | null;
  headline: string;
  reasons: string[];
};

type LockedSeat = {
  hero: string;
  player: string | null;
};

/** Quality points lost per required role the locked five can't cover. */
const MISSING_ROLE_QUALITY = 12;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function comfortOf(
  roster: PlayerScout[],
  player: string | null,
  hero: string,
): number {
  if (!roster.length) return 0;
  const want = player?.split("#")[0]?.trim().toLowerCase() ?? null;
  let best = 0;
  for (const p of roster) {
    const name = p.battletag.split("#")[0]?.trim().toLowerCase() ?? "";
    if (want && name !== want && p.battletag.toLowerCase() !== player?.toLowerCase()) {
      continue;
    }
    const hit = p.topHeroes.find((h) => heroKey(h.hero) === heroKey(hero));
    if (!hit) {
      if (want) return 0;
      continue;
    }
    if (want) return hit.comfort;
    best = Math.max(best, hit.comfort);
  }
  return best;
}

function comfortScore(
  seats: LockedSeat[],
  roster: PlayerScout[],
): { points: number; avg: number } {
  if (!seats.length) return { points: 0, avg: 0 };
  let sum = 0;
  for (const s of seats) {
    sum += comfortOf(roster, s.player, s.hero);
  }
  const avg = sum / seats.length;
  // Comfort ~0.05–0.25 typical; map into 0–50.
  return {
    points: clamp(avg * COMFORT_GRADE_MULTIPLIER, 0, COMFORT_GRADE_CAP),
    avg,
  };
}

function synergyScore(
  heroes: string[],
  table: DraftMetaTable | null | undefined,
): { points: number; best: string | null } {
  if (heroes.length < 2 || !table) return { points: 10, best: null }; // neutral if no data
  // All 10 duos of the five, each once.
  let total = 0;
  let best: { label: string; edge: number } | null = null;
  for (let i = 0; i < heroes.length; i++) {
    for (const d of allyDuos(table, heroes[i], heroes.slice(i + 1))) {
      total += d.edgePp;
      if (!best || d.edgePp > best.edge) {
        best = { label: `${heroes[i]} + ${d.hero} (${d.winRate}%)`, edge: d.edgePp };
      }
    }
  }
  return {
    points: clamp(10 + total * 0.4, 0, 20),
    best: best && best.edge > 0 ? best.label : null,
  };
}

/** How this five fares into the enemy five via SL matchup edges. */
function matchupScore(
  ours: string[],
  theirs: string[],
  table: DraftMetaTable | null | undefined,
): { points: number; edgePp: number; detail: string | null } {
  if (!ours.length || !theirs.length || !table) {
    return { points: 12.5, edgePp: 0, detail: null };
  }
  // All 25 cross-team duos.
  let edge = 0;
  let best: string | null = null;
  let bestAbs = 0;
  for (const hero of ours) {
    for (const d of enemyDuos(table, hero, theirs)) {
      edge += d.edgePp;
      if (Math.abs(d.edgePp) > bestAbs) {
        bestAbs = Math.abs(d.edgePp);
        best = `${hero} ${d.winRate}% into ${d.hero}`;
      }
    }
  }
  return {
    points: clamp(12.5 + edge * 0.3, 0, 25),
    edgePp: Math.round(edge * 10) / 10,
    detail: best,
  };
}

/** Strength of a locked five: comfort + synergy + matchup + map, minus missing roles. */
export function scoreFive(args: {
  seats: LockedSeat[];
  enemyHeroes: string[];
  roster: PlayerScout[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
}) {
  const heroes = args.seats.map((s) => s.hero);
  const roles = checkRequiredRoles(heroes);
  const comfort = comfortScore(args.seats, args.roster);
  const synergy = synergyScore(heroes, args.table);
  const matchup = matchupScore(heroes, args.enemyHeroes, args.table);

  let mapPts = 0;
  if (args.map && args.table) {
    for (const h of heroes) {
      const hit = heroDraftMeta(args.table, h).mapStrong.find(
        (m) => m.map.toLowerCase() === args.map!.toLowerCase(),
      );
      if (hit && hit.deltaPp > 0) mapPts += Math.min(2, hit.deltaPp / 3);
    }
  }
  mapPts = clamp(mapPts, 0, 5);

  // comfort 25 + synergy 20 + matchup 25 + map 5 = 75.
  const raw = comfort.points + synergy.points + matchup.points + mapPts;
  const quality = clamp(
    Math.round((raw / 75) * 100) - MISSING_ROLE_QUALITY * roles.missing.length,
    0,
    100,
  );
  return { quality, missingRoles: roles.missing, comfort, synergy, matchup, mapPts };
}

/**
 * Standard scale on the share of comparable options a lock beat: top 10% is
 * an A, the next 10% a B, and anything that didn't beat 60% of options is an F.
 */
export function percentileToGrade(percentile: number): LetterGrade {
  if (percentile >= 97) return "A+";
  if (percentile >= 93) return "A";
  if (percentile >= 90) return "A-";
  if (percentile >= 87) return "B+";
  if (percentile >= 83) return "B";
  if (percentile >= 80) return "B-";
  if (percentile >= 77) return "C+";
  if (percentile >= 73) return "C";
  if (percentile >= 70) return "C-";
  if (percentile >= 60) return "D";
  return "F";
}

/** Steps scored before percentiles existed fall back to achieved / best. */
export function stepPercentile(s: DraftStepScore): number {
  return s.percentile ?? stepPct(s);
}

/**
 * Σ achieved / Σ best over a side's steps. A step's best is never below what
 * was achieved (the locked option was scored too) and never below 0, so an
 * all-bad board can't inflate the ratio; a negative lock still drags it down.
 */
export function sumStepPoints(steps: readonly DraftStepScore[]): {
  points: number;
  bestPoints: number;
  pct: number;
} {
  let points = 0;
  let bestPoints = 0;
  for (const s of steps) {
    points += s.achieved;
    bestPoints += Math.max(0, s.best, s.achieved);
  }
  const pct = bestPoints > 0 ? clamp(Math.round((points / bestPoints) * 100), 0, 100) : 100;
  return { points: Math.round(points), bestPoints: Math.round(bestPoints), pct };
}

/** One step's achieved / best. When every option scored ≤ 0, taking the best is 100%. */
export function stepPct(s: Pick<DraftStepScore, "best" | "achieved">): number {
  const best = Math.max(0, s.best, s.achieved);
  if (best <= 0) return s.achieved >= s.best ? 100 : 0;
  return clamp(Math.round((s.achieved / best) * 100), 0, 100);
}

/** Lowest-ranked step (ties: bigger point gap), if it fell short of a C. */
function biggestMiss(steps: readonly DraftStepScore[]): DraftStepScore | null {
  let worst: DraftStepScore | null = null;
  let worstKey: [number, number] | null = null;
  for (const s of steps) {
    const gap = Math.max(0, s.best, s.achieved) - s.achieved;
    if (gap < 3) continue;
    const key: [number, number] = [stepPercentile(s), -gap];
    if (!worstKey || key[0] < worstKey[0] || (key[0] === worstKey[0] && key[1] < worstKey[1])) {
      worstKey = key;
      worst = s;
    }
  }
  return worstKey && worstKey[0] < 70 ? worst : null;
}

function fmt(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

function gradeSide(args: {
  label: string;
  steps: DraftStepScore[];
  scored: ReturnType<typeof scoreFive>;
}): SideDraftGrade {
  const { points, bestPoints, pct } = sumStepPoints(args.steps);
  const notes: string[] = [];
  const miss = biggestMiss(args.steps);
  if (miss) {
    const verb = miss.kind === "ban" ? "banned" : "picked";
    notes.push(
      `Biggest miss: ${verb} ${miss.locked} (${fmt(miss.achieved)}) over ${miss.bestLabel} (${fmt(Math.max(miss.best, miss.achieved))}).`,
    );
  } else if (args.steps.length) {
    notes.push("Every step ranked C or better against the options open.");
  }
  if (args.scored.missingRoles.length) {
    notes.push(`Missing: ${args.scored.missingRoles.join(", ")}.`);
  }
  if (args.scored.synergy.best) {
    notes.push(`Best pair: ${args.scored.synergy.best}.`);
  }
  const steps = args.steps.map((s) => {
    const percentile = stepPercentile(s);
    return { ...s, pct: stepPct(s), percentile, grade: percentileToGrade(percentile) };
  });
  const percentile = steps.length
    ? Math.round(steps.reduce((sum, s) => sum + s.percentile, 0) / steps.length)
    : 100;
  return {
    label: args.label,
    grade: percentileToGrade(percentile),
    points,
    bestPoints,
    pct,
    percentile,
    quality: args.scored.quality,
    notes: notes.slice(0, 3),
    steps,
  };
}

function draftWinPct(ourQ: number, theirQ: number): number {
  // Soft sigmoid on the quality gap: 28 quality ≈ 69%.
  const x = (ourQ - theirQ) / 28;
  const sigmoid = x / (1 + Math.abs(x));
  return Math.round(clamp(50 + sigmoid * 38, 12, 88));
}

/**
 * Log-odds per point of NGS team-average HP MMR gap, fit on 406 reported
 * Season 22 games (scripts/calibrate-mmr.mjs): 75 MMR ≈ 73% on its own.
 */
export const MMR_LOGIT_PER_POINT = 0.0133;

/** Folds a team MMR gap into the draft odds in log-odds space. */
export function mmrAdjustedWinPct(
  draftPct: number,
  ourMmr: number,
  theirMmr: number,
): number {
  const p = clamp(draftPct, 1, 99) / 100;
  const logit = Math.log(p / (1 - p)) + (ourMmr - theirMmr) * MMR_LOGIT_PER_POINT;
  return Math.round(clamp(100 / (1 + Math.exp(-logit)), 1, 99));
}

/** "Tricky Gooses favoured, 59%" — always phrased from the favoured side. */
export function favouredLabel(
  ourWinPct: number,
  ourLabel: string,
  theirLabel: string,
): string {
  if (ourWinPct === 50) return "Even, 50%";
  return ourWinPct > 50
    ? `${ourLabel} favoured, ${ourWinPct}%`
    : `${theirLabel} favoured, ${100 - ourWinPct}%`;
}

/**
 * End-of-draft report card. Each side is graded on the points it took out of
 * the best available at every ban and pick; win chance compares the two
 * locked fives, optionally adjusted by the team MMR gap.
 */
export function gradeFinishedDraft(args: {
  ourLocked: LockedSeat[];
  theirLocked: LockedSeat[];
  steps: DraftStepScore[];
  homeRoster: PlayerScout[];
  theirRoster: PlayerScout[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
  ourLabel?: string;
  theirLabel?: string;
  ourMmr?: number | null;
  theirMmr?: number | null;
}): DraftReportCard {
  const ourLabel = args.ourLabel ?? "Us";
  const theirLabel = args.theirLabel ?? "Them";
  const ourHeroes = args.ourLocked.map((s) => s.hero);
  const theirHeroes = args.theirLocked.map((s) => s.hero);

  const ourFive = scoreFive({
    seats: args.ourLocked,
    enemyHeroes: theirHeroes,
    roster: args.homeRoster,
    table: args.table,
    map: args.map,
  });
  const theirFive = scoreFive({
    seats: args.theirLocked,
    enemyHeroes: ourHeroes,
    roster: args.theirRoster,
    table: args.table,
    map: args.map,
  });

  const ours = gradeSide({
    label: ourLabel,
    steps: args.steps.filter((s) => s.side === "our"),
    scored: ourFive,
  });
  const theirs = gradeSide({
    label: theirLabel,
    steps: args.steps.filter((s) => s.side === "their"),
    scored: theirFive,
  });

  const winPct = draftWinPct(ourFive.quality, theirFive.quality);
  const haveMmr =
    typeof args.ourMmr === "number" && typeof args.theirMmr === "number";
  const mmrGap = haveMmr ? Math.round(args.ourMmr! - args.theirMmr!) : null;
  const mmrWinPct = haveMmr
    ? mmrAdjustedWinPct(winPct, args.ourMmr!, args.theirMmr!)
    : null;

  const reasons: string[] = [
    `Final fives: ${ourLabel} ${ourFive.quality} vs ${theirLabel} ${theirFive.quality} (comfort, synergy, matchups, map, roles).`,
  ];
  const matchup = ourFive.matchup;
  if (matchup.detail) {
    reasons.push(
      `Net matchup edge across all 25 duos ${fmt(matchup.edgePp)}pp for ${ourLabel} — biggest: ${matchup.detail}.`,
    );
  }
  if (mmrGap !== null) {
    const higher = mmrGap >= 0 ? ourLabel : theirLabel;
    reasons.push(
      mmrGap === 0
        ? "Team MMR is even."
        : `${higher} average ${Math.abs(mmrGap)} MMR higher (NGS team average).`,
    );
  }

  return {
    ours,
    theirs,
    draftWinPct: winPct,
    mmrWinPct,
    mmrGap,
    headline: `Draft decisions: ${ours.label} ${ours.grade}, ${theirs.label} ${theirs.grade}. Final five strength: ${ourLabel} ${ourFive.quality} vs ${theirLabel} ${theirFive.quality} — ${favouredLabel(winPct, ourLabel, theirLabel)}.`,
    reasons,
  };
}
