import { divePlaybook } from "@/config/divePlaybook";
import { heroIsOfflaner } from "@/lib/scoring/draftPlan";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import {
  metaStrength,
  type GlobalHeroStat,
} from "@/lib/scoring/metaPressure";

/** Min games before a matchup edge counts. */
const MIN_MATCHUP_GAMES = 40;
/** Heroes pulled per live-draft matchup request (chained until the queue is empty). */
export const MATCHUP_FETCH_BATCH = 4;
/**
 * Must beat this hero's normal loss rate by at least this many points.
 * Below that is noise, not a counter. There is no 55% win-rate cliff —
 * a 54% answer on a big sample still counts, and a 60% answer on 40 games
 * counts less.
 */
const MIN_DELTA_PP = 3.5;
/** Games where a matchup edge is mostly trusted. Thin samples shrink toward 0. */
const COUNTER_CONFIDENCE_GAMES = 800;
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
  /** Verified teammate samples, including neutral pairs excluded from generic synergy bonuses. */
  allySamples: SynergyEdge[];
  /** Every enemy matchup with enough games, not just hard counters. Absent on older cached tables. */
  matchupSamples?: MatchupEdge[];
  /** Raw SL game counts per enemy — includes pairings below the scoring threshold. */
  matchupGameCounts?: Record<string, number>;
  /** Raw SL game counts per ally — set only once this hero's ally payload was fetched. */
  allyGameCounts?: Record<string, number>;
  /**
   * True once this hero's Storm League matchup payload was fetched.
   * Empty samples with this flag set are a real gap, not an unfetched hero.
   */
  matchupsLoaded?: boolean;
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

/**
 * How hard this matchup is as a counter. Scales with the edge over the
 * hero's normal loss rate, and a thin sample counts for less.
 * About half-trusted at 550 games, nearly full by 2,500.
 */
export function counterSeverity(edge: MatchupEdge): number {
  if (edge.deltaPp <= 0 || edge.games <= 0) return 0;
  const confidence = 1 - Math.exp(-edge.games / COUNTER_CONFIDENCE_GAMES);
  return edge.deltaPp * confidence;
}

/** Scorecard points one live counter is worth, from 0 down to -8. */
export function counterPenalty(edge: MatchupEdge): number {
  return Math.min(8, counterSeverity(edge) * 0.8);
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
  return out.sort(
    (a, b) => counterSeverity(b) - counterSeverity(a) || b.games - a.games,
  );
}

function buildPairGameCounts(
  rows: { hero: string; games: number }[] | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) {
    out[heroKey(row.hero)] = row.games;
  }
  return out;
}

function buildMatchupSamples(
  baselineWr: number,
  enemies: MatchupEnemyRow[] | undefined,
): MatchupEdge[] {
  if (!enemies?.length) return [];
  const expectedEnemyWr = 100 - baselineWr;
  return enemies
    .filter((row) => row.games >= MIN_MATCHUP_GAMES)
    .map((row) => ({
      hero: row.hero,
      theirWinRate: Math.round(row.enemyWinRate * 10) / 10,
      games: row.games,
      deltaPp: Math.round((row.enemyWinRate - expectedEnemyWr) * 10) / 10,
    }));
}

/** Min games before an ally pair counts as synergy. */
const MIN_ALLY_GAMES = 60;
/** |delta| below this is noise vs solo baseline. */
const MIN_SYNERGY_DELTA_PP = 2;

