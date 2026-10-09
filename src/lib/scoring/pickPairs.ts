/**
 * Consecutive double-pick windows (same side picks twice in a row).
 * Score the two locks as a pair so tank+offlane (etc.) stay coherent.
 */
import {
  allyDuos,
  heroAlliesLoaded,
  heroDraftMeta,
  scoreDuos,
  SYNERGY_DUO,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import {
  comfortPickPoints,
  stormLeagueScore,
} from "@/lib/scoring/comfort";
import { heroKey } from "@/lib/scoring/heroMeta";
import {
  assignRequiredRoles,
  checkRequiredRoles,
  type RequiredRole,
} from "@/lib/scoring/roles";
import type { DraftCompPick, PlayerScout } from "@/lib/scoring/types";

/** True when this step starts a same-side pick-pick double. */
export function isDoublePickWindow(
  order: readonly { side: "fp" | "sp"; kind: "ban" | "pick" }[],
  stepIndex: number,
): boolean {
  const a = order[stepIndex];
  const b = order[stepIndex + 1];
  return Boolean(
    a &&
      b &&
      a.kind === "pick" &&
      b.kind === "pick" &&
      a.side === b.side,
  );
}

export type NextStepSuggestion = {
  side: "fp" | "sp";
  kind: "ban" | "pick";
  /** 1 for one lock. 2 when this step starts a same-side double. */
  picks: 1 | 2;
  /** This side has no pick after this lock, or after this double. */
  last: boolean;
};

/** What the suggestion should be for the next unplayed draft-order step. */
export function nextStepSuggestion(
  order: readonly { side: "fp" | "sp"; kind: "ban" | "pick" }[],
  completed: number,
): NextStepSuggestion | null {
  const step = order[completed];
  if (!step) return null;
  if (step.kind === "ban") {
    return { side: step.side, kind: "ban", picks: 1, last: false };
  }
  const pair = isDoublePickWindow(order, completed);
  const after = completed + (pair ? 2 : 1);
  let later = false;
  for (let i = after; i < order.length; i++) {
    if (order[i]?.kind === "pick" && order[i]?.side === step.side) {
      later = true;
      break;
    }
  }
  return {
    side: step.side,
    kind: "pick",
    picks: pair ? 2 : 1,
    last: !later,
  };
}

export type PairSeatCand = {
  hero: string;
  role: string;
  player: string | null;
  fromAlt: boolean;
};

export type RankedPickPair = {
  /** Lock this hero first. */
  first: string;
  /** Follow with this hero on the next pick. */
  second: string;
  firstPlayer: string | null;
  secondPlayer: string | null;
  firstRole: string | null;
  secondRole: string | null;
  firstFromAlt: boolean;
  secondFromAlt: boolean;
  /** Combined pair score (solo bases + duo + structure + order). */
  total: number;
  /** Factors unique to the pair layer (duo / structure / order). */
  pairFactors: PairScoreFactor[];
  /** Solo base totals used inside the pair (no single-pick structure). */
  firstSolo: number;
  secondSolo: number;
};

export type PairScoreFactor = {
  id: string;
  label: string;
  points: number;
  detail: string;
  /** Explanation for the portion credited to the hero locked first. */
  firstDetail?: string;
  /** Explanation for the portion credited to the hero locked second. */
  secondDetail?: string;
  /** Portion credited to the hero locked first. */
  firstPoints: number;
  /** Portion credited to the hero locked second. */
  secondPoints: number;
};

/**
 * Required roles after both locks. `after` must be this team's locked heroes
 * plus the pair — not unlocked plan placeholders.
 */
export function pairRoleCheck(
  after: DraftCompPick[],
  first: string,
  second: string,
): {
  points: number;
  detail: string;
  firstPoints: number;
  secondPoints: number;
  firstDetail: string;
  secondDetail: string;
} {
  const heroes = after.map((pick) => pick.hero);
  const check = checkRequiredRoles(heroes);
  const [firstPoints, secondPoints] = splitBetweenPair(check.points);
  const heroDetail = (hero: string, share: number) => {
    const index = heroes.findIndex((h) => heroKey(h) === heroKey(hero));
    const role = index >= 0 ? check.filledBy.get(index) : undefined;
    const covers = role ? `Covers ${role}` : "Flex — no required role";
    return share ? `${covers} · ${check.detail}: ${share}` : covers;
  };
  return {
    points: check.points,
    detail: check.detail,
    firstPoints,
    secondPoints,
    firstDetail: heroDetail(first, firstPoints),
    secondDetail: heroDetail(second, secondPoints),
  };
}

function allyPairGames(
  table: DraftMetaTable | null | undefined,
  a: string,
  b: string,
): number {
  const gamesOf = (hero: string, other: string) => {
    const row = heroDraftMeta(table, hero);
    const counted = row.allyGameCounts?.[heroKey(other)];
    if (counted != null) return counted;
    const sample = row.allySamples.find((edge) => heroKey(edge.hero) === heroKey(other));
    return sample?.games ?? 0;
  };
  return Math.max(gamesOf(a, b), gamesOf(b, a));
}

/** Duo WR between the two locks (not yet on the board). */
export function pairDuoSynergy(
  table: DraftMetaTable | null | undefined,
  a: string,
  b: string,
): { points: number; detail: string } {
  const [duo] = allyDuos(table, a, [b]);
  if (!duo) {
    const missing = [a, b].filter((hero) => !heroAlliesLoaded(table, hero));
    if (missing.length) {
      return {
        points: 0,
        detail: `${a} and ${b}: ally matchups not loaded for ${missing.join(", ")} — fetching`,
      };
    }
    const games = allyPairGames(table, a, b);
    if (games > 0) {
      return {
        points: 0,
        detail: `${a} and ${b}: only ${games.toLocaleString("en-US")} SL games together (need 60)`,
      };
    }
    return {
      points: 0,
      detail: `${a} and ${b}: no Storm League games together on record`,
    };
  }
  const points = Math.round(scoreDuos([duo], SYNERGY_DUO, "together").points);
  return {
    points,
    detail: `${duo.winRate}% together (${duo.games.toLocaleString("en-US")}g) — worth ${points > 0 ? "+" : ""}${points} pair points`,
  };
}

function splitBetweenPair(points: number): [number, number] {
  const rounded = Math.round(points);
  const first = Math.trunc(rounded / 2);
  return [first, rounded - first];
}

/** Split pair-only factors so the scorecard explains each hero's contribution. */
export function pairScoreFactors(args: {
  table: DraftMetaTable | null | undefined;
  after: DraftCompPick[];
  first: string;
  second: string;
}): PairScoreFactor[] {
  const duo = pairDuoSynergy(args.table, args.first, args.second);
  const [firstSynergy, secondSynergy] = splitBetweenPair(duo.points);
  const roles = pairRoleCheck(args.after, args.first, args.second);
  return [
    {
      id: "duo",
      label: "Ally synergy",
      points: Math.round(duo.points),
      detail: duo.detail,
      firstPoints: firstSynergy,
      secondPoints: secondSynergy,
    },
    {
      id: "roles",
      label: "Roles",
      points: roles.points,
      detail: roles.detail,
      firstDetail: roles.firstDetail,
      secondDetail: roles.secondDetail,
      firstPoints: roles.firstPoints,
      secondPoints: roles.secondPoints,
    },
  ];
}

/** Score one specific lock order (first, then second). */
export function scoreOrderedPair(args: {
  first: PairSeatCand;
  second: PairSeatCand;
  soloScore: (hero: string) => number;
  /** This team's locked heroes plus both new locks (no unlocked plan seats). */
  projectBoth: (first: string, second: string) => DraftCompPick[];
  table: DraftMetaTable | null | undefined;
}): RankedPickPair {
  const { first, second } = args;
  const firstSolo = args.soloScore(first.hero);
  const secondSolo = args.soloScore(second.hero);
  const pairFactors = pairScoreFactors({
    table: args.table,
    after: args.projectBoth(first.hero, second.hero),
    first: first.hero,
    second: second.hero,
  });
  const total = Math.round(
    firstSolo + secondSolo + pairFactors.reduce((sum, factor) => sum + factor.points, 0),
  );
  return {
    first: first.hero,
    second: second.hero,
    firstPlayer: first.player ?? null,
    secondPlayer: second.player ?? null,
    firstRole: first.role,
    secondRole: second.role,
    firstFromAlt: first.fromAlt,
    secondFromAlt: second.fromAlt,
    total,
    pairFactors,
    firstSolo,
    secondSolo,
  };
}

/**
 * Rank unordered seat-hero pairs. For each set, try both lock orders and
 * keep the better one. Caps per-seat fan-out for speed.
 */
export function rankDoublePickPairs(args: {
  seats: { role: string; player: string | null; cands: PairSeatCand[] }[];
  /** Solo score lookup (hero → points without single-pick structure). */
  soloScore: (hero: string) => number;
  /** True when they might take this hero (deny / comfort) — prefer locking first. */
  contested: (hero: string) => boolean;
  /** This team's locked heroes plus both new locks (no unlocked plan seats). */
  projectBoth: (first: string, second: string) => DraftCompPick[];
  table: DraftMetaTable | null | undefined;
  maxPerSeat?: number;
  maxPairs?: number;
}): RankedPickPair[] {
  const maxPerSeat = args.maxPerSeat ?? 5;
  const maxPairs = args.maxPairs ?? 6;
  if (args.seats.length < 2) return [];

  const trimmed = args.seats.map((s) => {
    const sorted = [...s.cands].sort(
      (a, b) =>
        args.soloScore(b.hero) - args.soloScore(a.hero) ||
        a.hero.localeCompare(b.hero),
    );
    const seen = new Set<string>();
    const out: PairSeatCand[] = [];
    for (const c of sorted) {
      const k = heroKey(c.hero);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= maxPerSeat) break;
    }
    return { role: s.role, player: s.player, cands: out };
  });

  type Raw = RankedPickPair & { key: string };
  const bestByKey = new Map<string, Raw>();

  const consider = (
    a: PairSeatCand,
    b: PairSeatCand,
    seatAPlayer: string | null,
    seatBPlayer: string | null,
  ) => {
    if (heroKey(a.hero) === heroKey(b.hero)) return;
    const pA = a.player ?? seatAPlayer;
    const pB = b.player ?? seatBPlayer;
    if (pA && pB && pA.toLowerCase() === pB.toLowerCase()) {
      return;
    }

    const evaluate = (first: PairSeatCand, second: PairSeatCand): Raw => ({
      ...scoreOrderedPair({ ...args, first, second }),
      key: [heroKey(first.hero), heroKey(second.hero)].sort().join("|"),
    });

    for (const ordered of [evaluate(a, b), evaluate(b, a)]) {
      const prev = bestByKey.get(ordered.key);
      if (!prev || ordered.total > prev.total) {
        bestByKey.set(ordered.key, ordered);
      }
    }
  };

  for (let i = 0; i < trimmed.length; i++) {
    for (let j = i + 1; j < trimmed.length; j++) {
      const seatA = trimmed[i];
      const seatB = trimmed[j];
      for (const a of seatA.cands) {
        for (const b of seatB.cands) {
          consider(a, b, seatA.player, seatB.player);
        }
      }
    }
  }

  return [...bestByKey.values()]
    .sort((a, b) => b.total - a.total || a.first.localeCompare(b.first))
    .slice(0, maxPairs)
    .map(({ key: _k, ...rest }) => rest);
}

