import { leagueConfig, stormLeagueWindows } from "@/config/league";
import { isScoutBudgetExceeded } from "@/lib/scout/budget";
import {
  HeroesProfileError,
  getNgsMatch,
  getGlobalHeroStats,
  getNgsPlayerProfile,
  getPlayerHeroAll,
  getPlayerBlizzId,
  heroesProfilePlayerUrl,
  ngsHeroesProfileUrl,
  normalizeBattletag,
} from "@/lib/heroesprofile/client";
import type { HeroStat, NgsHeroRow } from "@/lib/heroesprofile/types";
import { getTeam, getTeamMatches, teamProfileUrl } from "@/lib/ngs/client";
import type { NgsMatch } from "@/lib/ngs/types";
import { buildAdaptPlan } from "@/lib/scoring/adapt";
import { buildDraftInsights, type DraftMatchInput } from "@/lib/scoring/draft";
import {
  buildPlayerComfort,
  buildTeamThreats,
  heroStatsFromMap,
  mergeSourceMaps,
  playerFromStormLeague,
  playerWithoutHistory,
  sourceMapGames,
} from "@/lib/scoring/comfort";
import { replayBattletag } from "@/lib/replay/battletags";
import type { PlayerScout, ScoutReport, SourceHeroStat } from "@/lib/scoring/types";

function heroAllMap(
  response: Record<string, Record<string, HeroStat>>,
  gameType: string,
): Map<string, SourceHeroStat> {
  const stats =
    response[gameType] ||
    response[gameType.toLowerCase()] ||
    Object.values(response)[0];
  return heroStatsFromMap(stats);
}

/** Full history totals, tagged with how much of it falls in the recent window. */
function withRecent(
  history: Map<string, SourceHeroStat>,
  recent: Map<string, SourceHeroStat>,
): Map<string, SourceHeroStat> {
  const out = new Map<string, SourceHeroStat>();
  for (const [hero, h] of history) {
    const r = recent.get(hero);
    out.set(hero, {
      ...h,
      recentGames: Math.min(r?.games ?? 0, h.games),
      recentWins: Math.min(r?.wins ?? 0, h.wins),
    });
  }
  return out;
}

/** Real hero rows only. A name-only top-three list is not a game sample. */
export function ngsCurrentFromProfile(profile: {
  heroes?: NgsHeroRow[];
  top_three_heroes?: string[];
}): Map<string, SourceHeroStat> {
  return heroRowsToSourceMap(profile.heroes ?? []);
}

/** Prefer ngs/player hero pool over per-game replay scraping. */

function heroRowsToSourceMap(rows: NgsHeroRow[]): Map<string, SourceHeroStat> {
  const total = rows.reduce((n, h) => n + (h.games_played || 0), 0);
  const out = new Map<string, SourceHeroStat>();
  for (const h of rows) {
    const games = h.games_played || 0;
    if (!h.name || games <= 0) continue;
    out.set(h.name, {
      games,
      wins: h.wins,
      losses: h.losses,
      winRate: games > 0 ? h.wins / games : 0,
      playPct: total > 0 ? games / total : 0,
    });
  }
  return out;
}

async function loadWindowedMode(
  battletag: string,
  gameType: string,
): Promise<Map<string, SourceHeroStat>> {
  const windows = stormLeagueWindows();
  const [historyRaw, recentRaw] = await Promise.all([
    getPlayerHeroAll(battletag, {
      gameType,
      startDate: windows.historyStart,
    }),
    getPlayerHeroAll(battletag, {
      gameType,
      startDate: windows.recentStart,
    }),
  ]);
  return withRecent(
    heroAllMap(historyRaw, gameType),
    heroAllMap(recentRaw, gameType),
  );
}

async function ngsSeasonMap(
  battletag: string,
  season: number,
): Promise<Map<string, SourceHeroStat> | null> {
  const profile = await getNgsPlayerProfile(
    battletag,
    season,
    leagueConfig.division,
  );
  const map = heroRowsToSourceMap(profile.heroes ?? []);
  return map.size > 0 ? map : null;
}

