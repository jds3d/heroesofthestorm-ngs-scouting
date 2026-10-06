export type HeroStat = {
  wins: number;
  losses: number;
  games_played: number;
  win_rate: number;
  mmr?: number;
};

/** Normalized shape used by scoring (game_type → hero → stats). */
export type PlayerHeroAllResponse = Record<
  string,
  Record<string, HeroStat>
>;

export type NgsHeroRow = {
  name: string;
  games_played: number;
  wins: number;
  losses: number;
  role?: string;
};

export type NgsPlayerProfile = {
  wins?: string | number;
  losses?: string | number;
  top_three_heroes?: string[];
  heroes_played?: number;
  preferred_role?: string;
  /** Full NGS hero pool for the requested season (preferred over replaying games). */
  heroes?: NgsHeroRow[];
  [key: string]: unknown;
};

export type HpDraftEntry = {
  hero?: string;
  type?: string;
  pick_type?: string;
  team?: number;
  ban?: boolean;
  [key: string]: unknown;
};

export type HpMatchGame = {
  map: string;
  length: number;
  /** null when this game came from a draft shell with no winner. */
  winner: boolean | null;
  team_heroes: string[];
  team_bans: string[];
  enemy_heroes: string[];
  enemy_bans: string[];
  replay_url?: string;
};

export type HpNgsMatch = {
  season: string;
  division: string;
  team: string;
  team_map_bans: string[];
  enemy: string;
  enemy_map_bans: string[];
  round: string;
  total_games: number;
  match_data: Record<string, HpMatchGame>;
  /** Set when a round was cached. Missing on older files. */
  winnersKnown?: boolean;
};

/** Normalized replay used by the scout pipeline. */
export type HpReplayData = {
  game_date?: string;
  team_0?: string;
  team_1?: string;
  game_length?: number;
  game_map?: string;
  region?: number;
  winner_team?: number;
  players: Array<{
    battletag: string;
    blizz_id?: number;
    hero: string;
    team: number;
    winner: boolean | null;
  }>;
};

export type V1PlayerHeroRow = {
  wins?: number;
  losses?: number;
  games_played?: number;
  win_rate?: number;
  hero?: { name?: string; new_role?: string };
  name?: string;
  blizz_id?: number;
  sl_mmr_data?: number | null;
};

export type V1NgsPlayer = {
  wins?: number;
  losses?: number;
  preferred_role?: string | null;
  hero_top_three_most_played?: Array<{
    name?: string;
    hero?: { name?: string; new_role?: string };
    games_played?: number;
    wins?: number;
    losses?: number;
  }>;
  heroes?: Array<{
    name?: string;
    hero?: { name?: string; new_role?: string };
    games_played?: number;
    wins?: number;
    losses?: number;
  }>;
};

export type V1NgsTeamMatch = {
  replayID: number;
  season?: string;
  round?: string | number;
  game?: number;
  game_map?: string;
  game_length?: number;
  team_0_name?: string;
  team_1_name?: string;
  team_0_map_ban?: string | number;
  team_0_map_ban_2?: string | number;
  team_1_map_ban?: string | number;
  team_1_map_ban_2?: string | number;
  first_pick?: number;
};

export type V1NgsReplay = {
  game_date?: string;
  game_length?: number;
  game_map?: { name?: string } | string;
  region?: number;
  winner?: number;
  players?: Array<
    Array<{
      battletag?: string;
      blizz_id?: number;
      winner?: number | boolean;
      team?: number;
      hero?: { name?: string } | string;
    }>
  >;
};
