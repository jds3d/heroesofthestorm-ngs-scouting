export const leagueConfig = {
  homeTeam: "Little Buff Boyz",
  division: "A",
  divisionConcat: "a",
  season: 22,
  priorSeason: 21,
  /**
   * Storm League comfort uses this many months. Games inside the recent window
   * count fully; older games in the window count at `stormLeagueOlderWeight`.
   * A player under `minGames.confidentPool` in that window is read from older
   * NGS seasons, then Quick Match.
   */
  stormLeagueHistoryMonths: 24,
  /** Older NGS seasons to try when Storm League is too thin. */
  ngsSeasonLookback: 8,
  stormLeagueRecentMonths: 6,
  stormLeagueOlderWeight: 0.5,
  region: 1 as const,
  /**
   * Comfort blend when a hero has all three samples. NGS current is this
   * season's league games. Storm League's 30% is itself weighted toward the
   * recent window (`stormLeagueRecentMonths` at full credit, older games in
   * the history window at `stormLeagueOlderWeight`).
   */
  weights: {
    ngsCurrent: 0.5,
    stormLeague: 0.3,
    ngsPrior: 0.2,
  },
  minGames: {
    ngs: 2,
    stormLeague: 5,
    /** Recent Storm League games before we trust that pool over NGS history. */
    confidentPool: 30,
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
