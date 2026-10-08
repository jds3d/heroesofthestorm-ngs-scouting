import { classifyHeroesProfile, noteApiCall } from "@/lib/apiUsage";
import { assertScoutBudget, isScoutBudgetExceeded } from "@/lib/scout/budget";
import { leagueConfig, stormLeagueWindows } from "@/config/league";
import { NGS_MAP_POOL } from "@/config/ngsMaps";
import { FOREVER, cacheHas, cachedFetch, getCached, readCacheEntry, setCached } from "@/lib/cache";
import {
  heroesProfilePlayerUrl,
  ngsHeroesProfileUrl,
} from "@/lib/heroesprofile/profileUrls";
import {
  DRAFT_SHELL_TTL_MS,
  buildDraftShell,
  cachedMatchTrustworthy,
  isDraftOnlyReplay,
  matchWinnersKnown,
  ourSideWon,
} from "@/lib/heroesprofile/replayCache";

export { heroesProfilePlayerUrl, ngsHeroesProfileUrl };
import type { PlayerScout } from "@/lib/scoring/types";
import type { GlobalHeroStat } from "@/lib/scoring/metaPressure";
import type {
  HeroMapStat,
  MatchupAllyRow,
  MatchupEnemyRow,
} from "@/lib/scoring/draftMeta";
import type {
  HpDraftEntry,
  HpMatchGame,
  HpNgsMatch,
  HpReplayData,
  NgsHeroRow,
  NgsPlayerProfile,
  PlayerHeroAllResponse,
  V1NgsPlayer,
  V1NgsReplay,
  V1NgsTeamMatch,
  V1PlayerHeroRow,
} from "@/lib/heroesprofile/types";

export class HeroesProfileError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "HeroesProfileError";
    this.status = status;
    this.code = code;
  }
}

function getToken(): string {
  const token = process.env.HEROESPROFILE_API_TOKEN?.trim();
  if (!token) {
    throw new HeroesProfileError(
      "HEROESPROFILE_API_TOKEN is missing. Add it to .env.local",
    );
  }
  return token;
}

function authHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

async function heroesProfileFetch(
  url: string,
  headers: HeadersInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      headers,
      signal: AbortSignal.timeout(HP_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new HeroesProfileError(
      timedOut
        ? "HeroesProfile request timed out"
        : "HeroesProfile request failed",
      504,
    );
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const HP_MIN_REQUEST_INTERVAL_MS = 1_250;
const HP_MAX_RATE_LIMIT_RETRIES = 3;
/** Live draft history. These overlap; matchup and replay calls stay one at a time. */
const HP_PLAYER_CONCURRENCY = 20;
/** One HeroesProfile call must not sit open until Cloudflare drops the request. */
const HP_FETCH_TIMEOUT_MS = 20_000;
const HEROESPROFILE_ORIGIN = "https://www.heroesprofile.com";
let hpRequestTail: Promise<void> = Promise.resolve();
let hpNextRequestAt = 0;
let hpAuthRejected = false;
let playerInFlight = 0;
const playerWaiters: Array<() => void> = [];

/** Stop the shared queue from spending more calls after a 401/403. */
export function resetHeroesProfileAuthRejectionForTests(): void {
  hpAuthRejected = false;
}

export function heroesProfileJobUrl(location: string): string {
  let url: URL;
  try {
    url =
      location.startsWith("https://") || location.startsWith("http://")
        ? new URL(location)
        : new URL(location, HEROESPROFILE_ORIGIN);
  } catch {
    throw new HeroesProfileError("HeroesProfile returned an invalid job URL", 202);
  }
  if (url.protocol !== "https:" || url.hostname !== "www.heroesprofile.com") {
    throw new HeroesProfileError(
      "HeroesProfile job URL was not on www.heroesprofile.com",
      202,
    );
  }
  return url.toString();
}

/** Parse both delta-seconds and HTTP-date Retry-After header forms. */
export function heroesProfileRetryDelayMs(
  retryAfter: string | null,
  retryNumber: number,
): number {
  const seconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(seconds * 1_000, HP_MIN_REQUEST_INTERVAL_MS);
  }
  if (retryAfter) {
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) {
      return Math.max(dateDelay, HP_MIN_REQUEST_INTERVAL_MS);
    }
  }
  // The API omits Retry-After for some 429 responses; use bounded exponential backoff.
  return 8_000 * 2 ** retryNumber;
}

async function acquirePlayerSlot(): Promise<void> {
  if (playerInFlight >= HP_PLAYER_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      playerWaiters.push(resolve);
    });
    return;
  }
  playerInFlight += 1;
}

function releasePlayerSlot(): void {
  const next = playerWaiters.shift();
  if (next) next();
  else playerInFlight -= 1;
}

/** Player hero history overlaps. A 401 still stops every lane. */
async function hpFetchParallel(url: string, headers: HeadersInit): Promise<Response> {
  await acquirePlayerSlot();
  try {
    if (hpAuthRejected) {
      throw new HeroesProfileError(
        "HeroesProfile API rejected the token (401/403). Confirm the v1 Bearer key in .env.local and Developer access.",
        401,
      );
    }
    assertScoutBudget();
    const res = await heroesProfileFetch(url, headers);
    if (res.status === 401 || res.status === 403) hpAuthRejected = true;
    return res;
  } finally {
    releasePlayerSlot();
  }
}

/**
 * Serialize quota-consuming API requests and leave a gap between them. This
 * protects global stats from concurrent matchup/replay calls in one scout run.
 * Player hero history uses `parallel` and does not take this lock.
 */
async function hpFetch(
  url: string,
  headers: HeadersInit,
  opts?: { parallel?: boolean },
): Promise<Response> {
  if (opts?.parallel) return hpFetchParallel(url, headers);
  let release!: () => void;
  const previous = hpRequestTail;
  hpRequestTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    const waitMs = Math.max(0, hpNextRequestAt - Date.now());
    if (!hpAuthRejected) assertScoutBudget(waitMs);
    if (waitMs && !hpAuthRejected) await sleep(waitMs);
    if (hpAuthRejected) {
      throw new HeroesProfileError(
        "HeroesProfile API rejected the token (401/403). Confirm the v1 Bearer key in .env.local and Developer access.",
        401,
      );
    }
    const res = await heroesProfileFetch(url, headers);
    if (res.status === 401 || res.status === 403) hpAuthRejected = true;
    return res;
  } finally {
    hpNextRequestAt = Math.max(
      hpNextRequestAt,
      Date.now() + HP_MIN_REQUEST_INTERVAL_MS,
    );
    release();
  }
}

