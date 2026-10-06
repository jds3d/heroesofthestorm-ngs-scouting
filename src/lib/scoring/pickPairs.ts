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
import { heroKey } from "@/lib/scoring/heroMeta";
import { checkRequiredRoles } from "@/lib/scoring/roles";
import type { DraftCompPick } from "@/lib/scoring/types";

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