/** Points added for each required role this pair covers that was still open. */
const ROLE_SPLIT_BONUS = 24;

export type OpenSeatHeroOption = {
  hero: string;
  /** Storm League score used to rank the hero. */
  sl: number;
  games: number;
  comfort: number;
};

export type OpenSeatPairLock = {
  player: string;
  hero: string;
  /** Required role this hero is counted as filling, or the hero's own role. */
  role: string;
  sl: number;
  games: number;
  comfort: number;
};

export type OpenSeatPair = {
  first: OpenSeatPairLock;
  second: OpenSeatPairLock;
  /** "tank + healer", or "double ranged damage" when both fill the same job. */
  roleSplit: string;
};

function splitRoleLabel(role: RequiredRole | undefined): string {
  switch (role) {
    case "tank":
      return "Tank";
    case "healer":
      return "Healer";
    case "offlane":
      return "Offlane";
    case "ranged damage":
      return "Ranged";
    default:
      return "Flex";
  }
}

/**
 * Roles the two locks fill once the heroes already locked have taken theirs.
 * A hero with no required role left is Flex.
 */
export function predictPairRoleSplit(
  locked: readonly string[],
  first: string,
  second: string,
): { firstRole: string; secondRole: string; label: string } {
  const assigned = assignRequiredRoles([...locked, first, second]);
  const firstRole = splitRoleLabel(assigned.get(locked.length));
  const secondRole = splitRoleLabel(assigned.get(locked.length + 1));
  const label =
    firstRole === secondRole ? `double ${firstRole}` : `${firstRole} + ${secondRole}`;
  return { firstRole, secondRole, label };
}

