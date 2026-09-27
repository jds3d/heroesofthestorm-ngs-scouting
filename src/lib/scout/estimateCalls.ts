import { leagueConfig } from "@/config/league";
import { divePlaybook } from "@/config/divePlaybook";
import {
  type ApiCallCount,
  type ApiCallKind,
  countsFromMap,
} from "@/lib/apiUsage";
import { FOREVER, cacheHas, getCached, readCacheEntry } from "@/lib/cache";
import {
  countPendingMatchupCalls,
  globalHeroMapStatsKey,
  globalHeroStatsKey,
} from "@/lib/heroesprofile/client";
import type { NgsTeam } from "@/lib/ngs/types";
import type { NgsPlayerProfile } from "@/lib/heroesprofile/types";
import type { HpReplayData } from "@/lib/heroesprofile/types";
import {
  extractHpReplayIds,
  getTeam,
  getTeamMatches,
  teamMatchesCacheKey,
} from "@/lib/ngs/client";
import type { NgsMatch } from "@/lib/ngs/types";
import { draftHeroPool } from "@/lib/scout/draftHeroPool";
import type { ScoutReport } from "@/lib/scoring/types";
import { heroKey } from "@/lib/scoring/heroMeta";

const reportCacheKey = (teamName: string, starters?: string[]) => {
  const base = `scout-report-${teamName}`;
  if (!starters?.length) return base;
  return `${base}::${[...starters].sort((a, b) => a.localeCompare(b)).join("|")}`;
};

/** Same heroes the post-scout matchup pass will request — not the whole dive book. */
async function matchupHeroesForEstimate(
  teamName: string,
  starters?: string[],
): Promise<string[]> {
  const saved = await readCacheEntry<ScoutReport>(
    reportCacheKey(teamName, starters),
  );
  if (saved?.data) {
    const fromReport = draftHeroPool(saved.data);
    if (fromReport.length) return fromReport;
  }

  const names = new Set<string>([...divePlaybook.priorityDiveCores]);
  let team = await getCached<NgsTeam>(`ngs-team-${teamName}`);
  if (!team) team = await getTeam(teamName).catch(() => null);
  const starterSet = new Set((starters ?? []).map((s) => s.toLowerCase()));
  const tags = (team?.teamMembers ?? [])
    .map((m) => m.displayName)
    .filter((tag) => starterSet.size === 0 || starterSet.has(tag.toLowerCase()));

  for (const tag of tags) {
    const cur = `hp-v1-ngs-profile-${tag}-s${leagueConfig.season}-${leagueConfig.division}`;
    const profile = await getCached<NgsPlayerProfile>(cur);
    for (const h of profile?.heroes?.slice(0, 3) ?? []) {
      if (h.name) names.add(h.name);
    }
  }

  const home = await readCacheEntry<ScoutReport>(
    reportCacheKey(leagueConfig.homeTeam),
  );
  if (home?.data) {
    for (const h of draftHeroPool(home.data)) names.add(h);
  }

  const byKey = new Map<string, string>();
  for (const h of names) {
    const k = heroKey(h);
    if (!byKey.has(k)) byKey.set(k, h);
  }
  return [...byKey.values()];
}

async function replayNeedsFetch(id: number): Promise<"cached" | "bans" | "full"> {
  const replay = await getCached<HpReplayData>(`hp-v1-ngs-replay-${id}`, FOREVER);
  if (replay?.players?.length) {
    return (await cacheHas(`hp-v1-replay-ban-${id}`)) ? "cached" : "bans";
  }
  return "full";
}

async function roundIsCached(
  teamName: string,
  season: number,
  round: number,
): Promise<boolean> {
  const key = `hp-v1-ngs-match-s${season}-${leagueConfig.division}-${teamName}-r${round}`;
  const cached = await getCached<{
    match_data?: Record<string, { team_heroes?: string[] }>;
  }>(key, FOREVER);
  if (!cached?.match_data) return false;
  return Object.values(cached.match_data).some(
    (g) => (g.team_heroes?.length ?? 0) > 0,
  );
}

/**
 * What the next scout will call. Generate always rebuilds the report; only
 * missing source data (or a player-data refresh) produces API calls.
 */
