import { divePlaybook } from "@/config/divePlaybook";
import { heroIsOfflaner } from "@/lib/scoring/draftPlan";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
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

export type MatchupAllyRow = {
  hero: string;
  wins: number;
  losses: number;
  games: number;
  /** Combined WR when you and this hero are teammates. */
  allyWinRate: number;
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

export type SynergyEdge = {
  hero: string;
  /** Combined WR when you and this hero are teammates (0–100). */
  allyWinRate: number;
  games: number;
  /** pp vs your solo baseline (positive = real synergy). */
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
  /** Teammates that raise/lower your WR by the numbers. */
  synergiesWith: SynergyEdge[];
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

/** Min games before an ally pair counts as synergy. */
const MIN_ALLY_GAMES = 60;
/** |delta| below this is noise vs solo baseline. */
const MIN_SYNERGY_DELTA_PP = 2;

function buildSynergies(
  baselineWr: number,
  allies: MatchupAllyRow[] | undefined,
): SynergyEdge[] {
  if (!allies?.length) return [];
  const out: SynergyEdge[] = [];
  for (const row of allies) {
    if (row.games < MIN_ALLY_GAMES) continue;
    const deltaPp = row.allyWinRate - baselineWr;
    if (Math.abs(deltaPp) < MIN_SYNERGY_DELTA_PP) continue;
    out.push({
      hero: row.hero,
      allyWinRate: Math.round(row.allyWinRate * 10) / 10,
      games: row.games,
      deltaPp: Math.round(deltaPp * 10) / 10,
    });
  }
  return out.sort(
    (a, b) => b.deltaPp - a.deltaPp || b.games - a.games,
  );
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
  /** ally rows keyed by the hero being evaluated */
  allies?: Record<string, MatchupAllyRow[]>;
  mapStats?: HeroMapStat[];
}): DraftMetaTable {
  const globalByKey = new Map<string, GlobalHeroStat>();
  for (const g of args.global) {
    globalByKey.set(heroKey(g.hero), g);
  }
  const mapStats = args.mapStats ?? [];
  const byHero: Record<string, ComputedHeroMeta> = {};
  const alliesByKey = args.allies ?? {};

  const keys = new Set<string>([
    ...globalByKey.keys(),
    ...Object.keys(args.matchups).map(heroKey),
    ...Object.keys(alliesByKey).map(heroKey),
  ]);

  const lookup = <T,>(
    table: Record<string, T>,
    key: string,
  ): T | undefined =>
    table[key] ??
    table[Object.keys(table).find((k) => heroKey(k) === key) ?? ""];

  for (const key of keys) {
    const g = globalByKey.get(key);
    const wr = g?.winRate ?? 50;
    const enemies = lookup(args.matchups, key);
    const allies = lookup(alliesByKey, key);
    const counteredBy = hardCounters(key, wr, enemies, globalByKey);
    const synergiesWith = buildSynergies(wr, allies);
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
      synergiesWith,
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
    synergiesWith: [],
    mapStrong: [],
    note: "No Storm League sample for this hero yet.",
  };
}

/** Ally synergy edges for heroes already locked on our side. */
export function liveAllySynergies(
  table: DraftMetaTable | null | undefined,
  hero: string,
  lockedAllies: string[],
): SynergyEdge[] {
  if (!lockedAllies.length) return [];
  const syn = heroDraftMeta(table, hero).synergiesWith;
  const want = new Set(lockedAllies.map((h) => heroKey(h)));
  return syn.filter((s) => want.has(heroKey(s.hero)));
}

/** Cho + Gall are one roster lock — never count them as two answers. */
export function isChoGall(hero: string): boolean {
  const k = heroKey(hero).toLowerCase().replace(/['’]/g, "");
  return k === "cho" || k === "gall" || k === "chogall";
}

/** Hard counters still available on the live board. */
export function liveCountersUp(
  table: DraftMetaTable | null | undefined,
  hero: string,
  gone: Set<string>,
): MatchupEdge[] {
  const choGallGone = [...gone].some((h) => isChoGall(h));
  return heroDraftMeta(table, hero).counteredBy.filter((c) => {
    if (isChoGall(c.hero) && choGallGone) return false;
    return !goneHas(gone, c.hero);
  });
}

export function nakedOfflaneOpeningRisk(args: {
  table: DraftMetaTable | null | undefined;
  hero: string;
  gone: Set<string>;
  ourPickCount: number;
  inPlan: boolean;
  planRole?: string | null;
  answeringTeamLocked?: string[];
  answeringTeamPool?: string[] | null;
  lastPick?: boolean;
}): { points: number; detail: string; isRisk: boolean } {
  const opening = args.ourPickCount === 0;
  if (!opening || !args.inPlan || !isOfflanePlanRole(args.planRole)) {
    return { points: 0, detail: "Naked offlane first pick — not punished yet", isRisk: false };
  }

  const rawAnswers = liveCountersUp(args.table, args.hero, args.gone);
  const liveAnswers = args.lastPick
    ? []
    : credibleOpenCounters(
        rawAnswers,
        args.answeringTeamLocked ?? [],
        args.answeringTeamPool,
      );

  if (!liveAnswers.length) {
    return { points: 0, detail: "Naked offlane first pick — not punished yet", isRisk: false };
  }

  return {
    points: -16,
    detail: "Naked offlane first pick — punishable",
    isRisk: true,
  };
}

/**
 * Collapse linked dual-hero counters (Cho'Gall) into a single edge so we
 * don't double-penalize open-answers risk or trip "≥2 counters" mistake copy.
 */
export function collapseCounterEdges(threats: MatchupEdge[]): MatchupEdge[] {
  const linked = threats.filter((t) => isChoGall(t.hero));
  const rest = threats.filter((t) => !isChoGall(t.hero));
  if (!linked.length) return threats;
  const best = [...linked].sort(
    (a, b) =>
      b.games - a.games ||
      b.theirWinRate - a.theirWinRate ||
      a.hero.localeCompare(b.hero),
  )[0];
  return [{ ...best, hero: "Cho'Gall" }, ...rest];
}

/** Whether the answering team's known pool includes this counter. */
export function poolPlaysCounter(
  pool: Iterable<string>,
  counterHero: string,
): boolean {
  const keys = new Set(
    [...pool].map((h) => heroKey(h).toLowerCase().replace(/['’]/g, "")),
  );
  if (isChoGall(counterHero)) {
    return keys.has("cho") || keys.has("gall") || keys.has("chogall");
  }
  const want = heroKey(counterHero).toLowerCase().replace(/['’]/g, "");
  return keys.has(want);
}

/**
 * Drop counters that would fill a seat the answering team already has
 * (e.g. Tyrael when they locked Varian). Double-tank / double-offlane is
 * a weak stack — we shouldn't fear it, we should punish it.
 *
 * When `answeringTeamPool` is provided, only fear counters that team
 * actually plays (SL matchup ≠ their comfort pool).
 */
export function credibleOpenCounters(
  threats: MatchupEdge[],
  answeringTeamLocked: string[] = [],
  answeringTeamPool?: string[] | null,
): MatchupEdge[] {
  let out = collapseCounterEdges(threats);

  if (answeringTeamPool != null) {
    out = out.filter((t) => poolPlaysCounter(answeringTeamPool, t.hero));
  }

  if (!answeringTeamLocked.length) return out;
  const roles = answeringTeamLocked.map((h) => heroRole(h));
  const hasTank = roles.some((r) => r === "Tank");
  const hasHeal = roles.some((r) => r === "Healer" || r === "Support");
  const hasOfflane = answeringTeamLocked.some((h) => heroIsOfflaner(h));
  return out.filter((t) => {
    // Cho'Gall needs the tank seat (Cho). Treat as Tank for role-fill.
    const r = isChoGall(t.hero) ? "Tank" : heroRole(t.hero);
    if (hasTank && r === "Tank") return false;
    if (hasHeal && (r === "Healer" || r === "Support")) return false;
    if (hasOfflane && !isChoGall(t.hero) && heroIsOfflaner(t.hero))
      return false;
    return true;
  });
}

/** Roles already filled that make a listed counter non-credible. */
export function counterRoleFillNote(
  threats: MatchupEdge[],
  answeringTeamLocked: string[] = [],
  answeringTeamPool?: string[] | null,
): string | null {
  if (!answeringTeamLocked.length || !threats.length) return null;
  const collapsed = collapseCounterEdges(threats);
  const live = new Set(
    credibleOpenCounters(
      threats,
      answeringTeamLocked,
      answeringTeamPool,
    ).map((t) => heroKey(t.hero)),
  );
  const dropped = collapsed.filter((t) => {
    if (answeringTeamPool != null && !poolPlaysCounter(answeringTeamPool, t.hero)) {
      return false; // pool-drop is a different note
    }
    return !live.has(heroKey(t.hero));
  });
  if (!dropped.length) return null;
  const bits = dropped.slice(0, 3).map((t) => {
    const r = isChoGall(t.hero) ? "Tank" : heroRole(t.hero);
    if (r === "Tank") return `${t.hero} (they already tanked)`;
    if (r === "Healer" || r === "Support")
      return `${t.hero} (they already healed)`;
    if (heroIsOfflaner(t.hero)) return `${t.hero} (they already offlaned)`;
    return t.hero;
  });
  return `Not fearing ${bits.join(", ")} — that seat is filled; double-stack is free.`;
}

/** SL counters that aren't in their pool — don't invent answers they won't take. */
export function counterPoolNote(
  threats: MatchupEdge[],
  answeringTeamPool?: string[] | null,
): string | null {
  if (answeringTeamPool == null || !threats.length) return null;
  const collapsed = collapseCounterEdges(threats);
  const notInPool = collapsed.filter(
    (t) => !poolPlaysCounter(answeringTeamPool, t.hero),
  );
  if (!notInPool.length) return null;
  const bits = notInPool.slice(0, 3).map((t) => t.hero);
  return `Not fearing ${bits.join(", ")} — not in their played pool.`;
}

function normalizeMapName(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/[_-]+/g, " ").toLowerCase();
}

/**
 * Map-specialist status must come from the current HeroesProfile map rows.
 * We intentionally do not hard-code any hero/map list here — if the API data
 * says there is no specialist edge for this map, the score stays at zero.
 */
export function isMapSpecialist(
  table: DraftMetaTable | null | undefined,
  hero: string,
  map: string | null,
): { map: string; winRate: number; deltaPp: number; games: number } | null {
  if (!map) return null;
  const target = normalizeMapName(map);
  const hit = heroDraftMeta(table, hero).mapStrong.find((m) => {
    const candidate = normalizeMapName(m.map);
    return candidate !== null && candidate === target;
  });
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
 * Patch-defining dive we always snag when open (Qhira). Take it and rebuild —
 * do not hold for "mask dive" timing.
 */
export function isPriorityDiveCore(hero: string): boolean {
  return divePlaybook.priorityDiveCores.some(
    (h) => heroKey(h) === heroKey(hero),
  );
}

/**
 * Storm League says this hero is a must-take when available.
 * Tuned around Qhira-shaped influence/popularity.
 */
export function isMetaOp(
  table: DraftMetaTable | null | undefined,
  hero: string,
): boolean {
  if (isPriorityDiveCore(hero)) return true;
  const m = heroDraftMeta(table, hero);
  if (m.games < 80) return false;
  if (metaStrength(m) >= 0.72) return true;
  if (m.influence >= 220 && m.popularity >= 55) return true;
  if (m.winRate >= 52 && m.influence >= 150 && m.popularity >= 45) return true;
  return false;
}

/** Take this now and rebuild the plan — OP pocket or priority dive core. */
export function shouldTakeAndRebuild(
  table: DraftMetaTable | null | undefined,
  hero: string,
): boolean {
  return isPriorityDiveCore(hero) || isMetaOp(table, hero);
}

/**
 * Higher = better to lock on this step.
 * OP / priority dive cores beat everything — take them and rebuild.
 * Otherwise pick 1 prefers flexible anchors; naked offlane is punished.
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
    /** Heroes the answering side already locked — role-fill counters don't count. */
    answeringTeamLocked?: string[];
    /**
     * Heroes the answering side actually plays. When set, SL counters outside
     * this pool do not count as open answers.
     */
    answeringTeamPool?: string[] | null;
    /** Last pick of the draft — nobody answers after this. */
    lastPick?: boolean;
  },
): number {
  const meta = heroDraftMeta(table, hero);
  // Soft prior only — board state should dominate once picks start landing.
  const planDecay = Math.max(0.15, 1 - args.ourPickCount * 0.28);
  let score = (args.inPlan ? 12 : 0) * planDecay;

  const opening = args.ourPickCount === 0;
  const offlane = isOfflanePlanRole(args.planRole);
  const anchor = isFlexibleAnchorRole(args.planRole);
  const takeNow = shouldTakeAndRebuild(table, hero);

  // Power from current patch numbers
  score += metaStrength(meta) * 18;
  score += (meta.winRate - 50) * 0.8;
  if (meta.winRate < 46) score -= 10;
  if (meta.influence < -50) score -= 6;

  // Draft timing (early/late) is redundant; open answers risk below already
  // penalizes heroes with unavailable counter windows.

  const threats = args.lastPick
    ? []
    : credibleOpenCounters(
        liveCountersUp(table, hero, args.gone),
        args.answeringTeamLocked ?? [],
        args.answeringTeamPool,
      );
  for (const t of threats) {
    // Popular counters that crush you are worse to leave up.
    const pop =
      table?.byHero[heroKey(t.hero)]?.popularity ??
      Math.min(80, t.games / 10);
    const hit =
      5 + Math.min(8, (t.theirWinRate - 50) / 3) + pop / 40;
    // Offlane counters are existential; tank counters are awkward but rotatable.
    // OP cores: still respect hard answers, but do not refuse the pick.
    score -= offlane && opening ? hit * 1.75 : takeNow ? hit * 0.45 : hit;
  }

  // When an OP dive is open, take it — anchors wait.
  if (takeNow) {
    score += opening ? 42 : 28;
  } else {
    if (opening && anchor) score += 14;
    if (opening && offlane) {
      // Never casually open your real offlaner — they counter it and the map is over.
      score -= 22;
      if (threats.length > 0) score -= 10;
    }
  }

  const mapHit = isMapSpecialist(table, hero, args.map);
  if (mapHit) score += 6 + Math.min(6, mapHit.deltaPp);

  return score;
}

export function formatCounter(c: MatchupEdge): string {
  return `${c.hero} (${c.theirWinRate}% / ${c.games}g)`;
}
