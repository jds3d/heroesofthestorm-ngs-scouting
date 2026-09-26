import { leagueConfig } from "@/config/league";
import {
  API_CALL_KINDS,
  type ApiCallCount,
  type ApiCallKind,
  countsFromMap,
} from "@/lib/apiUsage";
import { FOREVER, cacheHas, getCached } from "@/lib/cache";
import { globalHeroStatsKey } from "@/lib/heroesprofile/client";
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
import { readCacheEntry } from "@/lib/cache";

const reportKey = (teamName: string) => `scout-report-${teamName}`;

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
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

/** What the next scout will call, based on cache. Does not include this check's own schedule fetch. */
export async function predictScoutCalls(
  teamName: string,
  opts?: { ignoreCache?: boolean; starters?: string[] },
): Promise<ApiCallCount[]> {
  const ignoreCache = Boolean(opts?.ignoreCache);
  const starterSet = new Set((opts?.starters ?? []).map((s) => s.toLowerCase()));
  const counts = new Map<ApiCallKind, number>();
  const add = (kind: ApiCallKind, n = 1) =>
    counts.set(kind, (counts.get(kind) ?? 0) + n);

  if (!(await cacheHas(globalHeroStatsKey))) add("hp-global-heroes", 2);

  const matches = await getTeamMatches(teamName, leagueConfig.season, {
    fresh: true,
  });
  add("ngs-schedule", 1);

  const reported = matches.filter((m) => m.reported);
  const reportedIds = reported.map((m) => m.matchId);
  const replayIds = reported.flatMap((m) => extractHpReplayIds(m));
  const entry = await readCacheEntry<{ reportedMatchIds?: string[] }>(
    reportKey(teamName),
  );
  const cached = entry?.fresh ? entry.data : null;
  const covered =
    cached != null && sameIds(cached.reportedMatchIds ?? [], reportedIds);
  let needsReplay = false;
  for (const id of replayIds) {
    if (!(await cacheHas(`hp-v1-ngs-replay-${id}`))) {
      needsReplay = true;
      break;
    }
  }

  if (!ignoreCache && cached && covered && !needsReplay) {
    return countsFromMap(counts);
  }

  const weekly = ignoreCache || !cached;
  let team = await getCached<NgsTeam>(`ngs-team-${teamName}`);
  if (!team) team = await getTeam(teamName).catch(() => null);
  if (weekly) add("ngs-team");
  const tags = (team?.teamMembers ?? [])
    .map((m) => m.displayName)
    .filter((tag) => starterSet.size === 0 || starterSet.has(tag.toLowerCase()));

  const priorKey = teamMatchesCacheKey(teamName, leagueConfig.priorSeason);
  const priorCached = await getCached<NgsMatch[]>(priorKey, FOREVER);
  if (ignoreCache || !priorCached) add("ngs-schedule");

  for (const tag of tags) {
    const slKey = `hp-v1-hero-all-${tag}-Storm League-${leagueConfig.stormLeagueStartDate}`;
    if (weekly || !(await cacheHas(slKey))) add("hp-storm-league");
    add("hp-ngs-player", 2);
  }

  await addRoundCalls(counts, teamName, leagueConfig.season, reported, ignoreCache);

  const priorReturning = await countCachedReturning(tags);
  if (priorReturning >= 3 && priorCached) {
    const priorReported = priorCached.filter((m) => m.reported).slice(0, 6);
    await addRoundCalls(
      counts,
      teamName,
      leagueConfig.priorSeason,
      priorReported,
      ignoreCache,
    );
  }

  return API_CALL_KINDS.map((kind) => {
    const row = countsFromMap(counts).find((r) => r.kind === kind)!;
    return row;
  });
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
  ignoreCache = false,
): Promise<void> {
  const add = (kind: ApiCallKind, n = 1) =>
    counts.set(kind, (counts.get(kind) ?? 0) + n);
  let needList = false;
  for (const match of reported) {
    if (!ignoreCache && (await roundIsCached(teamName, season, match.round))) continue;
    needList = true;
    for (const id of extractHpReplayIds(match)) {
      const state = ignoreCache ? "full" : await replayNeedsFetch(id);
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
      ignoreCache || season === leagueConfig.season
        ? false
        : await cacheHas(listKey);
    if (!listCached) add("hp-team-matches");
  }
}
