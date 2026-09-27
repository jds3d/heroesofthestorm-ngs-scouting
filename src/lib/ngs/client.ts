import { classifyNgs, noteApiCall } from "@/lib/apiUsage";
import { leagueConfig } from "@/config/league";
import { cachedFetch, setCached } from "@/lib/cache";
import type {
  LeagueTeamSummary,
  NgsApiEnvelope,
  NgsDivision,
  NgsMatch,
  NgsTeam,
} from "@/lib/ngs/types";

async function ngsGet<T>(path: string): Promise<T> {
  const url = `${leagueConfig.ngsBaseUrl}${path}`;
  const kind = classifyNgs(path);
  if (kind) noteApiCall(kind);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`NGS GET ${path} failed: ${res.status}`);
  }
  const json = (await res.json()) as NgsApiEnvelope<T>;
  return json.returnObject;
}

async function ngsPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${leagueConfig.ngsBaseUrl}${path}`;
  const kind = classifyNgs(path);
  if (kind) noteApiCall(kind);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NGS POST ${path} failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as NgsApiEnvelope<T>;
  return json.returnObject;
}

export function teamSlug(teamName: string): string {
  return teamName.replace(/ /g, "_");
}

export function teamProfileUrl(teamName: string): string {
  return `${leagueConfig.ngsBaseUrl}/teamProfile/${teamSlug(teamName)}`;
}

const metaTtlMs = 12 * 60 * 60 * 1000;

export async function getSeasonInfo(): Promise<{ value: number }> {
  return cachedFetch(
    "ngs-season-info",
    () => ngsGet<{ value: number }>("/api/admin/getSeasonInfo"),
    metaTtlMs,
  );
}

export async function getDivision(
  divisionConcat: string = leagueConfig.divisionConcat,
): Promise<NgsDivision> {
  return cachedFetch(
    `ngs-division-${divisionConcat}`,
    () =>
      ngsGet<NgsDivision>(
        `/api/division/get?division=${encodeURIComponent(divisionConcat)}`,
      ),
    metaTtlMs,
  );
}

export async function getTeam(teamName: string): Promise<NgsTeam> {
  return cachedFetch(`ngs-team-${teamName}`, () =>
    ngsGet<NgsTeam>(
      `/api/team/get?team=${encodeURIComponent(teamName)}`,
    ),
  );
}

export function teamMatchesCacheKey(teamName: string, season: number): string {
  return `ngs-matches-${season}-${teamName}`;
}

export async function getTeamMatches(
  teamName: string,
  season: number = leagueConfig.season,
  opts?: { fresh?: boolean },
): Promise<NgsMatch[]> {
  const key = teamMatchesCacheKey(teamName, season);
  // NGS site schedule (not HeroesProfile). Prior seasons never change.
  // Current season: 24h TTL; force-refresh when the coach recaches.
  const ttl =
    season === leagueConfig.season ? 24 * 60 * 60 * 1000 : null;
  const fetcher = () =>
    ngsPost<NgsMatch[]>("/api/schedule/fetch/matches/team", {
      season,
      team: teamName,
    });
  if (opts?.fresh) {
    const data = await fetcher();
    await setCached(key, data, ttl);
    return data;
  }
  return cachedFetch(key, fetcher, ttl);
}

export async function listOpponentTeams(): Promise<LeagueTeamSummary[]> {
  const division = await getDivision();
  return division.teams
    .filter((name) => name !== leagueConfig.homeTeam)
    .filter((name) => !name.toLowerCase().includes("withdrawn"))
    .map((name) => ({
      name,
      slug: teamSlug(name),
      profileUrl: teamProfileUrl(name),
      withdrawn: name.toLowerCase().includes("withdrawn"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Extract HeroesProfile replay IDs from NGS match replay URLs. */
export function extractHpReplayIds(match: NgsMatch): number[] {
  const ids: number[] = [];
  if (!match.replays) return ids;
  for (const [key, value] of Object.entries(match.replays)) {
    if (key === "_id" || typeof value === "string") continue;
    const url = value.parsedUrl || value.orig || "";
    const m = url.match(/\/(\d+)\s*$/) || url.match(/Single\/(\d+)/);
    if (m) ids.push(Number(m[1]));
  }
  return ids;
}
