import { classifyHeroesProfile, noteApiCall } from "@/lib/apiUsage";
import { leagueConfig } from "@/config/league";
import { FOREVER, cacheHas, cachedFetch, getCached } from "@/lib/cache";
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

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * GET against Heroes Profile external v1.
 * Handles 202 async jobs via Location / Retry-After polling.
 * Job polls do not consume weekly quota.
 */
async function hpGet<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  opts?: { maxPolls?: number },
): Promise<T> {
  const url = new URL(
    `${leagueConfig.heroesProfileBaseUrl}/${endpoint.replace(/^\//, "")}`,
  );
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const kind = classifyHeroesProfile(endpoint);
  if (kind) noteApiCall(kind);
  let res = await fetch(url.toString(), { headers: authHeaders() });
  let polls = 0;
  const maxPolls = opts?.maxPolls ?? 18;

  while (res.status === 202 && polls < maxPolls) {
    const retryAfter = Number(res.headers.get("Retry-After") || "5");
    const location = res.headers.get("Location");
    if (!location) {
      const body = await res.text();
      throw new HeroesProfileError(
        `HeroesProfile ${endpoint} returned 202 without Location: ${body.slice(0, 200)}`,
        202,
      );
    }
    await sleep(Math.max(retryAfter, 2) * 1000);
    const jobUrl = location.startsWith("http")
      ? location
      : `https://www.heroesprofile.com${location}`;
    res = await fetch(jobUrl, { headers: authHeaders() });
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

/** Storm League / player hero stats — live window, short TTL. */
export async function getPlayerHeroAll(
  battletag: string,
  options?: { gameType?: string; startDate?: string; endDate?: string },
): Promise<PlayerHeroAllResponse> {
  const gameType = options?.gameType ?? "Storm League";
  const startDate = options?.startDate ?? leagueConfig.stormLeagueStartDate;
  const key = `hp-v1-hero-all-${battletag}-${gameType}-${startDate}`;
  return cachedFetch(key, async () => {
    const rows = await hpGet<V1PlayerHeroRow[]>("players/heroes", {
      battletag,
      region: leagueConfig.regionName,
      game_type: gameType,
      start_date: startDate,
      end_date: options?.endDate,
    });
    return aggregatePlayerHeroRows(Array.isArray(rows) ? rows : [], gameType);
  });
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

/**
 * Prefer high-allowance `/replay/{id}/draft` + `/replay/{id}/bans`
 * over low-allowance `/ngs/replay/{id}`. Forever-cache successful past games.
 */
export async function getNgsReplayData(
  replayId: number,
): Promise<HpReplayData | null> {
  const key = `hp-v1-ngs-replay-${replayId}`;
  const existing = await getCached<HpReplayData>(key, FOREVER);
  if (existing?.players?.length) return existing;

  try {
    return await cachedFetch(
      key,
      async () => {
        // 1) Component APIs (replay_draft / replay_ban — typically ~10x ngs_replay_data)
        try {
          const [draftRaw, bansRaw] = await Promise.all([
            hpGet<unknown>(`replay/${replayId}/draft`),
            hpGet<unknown>(`replay/${replayId}/bans`).catch(() => null),
          ]);
          const draft = normalizeDraft(draftRaw);
          const banSides = normalizeBans(bansRaw);
          const picks = draft.filter((e) => !isBanEntry(e) && heroName(e.hero || e));
          if (picks.length >= 5) {
            const players: HpReplayData["players"] = picks.map((e, idx) => {
              const hero = heroName(e.hero || e);
              const team =
                typeof e.team === "number" ? e.team : idx < 5 ? 0 : 1;
              return {
                battletag: `unknown-${team}-${hero}`,
                hero,
                team,
                winner: false,
              };
            });
            // Attach bans onto a side channel via empty battletags is awkward;
            // full ngs/replay is better when we need winners/tags. Still usable for comps.
            if (banSides[0]?.length || banSides[1]?.length) {
              /* bans consumed in getNgsMatch via separate cache */
            }
            return {
              players,
              winner_team: undefined,
            } satisfies HpReplayData;
          }
        } catch (err) {
          if (
            err instanceof HeroesProfileError &&
            (err.status === 401 || err.status === 403)
          ) {
            throw err;
          }
          // Fall through to full NGS replay
        }

        // 2) Full NGS replay (ngs_replay_data — scarce; last resort)
        const raw = await hpGet<V1NgsReplay>(`ngs/replay/${replayId}`);
        const players: HpReplayData["players"] = [];
        const teams = raw.players ?? [];
        teams.forEach((side, teamIndex) => {
          for (const p of side ?? []) {
            const hero =
              typeof p.hero === "string" ? p.hero : p.hero?.name;
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
          // Quota / empty — do not forever-cache
          throw new HeroesProfileError(
            `Empty NGS replay ${replayId}`,
            404,
            "empty_replay",
          );
        }

        const mapName =
          typeof raw.game_map === "string"
            ? raw.game_map
            : raw.game_map?.name;

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
  } catch (err) {
    if (
      err instanceof HeroesProfileError &&
      (err.status === 401 || err.status === 403)
    ) {
      throw err;
    }
    return null;
  }
}

async function getReplayBansCached(replayId: number): Promise<string[][]> {
  const key = `hp-v1-replay-ban-${replayId}`;
  try {
    return await cachedFetch(
      key,
      async () => {
        const raw = await hpGet<unknown>(`replay/${replayId}/bans`);
        return normalizeBans(raw);
      },
      FOREVER,
    );
  } catch {
    return [[], []];
  }
}

function gameHasHeroes(game: HpMatchGame): boolean {
  return (game.team_heroes?.length ?? 0) > 0;
}

/** Build a round's games from forever-cached per-replay payloads. */
export async function getNgsMatch(
  team: string,
  round: number,
  season: number = leagueConfig.season,
  division: string = leagueConfig.division,
): Promise<HpNgsMatch | null> {
  const key = `hp-v1-ngs-match-s${season}-${division}-${team}-r${round}`;
  try {
    const cached = await getCached<HpNgsMatch>(key, FOREVER);
    if (
      cached &&
      Object.values(cached.match_data).some((g) => gameHasHeroes(g))
    ) {
      return cached;
    }

    return await cachedFetch(
      key,
      async () => {
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
          const weWon =
            replay?.players.some(
              (p) => p.team === ourTeamIndex && p.winner,
            ) ?? false;

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

        return {
          season: String(season),
          division,
          team,
          enemy: enemy || "Unknown",
          round: String(round),
          total_games: games.length,
          team_map_bans: [],
          enemy_map_bans: [],
          match_data,
        } satisfies HpNgsMatch;
      },
      FOREVER,
    );
  } catch (err) {
    if (
      err instanceof HeroesProfileError &&
      (err.status === 401 || err.status === 403)
    ) {
      throw err;
    }
    return null;
  }
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

async function currentGlobalPatch(): Promise<string | null> {
  return cachedFetch(
    patchCacheKey,
    async () => {
      const patches = await hpGet<PatchList>("patches");
      const patch =
        patches.patches?.find((p) => p.valid_globals && p.game_version) ??
        patches.patches?.find((p) => p.game_version);
      return patch?.game_version ?? null;
    },
    PATCH_TTL_MS,
  );
}

/** Current minor patch, Storm League. One cached pull for the whole meta table. */
export async function getGlobalHeroStats(): Promise<GlobalHeroStat[]> {
  return cachedFetch(globalHeroStatsKey, async () => {
    const gameVersion = await currentGlobalPatch();
    if (!gameVersion) return [];
    const stats = await hpGet<HeroStatsResponse>("heroes/stats", {
      game_type: "Storm League",
      timeframe_type: "minor",
      timeframe: gameVersion,
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
  }, GLOBAL_HERO_TTL_MS);
}

export const globalHeroMapStatsKey = "hp-v1-global-heroes-sl-minor-by-map";

type HeroStatsByMapResponse = {
  data?: {
    name?: string;
    map?: string | { name?: string };
    game_map?: string | { name?: string };
    win_rate?: number;
    games_played?: number;
  }[];
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

/** Per-hero-per-map Storm League WR for the current minor patch. */
export async function getGlobalHeroStatsByMap(): Promise<HeroMapStat[]> {
  return cachedFetch(
    globalHeroMapStatsKey,
    async () => {
      const gameVersion = await currentGlobalPatch();
      if (!gameVersion) return [];
      const stats = await hpGet<HeroStatsByMapResponse>("heroes/stats", {
        game_type: "Storm League",
        timeframe_type: "minor",
        timeframe: gameVersion,
        group_by_map: "true",
      });
      return (stats.data ?? [])
        .map((row) => {
          const map = mapNameFromRow(row);
          if (!row.name || !map) return null;
          return {
            hero: row.name,
            map,
            winRate: Number(row.win_rate) || 0,
            games: Number(row.games_played) || 0,
          } satisfies HeroMapStat;
        })
        .filter((r): r is HeroMapStat => r != null);
    },
    GLOBAL_HERO_TTL_MS,
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

/** Below this, a matchup edge is too thin on the minor patch — use major. */
const SPARSE_MATCHUP_GAMES = 250;
/** Enemy WR at/above this with sparse games triggers a major-patch refill. */
const SPARSE_COUNTER_ENEMY_WR = 52;

export type HeroMatchupBundle = {
  enemies: MatchupEnemyRow[];
  allies: MatchupAllyRow[];
};

function majorPatchFromMinor(minor: string): string {
  const parts = minor.split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return minor.slice(0, 4);
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
    // Opponent win% into you (HP enemy.win_rate / win_rate_against).
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

function matchupsNeedMajor(bundle: HeroMatchupBundle): boolean {
  const sparseEnemy = bundle.enemies.some(
    (e) =>
      e.games > 0 &&
      e.games < SPARSE_MATCHUP_GAMES &&
      e.enemyWinRate >= SPARSE_COUNTER_ENEMY_WR,
  );
  const sparseAlly = bundle.allies.some(
    (a) => a.games > 0 && a.games < SPARSE_MATCHUP_GAMES,
  );
  return sparseEnemy || sparseAlly;
}

function mergeEnemySparse(
  minor: MatchupEnemyRow[],
  major: MatchupEnemyRow[],
): MatchupEnemyRow[] {
  const byKey = new Map<string, MatchupEnemyRow>();
  for (const row of minor) byKey.set(row.hero.toLowerCase(), row);
  for (const row of major) {
    const k = row.hero.toLowerCase();
    const existing = byKey.get(k);
    if (!existing || existing.games < SPARSE_MATCHUP_GAMES) byKey.set(k, row);
  }
  return [...byKey.values()];
}

function mergeAllySparse(
  minor: MatchupAllyRow[],
  major: MatchupAllyRow[],
): MatchupAllyRow[] {
  const byKey = new Map<string, MatchupAllyRow>();
  for (const row of minor) byKey.set(row.hero.toLowerCase(), row);
  for (const row of major) {
    const k = row.hero.toLowerCase();
    const existing = byKey.get(k);
    if (!existing || existing.games < SPARSE_MATCHUP_GAMES) byKey.set(k, row);
  }
  return [...byKey.values()];
}

function mergeMatchupBundles(
  minor: HeroMatchupBundle,
  major: HeroMatchupBundle,
): HeroMatchupBundle {
  return {
    enemies: mergeEnemySparse(minor.enemies, major.enemies),
    allies: mergeAllySparse(minor.allies, major.allies),
  };
}

function matchupsCacheKey(
  timeframeType: "minor" | "major",
  timeframe: string,
  hero: string,
): string {
  return `hp-v3-matchups-sl-${timeframeType}-${timeframe}-${hero.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}

/**
 * How many HeroesProfile matchup HTTP calls a scout would still need.
 * Only counts calls that would miss the weekly TTL cache — and does not
 * pre-count a major-patch refill until the minor is known to be sparse.
 */
export async function countPendingMatchupCalls(
  heroes: string[],
): Promise<number> {
  const gameVersion = await currentGlobalPatch();
  if (!gameVersion) return 0;
  const major = majorPatchFromMinor(gameVersion);
  const unique = [...new Set(heroes.filter(Boolean))];
  let n = 0;
  for (const hero of unique) {
    const minorKey = matchupsCacheKey("minor", gameVersion, hero);
    const minorFresh =
      (await getCached<HeroMatchupBundle>(minorKey, GLOBAL_HERO_TTL_MS)) !==
      null;
    if (!minorFresh) {
      // One call for minor. Major is only fetched after we see sparse edges.
      n += 1;
      continue;
    }
    try {
      const minorBundle = await getCached<HeroMatchupBundle>(
        minorKey,
        GLOBAL_HERO_TTL_MS,
      );
      if (!minorBundle) {
        n += 1;
        continue;
      }
      if (
        matchupsNeedMajor(minorBundle) &&
        (await getCached(
          matchupsCacheKey("major", major, hero),
          GLOBAL_HERO_TTL_MS,
        )) === null
      ) {
        n += 1;
      }
    } catch {
      // Ignore estimate failures.
    }
  }
  return n;
}

async function fetchMatchupsForTimeframe(
  hero: string,
  timeframeType: "minor" | "major",
  timeframe: string,
): Promise<HeroMatchupBundle> {
  return cachedFetch(
    matchupsCacheKey(timeframeType, timeframe, hero),
    async () => {
      const raw = await hpGet<MatchupApiResponse>("heroes/matchups", {
        game_type: "Storm League",
        timeframe_type: timeframeType,
        timeframe,
        hero,
      });
      return parseMatchupBundle(raw, hero);
    },
    GLOBAL_HERO_TTL_MS,
  );
}

/**
 * Enemy + ally matchup rows for one hero (Storm League).
 * Prefers the current minor patch; sparse edges (&lt;250g) fill from major.
 */
export async function getHeroMatchups(hero: string): Promise<{
  patch: string;
  enemies: MatchupEnemyRow[];
  allies: MatchupAllyRow[];
}> {
  const gameVersion = await currentGlobalPatch();
  if (!gameVersion) return { patch: "", enemies: [], allies: [] };

  const minor = await fetchMatchupsForTimeframe(hero, "minor", gameVersion);

  if (!matchupsNeedMajor(minor)) {
    return { patch: gameVersion, ...minor };
  }

  const major = majorPatchFromMinor(gameVersion);
  try {
    const majorBundle = await fetchMatchupsForTimeframe(hero, "major", major);
    return {
      patch: `${major} (major+minor)`,
      ...mergeMatchupBundles(minor, majorBundle),
    };
  } catch {
    return { patch: gameVersion, ...minor };
  }
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
}> {
  const unique = [...new Set(heroes.filter(Boolean))];
  const byHero: Record<string, HeroMatchupBundle> = {};
  let patch = "";
  const queue = [...unique];
  const workers = 2;
  async function worker() {
    while (queue.length) {
      const hero = queue.shift();
      if (!hero) break;
      try {
        const { patch: p, enemies, allies } = await getHeroMatchups(hero);
        if (p) patch = p;
        byHero[hero] = { enemies, allies };
      } catch (err) {
        if (
          err instanceof HeroesProfileError &&
          (err.status === 429 || err.code === "rate_limited")
        ) {
          await sleep(8000);
          queue.unshift(hero);
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
  return { patch, byHero };
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

export function heroesProfilePlayerUrl(battletag: string): string {
  const name = battletag.split("#")[0];
  return `https://www.heroesprofile.com/Profile/?battletag=${encodeURIComponent(name)}&region=${leagueConfig.region}`;
}

export function ngsHeroesProfileUrl(battletag: string): string {
  return `https://www.heroesprofile.com/Esports/NGS/Player/${encodeURIComponent(battletag)}`;
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