export async function predictScoutCalls(
  teamName: string,
  opts?: { refreshPlayerData?: boolean; starters?: string[] },
): Promise<ApiCallCount[]> {
  const refreshPlayerData = Boolean(opts?.refreshPlayerData);
  const starterSet = new Set((opts?.starters ?? []).map((s) => s.toLowerCase()));
  const counts = new Map<ApiCallKind, number>();
  const add = (kind: ApiCallKind, n = 1) =>
    counts.set(kind, (counts.get(kind) ?? 0) + n);

  if (!(await cacheHas(globalHeroStatsKey))) add("hp-global-heroes", 2);
  if (!(await cacheHas(globalHeroMapStatsKey))) add("hp-global-heroes", 1);

  // Matchups: only heroes this scout's draft pool needs, and only if TTL-stale.
  const matchupProbe = await matchupHeroesForEstimate(
    teamName,
    opts?.starters,
  );
  const pendingMatchups = await countPendingMatchupCalls(matchupProbe);
  if (pendingMatchups > 0) add("hp-hero-matchups", pendingMatchups);

  // Current-season NGS schedule: 24h cache. Count a live pull only on
  // refresh or cache miss.
  const seasonKey = teamMatchesCacheKey(teamName, leagueConfig.season);
  const seasonCached = await cacheHas(seasonKey);
  if (refreshPlayerData || !seasonCached) add("ngs-schedule", 1);
  const matches = await getTeamMatches(teamName, leagueConfig.season, {
    fresh: refreshPlayerData,
  });

  const reported = matches.filter((m) => m.reported);

  let team = await getCached<NgsTeam>(`ngs-team-${teamName}`);
  if (!team) team = await getTeam(teamName).catch(() => null);
  if (refreshPlayerData || !team) add("ngs-team");

  const tags = (team?.teamMembers ?? [])
    .map((m) => m.displayName)
    .filter((tag) => starterSet.size === 0 || starterSet.has(tag.toLowerCase()));

  const priorKey = teamMatchesCacheKey(teamName, leagueConfig.priorSeason);
  const priorCached = await getCached<NgsMatch[]>(priorKey, FOREVER);
  if (refreshPlayerData || !priorCached) add("ngs-schedule");
  if (!priorCached) {
    await getTeamMatches(teamName, leagueConfig.priorSeason).catch(() => []);
  }

  for (const tag of tags) {
    const slKey = `hp-v1-hero-all-${tag}-Storm League-${leagueConfig.stormLeagueStartDate}`;
    if (refreshPlayerData || !(await cacheHas(slKey))) add("hp-storm-league");
    // Current + prior season profiles (pipeline always asks for both).
    if (refreshPlayerData) {
      add("hp-ngs-player", 2);
    } else {
      const cur = `hp-v1-ngs-profile-${tag}-s${leagueConfig.season}-${leagueConfig.division}`;
      const prior = `hp-v1-ngs-profile-${tag}-s${leagueConfig.priorSeason}-${leagueConfig.division}`;
      if (!(await cacheHas(cur))) add("hp-ngs-player");
      if (!(await cacheHas(prior))) add("hp-ngs-player");
    }
  }

  await addRoundCalls(
    counts,
    teamName,
    leagueConfig.season,
    reported,
    refreshPlayerData,
  );

  const priorReturning = await countCachedReturning(tags);
  if (priorReturning >= 3 && priorCached) {
    const priorReported = priorCached.filter((m) => m.reported).slice(0, 6);
    await addRoundCalls(
      counts,
      teamName,
      leagueConfig.priorSeason,
      priorReported,
      false,
    );
  }

  return countsFromMap(counts);
}

async function countCachedReturning(tags: string[]): Promise<number> {
  let n = 0;
  for (const tag of tags) {
    const key = `hp-v1-ngs-profile-${tag}-s${leagueConfig.priorSeason}-${leagueConfig.division}`;
    const profile = await getCached<NgsPlayerProfile>(key, FOREVER);
    if (!profile) continue;
    if ((profile.heroes?.length ?? 0) > 0 || Number(profile.wins) > 0) n += 1;
  }
  return n;
}

async function addRoundCalls(
  counts: Map<ApiCallKind, number>,
  teamName: string,
  season: number,
  reported: NgsMatch[],
  forceListRefresh = false,
): Promise<void> {
  const add = (kind: ApiCallKind, n = 1) =>
    counts.set(kind, (counts.get(kind) ?? 0) + n);
  let needList = false;
  for (const match of reported) {
    if (!forceListRefresh && (await roundIsCached(teamName, season, match.round))) {
      continue;
    }
    needList = true;
    for (const id of extractHpReplayIds(match)) {
      // Never force re-download of forever-cached replays.
      const state = await replayNeedsFetch(id);
      if (state === "full") {
        add("hp-replay-draft");
        add("hp-replay-bans", 2);
      } else if (state === "bans") {
        add("hp-replay-bans");
      }
    }
  }
  if (needList) {
    const listKey = `hp-v1-ngs-team-matches-s${season}-${leagueConfig.division}-${teamName}`;
    const listCached =
      forceListRefresh || season === leagueConfig.season
        ? false
        : await cacheHas(listKey);
    if (!listCached) add("hp-team-matches");
  }
}