/**
 * GET against Heroes Profile external v1.
 * Handles 202 async jobs via Location / Retry-After polling.
 * Job polls do not consume weekly quota.
 */
async function hpGet<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  opts?: { maxPolls?: number; parallel?: boolean },
): Promise<T> {
  const url = new URL(
    `${leagueConfig.heroesProfileBaseUrl}/${endpoint.replace(/^\//, "")}`,
  );
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  if (hpAuthRejected) {
    throw new HeroesProfileError(
      "HeroesProfile API rejected the token (401/403). Confirm the v1 Bearer key in .env.local and Developer access.",
      401,
    );
  }
  const kind = classifyHeroesProfile(endpoint);
  if (kind) noteApiCall(kind);
  const headers = authHeaders();
  let res = await hpFetch(url.toString(), headers, opts);
  let rateLimitRetries = 0;
  while (res.status === 429 && rateLimitRetries < HP_MAX_RATE_LIMIT_RETRIES) {
    const retryMs = heroesProfileRetryDelayMs(
      res.headers.get("Retry-After"),
      rateLimitRetries,
    );
    assertScoutBudget(retryMs);
    // Extend the shared cooldown before waiting so queued requests also slow down.
    hpNextRequestAt = Math.max(hpNextRequestAt, Date.now() + retryMs);
    await sleep(retryMs);
    res = await hpFetch(url.toString(), headers, opts);
    rateLimitRetries += 1;
  }
  let polls = 0;
  const maxPolls = opts?.maxPolls ?? 18;

  while (res.status === 202 && polls < maxPolls) {
    const retryAfter = Number(res.headers.get("Retry-After") || "5");
    assertScoutBudget(Math.max(retryAfter, 2) * 1000);
    const location = res.headers.get("Location");
    if (!location) {
      const body = await res.text();
      throw new HeroesProfileError(
        `HeroesProfile ${endpoint} returned 202 without Location: ${body.slice(0, 200)}`,
        202,
      );
    }
    await sleep(Math.max(retryAfter, 2) * 1000);
    const jobUrl = heroesProfileJobUrl(location);
    res = await heroesProfileFetch(jobUrl, headers);
    if (res.status === 401 || res.status === 403) hpAuthRejected = true;
    polls += 1;
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  if (res.status === 401 || res.status === 403) {
    throw new HeroesProfileError(
      "HeroesProfile API rejected the token (401/403). Confirm the v1 Bearer key in .env.local and Developer access.",
      res.status,
    );
  }

  if (res.status === 202) {
    throw new HeroesProfileError(
      `HeroesProfile ${endpoint} still pending after ${maxPolls} polls`,
      202,
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { error?: { code?: string } })?.error?.code;
    } catch {
      /* ignore */
    }
    throw new HeroesProfileError(
      `HeroesProfile ${endpoint} failed (${res.status}): ${text.slice(0, 300)}`,
      res.status,
      code,
    );
  }

  if (
    !contentType.includes("json") &&
    (text.trimStart().startsWith("<!DOCTYPE") ||
      text.trimStart().startsWith("<html"))
  ) {
    throw new HeroesProfileError(
      `HeroesProfile ${endpoint} returned HTML instead of JSON.`,
      res.status,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HeroesProfileError(
      `HeroesProfile ${endpoint} returned non-JSON body`,
      res.status,
    );
  }
}

function aggregatePlayerHeroRows(
  rows: V1PlayerHeroRow[],
  gameType: string,
): PlayerHeroAllResponse {
  const byHero = new Map<
    string,
    { wins: number; losses: number; games: number }
  >();

  for (const row of rows) {
    const hero = row.hero?.name || row.name;
    if (!hero) continue;
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const games = Number(row.games_played) || wins + losses || 0;
    const cur = byHero.get(hero) ?? { wins: 0, losses: 0, games: 0 };
    cur.wins += wins;
    cur.losses += losses;
    cur.games += games;
    byHero.set(hero, cur);
  }

  const out: Record<
    string,
    { wins: number; losses: number; games_played: number; win_rate: number }
  > = {};
  for (const [hero, s] of byHero) {
    out[hero] = {
      wins: s.wins,
      losses: s.losses,
      games_played: s.games,
      win_rate: s.games > 0 ? (s.wins / s.games) * 100 : 0,
    };
  }
  return { [gameType]: out };
}

function parseHeroRows(
  raw?: V1NgsPlayer["heroes"] | V1NgsPlayer["hero_top_three_most_played"],
): NgsHeroRow[] {
  if (!raw?.length) return [];
  return raw
    .map((h) => {
      const name = h.hero?.name || h.name || "";
      const wins = Number(h.wins) || 0;
      const losses = Number(h.losses) || 0;
      const games = Number(h.games_played) || wins + losses;
      return {
        name,
        wins,
        losses,
        games_played: games,
        role: h.hero?.new_role,
      } satisfies NgsHeroRow;
    })
    .filter((h) => h.name);
}

/** Storm League / player hero stats. `startDate: null` loads the whole career. */
export async function getPlayerHeroAll(
  battletag: string,
  options?: {
    gameType?: string;
    /** `null` omits start_date and loads the career. Omitted uses the recent window. */
    startDate?: string | null;
    endDate?: string;
  },
): Promise<PlayerHeroAllResponse> {
  const gameType = options?.gameType ?? "Storm League";
  const career = options != null && "startDate" in options && options.startDate == null;
  const startDate = career
    ? null
    : (options?.startDate ?? stormLeagueWindows().recentStart);
  const key = `hp-v1-hero-all-${battletag}-${gameType}-${startDate ?? "career"}`;
  return cachedFetch(
    key,
    async () => {
      const rows = await hpGet<V1PlayerHeroRow[]>(
        "players/heroes",
        {
          battletag,
          region: leagueConfig.regionName,
          game_type: gameType,
          start_date: startDate ?? undefined,
          end_date: options?.endDate,
        },
        { parallel: true },
      );
      const list = Array.isArray(rows) ? rows : [];
      const blizzId = list.find((row) => typeof row.blizz_id === "number")?.blizz_id;
      if (blizzId) await setCached(blizzIdKey(battletag), blizzId, FOREVER);
      return aggregatePlayerHeroRows(list, gameType);
    },
    leagueConfig.cacheTtlMs,
    {
      // Empty means the pull missed. Do not keep it for the week.
      isEmpty: (data) =>
        Object.values(data).every((heroes) => Object.keys(heroes).length === 0),
    },
  );
}

function blizzIdKey(battletag: string): string {
  return `hp-v1-blizz-id-${battletag}`;
}

/** Blizzard account id for profile links. Cached forever once found. */
export async function getPlayerBlizzId(battletag: string): Promise<number | null> {
  const cached = await getCached<number>(blizzIdKey(battletag), FOREVER);
  if (cached) return cached;
  try {
    const rows = await hpGet<V1PlayerHeroRow[]>("players/heroes", {
      battletag,
      region: leagueConfig.regionName,
      game_type: "Storm League",
    });
    const blizzId = (Array.isArray(rows) ? rows : []).find(
      (row) => typeof row.blizz_id === "number",
    )?.blizz_id;
    if (!blizzId) return null;
    await setCached(blizzIdKey(battletag), blizzId, FOREVER);
    return blizzId;
  } catch (err) {
    if (isScoutBudgetExceeded(err)) throw err;
    return null;
  }
}

/** Rewrite SL and NGS profile links so saved reports pick up a working URL. */
export async function withProfileLinks(
  players: PlayerScout[],
): Promise<PlayerScout[]> {
  const out: PlayerScout[] = [];
  for (const player of players) {
    const blizzId = player.blizzId ?? (await getPlayerBlizzId(player.battletag));
    out.push({
      ...player,
      blizzId,
      heroesProfileUrl: heroesProfilePlayerUrl(player.battletag, blizzId),
      ngsProfileUrl: ngsHeroesProfileUrl(player.battletag, blizzId),
    });
  }
  return out;
}

/**
 * NGS player page — preferred source for season hero pools (ngs_single_player).
 * Prior seasons are forever-cached; current season uses the default TTL.
 */
export async function getNgsPlayerProfile(
  battletag: string,
  season?: number,
  division?: string,
): Promise<NgsPlayerProfile> {
  const seasonKey = season ?? "all";
  const key = `hp-v1-ngs-profile-${battletag}-s${seasonKey}-${division ?? "all"}`;
  const ttl =
    season !== undefined && season !== leagueConfig.season
      ? FOREVER
      : leagueConfig.cacheTtlMs;

  return cachedFetch(
    key,
    async () => {
      const raw = await hpGet<V1NgsPlayer>("ngs/player", {
        battletag,
        season,
        division: division ?? leagueConfig.division,
      });

      const heroes = parseHeroRows(raw.heroes);
      const topFromProfile = parseHeroRows(raw.hero_top_three_most_played).map(
        (h) => h.name,
      );
      const top =
        topFromProfile.length > 0
          ? topFromProfile
          : heroes.slice(0, 3).map((h) => h.name);

      const preferredRole =
        raw.preferred_role ||
        raw.hero_top_three_most_played?.[0]?.hero?.new_role ||
        heroes[0]?.role ||
        null;

      return {
        wins: raw.wins,
        losses: raw.losses,
        top_three_heroes: top.filter(Boolean),
        preferred_role: preferredRole ?? undefined,
        heroes_played: heroes.length || raw.heroes?.length,
        heroes,
      } satisfies NgsPlayerProfile;
    },
    ttl,
  );
}

async function listTeamMatches(
  team: string,
  season: number,
  division: string,
): Promise<V1NgsTeamMatch[]> {
  const key = `hp-v1-ngs-team-matches-s${season}-${division}-${team}`;
  const ttl =
    season === leagueConfig.season ? leagueConfig.cacheTtlMs : FOREVER;
  return cachedFetch(
    key,
    async () => {
      const page = await hpGet<{ data?: V1NgsTeamMatch[] } | V1NgsTeamMatch[]>(
        "ngs/team/matches",
        { team, season, division },
      );
      if (Array.isArray(page)) return page;
      return page.data ?? [];
    },
    ttl,
  );
}

function heroName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const n = (value as { name?: string }).name;
    if (n) return n;
  }
  return "";
}

