import type { DraftMetaTable } from "@/lib/scoring/draftMeta";

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

export type DraftSectionGroup = {
  title: string;
  items?: string[];
};

export type DraftSection = {
  heading: string;
  /** Optional lead-in above bullets/groups. */
  body?: string;
  /** Flat list — one item per line. */
  bullets?: string[];
  /** Nested list (e.g. strategy group → common five). */
  groups?: DraftSectionGroup[];
};

export type DraftInsights = {
  /** Flat fallback string (joined section bodies). Prefer `sections` in UI. */
  narrative: string;
  /** Headings + short answers for the Draft strategy block. */
  sections: DraftSection[];
  archetype: string;
  /**
   * Fight shapes seen in the sample, highest frequency first.
   * Empty when identity is roster / Storm League fallback.
   */
  archetypeBreakdown: { archetype: string; count: number; pct: number }[];
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
  /**
   * Structural holes (no ranged, no clear, etc.) — call these out so we do
   * not walk into Infernal Shrines / Punisher with an all-melee five.
   */
  holes: string | null;
};

/** One ban or pick step for the interactive draft board. */
export type DraftTreeAction = {
  side: "our" | "their";
  kind: "ban" | "pick";
  ordinal: number;
  hero: string;
  player: string | null;
};

export type DraftTreeNode = {
  id: string;
  title: string;
  detail: string;
  /**
   * On a fork: `expected` is what we think they do (the read);
   * `adjust` is what we do if that step is something else.
   */
  branch?: "expected" | "adjust";
  /** Structured ban/pick for the HotS-style board (absent on fork parents). */
  action?: DraftTreeAction;
  children?: DraftTreeNode[];
};

export type DraftSide = {
  label: string;
  summary: string;
  /** Concrete counter read for their likely five — not archetype boilerplate. */
  counterNote: string;
  theirLikely: DraftCompPick[];
  ourLikely: DraftCompPick[];
  ourCompNote: string | null;
  ourBrief: OurCompBrief;
  tree: DraftTreeNode;
};

export type DraftPlaybookPivot = {
  id: string;
  name: string;
  objective: string;
  heroes: string[];
  maps: string[];
  /** When this pivot is the answer to their anti-dive. */
  why: string;
};

export type DraftPlaybook = {
  title: string;
  intro: string;
  /** Whether their predicted pool already shows anti-dive. */
  antiDiveThreat: boolean;
  antiDiveHeroesSeen: string[];
  /** Single recommended pivot when anti-dive is already in their pool. */
  recommended: DraftPlaybookPivot | null;
  /** Other pivots — only if map/lobby forces a different fight. */
  alternates: DraftPlaybookPivot[];
  tree: DraftTreeNode;
  /** @deprecated Prefer recommended + alternates. Kept for older cached reports. */
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
  draftPlan: DraftPlan | null;
  /** Maps we should ban vs leave up, from relative NGS records. */
  mapPlan?: MapPlan | null;
  /**
   * Storm League–derived early/late timing + hard matchup counters.
   * Built from HeroesProfile globals + matchups (not hand-written lore).
   */
  draftMeta?: DraftMetaTable | null;
};

export type MapPlanPick = {
  map: string;
  reason: string;
  ourRecord: string | null;
  theirRecord: string | null;
  edge: number;
};

export type MapPlan = {
  ban: MapPlanPick[];
  play: MapPlanPick[];
  note: string | null;
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
  /** Little Buff Boyz NGS team-average HP MMR. */
  homeHpMmrAvg?: number | null;
  threats: TeamThreat[];
  draft: DraftInsights;
  adapt: AdaptPlan;
  generatedAt: string;
  /** Reported NGS match ids this report was built from. */
  reportedMatchIds: string[];
  warnings: string[];
  apiUsage?: {
    predicted: import("@/lib/apiUsage").ApiCallCount[];
    actual: import("@/lib/apiUsage").ApiCallCount[];
  };
};
