export const leagueConfig = {
  homeTeam: "Little Buff Boyz",
  division: "A",
  divisionConcat: "a",
  season: 22,
  priorSeason: 21,
  /**
   * Storm League comfort history. Games inside the recent window count fully;
   * older games count at `stormLeagueOlderWeight`.
   */
  stormLeagueHistoryMonths: 24,
  stormLeagueRecentMonths: 6,
  stormLeagueOlderWeight: 0.5,
  region: 1 as const,
  /** Storm League is the real comfort read; NGS shows what they bring to league night. */
  weights: {
    ngsCurrent: 0.35,
    stormLeague: 0.55,
    ngsPrior: 0.1,
  },
  minGames: {
    ngs: 2,
    stormLeague: 5,
    /** Min NGS draft comps before we trust draft archetype / first-pick %. */
    draftSample: 4,
  },
  /** Volatile scout data (rosters, profiles, Storm League). Replays stay until invalidated. */
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** NGS current-season schedule freshness. */
  scheduleTtlMs: 24 * 60 * 60 * 1000,
  /** Scout report JSON freshness (rebuilds scoring; sources may be forever). */
  reportTtlMs: 7 * 24 * 60 * 60 * 1000,
  ngsBaseUrl: "https://www.nexusgamingseries.org",
  /** Heroes Profile external API v1 */
  heroesProfileBaseUrl: "https://www.heroesprofile.com/api/external/v1",
  /** Region can be NA or 1 on v1 */
  regionName: "NA" as const,
} as const;

export type LeagueConfig = typeof leagueConfig;

/** Month-aligned so cache keys stay stable for a whole month. */
function monthsAgoStart(months: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().slice(0, 10);
}

export function stormLeagueWindows(now: Date = new Date()): {
  historyStart: string;
  recentStart: string;
} {
  return {
    historyStart: monthsAgoStart(leagueConfig.stormLeagueHistoryMonths, now),
    recentStart: monthsAgoStart(leagueConfig.stormLeagueRecentMonths, now),
  };
}
