/**
 * Consecutive double-pick windows (same side picks twice in a row).
 * Score the two locks as a pair so tank+offlane (etc.) stay coherent.
 */
import {
  heroIsOfflaner,
  planHasOfflane,
  planHasRangedDamage,
  planHasWaveclear,
} from "@/lib/scoring/draftPlan";
import {
  heroDraftMeta,
  liveAllySynergies,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
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
  pairFactors: {
    id: string;
    label: string;
    points: number;
    detail: string;
  }[];
  /** Solo base totals used inside the pair (no single-pick structure). */
  firstSolo: number;
  secondSolo: number;
};

/** Structure of the five after both locks — no mid-pick "leaves seat empty" traps. */
export function pairStructureDelta(
  before: DraftCompPick[],
  after: DraftCompPick[],
): { points: number; bits: string[] } {
  let points = 0;
  const bits: string[] = [];
  const hadClear = planHasWaveclear(before);
  const hasClear = planHasWaveclear(after);
  const hadOff = planHasOfflane(before);
  const hasOff = planHasOfflane(after);
  const hadRanged = planHasRangedDamage(before);
  const hasRanged = planHasRangedDamage(after);

  if (!hadRanged && hasRanged) {
    points += 36;
    bits.push("Pair fills ranged damage");
  } else if (hadRanged && !hasRanged) {
    points -= 42;
    bits.push("Pair drops the only ranged damage");
  } else if (!hasRanged) {
    points -= 28;
    bits.push("Five still all-melee after both locks");
  }

  if (!hadClear && hasClear) {
    points += hasRanged ? 30 : 12;
    bits.push(
      hasRanged
        ? "Pair fills waveclear"
        : "Pair adds waveclear but ranged still missing",
    );
  } else if (hadClear && !hasClear) {
    points -= 38;
    bits.push("Pair drops the only waveclear");
  } else if (!hasClear) {
    points -= 16;
    bits.push("Five still has no waveclear after both locks");
  }

  if (!hadOff && hasOff) {
    points += 40;
    bits.push("Pair fills offlane");
  } else if (hadOff && !hasOff) {
    points -= 32;
    bits.push("Pair removes the offlaner");
  } else if (!hasOff) {
    points -= 22;
    bits.push("Five still has no offlaner after both locks");
  }

  const afterRoles = after.map((p) => heroRole(p.hero));
  const hasTank = afterRoles.some((r) => r === "Tank");
  const hasHeal = afterRoles.some((r) => r === "Healer" || r === "Support");
  const tankHero = after.find((p) => heroRole(p.hero) === "Tank")?.hero ?? null;
  const healHero =
    after.find((p) => {
      const r = heroRole(p.hero);
      return r === "Healer" || r === "Support";
    })?.hero ?? null;
  const offHero = after.find((p) => heroIsOfflaner(p.hero))?.hero ?? null;
  if (hasTank && hasHeal && hasOff) {
    points += 8;
    bits.push(
      `Core seats covered: ${tankHero ?? "tank"} (tank) / ${healHero ?? "heal"} (heal) / ${offHero ?? "offlane"} (offlane)`,
    );
  } else if (!hasTank) {
    points -= 24;
    bits.push("No tank after both locks");
  }

  return { points, bits };
}

/** Duo WR between the two locks (not yet on the board). */
export function pairDuoSynergy(
  table: DraftMetaTable | null | undefined,
  a: string,
  b: string,
): { points: number; detail: string } {
  const edges = [
    ...liveAllySynergies(table, a, [b]).map((edge) => ({ ...edge, hero: a })),
    ...liveAllySynergies(table, b, [a]).map((edge) => ({ ...edge, hero: b })),
  ];
  const edge = edges.sort((left, right) => right.games - left.games || Math.abs(right.deltaPp) - Math.abs(left.deltaPp))[0];
  if (!edge) {
    const raw =
      heroDraftMeta(table, a).synergiesWith.find(
        (s) => heroKey(s.hero) === heroKey(b),
      ) ??
      heroDraftMeta(table, b).synergiesWith.find(
        (s) => heroKey(s.hero) === heroKey(a),
      );
    if (!raw) {
      return { points: 0, detail: "No duo sample between these two yet" };
    }
    const vsCoin = raw.allyWinRate - 50;
    const points = Math.max(-10, Math.min(12, vsCoin * 1.15));
    const sign = raw.deltaPp >= 0 ? "+" : "";
    return {
      points,
      detail: `${raw.allyWinRate}% together (${sign}${raw.deltaPp}pp vs solo, ${raw.games}g)`,
    };
  }
  const vsCoin = edge.allyWinRate - 50;
  const points = Math.max(-10, Math.min(12, vsCoin * 1.15));
  const sign = edge.deltaPp >= 0 ? "+" : "";
  return {
    points,
    detail: `${edge.allyWinRate}% together (${sign}${edge.deltaPp}pp vs solo, ${edge.games}g)`,
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
  beforePlan: DraftCompPick[];
  /** Apply first then second onto the plan for structure. */
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

    const evaluate = (first: PairSeatCand, second: PairSeatCand) => {
      const firstSolo = args.soloScore(first.hero);
      const secondSolo = args.soloScore(second.hero);
      const duo = pairDuoSynergy(args.table, first.hero, second.hero);
      const projected = args.projectBoth(first.hero, second.hero);
      const structure = pairStructureDelta(args.beforePlan, projected);

      const pairFactors = [
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
      ];

      const total = Math.round(
        firstSolo + secondSolo + duo.points + structure.points,
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
        key: [heroKey(first.hero), heroKey(second.hero)].sort().join("|"),
      } satisfies Raw;
    };

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
