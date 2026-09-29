import { leagueConfig } from "@/config/league";
import {
  invalidateCached,
  readCacheEntry,
  readNewestCacheByPrefix,
  setCached,
} from "@/lib/cache";
import {
  getTeam,
  getTeamMatches,
  teamMatchesCacheKey,
} from "@/lib/ngs/client";
import {
  HeroesProfileError,
} from "@/lib/heroesprofile/client";
import type { PlayerScout, ScoutReport } from "@/lib/scoring/types";
import { runWithApiUsage } from "@/lib/apiUsage";
import { predictScoutCalls } from "@/lib/scout/estimateCalls";
import { generateScoutReport } from "@/lib/scout/pipeline";

/** Roster from a saved home-team scout, including a lineup-scoped cache key. */
export async function loadSavedHomeRoster(
  teamName: string,
): Promise<PlayerScout[] | null> {
  const report = await loadSavedHomeReport(teamName);
  return report?.roster?.length ? report.roster : null;
}

/** Full saved home scout — used for map records vs the opponent. */
export async function loadSavedHomeReport(
  teamName: string,
): Promise<ScoutReport | null> {
  const exact = await readCacheEntry<ScoutReport>(reportKey(teamName));
  if (exact?.data) return exact.data;
  const newest = await readNewestCacheByPrefix<ScoutReport>(reportKey(teamName));
  return newest?.data ?? null;
}

export const reportKey = (teamName: string, starters?: string[]) => {
  const base = `scout-report-${teamName}`;
  if (!starters?.length) return base;
  return `${base}::${[...starters].sort((a, b) => a.localeCompare(b)).join("|")}`;
};

/**
 * Drop volatile hero/player sources so the next generate re-pulls them.
 * Never touches forever-cached past games / replays / drafts / bans,
 * and never touches prior-season NGS profiles (those are frozen).
 */
async function refreshHeroPlayerData(teamName: string): Promise<void> {
  await invalidateCached(`ngs-team-${teamName}`);
  const team = await getTeam(teamName);
  const tags = (team.teamMembers ?? []).map((m) => m.displayName);
  const season = leagueConfig.season;
  const division = leagueConfig.division;
  for (const tag of tags) {
    await invalidateCached(
      `hp-v1-ngs-profile-${tag}-s${season}-${division}`,
    );
    await invalidateCached(`hp-v1-hero-all-${tag}`);
  }
  await invalidateCached(
    `hp-v1-ngs-team-matches-s${season}-${division}-${teamName}`,
  );
  await invalidateCached(teamMatchesCacheKey(teamName, season));
  await invalidateCached(reportKey(teamName));
}

/**
 * Always rebuild the scout from source data (cached replays + profiles).
 * When `refreshPlayerData` is set, also re-pull team / NGS profiles / Storm League.
 */
export async function loadScoutReport(
  teamName: string,
  opts?: { refreshPlayerData?: boolean; starters?: string[] },
): Promise<ScoutReport> {
  const refreshPlayerData = Boolean(opts?.refreshPlayerData);
  const starters = opts?.starters?.filter(Boolean);
  const predicted = await predictScoutCalls(teamName, {
    refreshPlayerData,
    starters,
  });
  const { result, actual } = await runWithApiUsage(() =>
    buildScoutReport(teamName, refreshPlayerData, starters),
  );
  return { ...result, apiUsage: { predicted, actual } };
}

async function buildScoutReport(
  teamName: string,
  refreshPlayerData: boolean,
  starters?: string[],
): Promise<ScoutReport> {
  const entry = await readCacheEntry<ScoutReport>(reportKey(teamName, starters));
  const fallback = entry?.data ?? null;

  try {
    if (refreshPlayerData) {
      await refreshHeroPlayerData(teamName);
    }

    // Force a live NGS schedule pull only when "Refresh hero & player data"
    // is checked. Otherwise the 24h cache is enough.
    if (refreshPlayerData) {
      await getTeamMatches(teamName, leagueConfig.season, { fresh: true });
    }

    const report = await generateScoutReport(teamName, starters);
    await setCached(
      reportKey(teamName, starters),
      report,
      leagueConfig.reportTtlMs,
    );
    return report;
  } catch (err) {
    if (err instanceof HeroesProfileError) {
      throw err;
    }
    if (!fallback) throw err;
    const message = err instanceof Error ? err.message : "Refresh failed";
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `Refresh failed (${message}); showing the last saved report.`,
      ],
    };
  }
}
