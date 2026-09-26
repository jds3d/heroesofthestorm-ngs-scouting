export type NgsApiEnvelope<T> = {
  message: string;
  route: string;
  returnObject: T;
};

export type NgsDivision = {
  teams: string[];
  displayName: string;
  divisionName: string;
  divisionConcat: string;
  moderator?: string;
};

export type NgsTeamMember = {
  _id?: string;
  id?: string;
  displayName: string;
};

export type NgsTeam = {
  teamName: string;
  ticker: string;
  captain: string;
  assistantCaptain?: string[];
  teamMembers: NgsTeamMember[];
  hpMmrAvg?: number;
  teamMMRAvg?: number;
  divisionConcat?: string;
  divisionDisplayName?: string;
  logo?: string;
  lookingForMore?: boolean;
};

export type NgsMatchSide = {
  teamName: string;
  score?: number;
  ticker?: string;
  dominator?: boolean;
  logo?: string;
};

export type NgsMapBans = {
  homeOne?: string;
  homeTwo?: string;
  awayOne?: string;
  awayTwo?: string;
};

export type NgsReplayEntry = {
  data?: string;
  url?: string;
  orig?: string;
  parsedUrl?: string;
};

export type NgsMatch = {
  matchId: string;
  round: number;
  season: number;
  divisionConcat: string;
  type?: string;
  reported?: boolean;
  home: NgsMatchSide;
  away: NgsMatchSide;
  mapBans?: NgsMapBans;
  other?: Record<string, unknown>;
  replays?: Record<string, NgsReplayEntry | string>;
  scheduledTime?: { startTime?: string };
};

export type LeagueTeamSummary = {
  name: string;
  slug: string;
  profileUrl: string;
  withdrawn?: boolean;
};
