import {
  COMFORT_GRADE_CAP,
  COMFORT_GRADE_MULTIPLIER,
  heroUnplayedBy,
  playerHasHistory,
  playerHeroGames,
  resolvePlayerScout,
  rosterAnyoneHasGamesOn,
} from "@/lib/scoring/comfort";
import {
  allyDuos,
  enemyDuos,
  heroDraftMeta,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import { HERO_META, heroKey } from "@/lib/scoring/heroMeta";
import { checkRequiredRoles, heroFillsRole, REQUIRED_ROLES } from "@/lib/scoring/roles";
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
  /**
   * Locked five as a percent of the best five still available against the
   * enemy comp. Drives the letter.
   */
  percentile: number;
  /** Strength of the locked five (0–100) — drives the draft win %. */
  quality: number;
  /** Strength of the best five still available against the enemy comp. */
  bestQuality: number;
  /** Heroes in that best five, in seat order. */
  bestHeroes: string[];
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

/** A ban is a quarter of a pick in the decision grade. */
export const BAN_STEP_WEIGHT = 0.25;

export function stepGradeWeight(kind: "ban" | "pick"): number {
  return kind === "ban" ? BAN_STEP_WEIGHT : 1;
}

/** Quality points lost per required role the locked five can't cover. */
const MISSING_ROLE_QUALITY = 12;
/** Quality points lost per locked hero nobody on the five has on record. */
export const UNPLAYED_SEAT_QUALITY = 18;
const SYNERGY_MAX = 20;
const MATCHUP_MAX = 25;
const MAP_MAX = 5;
/** Every component at its cap. */
const QUALITY_RAW_MAX = COMFORT_GRADE_CAP + SYNERGY_MAX + MATCHUP_MAX + MAP_MAX;

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

/**
 * Comfort for seats we can actually score.
 * A named player with no history is omitted: missing data is not comfort 0.
 * A named player with a pool and no games on the hero scores 0 — he does not play it.
 */
function comfortScore(
  seats: LockedSeat[],
  roster: PlayerScout[],
): { points: number; avg: number; scored: boolean } {
  if (!seats.length) return { points: 0, avg: 0, scored: false };
  if (!roster.length) return { points: 0, avg: 0, scored: true };
  const known: number[] = [];
  for (const s of seats) {
    if (s.player) {
      const scout = resolvePlayerScout(roster, s.player);
      if (scout && !playerHasHistory(scout)) continue;
    }
    known.push(comfortOf(roster, s.player, s.hero));
  }
  if (!known.length) return { points: 0, avg: 0, scored: false };
  const avg = known.reduce((sum, n) => sum + n, 0) / known.length;
  return {
    points: clamp(avg * COMFORT_GRADE_MULTIPLIER, 0, COMFORT_GRADE_CAP),
    avg,
    scored: true,
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
    points: clamp(10 + total * 0.4, 0, SYNERGY_MAX),
    // A 50.4% duo is a coin flip, not a reason to call it the best pair.
    best: best && best.edge >= 3 ? best.label : null,
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
    points: clamp(12.5 + edge * 0.3, 0, MATCHUP_MAX),
    edgePp: Math.round(edge * 10) / 10,
    detail: best,
  };
}

/** Locked heroes the roster's recorded pools cannot field. */
export function unplayedSeats(
  seats: LockedSeat[],
  roster: PlayerScout[],
): string[] {
  return seats
    .filter((s) => heroUnplayedBy(roster, s.hero))
    .map((s) => (s.player ? `${s.hero} (${s.player}, unplayed)` : s.hero));
}

/** Seat label when the named player has no games on the hero but teammates might. */
export function lowComfortSeatLabel(
  seats: LockedSeat[],
  roster: PlayerScout[],
): string[] {
  if (!roster.length) return [];
  return seats
    .filter((s) => {
      if (!s.player) return false;
      if (!rosterAnyoneHasGamesOn(roster, s.hero)) return false;
      const games = playerHeroGames(roster, s.hero, s.player);
      return games > 0 && comfortOf(roster, s.player, s.hero) < 0.15;
    })
    .map(
      (s) =>
        `${s.hero} (${s.player}, ${playerHeroGames(roster, s.hero, s.player)}g SL)`,
    );
}

/**
 * Strength of a locked five: comfort + synergy + matchup + map, minus missing
 * roles and heroes the five cannot field.
 */
export function scoreFive(args: {
  seats: LockedSeat[];
  enemyHeroes: string[];
  roster: PlayerScout[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
  /** Roster-wide "nobody plays this" only matters when seats can be swapped. */
  tournamentMode?: boolean;
  /** Comfort stays out of the quality number. */
  ignoreComfort?: boolean;
}) {
  const heroes = args.seats.map((s) => s.hero);
  const roles = checkRequiredRoles(heroes);
  const comfort = args.ignoreComfort
    ? { points: 0, avg: 0, scored: false }
    : comfortScore(args.seats, args.roster);
  const synergy = synergyScore(heroes, args.table);
  const matchup = matchupScore(heroes, args.enemyHeroes, args.table);
  const unplayed = args.tournamentMode
    ? unplayedSeats(args.seats, args.roster)
    : [];

  let mapPts = 0;
  if (args.map && args.table) {
    for (const h of heroes) {
      const hit = heroDraftMeta(args.table, h).mapStrong.find(
        (m) => m.map.toLowerCase() === args.map!.toLowerCase(),
      );
      if (hit && hit.deltaPp > 0) mapPts += Math.min(2, hit.deltaPp / 3);
    }
  }
  mapPts = clamp(mapPts, 0, MAP_MAX);

  const raw = comfort.points + synergy.points + matchup.points + mapPts;
  const rawMax = comfort.scored
    ? QUALITY_RAW_MAX
    : QUALITY_RAW_MAX - COMFORT_GRADE_CAP;
  const quality = clamp(
    Math.round((raw / rawMax) * 100) -
      MISSING_ROLE_QUALITY * roles.missing.length -
      UNPLAYED_SEAT_QUALITY * unplayed.length,
    0,
    100,
  );
  return {
    quality,
    missingRoles: roles.missing,
    unplayed,
    comfort,
    synergy,
    matchup,
    mapPts,
  };
}

/** Locked quality as a percent of a strictly better five. A tie is 100. */
export function fiveVersusBest(locked: number, best: number): number {
  if (best <= locked) return 100;
  if (best <= 0) return 0;
  return clamp(Math.floor((locked / best) * 100), 0, 99);
}

function sameHeroSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map((hero) => heroKey(hero)));
  return b.every((hero) => keys.has(heroKey(hero)));
}