function isBanEntry(entry: HpDraftEntry): boolean {
  if (entry.ban === true) return true;
  const t = String(entry.type ?? entry.pick_type ?? "").toLowerCase();
  return t.includes("ban");
}

function normalizeDraft(raw: unknown): HpDraftEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length && Array.isArray(raw[0])) {
      return (raw as unknown[][]).flat().map((e) => e as HpDraftEntry);
    }
    return raw as HpDraftEntry[];
  }
  if (typeof raw === "object" && raw && "draft" in raw) {
    return normalizeDraft((raw as { draft: unknown }).draft);
  }
  return [];
}

function normalizeBans(raw: unknown): string[][] {
  if (!raw) return [[], []];
  if (typeof raw === "object" && raw && "bans" in raw) {
    return normalizeBans((raw as { bans: unknown }).bans);
  }
  if (!Array.isArray(raw)) return [[], []];
  return raw.map((side) => {
    if (!Array.isArray(side)) return [];
    return side
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          return heroName((b as { hero?: unknown }).hero) || heroName(b);
        }
        return "";
      })
      .filter(Boolean);
  });
}

function isAuthError(err: unknown): boolean {
  return (
    err instanceof HeroesProfileError &&
    (err.status === 401 || err.status === 403)
  );
}

/** Keep a successful ban payload so the match builder does not fetch it again. */
async function rememberReplayBans(replayId: number, raw: unknown): Promise<void> {
  if (raw == null) return;
  const bans = normalizeBans(raw);
  if (!bans.some((side) => side.length > 0)) return;
  await setCached(replayBanKey(replayId), bans, FOREVER);
}

function replayBanKey(replayId: number): string {
  return `hp-v1-replay-ban-${replayId}`;
}

async function fetchDraftShell(replayId: number): Promise<HpReplayData | null> {
  const [draftRaw, bansRaw] = await Promise.all([
    hpGet<unknown>(`replay/${replayId}/draft`),
    hpGet<unknown>(`replay/${replayId}/bans`).catch(() => null),
  ]);
  await rememberReplayBans(replayId, bansRaw);
  const shell = buildDraftShell(normalizeDraft(draftRaw));
  if (!shell) return null;
  await setCached(`hp-v1-ngs-replay-${replayId}`, shell, DRAFT_SHELL_TTL_MS);
  return shell;
}

