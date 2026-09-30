import { leagueConfig, stormLeagueWindows } from "@/config/league";
import {
  HeroesProfileError,
  getNgsMatch,
  getGlobalHeroStats,
  getNgsPlayerProfile,
  getPlayerHeroAll,
  heroesProfilePlayerUrl,
  ngsHeroesProfileUrl,
  normalizeBattletag,
} from "@/lib/heroesprofile/client";
import type { HeroStat, NgsHeroRow } from "@/lib/heroesprofile/types";
import { getTeam, getTeamMatches, teamProfileUrl } from "@/lib/ngs/client";
import type { NgsMatch } from "@/lib/ngs/types";
import { buildAdaptPlan } from "@/lib/scoring/adapt";
import {
  buildPlayerComfort,
  buildTeamThreats,
  heroStatsFromMap,
} from "@/lib/scoring/comfort";
import { buildDraftInsights, type DraftMatchInput } from "@/lib/scoring/draft";
import type { ScoutReport, SourceHeroStat } from "@/lib/scoring/types";

function stormLeagueMap(
  response: Record<string, Record<string, HeroStat>>,
): Map<string, SourceHeroStat> {
  const sl =
    response["Storm League"] ||
    response["storm league"] ||
    Object.values(response)[0];
  return heroStatsFromMap(sl);
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
    getTeamMatches(teamName, leagueConfig.priorSeason).catch(
      () => [] as NgsMatch[],
    ),
  ]);

  let hpAuthBroken = false;
  let returningCount = 0;

  const players = await Promise.all(
    roster.map(async (battletag) => {
      let slMap = new Map<string, SourceHeroStat>();
      if (!hpAuthBroken) {
        try {
          const windows = stormLeagueWindows();
          const history = await getPlayerHeroAll(battletag, {
            gameType: "Storm League",
            startDate: windows.historyStart,
          });
          const recent = await getPlayerHeroAll(battletag, {
            gameType: "Storm League",
            startDate: windows.recentStart,
          });
          slMap = withRecent(stormLeagueMap(history), stormLeagueMap(recent));
        } catch (err) {
          if (err instanceof HeroesProfileError) {
            warnings.push(err.message);
            if (err.status === 401 || err.status === 403) hpAuthBroken = true;
          }
        }
      }

      let preferredRole: string | null = null;
      let ngsWins = 0;
      let ngsLosses = 0;
      let ngsCurrent = new Map<string, SourceHeroStat>();
      let ngsPrior = new Map<string, SourceHeroStat>();
      let includePrior = false;

      if (!hpAuthBroken) {
        try {
          const profile = await getNgsPlayerProfile(
            battletag,
            leagueConfig.season,
            leagueConfig.division,
          );
          preferredRole = profile.preferred_role ?? null;
          ngsWins = Number(profile.wins) || 0;
          ngsLosses = Number(profile.losses) || 0;
          ngsCurrent = heroRowsToSourceMap(profile.heroes ?? []);
          if (ngsCurrent.size === 0) {
            for (const hero of profile.top_three_heroes ?? []) {
              ngsCurrent.set(hero, {
                games: 2,
                wins: 1,
                losses: 1,
                winRate: 0.5,
                playPct: 0.33,
              });
            }
          }
        } catch (err) {
          if (err instanceof HeroesProfileError) {
            warnings.push(err.message);
            if (err.status === 401 || err.status === 403) hpAuthBroken = true;
          }
        }
      }

      if (!hpAuthBroken) {
        try {
          const prior = await getNgsPlayerProfile(
            battletag,
            leagueConfig.priorSeason,
            leagueConfig.division,
          );
          ngsPrior = heroRowsToSourceMap(prior.heroes ?? []);
          if (ngsPrior.size > 0 || Number(prior.wins) > 0) {
            includePrior = true;
            returningCount += 1;
          }
        } catch (err) {
          // Prior season missing is fine for new players.
          if (
            err instanceof HeroesProfileError &&
            (err.status === 401 || err.status === 403)
          ) {
            warnings.push(err.message);
            hpAuthBroken = true;
          }
        }
      }

      return buildPlayerComfort({
        battletag,
        preferredRole,
        ngsCurrent,
        stormLeague: slMap,
        ngsPrior,
        includePrior,
        ngsWins,
        ngsLosses,
        heroesProfileUrl: heroesProfilePlayerUrl(battletag),
        ngsProfileUrl: ngsHeroesProfileUrl(battletag),
      });
    }),
  );

  // Draft comps: one forever-cached pull per past game (prefers draft/ban APIs).
  const draftInputs: DraftMatchInput[] = [];
  const currentReported = currentMatches.filter((m) => m.reported);
  for (const match of currentReported) {
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
        if (err instanceof HeroesProfileError) {
          warnings.push(err.message);
          if (err.status === 401 || err.status === 403) hpAuthBroken = true;
        }
      }
    }
    draftInputs.push({ ngsMatch: match, hpMatch: hp, weight: 1 });
  }

  if (returningCount >= 3 && !hpAuthBroken) {
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
        if (err instanceof HeroesProfileError) {
          warnings.push(err.message);
          break;
        }
      }
    }
  }

  const threats = buildTeamThreats(players);
  const draft = buildDraftInsights(teamName, draftInputs, players);
  const meta = await getGlobalHeroStats().catch(() => []);
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
  if (draft.gamesAnalyzed > 0 && gamesWithHeroes === 0) {
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
  };
}
