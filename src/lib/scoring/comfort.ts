import { leagueConfig } from "@/config/league";
import type { HeroStat } from "@/lib/heroesprofile/types";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import type {
  ComfortHero,
  PlayerScout,
  SourceHeroStat,
  TeamThreat,
} from "@/lib/scoring/types";

function toSource(
  games: number,
  wins: number,
  playerGames: number,
): SourceHeroStat | undefined {
  if (games <= 0) return undefined;
  const losses = Math.max(games - wins, 0);
  return {
    games,
    wins,
    losses,
    winRate: wins / games,
    playPct: playerGames > 0 ? games / playerGames : 0,
  };
}

function rawScore(source?: SourceHeroStat): number {
  if (!source || source.games <= 0) return 0;
  return source.playPct * (0.4 + 0.6 * source.winRate);
}

/** Games until Storm League volume is ~63% of full credit. */
const SL_VOLUME_GAMES = 30;
/** Pseudo-games at 50% that a small SL sample is pulled toward. */
const SL_WR_PRIOR_GAMES = 10;
/** Keeps SL comfort on the same ~0–0.35 scale as the NGS play-share score. */
const SL_SCALE = 0.3;

/** Comfort → interactive pick/ban scorecard points (0–1 comfort scale). */
export const COMFORT_PICK_MULTIPLIER = 80;
export const COMFORT_PICK_CAP = 32;

/** Seat assignment / plan solver weight on raw comfort (~0–0.35). */
export const COMFORT_PLAN_WEIGHT = 2;

/** Post-plan hole-fill bonuses for comfortOn(home, player, hero). */
export const COMFORT_OFFLANE_FILL = 40;
export const COMFORT_RANGED_FILL = 60;

/** Locked-five grade: average comfort → points. */
export const COMFORT_GRADE_MULTIPLIER = 200;
export const COMFORT_GRADE_CAP = 50;

export function comfortPickPoints(comfort: number): number {
  return Math.min(COMFORT_PICK_CAP, comfort * COMFORT_PICK_MULTIPLIER);
}

/** Minimum raw comfort (0–1) to suggest a hero — UI shows this as 15. */
export const COMFORT_SUGGEST_MIN = 0.15;

export function comfortMeetsSuggestBar(comfort: number): boolean {
  return comfort >= COMFORT_SUGGEST_MIN;
}

function playerDisplayName(battletag: string): string {
  return battletag.split("#")[0]?.trim() ?? battletag;
}