async function fetchFullNgsReplay(replayId: number): Promise<HpReplayData> {
  return cachedFetch(
    `hp-v1-ngs-replay-${replayId}`,
    async () => {
      const raw = await hpGet<V1NgsReplay>(`ngs/replay/${replayId}`);
      const players: HpReplayData["players"] = [];
      const teams = raw.players ?? [];
      teams.forEach((side, teamIndex) => {
        for (const p of side ?? []) {
          const hero = typeof p.hero === "string" ? p.hero : p.hero?.name;
          if (!hero || !p.battletag) continue;
          players.push({
            battletag: p.battletag,
            blizz_id: p.blizz_id,
            hero,
            team: typeof p.team === "number" ? p.team : teamIndex,
            winner: Boolean(p.winner),
          });
        }
      });

      if (!players.length) {
        throw new HeroesProfileError(`Empty NGS replay ${replayId}`, 404, "empty_replay");
      }

      const mapName =
        typeof raw.game_map === "string" ? raw.game_map : raw.game_map?.name;

      return {
        game_date: raw.game_date,
        game_length: raw.game_length,
        game_map: mapName,
        region: raw.region,
        winner_team: raw.winner,
        players,
      } satisfies HpReplayData;
    },
    FOREVER,
  );
}

/**
 * Prefer the cheap draft endpoint until its shell expires, then replace it
 * with `/ngs/replay/{id}` so winners and battletags are real. A fresh shell
 * is returned for comps and is not treated as a finished game.
 */
export async function getNgsReplayData(
  replayId: number,
): Promise<HpReplayData | null> {
  const key = `hp-v1-ngs-replay-${replayId}`;
  const entry = await readCacheEntry<HpReplayData>(key);
  if (entry?.fresh && entry.data.players?.length && !isDraftOnlyReplay(entry.data)) {
    return entry.data;
  }
  if (entry?.fresh && isDraftOnlyReplay(entry.data)) return entry.data;

  const shellExpired = Boolean(entry && !entry.fresh && isDraftOnlyReplay(entry.data));

  try {
    if (shellExpired) {
      try {
        return await fetchFullNgsReplay(replayId);
      } catch (err) {
        if (isScoutBudgetExceeded(err) || isAuthError(err)) throw err;
      }
    }

    try {
      const shell = await fetchDraftShell(replayId);
      if (shell) return shell;
    } catch (err) {
      if (isScoutBudgetExceeded(err) || isAuthError(err)) throw err;
    }

    return await fetchFullNgsReplay(replayId);
  } catch (err) {
    if (isScoutBudgetExceeded(err) || isAuthError(err)) throw err;
    return null;
  }
}

async function getReplayBansCached(replayId: number): Promise<string[][]> {
  const key = replayBanKey(replayId);
  try {
    return await cachedFetch(
      key,
      async () => {
        const raw = await hpGet<unknown>(`replay/${replayId}/bans`);
        return normalizeBans(raw);
      },
      FOREVER,
    );
  } catch (err) {
    if (isScoutBudgetExceeded(err)) throw err;
    return [[], []];
  }
}

function gameHasHeroes(game: HpMatchGame): boolean {
  return (game.team_heroes?.length ?? 0) > 0;
}

const matchBuilds = new Map<string, Promise<HpNgsMatch | null>>();

/** Build a round's games from per-replay payloads. Unknown winners stay on a short TTL. */
export async function getNgsMatch(
  team: string,
  round: number,
  season: number = leagueConfig.season,
  division: string = leagueConfig.division,
): Promise<HpNgsMatch | null> {
  const key = `hp-v1-ngs-match-s${season}-${division}-${team}-r${round}`;
  const cached = await getCached<HpNgsMatch>(key, FOREVER);
    if (cached && cachedMatchTrustworthy(cached)) return cached;
    if (
      cached?.winnersKnown === false &&
      Object.values(cached.match_data).some((game) => gameHasHeroes(game))
    ) {
      return cached;
    }

    const pending = matchBuilds.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<HpNgsMatch | null> => {
      try {
        const all = await listTeamMatches(team, season, division);
        const games = all.filter((g) => String(g.round) === String(round));
        if (!games.length) {
          throw new HeroesProfileError(
            `No NGS games for ${team} round ${round}`,
            404,
          );
        }

        const sample = games[0];
        const isTeam0 = sample.team_0_name === team;
        const enemy = isTeam0 ? sample.team_1_name : sample.team_0_name;
        const ourTeamIndex = isTeam0 ? 0 : 1;

        const match_data: HpNgsMatch["match_data"] = {};
        let i = 1;
        let anyHeroes = false;
        for (const g of games.sort(
          (a, b) => Number(a.game ?? 0) - Number(b.game ?? 0),
        )) {
          const replay = await getNgsReplayData(g.replayID);
          const bans = await getReplayBansCached(g.replayID);
          const teamHeroes =
            replay?.players
              .filter((p) => p.team === ourTeamIndex)
              .map((p) => p.hero) ?? [];
          const enemyHeroes =
            replay?.players
              .filter((p) => p.team !== ourTeamIndex)
              .map((p) => p.hero) ?? [];
          const weWon = ourSideWon(replay, ourTeamIndex);

          if (teamHeroes.length) anyHeroes = true;

          match_data[String(i)] = {
            map: g.game_map || replay?.game_map || "Unknown",
            length: Number(g.game_length || replay?.game_length || 0),
            winner: weWon,
            team_heroes: teamHeroes,
            enemy_heroes: enemyHeroes,
            team_bans: bans[ourTeamIndex] ?? [],
            enemy_bans: bans[ourTeamIndex === 0 ? 1 : 0] ?? [],
            replay_url: `https://www.heroesprofile.com/Esports/NGS/Match/Single/${g.replayID}`,
          };
          i += 1;
        }

        if (!anyHeroes) {
          // Don't forever-cache a hollow shell — retry when quota recovers.
          throw new HeroesProfileError(
            `No hero drafts for ${team} round ${round} (replay quota or empty)`,
            429,
            "empty_match_drafts",
          );
        }

        const built = {
          season: String(season),
          division,
          team,
          enemy: enemy || "Unknown",
          round: String(round),
          total_games: games.length,
          team_map_bans: [],
          enemy_map_bans: [],
          match_data,
          winnersKnown: false,
        } satisfies HpNgsMatch;
        const winnersKnown = matchWinnersKnown(built);
        const stored = { ...built, winnersKnown };
        await setCached(
          key,
          stored,
          winnersKnown ? FOREVER : DRAFT_SHELL_TTL_MS,
        );
        return stored;
      } catch (err) {
        if (isScoutBudgetExceeded(err) || isAuthError(err)) throw err;
        return null;
      }
    })().finally(() => {
      matchBuilds.delete(key);
    });
    matchBuilds.set(key, promise);
    return promise;
}

