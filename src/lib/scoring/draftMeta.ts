import { heroKey } from "@/lib/scoring/heroMeta";
import {
  metaStrength,
  type GlobalHeroStat,
} from "@/lib/scoring/metaPressure";

/** Min games before a matchup edge counts. */
const MIN_MATCHUP_GAMES = 40;
/** Enemy win% into you at or above this is a draft-relevant counter. */
const HARD_COUNTER_ENEMY_WR = 55;
/** Must be at least this many pp worse than your baseline loss rate. */
const MIN_DELTA_PP = 3.5;
/** Counter hero must not be a dumpster-tier pick themselves. */
const COUNTER_FLOOR_WR = 46;
const COUNTER_FLOOR_INFLUENCE = -80;

export type MatchupEnemyRow = {
  hero: string;
  /** Your wins in this matchup. */
  wins: number;
  losses: number;
  games: number;
  /**
   * Opponent win% into you (HeroesProfile enemy.win_rate).
   * Diablo vs Malthael ≈ 66 means Malthael wins ~66% of those games.
   */
  enemyWinRate: number;
};

export type HeroMapStat = {
  hero: string;
  map: string;
  winRate: number;
  games: number;
};

export type MatchupEdge = {
  hero: string;
  /** How often they beat you in this matchup (0–100). */
  theirWinRate: number;
  games: number;
  /** pp worse than your baseline (positive = they punish you). */
  deltaPp: number;
};

export type ComputedHeroMeta = {
  hero: string;
  winRate: number;
  influence: number;
  popularity: number;
  banRate: number;
  pickRate: number;
  games: number;
  timing: "early" | "flex" | "late";
  /** Heroes that beat you by the numbers (hard counters). */
  counteredBy: MatchupEdge[];
  /** Maps where your WR is meaningfully above baseline. */
  mapStrong: { map: string; winRate: number; games: number; deltaPp: number }[];
  note: string;
};

export type DraftMetaTable = {
  patch: string;
  source: "heroesprofile-sl";
  byHero: Record<string, ComputedHeroMeta>;
};

function goneHas(gone: Set<string>, hero: string): boolean {
  return gone.has(heroKey(hero));
}

function counterIsViable(
  name: string,
  globalByKey: Map<string, GlobalHeroStat>,
): boolean {
  const g = globalByKey.get(heroKey(name));
  if (!g) return true; // unknown — keep, don't invent power
  if (g.games < 200) return g.winRate >= COUNTER_FLOOR_WR;
  return g.winRate >= COUNTER_FLOOR_WR || g.influence >= COUNTER_FLOOR_INFLUENCE;
}

function hardCounters(
  hero: string,
  baselineWr: number,
  enemies: MatchupEnemyRow[] | undefined,
  globalByKey: Map<string, GlobalHeroStat>,
): MatchupEdge[] {
  if (!enemies?.length) return [];
  const expectedEnemyWr = 100 - baselineWr;
  const out: MatchupEdge[] = [];
  for (const row of enemies) {
    if (row.games < MIN_MATCHUP_GAMES) continue;
    if (row.enemyWinRate < HARD_COUNTER_ENEMY_WR) continue;
    const deltaPp = row.enemyWinRate - expectedEnemyWr;
    if (deltaPp < MIN_DELTA_PP) continue;
    if (!counterIsViable(row.hero, globalByKey)) continue;
    out.push({
      hero: row.hero,
      theirWinRate: Math.round(row.enemyWinRate * 10) / 10,
      games: row.games,
      deltaPp: Math.round(deltaPp * 10) / 10,
    });
  }
  return out.sort((a, b) => b.theirWinRate - a.theirWinRate || b.games - a.games);
}

function mapEdges(
  hero: string,
  baselineWr: number,
  mapRows: HeroMapStat[],
): ComputedHeroMeta["mapStrong"] {
  const mine = mapRows.filter((r) => heroKey(r.hero) === heroKey(hero));
  const out: ComputedHeroMeta["mapStrong"] = [];
  for (const row of mine) {
    if (row.games < 50) continue;
    const deltaPp = row.winRate - baselineWr;
    if (deltaPp < 3) continue;
    out.push({
      map: row.map,
      winRate: Math.round(row.winRate * 10) / 10,
      games: row.games,
      deltaPp: Math.round(deltaPp * 10) / 10,
    });
  }
  return out.sort((a, b) => b.deltaPp - a.deltaPp);
}

function classifyTiming(
  wr: number,
  influence: number,
  popularity: number,
  counters: MatchupEdge[],
): "early" | "flex" | "late" {
  const weak = wr < 46.5 && influence < 0;
  const strong = wr >= 51 || influence >= 80 || (popularity >= 50 && wr >= 48);
  if (weak || counters.length >= 3) return "late";
  if (counters.length >= 2 && wr < 50) return "late";
  if (counters.length === 0 && (strong || wr >= 49)) return "early";
  if (counters.length <= 1 && strong) return "early";
  return "flex";
}

function buildNote(meta: Omit<ComputedHeroMeta, "note">): string {
  const bits: string[] = [];
  bits.push(
    `${meta.winRate.toFixed(1)}% WR / ${meta.influence} influence this patch (${meta.games}g SL)`,
  );
  if (meta.counteredBy.length) {
    const top = meta.counteredBy
      .slice(0, 3)
      .map((c) => `${c.hero} (${c.theirWinRate}% into you, ${c.games}g)`)
      .join("; ");
    bits.push(`Hard matchups: ${top}`);
  } else {
    bits.push("No hard matchup counters with enough games");
  }
  return bits.join(". ") + ".";
}

