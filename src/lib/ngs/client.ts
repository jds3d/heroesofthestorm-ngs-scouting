import { classifyNgs, noteApiCall } from "@/lib/apiUsage";
import { leagueConfig } from "@/config/league";
import { cachedFetch, setCached } from "@/lib/cache";
import type {
  LeagueTeamSummary,
  NgsApiEnvelope,
  NgsDivision,
  NgsMatch,
  NgsStandingRow,
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
    season === leagueConfig.season ? leagueConfig.scheduleTtlMs : null;
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

export async function getDivisionStandings(
  division: string = leagueConfig.divisionConcat,
  season: number = leagueConfig.season,
): Promise<NgsStandingRow[]> {
  return cachedFetch(
    `ngs-standings-${season}-${division}`,
    () =>
      ngsPost<NgsStandingRow[]>("/api/standings/fetch/division", {
        division,
        season,
      }),
    // Same cadence as current-season schedule — standings move weekly.
    season === leagueConfig.season ? leagueConfig.scheduleTtlMs : null,
  );
}

export async function listOpponentTeams(): Promise<LeagueTeamSummary[]> {
  const division = await getDivision();
  const opponents = division.teams
    .filter((name) => name !== leagueConfig.homeTeam)
    .filter((name) => !name.toLowerCase().includes("withdrawn"));

  const [homeMatches, standingRows] = await Promise.all([
    getTeamMatches(leagueConfig.homeTeam, leagueConfig.season).catch(
      () => [] as NgsMatch[],
    ),
    // Same source as https://www.nexusgamingseries.org/division/a standings tab.
    getDivisionStandings().catch(() => [] as NgsStandingRow[]),
  ]);

  const scheduleByOpp = new Map<
    string,
    {
      week: number;
      scheduledAt: string | null;
      played: boolean;
    }
  >();
  for (const match of homeMatches) {
    const oppName =
      match.home.teamName === leagueConfig.homeTeam
        ? match.away.teamName
        : match.home.teamName;
    if (!oppName || oppName === leagueConfig.homeTeam) continue;
    const startRaw = match.scheduledTime?.startTime;
    const startMs = startRaw != null ? Number(startRaw) : NaN;
    const scheduledAt =
      Number.isFinite(startMs) && startMs > 0
        ? new Date(startMs).toISOString()
        : null;
    scheduleByOpp.set(oppName.toLowerCase(), {
      week: match.round,
      scheduledAt,
      played: Boolean(match.reported),
    });
  }

  const standings = new Map(
    standingRows.map((s) => [
      s.teamName.toLowerCase(),
      {
        place: Number(s.standing) || 0,
        points: Number(s.points) || 0,
        wins: Number(s.wins) || 0,
        losses: Number(s.losses) || 0,
      },
    ]),
  );

  // If NGS omitted `standing`, rank by points then wins.
  const ranked = [...standings.entries()].sort(
    (a, b) =>
      b[1].points - a[1].points ||
      b[1].wins - a[1].wins ||
      a[1].losses - b[1].losses ||
      a[0].localeCompare(b[0]),
  );
  ranked.forEach(([key, row], i) => {
    if (!row.place) {
      standings.set(key, { ...row, place: i + 1 });
    }
  });

  return opponents
    .map((name) => {
      const sched = scheduleByOpp.get(name.toLowerCase());
      const standing = standings.get(name.toLowerCase());
      return {
        name,
        slug: teamSlug(name),
        profileUrl: teamProfileUrl(name),
        withdrawn: name.toLowerCase().includes("withdrawn"),
        week: sched?.week ?? null,
        scheduledAt: sched?.scheduledAt ?? null,
        played: Boolean(sched?.played),
        place: standing?.place && standing.place > 0 ? standing.place : null,
        points: standing?.points ?? null,
        wins: standing?.wins ?? null,
        losses: standing?.losses ?? null,
      } satisfies LeagueTeamSummary;
    })
    .sort((a, b) => {
      const aw = a.week ?? 999;
      const bw = b.week ?? 999;
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name);
    });
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