export async function generateScoutReport(
  teamName: string,
  starters?: string[],
): Promise<ScoutReport> {
  const warnings: string[] = [];
  const team = await getTeam(teamName);
  if (!team?.teamName) {
    throw new Error(`Team not found: ${teamName}`);
  }

  const want = new Set((starters ?? []).map((s) => s.toLowerCase()));
  const roster = (team.teamMembers ?? [])
    .map((m) => m.displayName)
    .filter((tag) => want.size === 0 || want.has(tag.toLowerCase()));

  const [currentMatches, priorMatches] = await Promise.all([
    getTeamMatches(teamName, leagueConfig.season),
    getTeamMatches(teamName, leagueConfig.priorSeason).catch((err) => {
      if (isScoutBudgetExceeded(err)) throw err;
      return [] as NgsMatch[];
    }),
  ]);

  let hpAuthBroken = false;
  let returningCount = 0;
  let incomplete = false;
  const stop = (err: unknown) => {
    if (!isScoutBudgetExceeded(err)) return false;
    incomplete = true;
    return true;
  };

  const players: PlayerScout[] = [];
  for (const battletag of roster) {
    if (hpAuthBroken) {
      players.push(
        buildPlayerComfort({
          battletag,
          ngsCurrent: new Map(),
          stormLeague: new Map(),
          ngsPrior: new Map(),
          includePrior: false,
          ngsWins: 0,
          ngsLosses: 0,
          blizzId: null,
          heroesProfileUrl: heroesProfilePlayerUrl(battletag, null),
          ngsProfileUrl: ngsHeroesProfileUrl(battletag, null),
        }),
      );
      continue;
    }
    players.push(await (async () => {
      let slMap = new Map<string, SourceHeroStat>();
      if (!hpAuthBroken && !incomplete) {
        try {
          slMap = await loadWindowedMode(battletag, "Storm League");
        } catch (err) {
          if (stop(err)) {
            /* keep the pools already loaded */
          } else if (err instanceof HeroesProfileError) {
            warnings.push(err.message);
            if (err.status === 401 || err.status === 403) hpAuthBroken = true;
          }
        }
      }

      const stormLeagueThin =
        sourceMapGames(slMap) < leagueConfig.minGames.confidentPool;

      let preferredRole: string | null = null;
      let ngsWins = 0;
      let ngsLosses = 0;
      let ngsCurrent = new Map<string, SourceHeroStat>();
      let ngsPrior = new Map<string, SourceHeroStat>();
      let includePrior = false;

      if (!hpAuthBroken && !incomplete) {
        try {
          const profile = await getNgsPlayerProfile(
            battletag,
            leagueConfig.season,
            leagueConfig.division,
          );
          preferredRole = profile.preferred_role ?? null;
          ngsWins = Number(profile.wins) || 0;
          ngsLosses = Number(profile.losses) || 0;
          ngsCurrent = ngsCurrentFromProfile(profile);
        } catch (err) {
          if (stop(err)) {
            /* keep the pools already loaded */
          } else if (err instanceof HeroesProfileError) {
            warnings.push(err.message);
            if (err.status === 401 || err.status === 403) hpAuthBroken = true;
          }
        }
      }

      if (!hpAuthBroken && !incomplete) {
        try {
          const prior = await ngsSeasonMap(battletag, leagueConfig.priorSeason);
          if (prior) {
            ngsPrior = prior;
            includePrior = true;
            returningCount += 1;
          }
        } catch (err) {
          if (stop(err)) {
            /* keep the pools already loaded */
          } else if (
            err instanceof HeroesProfileError &&
            (err.status === 401 || err.status === 403)
          ) {
            warnings.push(err.message);
            hpAuthBroken = true;
          }
        }
      }

      if (stormLeagueThin && !hpAuthBroken && !incomplete) {
        let emptyStreak = ngsPrior.size === 0 ? 1 : 0;
        const floor = Math.max(
          1,
          leagueConfig.season - leagueConfig.ngsSeasonLookback,
        );
        for (
          let season = leagueConfig.priorSeason - 1;
          season >= floor && emptyStreak < 2;
          season -= 1
        ) {
          const covered =
            sourceMapGames(ngsCurrent) + sourceMapGames(ngsPrior);
          if (covered >= leagueConfig.minGames.confidentPool) break;
          try {
            const older = await ngsSeasonMap(battletag, season);
            if (!older) {
              emptyStreak += 1;
              continue;
            }
            emptyStreak = 0;
            ngsPrior = mergeSourceMaps([ngsPrior, older]);
            includePrior = true;
          } catch (err) {
            if (stop(err)) break;
            if (
              err instanceof HeroesProfileError &&
              (err.status === 401 || err.status === 403)
            ) {
              warnings.push(err.message);
              hpAuthBroken = true;
              break;
            }
            emptyStreak += 1;
          }
        }
      }

      let quickMatch = new Map<string, SourceHeroStat>();
      const ngsPool =
        sourceMapGames(ngsCurrent) +
        (includePrior ? sourceMapGames(ngsPrior) : 0);
      if (
        stormLeagueThin &&
        ngsPool < leagueConfig.minGames.confidentPool &&
        !hpAuthBroken &&
        !incomplete
      ) {
        try {
          quickMatch = await loadWindowedMode(battletag, "Quick Match");
        } catch (err) {
          if (stop(err)) {
            /* keep the pools already loaded */
          } else if (err instanceof HeroesProfileError) {
            warnings.push(err.message);
            if (err.status === 401 || err.status === 403) hpAuthBroken = true;
          }
        }
      }

      if (
        !incomplete &&
        stormLeagueThin &&
        ngsPool + sourceMapGames(quickMatch) === 0 &&
        sourceMapGames(slMap) === 0
      ) {
        warnings.push(
          `${battletag}: no Storm League, NGS, or Quick Match hero pool.`,
        );
      }

      let blizzId: number | null = null;
      if (!hpAuthBroken && !incomplete) {
        try {
          blizzId = await getPlayerBlizzId(battletag);
        } catch (err) {
          if (!stop(err)) throw err;
        }
      }
      return buildPlayerComfort({
        battletag,
        preferredRole,
        ngsCurrent,
        stormLeague: slMap,
        ngsPrior,
        includePrior,
        quickMatch,
        ngsWins,
        ngsLosses,
        blizzId,
        heroesProfileUrl: heroesProfilePlayerUrl(battletag, blizzId),
        ngsProfileUrl: ngsHeroesProfileUrl(battletag, blizzId),
      });
    })());
  }

  // Draft comps: one forever-cached pull per past game (prefers draft/ban APIs).
  const draftInputs: DraftMatchInput[] = [];
  const currentReported = currentMatches.filter((m) => m.reported);
  for (const match of currentReported) {
    if (incomplete) break;
    let hp = null;
    if (!hpAuthBroken) {
      try {
        hp = await getNgsMatch(
          teamName,
          match.round,
          leagueConfig.season,
          leagueConfig.division,
        );
      } catch (err) {
        if (stop(err)) break;
        if (err instanceof HeroesProfileError) {
          warnings.push(err.message);
          if (err.status === 401 || err.status === 403) hpAuthBroken = true;
        }
      }
    }
    draftInputs.push({ ngsMatch: match, hpMatch: hp, weight: 1 });
  }

  if (returningCount >= 3 && !hpAuthBroken && !incomplete) {
    for (const match of priorMatches.filter((m) => m.reported).slice(0, 6)) {
      try {
        const hp = await getNgsMatch(
          teamName,
          match.round,
          leagueConfig.priorSeason,
          leagueConfig.division,
        );
        draftInputs.push({ ngsMatch: match, hpMatch: hp, weight: 0.25 });
      } catch (err) {
        if (stop(err)) break;
        if (err instanceof HeroesProfileError) {
          warnings.push(err.message);
          break;
        }
      }
    }
  }

  const threats = buildTeamThreats(players);
  const draft = buildDraftInsights(teamName, draftInputs, players);
  let meta: Awaited<ReturnType<typeof getGlobalHeroStats>> = [];
  if (!incomplete) {
    try {
      meta = await getGlobalHeroStats();
    } catch (err) {
      if (!stop(err)) meta = [];
    }
  }
  const adapt = buildAdaptPlan(players, threats, draft, meta);

  const gamesWithHeroes = draftInputs.reduce((n, d) => {
    if (!d.hpMatch?.match_data) return n;
    return (
      n +
      Object.values(d.hpMatch.match_data).filter(
        (g) => (g.team_heroes?.length ?? 0) > 0,
      ).length
    );
  }, 0);
  if (!incomplete && draft.gamesAnalyzed > 0 && gamesWithHeroes === 0) {
    warnings.push(
      "Past-game draft comps were unavailable (quota or empty). Replays/drafts are forever-cached once fetched — retry after weekly reset.",
    );
  }

  return {
    teamName: team.teamName,
    ticker: team.ticker,
    captain: team.captain,
    hpMmrAvg: team.hpMmrAvg ?? null,
    division: team.divisionDisplayName ?? leagueConfig.division,
    season: leagueConfig.season,
    profileUrl: teamProfileUrl(team.teamName),
    roster: players,
    threats,
    draft,
    adapt,
    generatedAt: new Date().toISOString(),
    reportedMatchIds: currentMatches
      .filter((m) => m.reported)
      .map((m) => m.matchId),
    warnings: [...new Set(warnings)],
    ...(incomplete ? { incomplete: true as const } : {}),
  };
}