function bannedFromSteps(steps: readonly DraftStepScore[]): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (step.kind !== "ban") continue;
    for (const part of step.locked.split("+")) {
      const hero = part.trim();
      if (hero) out.push(hero);
    }
  }
  return out;
}

/** Heroes in the catalog, one spelling each, excluding bans and the enemy five. */
function availableHeroes(banned: readonly string[], enemy: readonly string[]): string[] {
  const gone = new Set([...banned, ...enemy].map((hero) => heroKey(hero)));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of Object.keys(HERO_META)) {
    const key = heroKey(name);
    if (gone.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function soloIntoEnemy(
  hero: string,
  enemy: readonly string[],
  roster: PlayerScout[],
  table: DraftMetaTable | null | undefined,
  map: string | null,
  tournamentMode: boolean,
  ignoreComfort: boolean,
): number {
  const comfort =
    ignoreComfort || !roster.length
      ? 0
      : comfortOf(roster, null, hero) * COMFORT_GRADE_MULTIPLIER;
  let mapPts = 0;
  if (map && table) {
    const hit = heroDraftMeta(table, hero).mapStrong.find(
      (row) => row.map.toLowerCase() === map.toLowerCase(),
    );
    if (hit && hit.deltaPp > 0) mapPts = Math.min(2, hit.deltaPp / 3);
  }
  let edge = 0;
  if (table && enemy.length) {
    for (const duo of enemyDuos(table, hero, enemy)) edge += duo.edgePp;
  }
  const unplayed =
    tournamentMode && heroUnplayedBy(roster, hero) ? UNPLAYED_SEAT_QUALITY : 0;
  return comfort + mapPts + edge * 0.3 - unplayed;
}

function shortlistAgainst(
  pool: readonly string[],
  locked: readonly string[],
  pinned: readonly string[],
  rank: (hero: string) => number,
): string[] {
  const perRole = 3;
  const cap = 14;
  const chosen = new Map<string, string>();
  const take = (heroes: readonly string[]) => {
    const sorted = [...heroes].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
    for (const hero of sorted.slice(0, perRole)) chosen.set(heroKey(hero), hero);
  };
  for (const role of REQUIRED_ROLES) {
    take(pool.filter((hero) => heroFillsRole(hero, role)));
  }
  take(
    pool.filter((hero) => !REQUIRED_ROLES.some((role) => heroFillsRole(hero, role))),
  );
  for (const hero of [...locked, ...pinned]) {
    if (!chosen.has(heroKey(hero))) chosen.set(heroKey(hero), hero);
  }
  const ranked = [...chosen.values()].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  const keep = new Set([...locked, ...pinned].map((hero) => heroKey(hero)));
  const pinnedFirst = ranked.filter((hero) => keep.has(heroKey(hero)));
  const rest = ranked.filter((hero) => !keep.has(heroKey(hero)));
  return [...pinnedFirst, ...rest].slice(0, Math.max(cap, pinnedFirst.length));
}

function seatHeroes(heroes: readonly string[], roster: PlayerScout[]): LockedSeat[] {
  if (!roster.length) return heroes.map((hero) => ({ hero, player: null }));
  const rows = new Map<string, { tag: string; comfort: number }[]>();
  for (const hero of heroes) {
    rows.set(
      heroKey(hero),
      roster
        .map((player) => ({
          tag: player.battletag,
          comfort: comfortOf(roster, player.battletag, hero),
        }))
        .sort((a, b) => b.comfort - a.comfort),
    );
  }
  const order = [...heroes].sort((a, b) => {
    const aBest = rows.get(heroKey(a))?.[0]?.comfort ?? 0;
    const bBest = rows.get(heroKey(b))?.[0]?.comfort ?? 0;
    return bBest - aBest;
  });
  const used = new Set<string>();
  const playerByHero = new Map<string, string | null>();
  for (const hero of order) {
    const pick = (rows.get(heroKey(hero)) ?? []).find(
      (row) => row.comfort > 0 && !used.has(row.tag.toLowerCase()),
    );
    if (pick) {
      used.add(pick.tag.toLowerCase());
      playerByHero.set(heroKey(hero), pick.tag);
    } else {
      playerByHero.set(heroKey(hero), null);
    }
  }
  return heroes.map((hero) => ({ hero, player: playerByHero.get(heroKey(hero)) ?? null }));
}

/**
 * Best five this roster can still field into the enemy comp.
 * Comfort, ally synergy, map strength, and the 25 matchups are the score.
 * Bans and the enemy five are gone. The locked five is always a candidate.
 */
export function bestFiveAgainst(args: {
  locked: LockedSeat[];
  enemyHeroes: readonly string[];
  banned: readonly string[];
  roster: PlayerScout[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
  lockedQuality: number;
  tournamentMode?: boolean;
  ignoreComfort?: boolean;
}): { seats: LockedSeat[]; quality: number } {
  const lockedHeroes = args.locked.map((seat) => seat.hero);
  let bestSeats = args.locked;
  let bestQuality = args.lockedQuality;
  let bestComfort = comfortScore(args.locked, args.roster).avg;
  const pool = availableHeroes(args.banned, args.enemyHeroes);
  for (const hero of lockedHeroes) {
    if (!pool.some((name) => heroKey(name) === heroKey(hero))) pool.push(hero);
  }
  const rank = (hero: string) =>
    soloIntoEnemy(
      hero,
      args.enemyHeroes,
      args.roster,
      args.table,
      args.map,
      Boolean(args.tournamentMode),
      Boolean(args.ignoreComfort),
    );
  const partners: string[] = [];
  if (args.table) {
    for (const hero of lockedHeroes) {
      const [best] = allyDuos(args.table, hero, pool).sort((a, b) => b.edgePp - a.edgePp);
      if (best && best.edgePp >= 3) partners.push(best.hero);
    }
  }
  const heroes = shortlistAgainst(pool, lockedHeroes, partners, rank);
  const combo = new Array<string>(5);
  const consider = () => {
    if (sameHeroSet(combo, lockedHeroes)) return;
    if (checkRequiredRoles(combo).missing.length > 0) return;
    const seats = seatHeroes(combo, args.roster);
    const scored = scoreFive({
      seats,
      enemyHeroes: [...args.enemyHeroes],
      roster: args.roster,
      table: args.table,
      map: args.map,
      tournamentMode: args.tournamentMode,
      ignoreComfort: args.ignoreComfort,
    });
    const better =
      scored.quality > bestQuality ||
      (scored.quality === bestQuality &&
        scored.quality > args.lockedQuality &&
        scored.comfort.avg > bestComfort);
    if (better) {
      bestQuality = scored.quality;
      bestComfort = scored.comfort.avg;
      bestSeats = seats.map((seat) => ({ ...seat }));
    }
  };
  const walk = (start: number, depth: number) => {
    if (depth === 5) {
      consider();
      return;
    }
    for (let i = start; i <= heroes.length - (5 - depth); i++) {
      combo[depth] = heroes[i];
      walk(i + 1, depth + 1);
    }
  };
  if (heroes.length >= 5) walk(0, 0);
  return { seats: bestSeats, quality: bestQuality };
}

/**
 * Standard scale on the share of comparable options a lock beat: top 10% is
 * an A, the next 10% a B, and anything that didn't beat 60% of options is an F.
 */
/** Collapse A+/A/A- into A for headline badges. */
export function simpleLetterGrade(
  grade: LetterGrade,
): "A" | "B" | "C" | "D" | "F" {
  if (grade.startsWith("A")) return "A";
  if (grade.startsWith("B")) return "B";
  if (grade.startsWith("C")) return "C";
  if (grade === "D") return "D";
  return "F";
}

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
    const weight = stepGradeWeight(s.kind);
    points += s.achieved * weight;
    bestPoints += Math.max(0, s.best, s.achieved) * weight;
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
  lockedHeroes: readonly string[];
  best: { seats: LockedSeat[]; quality: number };
}): SideDraftGrade {
  const { points, bestPoints, pct } = sumStepPoints(args.steps);
  const notes: string[] = [];
  const miss =
    biggestMiss(args.steps.filter((s) => s.kind === "pick")) ??
    biggestMiss(args.steps.filter((s) => s.kind === "ban"));
  if (miss) {
    const verb = miss.kind === "ban" ? "banned" : "picked";
    notes.push(
      `Biggest miss: ${verb} ${miss.locked} (${fmt(miss.achieved)}) over ${miss.bestLabel} (${fmt(Math.max(miss.best, miss.achieved))}).`,
    );
  } else if (args.steps.length) {
    notes.push("Every step ranked C or better against the options open.");
  }
  if (args.scored.unplayed.length) {
    notes.unshift(
      `Unplayed: ${args.scored.unplayed.join(", ")} — nobody on this five has ${
        args.scored.unplayed.length === 1 ? "it" : "them"
      } on record, so ${
        args.scored.unplayed.length === 1 ? "it goes" : "they go"
      } to whoever is left over. Expect a forced fill on ${
        args.scored.unplayed.length === 1 ? "that seat" : "those seats"
      }.`,
    );
  }
  if (args.scored.missingRoles.length) {
    notes.push(`Missing: ${args.scored.missingRoles.join(", ")}.`);
  }
  if (args.scored.synergy.best) {
    notes.push(`Best pair: ${args.scored.synergy.best}.`);
  }
  const bestHeroes = args.best.seats.map((seat) => seat.hero);
  const tookBest = sameHeroSet(args.lockedHeroes, bestHeroes);
  if (!tookBest && args.best.quality > args.scored.quality) {
    notes.push(
      `Best available vs the enemy comp: ${bestHeroes.join(", ")} (${args.best.quality}).`,
    );
  }
  const steps = args.steps.map((s) => {
    const percentile = stepPercentile(s);
    return { ...s, pct: stepPct(s), percentile, grade: percentileToGrade(percentile) };
  });
  const percentile = tookBest
    ? 100
    : fiveVersusBest(args.scored.quality, args.best.quality);
  return {
    label: args.label,
    grade: percentileToGrade(percentile),
    points,
    bestPoints,
    pct,
    percentile,
    quality: args.scored.quality,
    bestQuality: args.best.quality,
    bestHeroes,
    notes: notes.slice(0, 5),
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
 * End-of-draft report card. The letter is the finished five against the best
 * five still available into the enemy comp (comfort, synergy, map, matchups).
 * The rows stay the locks as they happened. Win chance compares the two
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
  /** When seats can be swapped, a hero nobody on the five plays is a forced fill. */
  tournamentMode?: boolean;
  ignoreComfort?: boolean;
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
    tournamentMode: args.tournamentMode,
    ignoreComfort: args.ignoreComfort,
  });
  const theirFive = scoreFive({
    seats: args.theirLocked,
    enemyHeroes: ourHeroes,
    roster: args.theirRoster,
    table: args.table,
    map: args.map,
    tournamentMode: args.tournamentMode,
    ignoreComfort: args.ignoreComfort,
  });

  const banned = bannedFromSteps(args.steps);
  const ourBest = bestFiveAgainst({
    locked: args.ourLocked,
    enemyHeroes: theirHeroes,
    banned,
    roster: args.homeRoster,
    table: args.table,
    map: args.map,
    lockedQuality: ourFive.quality,
    tournamentMode: args.tournamentMode,
    ignoreComfort: args.ignoreComfort,
  });
  const theirBest = bestFiveAgainst({
    locked: args.theirLocked,
    enemyHeroes: ourHeroes,
    banned,
    roster: args.theirRoster,
    table: args.table,
    map: args.map,
    lockedQuality: theirFive.quality,
    tournamentMode: args.tournamentMode,
    ignoreComfort: args.ignoreComfort,
  });

  const ours = gradeSide({
    label: ourLabel,
    steps: args.steps.filter((s) => s.side === "our"),
    scored: ourFive,
    lockedHeroes: ourHeroes,
    best: ourBest,
  });
  const theirs = gradeSide({
    label: theirLabel,
    steps: args.steps.filter((s) => s.side === "their"),
    scored: theirFive,
    lockedHeroes: theirHeroes,
    best: theirBest,
  });

  const winPct = draftWinPct(ourFive.quality, theirFive.quality);
  const haveMmr =
    typeof args.ourMmr === "number" && typeof args.theirMmr === "number";
  const mmrGap = haveMmr ? Math.round(args.ourMmr! - args.theirMmr!) : null;
  const mmrWinPct = haveMmr
    ? mmrAdjustedWinPct(winPct, args.ourMmr!, args.theirMmr!)
    : null;

  const reasons: string[] = [
    `Final fives: ${ourLabel} ${ourFive.quality} vs ${theirLabel} ${theirFive.quality} (${
      args.ignoreComfort ? "synergy" : "comfort, synergy"
    }, matchups, map, roles, unplayed heroes).`,
  ];
  for (const [label, five] of [
    [ourLabel, ourFive],
    [theirLabel, theirFive],
  ] as const) {
    if (five.unplayed.length) {
      reasons.push(
        `${label} locked ${five.unplayed.join(", ")} with nobody on the five who has played ${
          five.unplayed.length === 1 ? "it" : "them"
        } — ${UNPLAYED_SEAT_QUALITY * five.unplayed.length} strength lost.`,
      );
    }
  }
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
    headline: `Final draft: ${ours.label} ${ours.grade}, ${theirs.label} ${theirs.grade}. Five strength: ${ourLabel} ${ourFive.quality} vs ${theirLabel} ${theirFive.quality} — ${favouredLabel(winPct, ourLabel, theirLabel)}.`,
    reasons,
  };
}