export const globalHeroStatsKey = "hp-v1-global-heroes-sl-minor";

/** Storm League globals / matchups / map stats — refresh at most weekly. */
const GLOBAL_HERO_TTL_MS = leagueConfig.cacheTtlMs;

type PatchList = {
  patches?: { game_version?: string; valid_globals?: boolean }[];
};

type HeroStatsResponse = {
  data?: {
    name?: string;
    influence?: number;
    popularity?: number;
    ban_rate?: number;
    pick_rate?: number;
    win_rate?: number;
    games_played?: number;
  }[];
};

const PATCH_TTL_MS = leagueConfig.cacheTtlMs;
const patchCacheKey = "hp-v1-current-global-patch";

function patchVersionValue(version: string): number[] {
  return version
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
    .slice(0, 4);
}

function comparePatchVersionsDesc(a: string, b: string): number {
  const left = patchVersionValue(a);
  const right = patchVersionValue(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const lv = left[i] ?? 0;
    const rv = right[i] ?? 0;
    if (lv !== rv) return rv - lv;
  }
  return 0;
}

export function selectLatestGlobalPatch(
  patches: { game_version?: string; valid_globals?: boolean }[] = [],
): string | null {
  const usable = patches
    .filter((p) => p.game_version && p.valid_globals !== false)
    .sort((a, b) => comparePatchVersionsDesc(a.game_version!, b.game_version!));

  return usable[0]?.game_version ?? null;
}

async function currentGlobalPatch(): Promise<string | null> {
  return cachedFetch(
    patchCacheKey,
    async () => {
      const patches = await hpGet<PatchList>("patches");
      return selectLatestGlobalPatch(patches.patches ?? []);
    },
    PATCH_TTL_MS,
  );
}

async function recentGlobalPatchBuilds(): Promise<string[]> {
  const patches = await hpGet<PatchList>("patches");
  const versions = (patches.patches ?? [])
    .map((p) => p.game_version)
    .filter((v): v is string => Boolean(v))
    .filter((v) => {
      const row = (patches.patches ?? []).find((p) => p.game_version === v);
      return !row || row.valid_globals !== false;
    })
    .sort(comparePatchVersionsDesc)
    .slice(0, 8);

  return versions;
}

/** Current minor patch, Storm League. One cached pull for the whole meta table. */
export async function getGlobalHeroStats(): Promise<GlobalHeroStat[]> {
  return cachedFetch(globalHeroStatsKey, async () => {
    const patchWindow = await recentGlobalPatchBuilds();
    if (!patchWindow.length) return [];

    try {
      const stats = await hpGet<HeroStatsResponse>("heroes/stats", {
        game_type: "Storm League",
        timeframe_type: "minor",
        timeframe: patchWindow.join(","),
      });
      return (stats.data ?? [])
        .filter((row) => row.name)
        .map((row) => ({
          hero: row.name as string,
          influence: Number(row.influence) || 0,
          popularity: Number(row.popularity) || 0,
          banRate: Number(row.ban_rate) || 0,
          pickRate: Number(row.pick_rate) || 0,
          winRate: Number(row.win_rate) || 0,
          games: Number(row.games_played) || 0,
        }));
    } catch (err) {
      if (err instanceof HeroesProfileError) {
        throw new HeroesProfileError(
          `HeroesProfile global stats for patch window ${patchWindow.join(", ")} are unavailable yet. This usually means the newest patch has not published global data; retrying with the latest valid older patch window.`,
          err.status,
          err.code,
        );
      }
      throw err;
    }
  }, GLOBAL_HERO_TTL_MS);
}

export const globalHeroMapStatsKey = "hp-v2-global-heroes-sl-minor-by-map";

type HeroStatsByMapResponse = {
  data?: unknown;
};

type HeroStatsByMapRow = {
    name?: string;
    map?: string | { name?: string };
    game_map?: string | { name?: string };
    win_rate?: number;
    games_played?: number;
};

function mapNameFromRow(row: {
  map?: string | { name?: string };
  game_map?: string | { name?: string };
}): string | null {
  const raw = row.map ?? row.game_map;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  return raw.name ?? null;
}

const hpMapNames = new Set(NGS_MAP_POOL.map((map) => map.name.toLowerCase()));

function mapStatsRow(
  row: HeroStatsByMapRow,
  inheritedHero?: string,
  inheritedMap?: string,
): HeroMapStat | null {
  const hasStats = "win_rate" in row || "games_played" in row;
  const map = mapNameFromRow(row) ?? inheritedMap ?? null;
  const hero = row.name ?? inheritedHero ?? null;
  if (!hasStats || !hero || !map) return null;
  return {
    hero,
    map,
    winRate: Number(row.win_rate) || 0,
    games: Number(row.games_played) || 0,
  };
}

/** Accept flat rows and grouped map objects, whether returned at the root or under `data`. */
export function parseHeroMapStats(data: unknown): HeroMapStat[] {
  const rows: HeroMapStat[] = [];
  const visit = (
    value: unknown,
    inheritedHero?: string,
    inheritedMap?: string,
  ) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inheritedHero, inheritedMap);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as HeroStatsByMapRow;
    const row = mapStatsRow(record, inheritedHero, inheritedMap);
    if (row) {
      rows.push(row);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const isMap = hpMapNames.has(key.toLowerCase());
      visit(
        child,
        isMap ? inheritedHero : inheritedHero ?? key,
        isMap ? key : inheritedMap,
      );
    }
  };

  visit(data);
  return rows;
}