function newlyCoveredRoles(
  locked: readonly string[],
  first: string,
  second: string,
): number {
  const before = new Set(assignRequiredRoles(locked).values());
  const after = assignRequiredRoles([...locked, first, second]);
  let covered = 0;
  for (const index of [locked.length, locked.length + 1]) {
    const role = after.get(index);
    if (role && !before.has(role)) covered += 1;
  }
  return covered;
}

/**
 * Best hero pairs for the players still picking.
 * Comfort picks the hero. Covering a required role that is still open
 * outranks a second hero in a role the team already has.
 * Locks stay in open-seat order.
 */
export function rankOpenSeatPairs(args: {
  seats: { player: string; heroes: OpenSeatHeroOption[] }[];
  lockedHeroes: readonly string[];
  maxPairs?: number;
}): OpenSeatPair[] {
  const maxPairs = args.maxPairs ?? 3;
  if (args.seats.length < 2) return [];
  const ranked: (OpenSeatPair & { total: number })[] = [];
  for (let i = 0; i < args.seats.length; i++) {
    for (let j = i + 1; j < args.seats.length; j++) {
      const earlier = args.seats[i];
      const later = args.seats[j];
      for (const a of earlier.heroes) {
        for (const b of later.heroes) {
          if (heroKey(a.hero) === heroKey(b.hero)) continue;
          const split = predictPairRoleSplit(args.lockedHeroes, a.hero, b.hero);
          const total =
            comfortPickPoints(a.sl) +
            comfortPickPoints(b.sl) +
            newlyCoveredRoles(args.lockedHeroes, a.hero, b.hero) * ROLE_SPLIT_BONUS +
            checkRequiredRoles([...args.lockedHeroes, a.hero, b.hero]).points;
          ranked.push({
            first: {
              player: earlier.player,
              hero: a.hero,
              role: split.firstRole,
              sl: a.sl,
              games: a.games,
              comfort: a.comfort,
            },
            second: {
              player: later.player,
              hero: b.hero,
              role: split.secondRole,
              sl: b.sl,
              games: b.games,
              comfort: b.comfort,
            },
            roleSplit: split.label,
            total,
          });
        }
      }
    }
  }
  ranked.sort(
    (a, b) =>
      b.total - a.total ||
      a.first.hero.localeCompare(b.first.hero) ||
      a.second.hero.localeCompare(b.second.hero),
  );
  return ranked.slice(0, maxPairs).map(({ total: _total, ...pair }) => pair);
}

