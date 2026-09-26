export type SourceHeroStat = {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  playPct: number;
};

export type ComfortHero = {
  hero: string;
  comfort: number;
  playPct: number;
  winRate: number;
  games: number;
  sources: {
    ngsCurrent?: SourceHeroStat;
    stormLeague?: SourceHeroStat;
    ngsPrior?: SourceHeroStat;
  };
};

export type PlayerScout = {
  battletag: string;
  preferredRole: string | null;
  topHeroes: ComfortHero[];
  ngsWins: number;
  ngsLosses: number;
  confidence: "high" | "medium" | "low";
  heroesProfileUrl: string;
  ngsProfileUrl: string;
  returningFromPrior: boolean;
};

export type TeamThreat = {
  hero: string;
  reason: string;
  comfort: number;
  playerCount: number;
};

export type DraftDataQuality =
  | "ok"
  | "early_season"
  | "incomplete"
  | "insufficient";

export type DraftSection = {
  heading: string;
  body: string;
};

export type DraftInsights = {
  /** Flat fallback string (joined section bodies). Prefer `sections` in UI. */
  narrative: string;
  /** Headings + short answers for the Draft strategy block. */
  sections: DraftSection[];
  archetype: string;
  /** What the "Games analyzed" UI should show. */
  gamesAnalyzedLabel: string;
  dataQuality: DraftDataQuality;
  /** Where draft identity primarily came from. */
  identitySource: "ngs_drafts" | "storm_league" | "roster";
  firstPickHeroes: { hero: string; count: number; pct: number }[];
  theirBans: { hero: string; count: number }[];
  bannedAgainstThem: { hero: string; count: number }[];
  mapBans: { map: string; count: number }[];
  mapTendencies: {
    map: string;
    games: number;
    wins: number;
    winRate: number;
  }[];
  /** Weighting and counting asides, shown under the draft writeup. */
  notes: string[];
  /** Games with usable hero drafts. */
  gamesAnalyzed: number;
  /** Reported NGS games expected this season (from schedule / HP match list). */
  reportedGamesExpected: number;
  matchesAnalyzed: number;
  priorSeasonWeightApplied: boolean;
};

export type AdaptRecommendation = {
  title: string;
  detail: string;
  priority: number;
};

export type DraftPlanPick = {
  hero: string;
  why: string;
};

export type DraftPlanSlot = {
  role: string;
  heroes: string[];
  why: string;
};

export type CompAlternative = {
  hero: string;
  player: string | null;
};

export type DraftCompPick = {
  role: string;
  hero: string;
  player: string | null;
  note: string | null;
  alternatives?: CompAlternative[];
};

export type OurCompBrief = {
  /** What shape the five actually is. */
  kind: string;
  /** Set when nobody in the five is a selected main tank. */
  noTankReason: string | null;
  /** How this five plays the map they see most. */
  mapStrategy: string;
  whyItWorks: string;
};

export type DraftTreeNode = {
  id: string;
  title: string;
  detail: string;
  children?: DraftTreeNode[];
};

export type DraftSide = {
  label: string;
  summary: string;
  theirLikely: DraftCompPick[];
  ourLikely: DraftCompPick[];
  ourCompNote: string | null;
  ourBrief: OurCompBrief;
  tree: DraftTreeNode;
};

export type DraftPlaybookPivot = {
  name: string;
  objective: string;
  heroes: string[];
  maps: string[];
};

export type DraftPlaybook = {
  title: string;
  intro: string;
  /** Whether their predicted pool already shows anti-dive. */
  antiDiveThreat: boolean;
  antiDiveHeroesSeen: string[];
  tree: DraftTreeNode;
  pivots: DraftPlaybookPivot[];
};

export type DraftPlan = {
  summary: string;
  certainty: "high" | "medium" | "low";
  predictedPicks: DraftPlanPick[];
  baitBans: { hero: string; reason: string }[];
  theirComp: string;
  fight: string;
  counter: string;
  macro: string;
  slots: DraftPlanSlot[];
  steps: { phase: string; action: string }[];
  theirLikely: DraftCompPick[];
  ourLikely: DraftCompPick[];
  ourCompNote: string | null;
  ourBrief: OurCompBrief;
  tree: DraftTreeNode;
  sides: { weFirst: DraftSide; theyFirst: DraftSide };
  /** LBB primary: heavy dive decision tree + pivots. */
  playbook: DraftPlaybook;
};

export type AdaptPlan = {
  banPriority: { hero: string; reason: string }[];
  firstPickDenies: string[];
  recommendations: AdaptRecommendation[];
  confidence: "high" | "medium" | "low";
  draftPlan: DraftPlan;
};

export type ScoutReport = {
  teamName: string;
  ticker: string;
  captain: string;
  hpMmrAvg: number | null;
  division: string;
  season: number;
  profileUrl: string;
  roster: PlayerScout[];
  /** Saved Little Buff Boyz pool, used to fill our comp when starters change. */
  homeRoster?: PlayerScout[] | null;
  threats: TeamThreat[];
  draft: DraftInsights;
  adapt: AdaptPlan;
  generatedAt: string;
  /** Reported NGS match ids this report was built from. */
  reportedMatchIds: string[];
  warnings: string[];
  apiUsage?: {
    predicted: { kind: string; label: string; count: number }[];
    actual: { kind: string; label: string; count: number }[];
  };
};