export function validateHeroMapStats(rows: HeroMapStat[] | null | undefined): HeroMapStat[] {
  if (!rows || rows.length === 0) {
    throw new HeroesProfileError(
      "HeroesProfile map stats are empty for the current patch; map fit cannot be calculated.",
      502,
      "empty_map_stats",
    );
  }
  return rows;
}

/** Per-hero-per-map Storm League WR for the current minor patch. */
export async function getGlobalHeroStatsByMap(): Promise<HeroMapStat[]> {
  return cachedFetch(
    globalHeroMapStatsKey,
    async () => {
      const minorBuilds = await recentGlobalPatchBuilds();
      if (!minorBuilds.length) {
        throw new HeroesProfileError(
          "HeroesProfile global patch metadata is unavailable; map stats cannot be loaded.",
          502,
          "missing_patch_metadata",
        );
      }

      let lastEmptyDataError: HeroesProfileError | null = null;
      for (const minorBuild of minorBuilds) {
        try {
          const stats = await hpGet<HeroStatsByMapResponse>("heroes/stats", {
            game_type: "Storm League",
            timeframe_type: "minor",
            timeframe: minorBuild,
            group_by_map: "true",
          });
          const rows = parseHeroMapStats(stats.data ?? stats);
          return validateHeroMapStats(rows);
        } catch (err) {
          // Only try an older build when this build returned an otherwise valid,
          // but empty, map dataset. Auth, rate-limit, and transport failures are
          // not patch freshness problems and must not burn the remaining quota.
          if (
            err instanceof HeroesProfileError &&
            err.code === "empty_map_stats"
          ) {
            lastEmptyDataError = err;
            continue;
          }
          throw err;
        }
      }

      throw new HeroesProfileError(
        `HeroesProfile returned no map-stat rows for minor builds ${minorBuilds.join(", ")}.`,
        lastEmptyDataError?.status ?? 502,
        "empty_map_stats",
      );
    },
    GLOBAL_HERO_TTL_MS,
    { isEmpty: (rows) => !Array.isArray(rows) || rows.length === 0 },
  );
}

type MatchupApiRow = {
  hero?: { name?: string } | string;
  name?: string;
  wins?: number;
  losses?: number;
  games_played?: number;
  win_rate?: number;
  wins_with?: number;
  losses_with?: number;
  win_rate_as_ally?: number;
  wins_against?: number;
  losses_against?: number;
  win_rate_against?: number;
};

type MatchupApiResponse = {
  enemy?: MatchupApiRow[];
  ally?: MatchupApiRow[];
  /** Classic nested shape: { [hero]: { [other]: { ally, enemy } } } */
  [hero: string]: unknown;
};

/**
 * Target: 95% CI half-width ≤ 3pp on enemy WR.
 * Variance p(1-p) peaks at 50%, so near-even matchups need the most games
 * (~1,068 at 50% vs ~897 at 70%). Fixed game counts / "≥52% WR" gates do not.
 */
const MATCHUP_MOE_TARGET = 0.03;
const MATCHUP_Z_95 = 1.96;
/** Never walk back further than this many major-sub patches (2.55.17, .16, …). */
const MAX_MAJOR_SUB_PATCHES = 8;

export type HeroMatchupBundle = {
  enemies: MatchupEnemyRow[];
  allies: MatchupAllyRow[];
};

type PatchRow = {
  game_version?: string;
  major?: number;
  minor?: number;
  patch?: number;
  valid_globals?: boolean;
};

/** Binomial 95% margin of error on a win-rate proportion. */
export function matchupMarginOfError(
  games: number,
  winRatePct: number,
): number {
  if (games <= 0) return 1;
  const p = Math.min(0.99, Math.max(0.01, winRatePct / 100));
  return MATCHUP_Z_95 * Math.sqrt((p * (1 - p)) / games);
}

/** Games needed for ±3pp at 95% CI given the current WR estimate. */
export function gamesForMatchupPrecision(winRatePct: number): number {
  const p = Math.min(0.99, Math.max(0.01, winRatePct / 100));
  return Math.ceil(
    (MATCHUP_Z_95 * MATCHUP_Z_95 * p * (1 - p)) /
      (MATCHUP_MOE_TARGET * MATCHUP_MOE_TARGET),
  );
}

/**
 * Keep stacking while any enemy or ally duo is wider than ±3pp.
 * Near 50% needs ~1.1k games; extreme WRs need fewer. No WR floor —
 * 50.5% and 58% are both refined until precision is met (or we hit the cap).
 */
export function matchupsNeedMoreGames(bundle: HeroMatchupBundle): boolean {
  const imprecise = (games: number, wr: number) =>
    games > 0 && matchupMarginOfError(games, wr) > MATCHUP_MOE_TARGET;
  return (
    bundle.enemies.some((e) => imprecise(e.games, e.enemyWinRate)) ||
    bundle.allies.some((a) => imprecise(a.games, a.allyWinRate))
  );
}