/** Comfort on a hero for one player, or the roster high when player is omitted. */
export function playerComfortOn(
  roster: PlayerScout[],
  hero: string,
  player: string | null | undefined,
): number {
  if (!roster.length) return 0;
  const want = player ? playerDisplayName(player).toLowerCase() : null;
  let best = 0;
  for (const p of roster) {
    const name = playerDisplayName(p.battletag);
    const nameKey = name.toLowerCase();
    if (want && nameKey !== want) continue;
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

export function heroMeetsSuggestBar(
  roster: PlayerScout[],
  hero: string,
  player: string | null | undefined,
): boolean {
  return comfortMeetsSuggestBar(playerComfortOn(roster, hero, player));
}

export type SuggestableOwner = { player: string; comfort: number };

/** Free players who clear the suggest bar on this hero, highest comfort first. */
export function playersMeetingSuggestBar(
  roster: PlayerScout[],
  hero: string,
  taken?: ReadonlySet<string>,
): SuggestableOwner[] {
  const takenIds = new Set([...(taken ?? [])].map((name) => name.toLowerCase()));
  const out: SuggestableOwner[] = [];
  for (const p of roster) {
    const player = playerDisplayName(p.battletag);
    if (takenIds.has(player.toLowerCase())) continue;
    const comfort = playerComfortOn(roster, hero, player);
    if (!comfortMeetsSuggestBar(comfort)) continue;
    out.push({ player, comfort });
  }
  out.sort((a, b) => b.comfort - a.comfort || a.player.localeCompare(b.player));
  return out;
}

/**
 * Two different free players, both at the suggest bar. Prefers the plan's
 * players when they qualify.
 */
export function suggestablePairOwners(
  roster: PlayerScout[],
  first: string,
  second: string,
  preferredFirst?: string | null,
  preferredSecond?: string | null,
  taken?: ReadonlySet<string>,
): { first: SuggestableOwner; second: SuggestableOwner } | null {
  const firstOwners = playersMeetingSuggestBar(roster, first, taken);
  const secondOwners = playersMeetingSuggestBar(roster, second, taken);
  if (!firstOwners.length || !secondOwners.length) return null;

  const prefer = (owners: SuggestableOwner[], name?: string | null) => {
    if (!name) return null;
    const id = playerDisplayName(name).toLowerCase();
    return owners.find((o) => o.player.toLowerCase() === id) ?? null;
  };
  const prefA = prefer(firstOwners, preferredFirst);
  const prefB = prefer(secondOwners, preferredSecond);
  if (
    prefA &&
    prefB &&
    prefA.player.toLowerCase() !== prefB.player.toLowerCase()
  ) {
    return { first: prefA, second: prefB };
  }

  let best: { first: SuggestableOwner; second: SuggestableOwner; score: number } | null =
    null;
  for (const a of firstOwners) {
    for (const b of secondOwners) {
      if (a.player.toLowerCase() === b.player.toLowerCase()) continue;
      const score =
        a.comfort +
        b.comfort +
        (prefA && a.player === prefA.player ? 0.01 : 0) +
        (prefB && b.player === prefB.player ? 0.01 : 0);
      if (!best || score > best.score) best = { first: a, second: b, score };
    }
  }
  return best ? { first: best.first, second: best.second } : null;
}

/** True when two open heroes can be handed to two different players at the bar. */
export function anySuggestablePair(
  roster: PlayerScout[],
  heroes: string[],
  taken?: ReadonlySet<string>,
): boolean {
  const owners = heroes.map((hero) =>
    playersMeetingSuggestBar(roster, hero, taken).map((o) => o.player.toLowerCase()),
  );
  for (let i = 0; i < owners.length; i++) {
    if (!owners[i].length) continue;
    for (let j = i + 1; j < owners.length; j++) {
      for (const a of owners[i]) {
        if (owners[j].some((b) => b !== a)) return true;
      }
    }
  }
  return false;
}

export function filterBanList(
  roster: PlayerScout[],
  bans: { hero: string; reason: string }[],
  playerFor?: (hero: string) => string | null,
): { hero: string; reason: string }[] {
  if (!roster.length) return bans;
  return bans.filter((b) =>
    heroMeetsSuggestBar(roster, b.hero, playerFor?.(b.hero) ?? null),
  );
}

/**
 * Storm League comfort from volume and win rate, not share of games: a deep
 * hero pool should not dilute a hero someone has 100+ games on.
 */
export function stormLeagueScore(source?: SourceHeroStat): number {
  if (!source || source.games <= 0) return 0;
  const recentGames = source.recentGames ?? source.games;
  const recentWins = source.recentWins ?? source.wins;
  const w = leagueConfig.stormLeagueOlderWeight;
  const games = recentGames + w * (source.games - recentGames);
  const wins = recentWins + w * (source.wins - recentWins);
  if (games <= 0) return 0;
  const winRate =
    (wins + SL_WR_PRIOR_GAMES / 2) / (games + SL_WR_PRIOR_GAMES);
  const volume = 1 - Math.exp(-games / SL_VOLUME_GAMES);
  const quality = Math.max(0.25, Math.min(1.4, 1 + 3 * (winRate - 0.5)));
  return SL_SCALE * volume * quality;
}

export function comfortFromSources(
  hero: string,
  ngsCurrent?: SourceHeroStat,
  stormLeague?: SourceHeroStat,
  ngsPrior?: SourceHeroStat,
  includePrior = true,
): ComfortHero {
  const { weights, minGames } = leagueConfig;

  let wNgs: number = weights.ngsCurrent;
  let wSl: number = weights.stormLeague;
  let wPrior: number = includePrior ? weights.ngsPrior : 0;

  const ngsOk = ngsCurrent && ngsCurrent.games >= minGames.ngs;
  const slOk = stormLeague && stormLeague.games >= minGames.stormLeague;
  const priorOk = includePrior && ngsPrior && ngsPrior.games >= minGames.ngs;

  if (!ngsOk) {
    wSl += wNgs * 0.6;
    wPrior += wNgs * 0.4;
    wNgs = 0;
  }
  if (!slOk) {
    wNgs += wSl * 0.7;
    wPrior += wSl * 0.3;
    wSl = 0;
  }
  if (!priorOk) {
    const total = wNgs + wSl;
    if (total > 0) {
      wNgs = wNgs / total;
      wSl = wSl / total;
    }
    wPrior = 0;
  }

  const weightSum = wNgs + wSl + wPrior || 1;
  const comfort =
    (wNgs * rawScore(ngsOk ? ngsCurrent : undefined) +
      wSl * stormLeagueScore(slOk ? stormLeague : undefined) +
      wPrior * rawScore(priorOk ? ngsPrior : undefined)) /
    weightSum;

  const games =
    (ngsCurrent?.games ?? 0) +
    (stormLeague?.games ?? 0) * 0.25 +
    (ngsPrior?.games ?? 0) * 0.25;
  const playPct = Math.max(
    ngsCurrent?.playPct ?? 0,
    stormLeague?.playPct ?? 0,
    ngsPrior?.playPct ?? 0,
  );
  const winRate =
    ngsCurrent && ngsCurrent.games >= minGames.ngs
      ? ngsCurrent.winRate
      : stormLeague?.winRate ?? ngsPrior?.winRate ?? 0;

  return {
    hero,
    comfort,
    playPct,
    winRate,
    games: Math.round(games * 10) / 10,
    sources: {
      ngsCurrent,
      stormLeague,
      ngsPrior: includePrior ? ngsPrior : undefined,
    },
  };
}

export function heroStatsFromMap(
  map: Record<string, HeroStat> | undefined,
): Map<string, SourceHeroStat> {
  const out = new Map<string, SourceHeroStat>();
  if (!map) return out;
  let totalGames = 0;
  for (const stat of Object.values(map)) {
    totalGames += Number(stat.games_played) || 0;
  }
  for (const [hero, stat] of Object.entries(map)) {
    const games = Number(stat.games_played) || 0;
    const wins = Number(stat.wins) || 0;
    const source = toSource(games, wins, totalGames);
    if (source) out.set(hero, source);
  }
  return out;
}

export type NgsHeroAgg = {
  games: number;
  wins: number;
};

export function sourceMapGames(map: Map<string, SourceHeroStat>): number {
  let games = 0;
  for (const source of map.values()) games += source.games;
  return games;
}

/** Sum hero rows from several seasons and recompute each hero's share. */
export function mergeSourceMaps(
  maps: Array<Map<string, SourceHeroStat>>,
): Map<string, SourceHeroStat> {
  const agg = new Map<string, NgsHeroAgg>();
  for (const map of maps) {
    for (const [hero, source] of map) {
      const cur = agg.get(hero) ?? { games: 0, wins: 0 };
      cur.games += source.games;
      cur.wins += source.wins;
      agg.set(hero, cur);
    }
  }
  return aggregateToSourceMap(agg);
}

/**
 * Comfort for an NGS or Quick Match sample. A few league games should clear
 * the suggest bar; a single game should not.
 */
export function fallbackPoolScore(source?: SourceHeroStat): number {
  if (!source || source.games <= 0) return 0;
  const volume = 1 - Math.exp(-source.games / 3);
  const winRate = (source.wins + 1) / (source.games + 2);
  const quality = Math.max(0.4, Math.min(1.3, 1 + 2 * (winRate - 0.5)));
  return 0.35 * volume * quality;
}

export function aggregateToSourceMap(
  agg: Map<string, NgsHeroAgg>,
): Map<string, SourceHeroStat> {
  let total = 0;
  for (const v of agg.values()) total += v.games;
  const out = new Map<string, SourceHeroStat>();
  for (const [hero, v] of agg) {
    const source = toSource(v.games, v.wins, total);
    if (source) out.set(hero, source);
  }
  return out;
}

function comfortFromFallback(
  hero: string,
  ngsCurrent: SourceHeroStat | undefined,
  ngsPrior: SourceHeroStat | undefined,
  quickMatch: SourceHeroStat | undefined,
): ComfortHero {
  const { minGames } = leagueConfig;
  const ngs =
    ngsCurrent || ngsPrior
      ? {
          games: (ngsCurrent?.games ?? 0) + (ngsPrior?.games ?? 0),
          wins: (ngsCurrent?.wins ?? 0) + (ngsPrior?.wins ?? 0),
          losses: (ngsCurrent?.losses ?? 0) + (ngsPrior?.losses ?? 0),
          winRate: 0,
          playPct: 0,
        }
      : undefined;
  if (ngs && ngs.games > 0) ngs.winRate = ngs.wins / ngs.games;

  const ngsOk = ngs && ngs.games >= minGames.ngs;
  const qmOk = quickMatch && quickMatch.games >= minGames.ngs;
  const comfort = ngsOk
    ? fallbackPoolScore(ngs)
    : qmOk
      ? fallbackPoolScore(quickMatch) * 0.85
      : 0;
  const played = ngsOk ? ngs : qmOk ? quickMatch : undefined;

  return {
    hero,
    comfort,
    playPct: played?.playPct ?? 0,
    winRate: played?.winRate ?? 0,
    games: played?.games ?? 0,
    sources: {
      ngsCurrent,
      ngsPrior,
      quickMatch: qmOk ? quickMatch : undefined,
    },
  };
}

export function buildPlayerComfort(args: {
  battletag: string;
  preferredRole?: string | null;
  ngsCurrent: Map<string, SourceHeroStat>;
  stormLeague: Map<string, SourceHeroStat>;
  ngsPrior: Map<string, SourceHeroStat>;
  includePrior: boolean;
  /** Used only when recent Storm League is under the confident-pool bar. */
  quickMatch?: Map<string, SourceHeroStat>;
  ngsWins: number;
  ngsLosses: number;
  heroesProfileUrl: string;
  ngsProfileUrl: string;
  blizzId?: number | null;
}): PlayerScout {
  const stormLeagueThin =
    sourceMapGames(args.stormLeague) < leagueConfig.minGames.confidentPool;
  const quickMatch = stormLeagueThin
    ? (args.quickMatch ?? new Map<string, SourceHeroStat>())
    : new Map<string, SourceHeroStat>();

  const heroes = new Set<string>([
    ...args.ngsCurrent.keys(),
    ...(stormLeagueThin ? [] : args.stormLeague.keys()),
    ...(args.includePrior ? args.ngsPrior.keys() : []),
    ...quickMatch.keys(),
  ]);

  const scored: ComfortHero[] = [];
  for (const hero of heroes) {
    scored.push(
      stormLeagueThin
        ? comfortFromFallback(
            hero,
            args.ngsCurrent.get(hero),
            args.includePrior ? args.ngsPrior.get(hero) : undefined,
            quickMatch.get(hero),
          )
        : comfortFromSources(
            hero,
            args.ngsCurrent.get(hero),
            args.stormLeague.get(hero),
            args.ngsPrior.get(hero),
            args.includePrior,
          ),
    );
  }

  scored.sort((a, b) => b.comfort - a.comfort);
  // Draft suggestions may need a lower-ranked pocket for a specific open seat.
  // Call sites that present a compact player summary already slice this list.
  const topHeroes = scored.filter((h) => h.comfort > 0);

  const ngsGames = stormLeagueThin
    ? sourceMapGames(args.ngsCurrent) +
      (args.includePrior ? sourceMapGames(args.ngsPrior) : 0) +
      sourceMapGames(quickMatch)
    : args.ngsWins + args.ngsLosses;
  const confidence: PlayerScout["confidence"] =
    ngsGames >= 8 ? "high" : ngsGames >= 3 ? "medium" : "low";

  const roleFromHeroes =
    topHeroes[0] != null ? heroRole(topHeroes[0].hero) : null;

  return {
    battletag: args.battletag,
    blizzId: args.blizzId ?? null,
    preferredRole: args.preferredRole || roleFromHeroes,
    topHeroes,
    ngsWins: args.ngsWins,
    ngsLosses: args.ngsLosses,
    confidence,
    heroesProfileUrl: args.heroesProfileUrl,
    ngsProfileUrl: args.ngsProfileUrl,
    returningFromPrior: args.includePrior,
  };
}

/** Storm League games saved on this player's pool. Zero means the window came back empty. */
export function stormLeagueGames(player: PlayerScout): number {
  let games = 0;
  for (const hero of player.topHeroes) {
    games += hero.sources.stormLeague?.games ?? 0;
  }
  return games;
}

export function buildTeamThreats(players: PlayerScout[]): TeamThreat[] {
  const byHero = new Map<
    string,
    { comfort: number; players: string[]; maxComfort: number }
  >();

  for (const p of players) {
    for (const h of p.topHeroes.slice(0, 5)) {
      if (!comfortMeetsSuggestBar(h.comfort)) continue;
      const cur = byHero.get(h.hero) ?? {
        comfort: 0,
        players: [],
        maxComfort: 0,
      };
      cur.comfort += h.comfort;
      cur.maxComfort = Math.max(cur.maxComfort, h.comfort);
      cur.players.push(p.battletag);
      byHero.set(h.hero, cur);
    }
  }

  const threats: TeamThreat[] = [];
  for (const [hero, data] of byHero) {
    if (data.players.length >= 2) {
      threats.push({
        hero,
        comfort: data.comfort,
        playerCount: data.players.length,
        reason: `Shared comfort pick across ${data.players.length} players`,
      });
    } else if (comfortMeetsSuggestBar(data.maxComfort)) {
      threats.push({
        hero,
        comfort: data.maxComfort,
        playerCount: 1,
        reason: `Signature / high-comfort pocket (${data.players[0]?.split("#")[0]})`,
      });
    }
  }

  return threats.sort((a, b) => b.comfort - a.comfort).slice(0, 10);
}
