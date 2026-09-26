export const leagueConfig = {
  homeTeam: "Little Buff Boyz",
  division: "A",
  divisionConcat: "a",
  season: 22,
  priorSeason: 21,
  /** Storm League window start (NGS S22 regular season start) */
  stormLeagueStartDate: "2026-08-10",
  region: 1 as const,
  weights: {
    ngsCurrent: 0.55,
    stormLeague: 0.3,
    ngsPrior: 0.15,
  },
  minGames: {
    ngs: 2,
    stormLeague: 5,
    /** Min NGS draft comps before we trust draft archetype / first-pick %. */
    draftSample: 4,
  },
  /** Volatile scout data (rosters, profiles, Storm League). Replays stay until invalidated. */
  cacheTtlMs: 7 * 24 * 60 * 60 * 1000,
  ngsBaseUrl: "https://www.nexusgamingseries.org",
  /** Heroes Profile external API v1 */
  heroesProfileBaseUrl: "https://www.heroesprofile.com/api/external/v1",
  /** Region can be NA or 1 on v1 */
  regionName: "NA" as const,
} as const;

export type LeagueConfig = typeof leagueConfig;