/** `2.55.17.98025` → `2.55.17` (Heroes Profile "major sub patch"). */
function majorSubPatchKey(gameVersion: string): string {
  const parts = gameVersion.split(".");
  if (parts.length >= 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
  return gameVersion;
}

function rowHeroName(row: MatchupApiRow): string | null {
  if (typeof row.hero === "string") return row.hero;
  if (row.hero && typeof row.hero === "object" && row.hero.name) {
    return row.hero.name;
  }
  return row.name ?? null;
}

function parseEnemyRow(row: MatchupApiRow): MatchupEnemyRow | null {
  const name = rowHeroName(row);
  if (!name) return null;
  const wins = Number(row.wins ?? row.wins_against) || 0;
  const losses = Number(row.losses ?? row.losses_against) || 0;
  const games = Number(row.games_played) || wins + losses;
  return {
    hero: name,
    wins,
    losses,
    games,
    // Opponent win% into you (HP flat enemy.win_rate / nested win_rate_against).
    enemyWinRate: Number(row.win_rate ?? row.win_rate_against) || 0,
  };
}

function parseAllyRow(row: MatchupApiRow): MatchupAllyRow | null {
  const name = rowHeroName(row);
  if (!name) return null;
  const wins = Number(row.wins ?? row.wins_with) || 0;
  const losses = Number(row.losses ?? row.losses_with) || 0;
  const games = Number(row.games_played) || wins + losses;
  return {
    hero: name,
    wins,
    losses,
    games,
    allyWinRate: Number(row.win_rate ?? row.win_rate_as_ally) || 0,
  };
}

function parseMatchupBundle(
  raw: MatchupApiResponse,
  forHero: string,
): HeroMatchupBundle {
  const enemies: MatchupEnemyRow[] = [];
  const allies: MatchupAllyRow[] = [];

  if (Array.isArray(raw.enemy)) {
    for (const row of raw.enemy) {
      const e = parseEnemyRow(row);
      if (e) enemies.push(e);
    }
  }
  if (Array.isArray(raw.ally)) {
    for (const row of raw.ally) {
      const a = parseAllyRow(row);
      if (a) allies.push(a);
    }
  }

  // Classic nested: { Abathur: { Alarak: { ally, enemy }, ... } }
  if (!enemies.length && !allies.length) {
    const root =
      (raw[forHero] as Record<string, unknown> | undefined) ??
      (Object.values(raw).find(
        (v) => v && typeof v === "object" && !Array.isArray(v),
      ) as Record<string, unknown> | undefined);
    if (root) {
      for (const [other, cell] of Object.entries(root)) {
        if (!cell || typeof cell !== "object") continue;
        const c = cell as {
          ally?: MatchupApiRow;
          enemy?: MatchupApiRow;
        };
        if (c.enemy) {
          const e = parseEnemyRow({ ...c.enemy, name: other });
          if (e) enemies.push(e);
        }
        if (c.ally) {
          const a = parseAllyRow({ ...c.ally, name: other });
          if (a) allies.push(a);
        }
      }
    }
  }

  return { enemies, allies };
}

function mergeEnemyAdditive(
  a: MatchupEnemyRow,
  b: MatchupEnemyRow,
): MatchupEnemyRow {
  const wins = a.wins + b.wins;
  const losses = a.losses + b.losses;
  const games = wins + losses || a.games + b.games;
  const enemyWinRate =
    a.games + b.games > 0
      ? Math.round(
          ((a.enemyWinRate * a.games + b.enemyWinRate * b.games) /
            (a.games + b.games)) *
            10,
        ) / 10
      : 0;
  return { hero: a.hero, wins, losses, games, enemyWinRate };
}

function mergeAllyAdditive(
  a: MatchupAllyRow,
  b: MatchupAllyRow,
): MatchupAllyRow {
  const wins = a.wins + b.wins;
  const losses = a.losses + b.losses;
  const games = wins + losses || a.games + b.games;
  const allyWinRate =
    a.games + b.games > 0
      ? Math.round(
          ((a.allyWinRate * a.games + b.allyWinRate * b.games) /
            (a.games + b.games)) *
            10,
        ) / 10
      : 0;
  return { hero: a.hero, wins, losses, games, allyWinRate };
}

/** Sum two bundles (stack older major-sub patches onto newer). */
function mergeMatchupsAdditive(
  base: HeroMatchupBundle,
  extra: HeroMatchupBundle,
): HeroMatchupBundle {
  const enemies = new Map<string, MatchupEnemyRow>();
  for (const row of base.enemies) enemies.set(row.hero.toLowerCase(), row);
  for (const row of extra.enemies) {
    const k = row.hero.toLowerCase();
    const existing = enemies.get(k);
    enemies.set(k, existing ? mergeEnemyAdditive(existing, row) : row);
  }
  const allies = new Map<string, MatchupAllyRow>();
  for (const row of base.allies) allies.set(row.hero.toLowerCase(), row);
  for (const row of extra.allies) {
    const k = row.hero.toLowerCase();
    const existing = allies.get(k);
    allies.set(k, existing ? mergeAllyAdditive(existing, row) : row);
  }
  return { enemies: [...enemies.values()], allies: [...allies.values()] };
}

function matchupsCacheKey(
  kind: "minor" | "sub",
  timeframe: string,
  hero: string,
): string {
  return `hp-v4-matchups-sl-${kind}-${timeframe}-${hero.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}

const majorSubPatchListKey = "hp-v1-major-sub-patches";

/**
 * Newest-first major-sub patch keys (`2.55.17`, `2.55.16`, …) with every
 * minor build under each (for comma-separated HP timeframe queries).
 */
async function listMajorSubPatches(): Promise<
  { key: string; builds: string[] }[]
> {
  return cachedFetch(
    majorSubPatchListKey,
    async () => {
      const patches = await hpGet<PatchList>("patches");
      const byKey = new Map<string, string[]>();
      const order: string[] = [];
      for (const p of patches.patches ?? []) {
        const row = p as PatchRow;
        if (
          row.major == null ||
          row.minor == null ||
          row.patch == null ||
          !row.game_version
        ) {
          continue;
        }
        const key = `${row.major}.${row.minor}.${row.patch}`;
        if (!byKey.has(key)) {
          byKey.set(key, []);
          order.push(key);
        }
        byKey.get(key)!.push(row.game_version);
      }
      return order.map((key) => ({ key, builds: byKey.get(key)! }));
    },
    PATCH_TTL_MS,
  );
}

/**
 * How many HeroesProfile matchup HTTP calls a scout would still need.
 * Counts uncached current-minor pulls, plus uncached major-sub stacks when
 * the minor is known to be sparse (never the full multi-year major).
 */
export async function countPendingMatchupCalls(
  heroes: string[],
): Promise<number> {
  const gameVersion = await currentGlobalPatch();
  if (!gameVersion) return 0;
  const unique = [...new Set(heroes.filter(Boolean))];
  const subs = await listMajorSubPatches().catch(() => []);
  const currentSub = majorSubPatchKey(gameVersion);
  const startIdx = Math.max(
    0,
    subs.findIndex((s) => s.key === currentSub),
  );
  const stackKeys = subs
    .slice(startIdx, startIdx + MAX_MAJOR_SUB_PATCHES)
    .map((s) => s.key);

  let n = 0;
  for (const hero of unique) {
    const minorKey = matchupsCacheKey("minor", gameVersion, hero);
    const minorBundle = await getCached<HeroMatchupBundle>(
      minorKey,
      GLOBAL_HERO_TTL_MS,
    );
    if (!minorBundle) {
      // Minor + up to one current-sub expand if sparse (can't know yet).
      n += 1;
      continue;
    }
    if (!matchupsNeedMoreGames(minorBundle)) continue;
    for (const sub of stackKeys) {
      if (
        (await getCached(
          matchupsCacheKey("sub", sub, hero),
          GLOBAL_HERO_TTL_MS,
        )) === null
      ) {
        n += 1;
      }
    }
  }
  return n;
}

async function fetchMatchupsForMinorBuilds(
  hero: string,
  builds: string[],
  cacheKind: "minor" | "sub",
  cacheTimeframe: string,
): Promise<HeroMatchupBundle> {
  return cachedFetch(
    matchupsCacheKey(cacheKind, cacheTimeframe, hero),
    async () => {
      const raw = await hpGet<MatchupApiResponse>("heroes/matchups", {
        game_type: "Storm League",
        timeframe_type: "minor",
        // HP accepts comma-separated minors → one major-sub patch window.
        timeframe: builds.join(","),
        hero,
      });
      return parseMatchupBundle(raw, hero);
    },
    GLOBAL_HERO_TTL_MS,
  );
}

/**
 * Enemy + ally matchup rows for one hero (Storm League).
 * Starts on the current minor build. Stacks major-sub patches (2.55.17 → .16 → …)
 * until every enemy edge has ±3pp precision at 95% CI (hardest near 50%), or
 * we hit the subpatch cap — never the full multi-year `major` timeframe.
 */
export async function getHeroMatchups(hero: string): Promise<{
  patch: string;
  enemies: MatchupEnemyRow[];
  allies: MatchupAllyRow[];
}> {
  const gameVersion = await currentGlobalPatch();
  if (!gameVersion) return { patch: "", enemies: [], allies: [] };

  let bundle = await fetchMatchupsForMinorBuilds(
    hero,
    [gameVersion],
    "minor",
    gameVersion,
  );
  if (!matchupsNeedMoreGames(bundle)) {
    return { patch: gameVersion, ...bundle };
  }

  const subs = await listMajorSubPatches();
  const currentSub = majorSubPatchKey(gameVersion);
  const startIdx = Math.max(
    0,
    subs.findIndex((s) => s.key === currentSub),
  );
  const used: string[] = [];

  for (let i = startIdx; i < subs.length && used.length < MAX_MAJOR_SUB_PATCHES; i++) {
    const sub = subs[i];
    try {
      // Replace single-build minor with the full current subpatch first
      // (avoids double-counting the current build).
      const next = await fetchMatchupsForMinorBuilds(
        hero,
        sub.builds,
        "sub",
        sub.key,
      );
      if (used.length === 0 && sub.key === currentSub) {
        bundle = next;
      } else {
        bundle = mergeMatchupsAdditive(bundle, next);
      }
      used.push(sub.key);
    } catch (err) {
      if (isScoutBudgetExceeded(err)) throw err;
      // Skip a missing subpatch; keep walking older ones.
      continue;
    }
    if (!matchupsNeedMoreGames(bundle)) break;
  }

  const patchLabel = used.length
    ? `${used[used.length - 1]}…${used[0]} (${used.length} sub)`
    : gameVersion;
  return { patch: patchLabel, ...bundle };
}

/**
 * Fetch matchups for many heroes. Cached heroes are free; uncached calls
 * run with low concurrency to avoid HeroesProfile rate limits.
 */
export async function getHeroMatchupsMany(
  heroes: string[],
): Promise<{
  patch: string;
  byHero: Record<string, HeroMatchupBundle>;
  /** True when the scout time budget stopped the queue before every hero. */
  incomplete: boolean;
}> {
  const unique = [...new Set(heroes.filter(Boolean))];
  const byHero: Record<string, HeroMatchupBundle> = {};
  let patch = "";
  let incomplete = false;
  const queue = [...unique];
  const rateRetries = new Map<string, number>();
  const workers = 2;
  async function worker() {
    while (queue.length) {
      const hero = queue.shift();
      if (!hero) break;
      try {
        assertScoutBudget();
        const { patch: p, enemies, allies } = await getHeroMatchups(hero);
        if (p) patch = p;
        byHero[hero] = { enemies, allies };
      } catch (err) {
        if (isScoutBudgetExceeded(err)) {
          incomplete = true;
          queue.length = 0;
          break;
        }
        if (
          err instanceof HeroesProfileError &&
          (err.status === 429 || err.code === "rate_limited")
        ) {
          const tries = (rateRetries.get(hero) ?? 0) + 1;
          rateRetries.set(hero, tries);
          // hpGet already retried the 429. One extra pass, then skip the hero
          // so a single limited hero cannot hold the scout open.
          if (tries <= 1) {
            try {
              assertScoutBudget(8_000);
              await sleep(8000);
            } catch (budgetErr) {
              if (!isScoutBudgetExceeded(budgetErr)) throw budgetErr;
              incomplete = true;
              queue.length = 0;
              break;
            }
            queue.unshift(hero);
          }
          continue;
        }
        // Skip failed hero — draft meta degrades to globals-only for them.
      }
      await sleep(350);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(workers, unique.length) }, () => worker()),
  );
  return { patch, byHero, incomplete };
}

export async function checkHeroesProfileAuth(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    await hpGet<unknown>("heroes", { hero: "Abathur" });
    return {
      ok: true,
      message: "HeroesProfile v1 API token accepted (Bearer).",
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "HeroesProfile auth check failed",
    };
  }
}

/** Replay attribute id (e.g. "Crus") → hero name. New heroes appear here first. */
export async function getHeroAttributeNames(): Promise<Record<string, string>> {
  return cachedFetch(
    "hp-v1-hero-attribute-ids",
    async () => {
      const data = await hpGet<{
        heroes?: { name?: string; attribute_id?: string }[];
      }>("heroes");
      const out: Record<string, string> = {};
      for (const h of data.heroes ?? []) {
        if (h.attribute_id && h.name) out[h.attribute_id] = h.name;
      }
      return out;
    },
    7 * 24 * 60 * 60 * 1000,
  );
}

export function normalizeBattletag(tag: string): string {
  const [name, discr] = tag.split("#");
  return `${name}#${discr ?? ""}`.toLowerCase();
}

/** Match full tags or name-only replay battletags. */
export function battletagMatches(
  rosterTag: string,
  candidate: string,
): boolean {
  const a = normalizeBattletag(rosterTag);
  const b = normalizeBattletag(candidate);
  if (a === b) return true;
  const aName = a.split("#")[0];
  const bName = b.split("#")[0];
  return aName.length > 0 && aName === bName;
}
