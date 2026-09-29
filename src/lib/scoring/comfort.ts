import { leagueConfig } from "@/config/league";
import type { HeroStat } from "@/lib/heroesprofile/types";
import { heroRole } from "@/lib/scoring/heroMeta";
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
      wSl * rawScore(slOk ? stormLeague : undefined) +
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

export function buildPlayerComfort(args: {
  battletag: string;
  preferredRole?: string | null;
  ngsCurrent: Map<string, SourceHeroStat>;
  stormLeague: Map<string, SourceHeroStat>;
  ngsPrior: Map<string, SourceHeroStat>;
  includePrior: boolean;
  ngsWins: number;
  ngsLosses: number;
  heroesProfileUrl: string;
  ngsProfileUrl: string;
}): PlayerScout {
  const heroes = new Set<string>([
    ...args.ngsCurrent.keys(),
    ...args.stormLeague.keys(),
    ...(args.includePrior ? args.ngsPrior.keys() : []),
  ]);

  const scored: ComfortHero[] = [];
  for (const hero of heroes) {
    scored.push(
      comfortFromSources(
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

  const ngsGames = args.ngsWins + args.ngsLosses;
  const confidence: PlayerScout["confidence"] =
    ngsGames >= 8 ? "high" : ngsGames >= 3 ? "medium" : "low";

  const roleFromHeroes =
    topHeroes[0] != null ? heroRole(topHeroes[0].hero) : null;

  return {
    battletag: args.battletag,
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

export function buildTeamThreats(players: PlayerScout[]): TeamThreat[] {
  const byHero = new Map<
    string,
    { comfort: number; players: string[]; maxComfort: number }
  >();

  for (const p of players) {
    for (const h of p.topHeroes.slice(0, 5)) {
      if (h.comfort < 0.02) continue;
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
    } else if (data.maxComfort >= 0.12) {
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