function plateName(tag: string): string {
  return tag.split("#")[0]?.trim() ?? "";
}

/**
 * Double-pick window for the live screen: one pair from the open seats'
 * Storm League pools, with the role split that pair is predicted to fill.
 */
export function openSeatDoublePick(args: {
  openPlayers: readonly string[];
  roster: readonly PlayerScout[];
  gone: ReadonlySet<string>;
  lockedHeroes: readonly string[];
}): OpenSeatPair[] {
  const goneKeys = new Set([...args.gone].map((hero) => heroKey(hero)));
  for (const hero of args.lockedHeroes) goneKeys.add(heroKey(hero));
  const seats: { player: string; heroes: OpenSeatHeroOption[] }[] = [];
  for (const player of args.openPlayers) {
    const shown = plateName(player);
    const key = shown.toLowerCase();
    if (!shown) continue;
    const scout = args.roster.find(
      (row) => plateName(row.battletag).toLowerCase() === key,
    );
    if (!scout) continue;
    const heroes: OpenSeatHeroOption[] = [];
    const seen = new Set<string>();
    const pool = [...scout.topHeroes].sort((a, b) => {
      const as = a.sources.stormLeague ? stormLeagueScore(a.sources.stormLeague) : 0;
      const bs = b.sources.stormLeague ? stormLeagueScore(b.sources.stormLeague) : 0;
      return bs - as || a.hero.localeCompare(b.hero);
    });
    for (const hero of pool) {
      const source = hero.sources.stormLeague;
      if (!source || source.games <= 0) continue;
      const sl = stormLeagueScore(source);
      if (sl <= 0) continue;
      const id = heroKey(hero.hero);
      if (goneKeys.has(id) || seen.has(id)) continue;
      seen.add(id);
      heroes.push({
        hero: hero.hero,
        sl,
        games: source.games,
        comfort: hero.comfort,
      });
      if (heroes.length >= 4) break;
    }
    if (heroes.length) seats.push({ player: shown, heroes });
  }
  return rankOpenSeatPairs({ seats, lockedHeroes: args.lockedHeroes });
}

/** Sentence for the live suggestion. Our double names who locks which hero. */
export function describeOpenSeatPair(args: {
  pair: OpenSeatPair;
  side: "our" | "their";
  last: boolean;
}): string {
  const { pair, side, last } = args;
  const lead = last
    ? side === "our"
      ? "Next is our last picks."
      : "Next is their last picks."
    : side === "our"
      ? "Next is our double."
      : "Next is their double.";
  if (side === "our") {
    return `${lead} ${pair.first.player} locks ${pair.first.hero}, ${pair.second.player} locks ${pair.second.hero}. Role split: ${pair.roleSplit}.`;
  }
  return `${lead} Role split: ${pair.roleSplit} (${pair.first.hero} + ${pair.second.hero}).`;
}