function buildAllySamples(
  baselineWr: number,
  allies: MatchupAllyRow[] | undefined,
): SynergyEdge[] {
  if (!allies?.length) return [];
  const out: SynergyEdge[] = [];
  for (const row of allies) {
    if (row.games < MIN_ALLY_GAMES) continue;
    const deltaPp = row.allyWinRate - baselineWr;
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

function buildSynergies(
  baselineWr: number,
  allies: MatchupAllyRow[] | undefined,
): SynergyEdge[] {
  return buildAllySamples(baselineWr, allies).filter(
    (edge) => Math.abs(edge.deltaPp) >= MIN_SYNERGY_DELTA_PP,
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
  // A real answer, not a 3.5pp nudge on a huge sample.
  const serious = counters.filter((c) => counterSeverity(c) >= 5).length;
  if (weak || serious >= 3) return "late";
  if (serious >= 2 && wr < 50) return "late";
  if (serious === 0 && (strong || wr >= 49)) return "early";
  if (serious <= 1 && strong) return "early";
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
    const allySamples = buildAllySamples(wr, allies);
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
      allySamples,
      matchupSamples: buildMatchupSamples(wr, enemies),
      matchupGameCounts:
        enemies !== undefined ? buildPairGameCounts(enemies) : undefined,
      allyGameCounts: allies !== undefined ? buildPairGameCounts(allies) : undefined,
      matchupsLoaded: enemies !== undefined || allies !== undefined,
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
    allySamples: [],
    matchupSamples: [],
    matchupsLoaded: false,
    mapStrong: [],
    note: "No Storm League sample for this hero yet.",
  };
}

/**
 * Storm League matchups were fetched for this hero.
 * A globals-only row (no samples, flag unset) still needs a pull.
 */
export function heroMatchupsLoaded(
  table: DraftMetaTable | null | undefined,
  hero: string,
): boolean {
  const row = table?.byHero[heroKey(hero)];
  if (!row) return false;
  if (row.matchupsLoaded) return true;
  return (row.matchupSamples?.length ?? 0) > 0 || row.allySamples.length > 0;
}

/** True once this hero's ally payload was fetched, even if every pair is below the scoring line. */
export function heroAlliesLoaded(
  table: DraftMetaTable | null | undefined,
  hero: string,
): boolean {
  const row = table?.byHero[heroKey(hero)];
  if (!row) return false;
  if (row.allyGameCounts) return true;
  return row.allySamples.length > 0 || row.synergiesWith.length > 0;
}

/** Display names whose matchup payload is not in the table yet. */
export function heroesMissingMatchupLoad(
  table: DraftMetaTable | null | undefined,
  heroes: readonly string[],
): string[] {
  return matchupFetchQueue(table, heroes);
}

/**
 * Heroes still needing a Storm League pull, with `priority` names first
 * (e.g. their likely five while scoring pick suggestions).
 */
export function matchupFetchQueue(
  table: DraftMetaTable | null | undefined,
  heroes: readonly string[],
  priority: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (hero: string) => {
    // Plan seats use "Flex" / "Flex ban" when no hero is chosen yet.
    if (!hero || heroRole(hero) === "Unknown") return;
    const key = heroKey(hero);
    if (seen.has(key)) return;
    seen.add(key);
    if (!heroMatchupsLoaded(table, hero) || !heroAlliesLoaded(table, hero)) {
      out.push(hero);
    }
  };
  for (const hero of priority) push(hero);
  for (const hero of heroes) push(hero);
  return out;
}

/** Best SL sample size for a pairing once both heroes' rows are loaded. */
export function pairingGameCount(
  table: DraftMetaTable | null | undefined,
  a: string,
  b: string,
): number | undefined {
  if (!heroMatchupsLoaded(table, a) || !heroMatchupsLoaded(table, b)) {
    return undefined;
  }
  const bk = heroKey(b);
  const ak = heroKey(a);
  let best = 0;
  const aMeta = heroDraftMeta(table, a);
  const bMeta = heroDraftMeta(table, b);
  const ga = aMeta.matchupGameCounts?.[bk];
  const gb = bMeta.matchupGameCounts?.[ak];
  if (ga != null) best = Math.max(best, ga);
  if (gb != null) best = Math.max(best, gb);
  if (ga == null && gb == null) {
    const fromSample = (list: MatchupEdge[] | undefined, other: string) =>
      list?.find((s) => heroKey(s.hero) === heroKey(other))?.games ?? 0;
    best = Math.max(fromSample(aMeta.matchupSamples, b), fromSample(bMeta.matchupSamples, a));
  }
  return best;
}

/**
 * Copy fetched matchup fields onto an existing table.
 * Win rate, map edges, and other heroes' rows stay as they were.
 * Either hero's row is enough for a duo — `enemyDuos` / `allyDuos` read both sides.
 */
export function mergeLoadedMatchupRows(
  base: DraftMetaTable | null | undefined,
  rows: Record<string, ComputedHeroMeta>,
  patch = "",
): DraftMetaTable {
  const incoming: Record<string, ComputedHeroMeta> = {};
  for (const [key, row] of Object.entries(rows)) {
    incoming[heroKey(key)] = { ...row, matchupsLoaded: true };
  }
  if (!base) {
    return {
      patch: patch || "live",
      source: "heroesprofile-sl",
      byHero: incoming,
    };
  }
  const byHero = { ...base.byHero };
  for (const [key, row] of Object.entries(incoming)) {
    const prev = byHero[key];
    byHero[key] = prev
      ? {
          ...prev,
          counteredBy: row.counteredBy,
          synergiesWith: row.synergiesWith,
          allySamples: row.allySamples,
          matchupSamples: row.matchupSamples ?? [],
          matchupGameCounts: mergeMatchupGameCounts(
            prev.matchupGameCounts,
            row.matchupGameCounts,
          ),
          allyGameCounts: mergeMatchupGameCounts(
            prev.allyGameCounts,
            row.allyGameCounts,
          ),
          matchupsLoaded: true,
          timing: row.timing,
        }
      : row;
  }
  return { ...base, byHero };
}

function mergeMatchupGameCounts(
  prev: Record<string, number> | undefined,
  next: Record<string, number> | undefined,
): Record<string, number> {
  const out = { ...prev };
  for (const [key, games] of Object.entries(next ?? {})) {
    out[key] = Math.max(out[key] ?? 0, games);
  }
  return out;
}

/** Why a duo line scored 0 — only after both heroes' rows are in the table. */
export function duoMissingLine(
  table: DraftMetaTable | null | undefined,
  subject: string,
  other: string,
  verb: "together" | "into",
  pending?: ReadonlySet<string>,
): string | null {
  // Both teams cannot lock the same hero. A likely-five mirror is not a gap.
  if (heroKey(subject) === heroKey(other)) return null;
  const label = verb === "into" ? `into ${other}` : `with ${other}`;
  const pendingKey = (name: string) =>
    pending?.has(name) || pending?.has(heroKey(name)) || false;
  if (pendingKey(subject) || pendingKey(other)) {
    return `${label}: fetching Storm League… → 0`;
  }
  if (!heroMatchupsLoaded(table, subject)) {
    return `${label}: ${subject} matchups not loaded — fetching… → 0`;
  }
  if (!heroMatchupsLoaded(table, other)) {
    return `${label}: ${other} matchups not loaded — fetching… → 0`;
  }
  const games = pairingGameCount(table, subject, other);
  if (games === undefined) {
    return `${label}: fetching Storm League… → 0`;
  }
  if (games > 0 && games < MIN_MATCHUP_GAMES) {
    return `${label}: only ${games.toLocaleString("en-US")} SL games (need ${MIN_MATCHUP_GAMES}) → 0`;
  }
  return `${label}: no Storm League pairing on record → 0`;
}

/** Short label for a duo line that has nothing to score, or null when the line has a sample. */
export function missingDuoLabel(text: string): string | null {
  if (
    !/no sample with enough games|ally data unavailable|no verified sample|fetching Storm League|matchups not loaded|ally matchups not loaded|only \d|no Storm League pairing on record|no Storm League games together/i.test(
      text,
    )
  ) {
    return null;
  }
  const head = text.split(":")[0]?.trim() ?? "";
  if (/^(into|with)\s+/i.test(head)) return head;
  if (/ and /i.test(head)) return head;
  const named = text.match(/ally data unavailable for (.+?) right now/i);
  if (named) return named[1];
  return "duo sample";
}

/** Human-readable reason from a missing-duo score line (after the hero label). */
export function missingDuoReason(text: string): string | null {
  const label = missingDuoLabel(text);
  if (!label) return null;
  const body = text.slice(text.indexOf(":") + 1).replace(/\s*→\s*0\s*$/, "").trim();
  if (/fetching/i.test(body)) return body;
  if (/only .* SL games/i.test(body)) return body;
  if (/not loaded/i.test(body)) return body;
  if (/no Storm League pairing/i.test(body)) return body;
  if (/no sample with enough games/i.test(body)) {
    return "Storm League sample not loaded yet";
  }
  return body || null;
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

/**
 * A sampled two-hero result (teammates or opponents). HeroesProfile has no
 * 3–5 hero data, so a team is judged as the sum of its duos.
 */
export type DuoEdge = {
  /** The other hero in the duo. */
  hero: string;
  /** Pair WR together, or `hero`'s WR into this enemy. */
  winRate: number;
  games: number;
  /** winRate − 50: good together / good into them, not better than solo. */
  edgePp: number;
};

/** Both heroes' rows describe the same games; keep whichever stacked more patches. */
function moreGames<T extends { games: number }>(a?: T, b?: T): T | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.games > a.games ? b : a;
}

function uniqueOthers(hero: string, others: readonly string[]): string[] {
  const self = heroKey(hero);
  const seen = new Set<string>();
  return others.filter((h) => {
    const k = heroKey(h);
    if (k === self || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function duoEdge(hero: string, winRate: number, games: number): DuoEdge {
  const wr = Math.round(winRate * 10) / 10;
  return { hero, winRate: wr, games, edgePp: Math.round((wr - 50) * 10) / 10 };
}

/** Every sampled ally duo between `hero` and `allies`, from either hero's row. */
export function allyDuos(
  table: DraftMetaTable | null | undefined,
  hero: string,
  allies: readonly string[],
): DuoEdge[] {
  const meta = heroDraftMeta(table, hero);
  const out: DuoEdge[] = [];
  for (const ally of uniqueOthers(hero, allies)) {
    const allyMeta = heroDraftMeta(table, ally);
    const find = (list: SynergyEdge[] | undefined, other: string) =>
      list?.find((s) => heroKey(s.hero) === heroKey(other));
    const sample =
      moreGames(find(meta.allySamples, ally), find(allyMeta.allySamples, hero)) ??
      moreGames(find(meta.synergiesWith, ally), find(allyMeta.synergiesWith, hero));
    if (sample) out.push(duoEdge(ally, sample.allyWinRate, sample.games));
  }
  return out;
}

/** Every sampled matchup between `hero` and `enemies`, from either hero's row. */
export function enemyDuos(
  table: DraftMetaTable | null | undefined,
  hero: string,
  enemies: readonly string[],
): DuoEdge[] {
  const meta = heroDraftMeta(table, hero);
  const out: DuoEdge[] = [];
  for (const enemy of uniqueOthers(hero, enemies)) {
    const enemyMeta = heroDraftMeta(table, enemy);
    const find = (list: MatchupEdge[] | undefined, other: string) =>
      list?.find((s) => heroKey(s.hero) === heroKey(other));
    // Our row lists the enemy's WR into us; their row lists our WR into them.
    const ours = find(meta.matchupSamples, enemy) ?? find(meta.counteredBy, enemy);
    const theirs =
      find(enemyMeta.matchupSamples, hero) ?? find(enemyMeta.counteredBy, hero);
    const pick = moreGames(
      ours && { winRate: 100 - ours.theirWinRate, games: ours.games },
      theirs && { winRate: theirs.theirWinRate, games: theirs.games },
    );
    if (pick) out.push(duoEdge(enemy, pick.winRate, pick.games));
  }
  return out;
}

export type DuoWeights = { perPp: number; perDuoCap: number; totalCap: number };
export const SYNERGY_DUO: DuoWeights = { perPp: 1.15, perDuoCap: 12, totalCap: 18 };
export const MATCHUP_DUO: DuoWeights = { perPp: 0.55, perDuoCap: 14, totalCap: 24 };
/** Expected picks are not locked, so this span is half of MATCHUP_DUO. */
export const LIKELY_MATCHUP_DUO: DuoWeights = { perPp: 0.275, perDuoCap: 7, totalCap: 12 };

function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

/**
 * Sum of per-duo points. `lines` lists every hero in `others` — sampled duos
 * best-first, then any with too few games to score — for the tooltip.
 */
export function scoreDuos(
  duos: readonly DuoEdge[],
  weights: DuoWeights,
  verb: "together" | "into",
  others: readonly string[] = [],
  missingLine?: (other: string) => string | null,
): { points: number; summary: string; lines: string[]; math: string } {
  const scored = duos
    .map((d) => ({
      duo: d,
      pts: Math.max(-weights.perDuoCap, Math.min(weights.perDuoCap, d.edgePp * weights.perPp)),
    }))
    .sort((a, b) => b.pts - a.pts);
  const sum = scored.reduce((s, x) => s + x.pts, 0);
  const points = Math.max(-weights.totalCap, Math.min(weights.totalCap, sum));
  const label = (hero: string) =>
    verb === "together" ? `with ${hero}` : `into ${hero}`;
  const lines = scored.map(
    ({ duo, pts }) =>
      `${label(duo.hero)}: ${duo.winRate}% ${verb === "together" ? "together" : "win rate"} (${duo.games.toLocaleString("en-US")}g) → ${signed(pts)}`,
  );
  const sampled = new Set(duos.map((d) => heroKey(d.hero)));
  for (const hero of others) {
    if (sampled.has(heroKey(hero))) continue;
    const line = missingLine
      ? missingLine(hero)
      : `${label(hero)}: no sample with enough games → 0`;
    if (line) lines.push(line);
  }
  const unsampled = lines.length - scored.length;
  const summary = scored.length
    ? `${scored.length} duo${scored.length === 1 ? "" : "s"}, net ${signed(points)}` +
      (unsampled ? ` · ${unsampled} unsampled` : "") +
      ` · best ${scored[0].duo.hero} ${scored[0].duo.winRate}%` +
      (scored.length > 1
        ? ` · worst ${scored[scored.length - 1].duo.hero} ${scored[scored.length - 1].duo.winRate}%`
        : "")
    : "";
  return {
    points,
    summary,
    lines,
    math: `each duo ${weights.perPp} × (WR − 50) capped ±${weights.perDuoCap}; sum ${sum.toFixed(1)} capped ±${weights.totalCap} → ${Math.round(points)}`,
  };
}

/** Cho + Gall are one roster lock — never count them as two answers. */
export function isChoGall(hero: string): boolean {
  const k = heroKey(hero).toLowerCase().replace(/['’]/g, "");
  return k === "cho" || k === "gall" || k === "chogall";
}

function counterStillViable(
  table: DraftMetaTable | null | undefined,
  name: string,
): boolean {
  const g = table?.byHero[heroKey(name)];
  if (!g || g.games < 1) return true;
  if (g.games < 200) return g.winRate >= COUNTER_FLOOR_WR;
  return g.winRate >= COUNTER_FLOOR_WR || g.influence >= COUNTER_FLOOR_INFLUENCE;
}

/**
 * Counters from the full matchup sample, so a stored report picks up a
 * changed cutoff without another HeroesProfile pull. Falls back to the
 * list baked in at report time when samples were not saved.
 */
function countersOnRecord(
  table: DraftMetaTable | null | undefined,
  hero: string,
): MatchupEdge[] {
  const meta = heroDraftMeta(table, hero);
  const samples = meta.matchupSamples ?? [];
  if (!samples.length) return meta.counteredBy;
  return samples
    .filter(
      (s) =>
        s.games >= MIN_MATCHUP_GAMES &&
        s.deltaPp >= MIN_DELTA_PP &&
        counterStillViable(table, s.hero),
    )
    .sort((a, b) => counterSeverity(b) - counterSeverity(a) || b.games - a.games);
}

/** Hard counters still available on the live board. */
export function liveCountersUp(
  table: DraftMetaTable | null | undefined,
  hero: string,
  gone: Set<string>,
): MatchupEdge[] {
  const choGallGone = [...gone].some((h) => isChoGall(h));
  return countersOnRecord(table, hero).filter((c) => {
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
  answerer: "ours" | "theirs" = "theirs",
): string | null {
  const who = answerer === "ours" ? "we" : "they";
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
    if (r === "Tank") return `${t.hero} (${who} already tanked)`;
    if (r === "Healer" || r === "Support")
      return `${t.hero} (${who} already healed)`;
    if (heroIsOfflaner(t.hero)) return `${t.hero} (${who} already offlaned)`;
    return t.hero;
  });
  return `Not fearing ${bits.join(", ")} — that seat is filled; double-stack is free.`;
}

/** SL counters that aren't in their pool — don't invent answers they won't take. */
export function counterPoolNote(
  threats: MatchupEdge[],
  answeringTeamPool?: string[] | null,
  answerer: "ours" | "theirs" = "theirs",
): string | null {
  if (answeringTeamPool == null || !threats.length) return null;
  const collapsed = collapseCounterEdges(threats);
  const notInPool = collapsed.filter(
    (t) => !poolPlaysCounter(answeringTeamPool, t.hero),
  );
  if (!notInPool.length) return null;
  const bits = notInPool.slice(0, 3).map((t) => t.hero);
  return `Not fearing ${bits.join(", ")} — not in ${answerer === "ours" ? "our" : "their"} played pool.`;
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

export function mapSpecialistTooltip(
  hit: { map: string; winRate: number; deltaPp: number; games: number } | null,
): string {
  if (!hit) return "No specialist edge on this map.";
  const ci = Math.min(3, 3.5 + Math.max(0, 50 - hit.winRate) / 25);
  return `${hit.map}: ${hit.winRate.toFixed(1)}% WR on this map (${hit.games}g), +${hit.deltaPp.toFixed(1)}pp vs baseline, 95% CI target ±${ci.toFixed(1)}pp.`;
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
