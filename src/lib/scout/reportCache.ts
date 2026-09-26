import { leagueConfig } from "@/config/league";
import {
  cacheHas,
  invalidateCached,
  readCacheEntry,
  readNewestCacheByPrefix,
  setCached,
} from "@/lib/cache";
import {
  extractHpReplayIds,
  getTeam,
  getTeamMatches,
  teamMatchesCacheKey,
} from "@/lib/ngs/client";
import type { NgsMatch } from "@/lib/ngs/types";
import type { PlayerScout, ScoutReport } from "@/lib/scoring/types";
import { runWithApiUsage } from "@/lib/apiUsage";
import { predictScoutCalls } from "@/lib/scout/estimateCalls";
import { generateScoutReport } from "@/lib/scout/pipeline";

/** Roster from a saved home-team scout, including a lineup-scoped cache key. */
export async function loadSavedHomeRoster(
  teamName: string,
): Promise<PlayerScout[] | null> {
  const exact = await readCacheEntry<ScoutReport>(reportKey(teamName));
  if (exact?.data.roster?.length) return exact.data.roster;
  const newest = await readNewestCacheByPrefix<ScoutReport>(reportKey(teamName));
  if (newest?.data.roster?.length) return newest.data.roster;
  return null;
}

const reportKey = (teamName: string, starters?: string[]) => {
  const base = `scout-report-${teamName}`;
  if (!starters?.length) return base;
  return `${base}::${[...starters].sort((a, b) => a.localeCompare(b)).join("|")}`;
};

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}

async function missingReplay(ids: number[]): Promise<boolean> {
  for (const id of ids) {
    if (!(await cacheHas(`hp-v1-ngs-replay-${id}`))) return true;
  }
  return false;
}

async function invalidateSources(
  teamName: string,
  opts: { stormLeague: boolean },
): Promise<void> {
  if (opts.stormLeague) {
    await invalidateCached(`ngs-team-${teamName}`);
  }
  const team = await getTeam(teamName);
  const tags = (team.teamMembers ?? []).map((m) => m.displayName);
  for (const tag of tags) {
    await invalidateCached(`hp-v1-ngs-profile-${tag}`);
    if (opts.stormLeague) {
      await invalidateCached(`hp-v1-hero-all-${tag}`);
    }
  }
  const season = leagueConfig.season;
  const division = leagueConfig.division;
  // Do NOT invalidate forever-cached past games / replays / drafts.
  await invalidateCached(
    `hp-v1-ngs-team-matches-s${season}-${division}-${teamName}`,
  );
}

/**
 * Return a saved scout when it is under a week old and already includes
 * every reported NGS game. Otherwise rebuild, reusing cached replays and
 * only fetching games, profiles, or Storm League stats that are missing.
 */
export async function loadScoutReport(
  teamName: string,
  opts?: { ignoreCache?: boolean; starters?: string[] },
): Promise<ScoutReport> {
  const ignoreCache = Boolean(opts?.ignoreCache);
  const starters = opts?.starters?.filter(Boolean);
  const predicted = await predictScoutCalls(teamName, { ignoreCache, starters });
  const { result, actual } = await runWithApiUsage(() =>
    buildScoutReport(teamName, ignoreCache, starters),
  );
  return { ...result, apiUsage: { predicted, actual } };
}

async function dropSavedScout(
  teamName: string,
  matches: NgsMatch[],
): Promise<void> {
  await invalidateCached(`ngs-team-${teamName}`);
  const team = await getTeam(teamName);
  const tags = (team.teamMembers ?? []).map((m) => m.displayName);
  await invalidateCached(reportKey(teamName));
  await invalidateCached(teamMatchesCacheKey(teamName, leagueConfig.season));
  await invalidateCached(
    teamMatchesCacheKey(teamName, leagueConfig.priorSeason),
  );
  for (const season of [leagueConfig.season, leagueConfig.priorSeason]) {
    await invalidateCached(
      `hp-v1-ngs-team-matches-s${season}-${leagueConfig.division}-${teamName}`,
    );
    await invalidateCached(
      `hp-v1-ngs-match-s${season}-${leagueConfig.division}-${teamName}-`,
    );
  }
  for (const tag of tags) {
    await invalidateCached(`hp-v1-ngs-profile-${tag}`);
    await invalidateCached(`hp-v1-hero-all-${tag}`);
  }
  for (const match of matches) {
    for (const id of extractHpReplayIds(match)) {
      await invalidateCached(`hp-v1-ngs-replay-${id}`);
      await invalidateCached(`hp-v1-replay-ban-${id}`);
    }
  }
}

async function buildScoutReport(
  teamName: string,
  ignoreCache: boolean,
  starters?: string[],
): Promise<ScoutReport> {
  const matches = await getTeamMatches(teamName, leagueConfig.season, {
    fresh: true,
  });
  const reportedIds = matches.filter((m) => m.reported).map((m) => m.matchId);
  const replayIds = matches
    .filter((m) => m.reported)
    .flatMap((m) => extractHpReplayIds(m));

  const entry = await readCacheEntry<ScoutReport>(reportKey(teamName, starters));
  const cached = entry?.fresh ? entry.data : null;
  const covered =
    cached != null && sameIds(cached.reportedMatchIds ?? [], reportedIds);
  const needsReplay = await missingReplay(replayIds);

  if (!ignoreCache && cached && covered && !needsReplay) {
    return cached;
  }

  const fallback = ignoreCache ? null : (entry?.data ?? null);
  try {
    if (ignoreCache) {
      const prior = await getTeamMatches(teamName, leagueConfig.priorSeason, {
        fresh: true,
      }).catch(() => [] as NgsMatch[]);
      await dropSavedScout(teamName, [...matches, ...prior]);
    } else {
      await invalidateSources(teamName, { stormLeague: !cached });
    }
    await setCached(
      teamMatchesCacheKey(teamName, leagueConfig.season),
      matches,
      leagueConfig.cacheTtlMs,
    );
    const report = await generateScoutReport(teamName, starters);
    await setCached(reportKey(teamName, starters), report, leagueConfig.cacheTtlMs);
    return report;
  } catch (err) {
    if (!fallback) throw err;
    const message = err instanceof Error ? err.message : "Refresh failed";
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `Refresh failed (${message}); showing the saved report.`,
      ],
    };
  }
}