/**
 * Storm League hero pools for battletags or display names.
 * A bare name uses the most recent shared replay. No history comes back with comfort 0.
 */
async function loadOneStormLeaguePlayer(shown: string): Promise<PlayerScout> {
  const tag = shown.includes("#") ? shown : replayBattletag(shown);
  if (!tag) return playerWithoutHistory(shown);
  try {
    const storm = await loadWindowedMode(tag, "Storm League");
    if (sourceMapGames(storm) <= 0) return playerWithoutHistory(shown);
    const player = playerFromStormLeague(tag, storm);
    player.heroesProfileUrl = heroesProfilePlayerUrl(tag);
    return player;
  } catch (err) {
    if (
      err instanceof HeroesProfileError &&
      (err.status === 401 || err.status === 403)
    ) {
      throw err;
    }
    return playerWithoutHistory(shown);
  }
}

export async function loadStormLeaguePlayers(
  tags: string[],
): Promise<PlayerScout[]> {
  const seen = new Set<string>();
  const jobs: Promise<PlayerScout>[] = [];
  for (const raw of tags) {
    const shown = raw.trim();
    const name = shown.split("#")[0]?.trim().toLowerCase() ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    jobs.push(loadOneStormLeaguePlayer(shown));
  }
  return Promise.all(jobs);
}