/**
 * Build draft timing / counters from Storm League globals + matchup rows.
 * Matchup map keys should be heroKey (or display name — we normalize).
 */
export function buildDraftMetaTable(args: {
  patch: string;
  global: GlobalHeroStat[];
  /** enemy rows keyed by the hero being evaluated */
  matchups: Record<string, MatchupEnemyRow[]>;
  mapStats?: HeroMapStat[];
}): DraftMetaTable {
  const globalByKey = new Map<string, GlobalHeroStat>();
  for (const g of args.global) {
    globalByKey.set(heroKey(g.hero), g);
  }
  const mapStats = args.mapStats ?? [];
  const byHero: Record<string, ComputedHeroMeta> = {};

  const keys = new Set<string>([
    ...globalByKey.keys(),
    ...Object.keys(args.matchups).map(heroKey),
  ]);

  for (const key of keys) {
    const g = globalByKey.get(key);
    const wr = g?.winRate ?? 50;
    const enemies =
      args.matchups[key] ??
      args.matchups[
        Object.keys(args.matchups).find((k) => heroKey(k) === key) ?? ""
      ];
    const counteredBy = hardCounters(key, wr, enemies, globalByKey);
    const influence = g?.influence ?? 0;
    const popularity = g?.popularity ?? 0;
    const partial = {
      hero: g?.hero ?? key,
      winRate: wr,
      influence,
      popularity,
      banRate: g?.banRate ?? 0,
      pickRate: g?.pickRate ?? 0,
      games: g?.games ?? 0,
      timing: classifyTiming(wr, influence, popularity, counteredBy),
      counteredBy,
      mapStrong: mapEdges(key, wr, mapStats),
    };
    byHero[key] = { ...partial, note: buildNote(partial) };
  }

  return {
    patch: args.patch,
    source: "heroesprofile-sl",
    byHero,
  };
}

export function heroDraftMeta(
  table: DraftMetaTable | null | undefined,
  hero: string,
): ComputedHeroMeta {
  const key = heroKey(hero);
  const hit = table?.byHero[key];
  if (hit) return hit;
  return {
    hero,
    winRate: 50,
    influence: 0,
    popularity: 0,
    banRate: 0,
    pickRate: 0,
    games: 0,
    timing: "flex",
    counteredBy: [],
    mapStrong: [],
    note: "No Storm League sample for this hero yet.",
  };
}

/** Hard counters still available on the live board. */
export function liveCountersUp(
  table: DraftMetaTable | null | undefined,
  hero: string,
  gone: Set<string>,
): MatchupEdge[] {
  return heroDraftMeta(table, hero).counteredBy.filter(
    (c) => !goneHas(gone, c.hero),
  );
}

export function isMapSpecialist(
  table: DraftMetaTable | null | undefined,
  hero: string,
  map: string | null,
): { map: string; winRate: number; deltaPp: number; games: number } | null {
  if (!map) return null;
  const hit = heroDraftMeta(table, hero).mapStrong.find(
    (m) => m.map.toLowerCase() === map.toLowerCase(),
  );
  return hit ?? null;
}

/** Plan slot is the offlane / solo-lane seat — half the game if it loses. */
export function isOfflanePlanRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return (
    r.includes("off") ||
    r.includes("solo") ||
    r === "bruiser" ||
    r.includes("clear")
  );
}

/** Flexible tank / healer seats — safe to show early without locking a lane matchup. */
export function isFlexibleAnchorRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r.includes("tank") || r.includes("heal") || r.includes("enabler");
}

/**
 * Higher = better to lock on this step.
 * Pick 1 prioritizes flexible anchors; naked offlane is heavily punished
 * (offlane is ~half the game — do not gift them the counter).
 */
export function earlyPickScore(
  table: DraftMetaTable | null | undefined,
  hero: string,
  args: {
    gone: Set<string>;
    map: string | null;
    ourPickCount: number;
    inPlan: boolean;
    /** Role from our planned five, if this hero is in it. */
    planRole?: string | null;
  },
): number {
  const meta = heroDraftMeta(table, hero);
  let score = args.inPlan ? 20 : 0;
  const opening = args.ourPickCount === 0;
  const offlane = isOfflanePlanRole(args.planRole);
  const anchor = isFlexibleAnchorRole(args.planRole);

  // Power from current patch numbers
  score += metaStrength(meta) * 18;
  score += (meta.winRate - 50) * 0.8;
  if (meta.winRate < 46) score -= 10;
  if (meta.influence < -50) score -= 6;

  if (meta.timing === "early") score += 8;
  if (meta.timing === "late") score -= 10;
  if (opening && meta.timing === "late") score -= 10;

  const threats = liveCountersUp(table, hero, args.gone);
  for (const t of threats) {
    // Popular counters that crush you are worse to leave up.
    const pop =
      table?.byHero[heroKey(t.hero)]?.popularity ??
      Math.min(80, t.games / 10);
    const hit =
      5 + Math.min(8, (t.theirWinRate - 50) / 3) + pop / 40;
    // Offlane counters are existential; tank counters are awkward but rotatable.
    score -= offlane && opening ? hit * 1.75 : hit;
  }

  if (opening && anchor) score += 14;
  if (opening && offlane) {
    // Never casually open your real offlaner — they counter it and the map is over.
    score -= 22;
    if (threats.length > 0) score -= 10;
  }

  const mapHit = isMapSpecialist(table, hero, args.map);
  if (mapHit) score += 6 + Math.min(6, mapHit.deltaPp);

  return score;
}

export function formatCounter(c: MatchupEdge): string {
  return `${c.hero} (${c.theirWinRate}% / ${c.games}g)`;
}
