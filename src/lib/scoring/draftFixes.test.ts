import { describe, expect, it } from "vitest";
import { cachedFetch, invalidateCached, setCached } from "@/lib/cache";
import {
  explainTheirArchetypeRead,
  explainTheirLikelyBan,
  expectTheirNext,
  applyPlanSeatsToSlSuggestions,
  collectReportSteps,
  findSeatForCandidate,
  isLockedPlanSeat,
  openPlanHeroForPlayer,
  planPickLabel,
  showSuggestionOnPlan,
} from "@/components/InteractiveDraft";
import {
  chooseDivePivot,
  divePlaybook,
  pivotPlanSlots,
} from "@/config/divePlaybook";
import { healDenyGuideFor } from "@/config/healDenyPlaybook";
import { applyMapToDraftPlan } from "@/lib/scoring/applyMap";
import {
  favouredLabel,
  gradeFinishedDraft,
  mmrAdjustedWinPct,
  percentileToGrade,
  stepPct,
  sumStepPoints,
  type DraftStepScore,
} from "@/lib/scoring/draftGrade";
import { heroKey } from "@/lib/scoring/heroMeta";
import { solveSeatAssignments } from "@/lib/scoring/draftPlan";
import { assignUniqueOwners, displacedComfort, nextSeatLabels, playersSeatedOnLocks } from "@/lib/scoring/draftSwap";
import { slHeroSuggestions } from "@/lib/scoring/comfort";
import type { PlayerScout } from "@/lib/scoring/types";
import { pairDuoSynergy, pairRoleCheck } from "@/lib/scoring/pickPairs";
import {
  HeroesProfileError,
  heroesProfileRetryDelayMs,
  matchupsNeedMoreGames,
  parseHeroMapStats,
  selectLatestGlobalPatch,
  validateHeroMapStats,
} from "@/lib/heroesprofile/client";
import {
  allyDuos,
  buildDraftMetaTable,
  counterPenalty,
  counterPoolNote,
  duoMissingLine,
  enemyDuos,
  heroesMissingMatchupLoad,
  MATCHUP_DUO,
  mergeLoadedMatchupRows,
  matchupFetchQueue,
  missingDuoLabel,
  missingDuoReason,
  suggestionDataGap,
  suggestionDataGapTooltip,
  pairingGameCount,
  scoreDuos,
  SYNERGY_DUO,
  isMapSpecialist,
  mapSpecialistTooltip,
  nakedOfflaneOpeningRisk,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import type { DraftCompPick, DraftPlan, DraftPlanSlot } from "@/lib/scoring/types";
import { planSeatJob } from "@/lib/scoring/draftPlan";

describe("heroKey", () => {
  it("case-folds and aliases", () => {
    expect(heroKey("qhira")).toBe("Qhira");
    expect(heroKey("Qhira")).toBe("Qhira");
    expect(heroKey("Anubarak")).toBe("Anub'arak");
    expect(heroKey("Anub'arak")).toBe("Anub'arak");
  });
});

describe("leave-dive / Falstad", () => {
  it("treats Falstad as hard anti-dive (Gust when we dive)", () => {
    expect(
      (divePlaybook.antiDiveHeroes as readonly string[]).includes("Falstad"),
    ).toBe(true);
    expect(
      (divePlaybook.softAntiDiveHeroes as readonly string[]).includes("Falstad"),
    ).toBe(false);
  });

  it("Falstad alone is enough to choose a leave-dive pivot", () => {
    const { pivot, matched } = chooseDivePivot(["Falstad"]);
    expect(matched).toContain("Falstad");
    expect(pivot.id).toBeTruthy();
  });

  it("pivotPlanSlots returns five seats", () => {
    const poke = divePlaybook.pivots.find((p) => p.id === "poke")!;
    const slots = pivotPlanSlots(poke);
    expect(slots).toHaveLength(5);
    expect(slots.every((s: DraftPlanSlot) => s.heroes.length > 0)).toBe(true);
  });

  it("chooseDivePivot tips poke when Brightwing + Tyrael", () => {
    const { pivot } = chooseDivePivot(["Brightwing", "Tyrael"]);
    expect(["poke", "blowup", "global"]).toContain(pivot.id);
  });
});

describe("healDenyPlaybook currency", () => {
  it("Anduin has real talent names (no Purgatory)", () => {
    const g = healDenyGuideFor("Anduin");
    expect(g).not.toBeNull();
    const names = g!.talents.flatMap((t) => [t.take, t.alt].filter(Boolean));
    expect(names).not.toContain("Purgatory");
    expect(names).toContain("Holy Word: Salvation");
    expect(names).toContain("Evenhanded Blessings");
  });

  it("Brightwing has Sticky Flare path, not Sticky Flue / Continuous Winds", () => {
    const g = healDenyGuideFor("Brightwing");
    expect(g).not.toBeNull();
    const names = g!.talents.flatMap((t) => [t.take, t.alt].filter(Boolean));
    expect(names.join(" ")).not.toMatch(/Sticky Flue/i);
    expect(names.join(" ")).not.toMatch(/Continuous Winds/i);
    expect(names).toContain("Hyper Shift");
    expect(names).toContain("Critterize");
  });

  it("Whitemane L1 is Pity the Frail, not Inquisitor's Ordnance", () => {
    const g = healDenyGuideFor("Whitemane");
    expect(g!.talents[0].take).toBe("Pity the Frail");
  });
});

describe("global patch selection", () => {
  it("skips the newest patch when HeroesProfile does not yet have global stats for it", () => {
    const latest = selectLatestGlobalPatch([
      { game_version: "2.55.17.98025", valid_globals: false },
      { game_version: "2.55.16.97145", valid_globals: true },
      { game_version: "2.55.15.96000", valid_globals: true },
    ]);

    expect(latest).toBe("2.55.16.97145");
  });
});

describe("HeroesProfile rate-limit backoff", () => {
  it("honors an API Retry-After value while preserving a minimum request gap", () => {
    expect(heroesProfileRetryDelayMs("12", 0)).toBe(12_000);
    expect(heroesProfileRetryDelayMs("0", 0)).toBeGreaterThanOrEqual(1_250);
  });

  it("uses increasing backoff when the API omits Retry-After", () => {
    expect(heroesProfileRetryDelayMs(null, 1)).toBeGreaterThan(
      heroesProfileRetryDelayMs(null, 0),
    );
  });
});

describe("draftGrade", () => {
  const ourLocked = [
    { hero: "Anub'arak", player: null },
    { hero: "Qhira", player: null },
    { hero: "Genji", player: null },
    { hero: "Malthael", player: null },
    { hero: "Greymane", player: null },
  ];
  const theirLocked = [
    { hero: "Varian", player: null },
    { hero: "Rehgar", player: null },
    { hero: "Valla", player: null },
    { hero: "Sonya", player: null },
    { hero: "Falstad", player: null },
  ];
  const step = (
    side: "our" | "their",
    best: number,
    achieved: number,
    percentile?: number,
  ): DraftStepScore => ({
    side,
    kind: "pick",
    label: `Pick ${best}`,
    locked: "X",
    bestLabel: "Y",
    best,
    achieved,
    percentile,
  });
  const base = {
    ourLocked,
    theirLocked,
    homeRoster: [],
    theirRoster: [],
    table: null,
    map: null,
    ourLabel: "LBB",
    theirLabel: "TG",
  };

  it("grades each side on the average percentile of its steps", () => {
    const card = gradeFinishedDraft({
      ...base,
      steps: [
        step("our", 60, 45, 90),
        step("our", 75, 40, 76),
        step("their", 50, 50, 100),
      ],
    });
    expect(card.ours.points).toBe(85);
    expect(card.ours.bestPoints).toBe(135);
    expect(card.ours.percentile).toBe(83);
    expect(card.ours.grade).toBe("B");
    expect(card.theirs.grade).toBe("A+");
    expect(card.ours.notes[0]).toBe("Every step ranked C or better against the options open.");
  });

  it("names the lowest-ranked step as the biggest miss", () => {
    const card = gradeFinishedDraft({
      ...base,
      steps: [step("our", 60, 20, 65), step("our", 40, 30, 40)],
    });
    expect(card.ours.notes[0]).toContain("(+30) over Y (+40)");
  });

  it("flags locked heroes nobody on the five has played and drops five strength", () => {
    const player = (battletag: string, heroes: [string, number][]) => ({
      battletag,
      preferredRole: null,
      topHeroes: heroes.map(([hero, comfort]) => ({
        hero,
        comfort,
        playPct: 0,
        winRate: 0,
        games: 0,
        sources: {},
      })),
      ngsWins: 0,
      ngsLosses: 0,
      confidence: "high" as const,
      heroesProfileUrl: "",
      ngsProfileUrl: "",
      returningFromPrior: false,
    });
    const homeRoster = [
      player("A#1", [["Anub'arak", 0.3], ["Qhira", 0.2]]),
      player("B#1", [["Genji", 0.3], ["Malthael", 0.2]]),
      player("C#1", [["Greymane", 0.25]]),
    ];
    const full = gradeFinishedDraft({ ...base, homeRoster, steps: [] });
    expect(full.ours.notes.join(" ")).not.toContain("Unplayed");

    const withAzmodan = gradeFinishedDraft({
      ...base,
      homeRoster,
      ourLocked: [...ourLocked.slice(0, 4), { hero: "Azmodan", player: "C" }],
      steps: [],
    });
    expect(withAzmodan.ours.notes[0]).toContain("Unplayed: Azmodan (C, blind)");
    expect(withAzmodan.ours.notes[0]).toContain("blind game");
    expect(withAzmodan.ours.quality).toBeLessThan(full.ours.quality - 15);
    expect(withAzmodan.reasons.join(" ")).toContain("locked Azmodan");
  });

  it("never lets a lock beat its step's best, and counts Varian as the tank", () => {
    expect(sumStepPoints([step("our", 20, 30)]).pct).toBe(100);
    expect(percentileToGrade(97)).toBe("A+");
    expect(percentileToGrade(90)).toBe("A-");
    expect(percentileToGrade(85)).toBe("B");
    expect(percentileToGrade(64)).toBe("D");
    expect(percentileToGrade(59)).toBe("F");
    const card = gradeFinishedDraft({ ...base, steps: [] });
    expect(card.theirs.notes.join(" ")).not.toContain("tank");
    expect(card.ours.notes.join(" ")).toContain("Missing: healer");
    expect(card.draftWinPct).toBeLessThan(50);
  });

  it("letter-grades every step on its percentile, not its raw score", () => {
    const card = gradeFinishedDraft({
      ...base,
      steps: [
        step("our", 60, 60, 100),
        step("our", 36, 7, 88),
        step("our", -5, -12, 72),
      ],
    });
    // A 7/36 ban or a negative pick can still beat most of the field.
    expect(card.ours.steps.map((s) => s.grade)).toEqual(["A+", "B+", "C-"]);
    expect(stepPct({ best: -5, achieved: -5 })).toBe(100);
  });

  it("shifts win chance by the team MMR gap at the NGS-fitted weight", () => {
    expect(mmrAdjustedWinPct(50, 2075, 2000)).toBe(73);
    expect(mmrAdjustedWinPct(39, 2000, 2075)).toBe(19);
    expect(mmrAdjustedWinPct(60, 2000, 2000)).toBe(60);
    const card = gradeFinishedDraft({ ...base, steps: [], ourMmr: 2600, theirMmr: 2500 });
    expect(card.mmrWinPct).toBeGreaterThan(card.draftWinPct);
    expect(card.mmrGap).toBe(100);
    expect(favouredLabel(41, "LBB", "TG")).toBe("TG favoured, 59%");
  });
});

describe("counter severity", () => {
  const g = (hero: string, winRate: number) => ({
    hero,
    winRate,
    influence: 0,
    popularity: 0,
    banRate: 0,
    pickRate: 0,
    games: 5000,
  });
  const enemy = (hero: string, enemyWinRate: number, games: number) => ({
    hero,
    wins: 0,
    losses: 0,
    games,
    enemyWinRate,
  });
  // Samuro baseline 53.5 → enemies are expected to win 46.5% into him.
  const table = buildDraftMetaTable({
    patch: "test",
    global: [g("Samuro", 53.5), g("Hogger", 51), g("Illidan", 50), g("Noise", 50)],
    matchups: {
      Samuro: [
        enemy("Hogger", 54.4, 3333),
        enemy("Illidan", 55, 4705),
        enemy("Noise", 49, 4000),
        enemy("Thin", 62, 50),
        enemy("Tiny", 70, 20),
      ],
    },
  });
  const counters = table.byHero.Samuro?.counteredBy ?? [];

  it("keeps a sub-55% answer when it beats the hero's normal loss rate", () => {
    expect(counters.map((c) => c.hero)).toContain("Hogger");
    expect(counters.map((c) => c.hero)).toContain("Illidan");
    expect(counters.map((c) => c.hero)).toContain("Thin");
    expect(counters.map((c) => c.hero)).not.toContain("Noise");
    expect(counters.map((c) => c.hero)).not.toContain("Tiny");
  });

  it("charges a big-sample 54% answer more than a thin 62% sample", () => {
    const hogger = counters.find((c) => c.hero === "Hogger");
    const thin = counters.find((c) => c.hero === "Thin");
    expect(hogger).toBeTruthy();
    expect(thin).toBeTruthy();
    expect(counterPenalty(hogger!)).toBeGreaterThan(4);
    expect(counterPenalty(hogger!)).toBeLessThanOrEqual(8);
    expect(counterPenalty(thin!)).toBeLessThan(2);
    expect(counterPenalty(hogger!)).toBeGreaterThan(counterPenalty(thin!));
  });
});

describe("duo scoring", () => {
  const ally = (hero: string, allyWinRate: number, games: number) => ({
    hero,
    wins: 0,
    losses: 0,
    games,
    allyWinRate,
  });
  const enemy = (hero: string, enemyWinRate: number, games: number) => ({
    hero,
    wins: 0,
    losses: 0,
    games,
    enemyWinRate,
  });
  const g = (hero: string, winRate: number) => ({
    hero,
    winRate,
    influence: 0,
    popularity: 0,
    banRate: 0,
    pickRate: 0,
    games: 5000,
  });
  const table = buildDraftMetaTable({
    patch: "test",
    global: [g("Tyrael", 54), g("Whitemane", 50), g("Falstad", 50), g("Valla", 50)],
    matchups: {
      Tyrael: [enemy("Valla", 44, 500)],
      Falstad: [enemy("Tyrael", 48, 800)],
    },
    allies: {
      Tyrael: [ally("Whitemane", 54, 1000), ally("Falstad", 57, 90)],
    },
  });

  it("scores every locked teammate as its own duo on absolute WR together", () => {
    const duos = allyDuos(table, "Tyrael", ["Whitemane", "Falstad", "Valla"]);
    expect(duos.map((d) => [d.hero, d.edgePp])).toEqual([
      ["Whitemane", 4],
      // Small samples count in full — more data comes from stacking patches.
      ["Falstad", 7],
    ]);
  });

  it("includes mild matchups from either hero's row, not only hard counters", () => {
    const duos = enemyDuos(table, "Tyrael", ["Valla", "Falstad"]);
    expect(duos.find((d) => d.hero === "Valla")?.winRate).toBe(56);
    // Falstad's row: Tyrael wins 48% into Falstad.
    expect(duos.find((d) => d.hero === "Falstad")?.edgePp).toBe(-2);
  });

  it("lists every locked hero in the breakdown, including unsampled ones", () => {
    const allies = ["Whitemane", "Falstad", "Valla"];
    const result = scoreDuos(
      allyDuos(table, "Tyrael", allies),
      SYNERGY_DUO,
      "together",
      allies,
      (ally) => duoMissingLine(table, "Tyrael", ally, "together"),
    );
    expect(result.lines).toEqual([
      "with Falstad: 57% together (90g) → +8",
      "with Whitemane: 54% together (1,000g) → +5",
      "with Valla: Valla ally matchups not loaded — queued… → 0",
    ]);
    expect(Math.round(result.points)).toBe(13);
    expect(missingDuoLabel(result.lines[2]!)).toBe("with Valla");
  });

  it("prioritizes their likely heroes in the matchup fetch queue", () => {
    const bare = (hero: string, loaded = false) => ({
      hero,
      winRate: 50,
      influence: 0,
      popularity: 0,
      banRate: 0,
      pickRate: 0,
      games: 0,
      timing: "flex" as const,
      counteredBy: [],
      synergiesWith: [],
      allySamples: [],
      matchupSamples: [],
      matchupsLoaded: loaded,
      allyGameCounts: loaded ? {} : undefined,
      matchupGameCounts: loaded ? {} : undefined,
      mapStrong: [],
      note: "",
    });
    const table = {
      patch: "test",
      source: "heroesprofile-sl" as const,
      byHero: {
        Anduin: bare("Anduin", true),
        Samuro: bare("Samuro"),
        Garrosh: bare("Garrosh"),
        Junkrat: bare("Junkrat"),
        Deathwing: bare("Deathwing"),
        Guldan: bare("Gul'dan"),
      },
    };
    expect(
      matchupFetchQueue(
        table,
        ["Garrosh", "Anduin", "Junkrat", "Deathwing", "Gul'dan", "Samuro"],
        ["Samuro", "Anduin"],
      ),
    ).toEqual(["Samuro", "Anduin", "Garrosh", "Junkrat", "Deathwing", "Gul'dan"]);
  });

  it("does not flag a hero as missing data into itself", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Samuro", winRate: 51.5, influence: 10, popularity: 6, banRate: 0, pickRate: 0, games: 1380 },
        { hero: "Anduin", winRate: 50, influence: 0, popularity: 10, banRate: 0, pickRate: 0, games: 4000 },
      ],
      matchups: {
        Samuro: [{ hero: "Anduin", wins: 55, losses: 45, games: 1000, enemyWinRate: 45 }],
        Anduin: [{ hero: "Samuro", wins: 45, losses: 55, games: 1000, enemyWinRate: 55 }],
      },
    });
    expect(duoMissingLine(table, "Samuro", "Samuro", "into")).toBeNull();
    const duos = enemyDuos(table, "Samuro", ["Anduin", "Samuro"]);
    const result = scoreDuos(duos, MATCHUP_DUO, "into", ["Anduin", "Samuro"], (enemy) =>
      duoMissingLine(table, "Samuro", enemy, "into"),
    );
    expect(result.lines.some((line) => /into Samuro/i.test(line))).toBe(false);
    expect(result.lines.some((line) => line.startsWith("into Anduin:"))).toBe(true);
  });

  it("explains ally gaps with ally load state, not enemy matchup counts", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [g("Zagara", 46.5), g("Muradin", 50)],
      matchups: {
        Zagara: [enemy("Muradin", 48, 2000)],
      },
    });
    expect(duoMissingLine(table, "Zagara", "Muradin", "together")).toContain(
      "Zagara ally matchups not loaded",
    );
  });

  it("explains why a duo scored 0 instead of a generic loading message", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Garrosh", winRate: 52, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 4000 },
        { hero: "Samuro", winRate: 50, influence: 0, popularity: 10, banRate: 0, pickRate: 0, games: 800 },
      ],
      matchups: {
        Garrosh: [{ hero: "Samuro", wins: 6, losses: 6, games: 12, enemyWinRate: 50 }],
        Samuro: [{ hero: "Garrosh", wins: 6, losses: 6, games: 12, enemyWinRate: 50 }],
      },
    });
    expect(pairingGameCount(table, "Garrosh", "Samuro")).toBe(12);
    const line = duoMissingLine(table, "Garrosh", "Samuro", "into");
    expect(line).toBe("into Samuro: only 12 SL games (need 40) → 0");
    expect(missingDuoReason(line ?? "")).toBe("only 12 SL games (need 40)");
    const unloaded = duoMissingLine(table, "Garrosh", "Anduin", "into");
    expect(unloaded).toContain("Anduin matchups not loaded");
  });

  it("keeps a hero with no played matchups on the fetch queue", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Tyrael", winRate: 52, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 4000 },
        { hero: "Valla", winRate: 50, influence: 0, popularity: 10, banRate: 0, pickRate: 0, games: 3000 },
      ],
      matchups: {
        Tyrael: [{ hero: "Valla", wins: 0, losses: 0, games: 0, enemyWinRate: 50 }],
        Valla: [],
      },
    });
    expect(matchupFetchQueue(table, ["Valla", "Tyrael"])).toEqual(["Valla", "Tyrael"]);
    expect(duoMissingLine(table, "Tyrael", "Valla", "into", new Set(["Tyrael"]))).toContain(
      "fetching",
    );
    expect(enemyDuos(table, "Tyrael", ["Valla"])).toEqual([]);
  });

  it("reads into Tyrael from Tyrael's row when our hero was never fetched", () => {
    const bare = (hero: string) => ({
      hero,
      winRate: 50,
      influence: 0,
      popularity: 0,
      banRate: 0,
      pickRate: 0,
      games: 0,
      timing: "flex" as const,
      counteredBy: [],
      synergiesWith: [],
      allySamples: [],
      matchupSamples: [],
      mapStrong: [],
      note: "",
    });
    const base = {
      patch: "test",
      source: "heroesprofile-sl" as const,
      byHero: {
        Garrosh: bare("Garrosh"),
        Tyrael: bare("Tyrael"),
        Rehgar: bare("Rehgar"),
      },
    };
    expect(enemyDuos(base, "Garrosh", ["Tyrael", "Rehgar"])).toEqual([]);
    expect(heroesMissingMatchupLoad(base, ["Tyrael", "Rehgar", "Garrosh"])).toEqual([
      "Tyrael",
      "Rehgar",
      "Garrosh",
    ]);
    expect(
      heroesMissingMatchupLoad(base, ["Tyrael", "Flex", "Flex ban", ""]),
    ).toEqual(["Tyrael"]);

    const loaded = buildDraftMetaTable({
      patch: "test",
      global: [
        {
          hero: "Tyrael",
          winRate: 52,
          influence: 10,
          popularity: 20,
          banRate: 0,
          pickRate: 0,
          games: 4000,
        },
      ],
      matchups: {
        Tyrael: [
          { hero: "Garrosh", wins: 60, losses: 40, games: 100, enemyWinRate: 40 },
        ],
      },
    });
    const merged = mergeLoadedMatchupRows(base, {
      Tyrael: loaded.byHero.Tyrael,
    });
    const duos = enemyDuos(merged, "Garrosh", ["Tyrael", "Rehgar"]);
    expect(duos.find((d) => d.hero === "Tyrael")?.winRate).toBe(40);
    expect(duos.find((d) => d.hero === "Rehgar")).toBeUndefined();
    expect(heroesMissingMatchupLoad(merged, ["Tyrael"])).toEqual([]);
    expect(heroesMissingMatchupLoad(merged, ["Rehgar"])).toEqual(["Rehgar"]);
    const lines = scoreDuos(duos, SYNERGY_DUO, "into", ["Tyrael", "Rehgar"]).lines;
    expect(lines.some((line) => line.startsWith("into Tyrael:"))).toBe(true);
    expect(missingDuoLabel(lines.find((line) => line.startsWith("into Rehgar"))!)).toBe(
      "into Rehgar",
    );
  });
});

describe("suggestion data gap", () => {
  const loaded = "into Diablo: 54% win rate (800g) → +2";
  const fetching = "into Garrosh: fetching Storm League… → 0";
  const thin = "with Anduin: only 12 SL games (need 40) → 0";

  it("reports the loaded share while a duo is still fetching", () => {
    const gap = suggestionDataGap({
      heroes: ["Valla"],
      lines: [loaded, fetching],
      queued: ["Valla"],
      failed: [],
    });
    expect(gap).toMatchObject({
      percent: 50,
      loading: true,
      failed: false,
    });
    expect(gap?.missing).toEqual([
      "into Garrosh: fetching Storm League…",
    ]);
    expect(suggestionDataGapTooltip(gap!)).toBe(
      "Missing data\ninto Garrosh: fetching Storm League…\n50% loaded",
    );
  });

  it("names the hero payload when the card has no duo lines yet", () => {
    const gap = suggestionDataGap({
      heroes: ["Valla"],
      lines: ["2 duos, net +4"],
      queued: ["Valla"],
      failed: [],
    });
    expect(gap).toMatchObject({
      missing: ["Storm League matchups for Valla"],
      percent: 0,
      loading: true,
      failed: false,
    });
  });

  it("stays amber without a percent once the gaps are settled", () => {
    const gap = suggestionDataGap({
      heroes: ["Valla"],
      lines: [loaded, thin],
      queued: [],
      failed: [],
    });
    expect(gap).toMatchObject({ loading: false, failed: false, percent: 50 });
    expect(suggestionDataGapTooltip(gap!)).not.toMatch(/% loaded/);
  });

  it("marks the card failed when that hero's pull failed", () => {
    const gap = suggestionDataGap({
      heroes: ["Valla", "Tyrande"],
      lines: [fetching],
      queued: ["Valla"],
      failed: ["Tyrande"],
    });
    expect(gap?.failed).toBe(true);
    expect(gap?.loading).toBe(false);
    expect(suggestionDataGapTooltip(gap!).startsWith("Failed to load")).toBe(true);
  });

  it("returns nothing when every duo line has a sample", () => {
    expect(
      suggestionDataGap({
        heroes: ["Valla"],
        lines: [loaded],
        queued: [],
        failed: [],
      }),
    ).toBeNull();
  });
});

describe("matchup data depth", () => {
  it("pulls more patches while ally duos are still imprecise, not just enemies", () => {
    const precise = { hero: "X", wins: 0, losses: 0, games: 5000, enemyWinRate: 50 };
    expect(
      matchupsNeedMoreGames({
        enemies: [precise],
        allies: [{ hero: "Y", wins: 0, losses: 0, games: 200, allyWinRate: 52 }],
      }),
    ).toBe(true);
    expect(
      matchupsNeedMoreGames({
        enemies: [precise],
        allies: [{ hero: "Y", wins: 0, losses: 0, games: 5000, allyWinRate: 52 }],
      }),
    ).toBe(false);
    expect(matchupsNeedMoreGames({ enemies: [], allies: [] })).toBe(true);
  });
});

describe("data-driven structure checks", () => {
  it("names the answering side in the pool note", () => {
    const threats = [{ hero: "Hogger", theirWinRate: 55, games: 200, deltaPp: 4 }];
    expect(counterPoolNote(threats, [], "ours")).toBe(
      "Not fearing Hogger — not in our played pool.",
    );
    expect(counterPoolNote(threats, [])).toBe(
      "Not fearing Hogger — not in their played pool.",
    );
  });

  it("names the role each hero covers in a pair", () => {
    const result = pairRoleCheck(
      [
        { hero: "Tyrael", role: "Tank", player: null, note: "locked" },
        { hero: "Whitemane", role: "Healer", player: null, note: "locked" },
        { hero: "Leoric", role: "Offlane", player: null, note: "locked" },
      ] as DraftCompPick[],
      "Whitemane",
      "Leoric",
    );

    expect(result.points).toBe(0);
    expect(result.firstDetail).toBe("Covers healer");
    expect(result.secondDetail).toBe("Covers offlane");
    expect(result.detail).toBe("Still need ranged damage · 2 picks left");
  });

  it("uses the reverse-direction ally sample when the first hero row is empty", () => {
    const table = {
      patch: "test",
      source: "heroesprofile-sl",
      byHero: {
        Whitemane: {
          hero: "Whitemane",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 0,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
        Tyrael: {
          hero: "Tyrael",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 0,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [
            {
              hero: "Whitemane",
              allyWinRate: 56,
              games: 120,
              deltaPp: 6,
            },
          ],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
      },
    } as DraftMetaTable;

    const result = pairDuoSynergy(table, "Whitemane", "Tyrael");

    expect(result.detail).toContain("56% together");
    expect(result.detail).not.toContain("No duo sample");
    expect(result.points).toBeGreaterThan(0);
  });

  it("labels missing ally data as unavailable instead of silently neutral", () => {
    const table = {
      patch: "test",
      source: "heroesprofile-sl",
      byHero: {
        Whitemane: {
          hero: "Whitemane",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 0,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
        Tyrael: {
          hero: "Tyrael",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 0,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
      },
    } as DraftMetaTable;

    const result = pairDuoSynergy(table, "Whitemane", "Tyrael");

    expect(result.detail).toContain("ally matchups not loaded");
    expect(result.points).toBe(0);
  });

  it("scores Tyrael with Azmodan from the ally payload instead of calling it missing", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Tyrael", winRate: 52, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 4000 },
        { hero: "Azmodan", winRate: 51, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 4000 },
      ],
      matchups: { Tyrael: [], Azmodan: [] },
      allies: {
        Tyrael: [{ hero: "Azmodan", wins: 808, losses: 651, games: 1459, allyWinRate: 55.38 }],
      },
    });
    const result = pairDuoSynergy(table, "Tyrael", "Azmodan");
    expect(result.detail).toContain("55.4% together");
    expect(result.detail).not.toContain("not loaded");
    expect(result.points).not.toBe(0);
  });

  it("keeps fetching a hero that has enemy rows but no ally payload", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Tyrael", winRate: 52, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 4000 },
      ],
      matchups: {
        Tyrael: [{ hero: "Raynor", wins: 40, losses: 60, games: 100, enemyWinRate: 60 }],
      },
    });
    expect(matchupFetchQueue(table, ["Tyrael"])).toEqual(["Tyrael"]);
  });

  it("uses HeroesProfile map rows as the source of truth, not a hardcoded map list", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        {
          hero: "Tyrael",
          winRate: 50,
          influence: 50,
          popularity: 40,
          banRate: 0,
          pickRate: 0,
          games: 200,
        },
      ],
      matchups: { Tyrael: [] },
      mapStats: [
        { hero: "Tyrael", map: "Infernal Shrines", winRate: 57, games: 120 },
        { hero: "Tyrael", map: "Tomb of the Spider Queen", winRate: 48, games: 90 },
      ],
    });

    expect(isMapSpecialist(table, "Tyrael", "Infernal Shrines")).toMatchObject({
      map: "Infernal Shrines",
      winRate: 57,
      deltaPp: 7,
      games: 120,
    });
    expect(isMapSpecialist(table, "Tyrael", "Tomb of the Spider Queen")).toBeNull();
    expect(isMapSpecialist(table, "Tyrael", "Infernal Shrines")?.map).not.toBe("Blackheart's Bay");
    expect(mapSpecialistTooltip(isMapSpecialist(table, "Tyrael", "Infernal Shrines"))).toContain("57.0% WR");
    expect(mapSpecialistTooltip(isMapSpecialist(table, "Tyrael", "Infernal Shrines"))).toContain("95% CI target");
  });

  it("fails fast when the map-stat dataset is empty instead of silently treating it as zero", () => {
    expect(() => validateHeroMapStats([])).toThrow(HeroesProfileError);
    expect(() => validateHeroMapStats([])).toThrow(/empty.*map/i);
  });

  it("parses the map-keyed payload returned by HeroesProfile group_by_map", () => {
    expect(
      parseHeroMapStats({
        "Infernal Shrines": [
          { name: "Tyrael", win_rate: 57, games_played: 120 },
        ],
      }),
    ).toEqual([
      {
        hero: "Tyrael",
        map: "Infernal Shrines",
        winRate: 57,
        games: 120,
      },
    ]);
  });

  it("parses a successful top-level payload when the response has no data wrapper", () => {
    expect(
      parseHeroMapStats([
        {
          name: "Tyrael",
          map: "Infernal Shrines",
          win_rate: 57,
          games_played: 120,
        },
      ]),
    ).toEqual([
      {
        hero: "Tyrael",
        map: "Infernal Shrines",
        winRate: 57,
        games: 120,
      },
    ]);
  });

  it("parses a hero-keyed grouped map payload without inventing zero-valued parent rows", () => {
    expect(
      parseHeroMapStats({
        Tyrael: {
          "Infernal Shrines": { win_rate: 57, games_played: 120 },
        },
      }),
    ).toEqual([
      {
        hero: "Tyrael",
        map: "Infernal Shrines",
        winRate: 57,
        games: 120,
      },
    ]);
  });

  it("parses the real map-to-hero grouped response shape without a data wrapper", () => {
    expect(
      parseHeroMapStats({
        "Infernal Shrines": {
          Tyrael: { win_rate: 57, games_played: 120 },
        },
      }),
    ).toEqual([
      {
        hero: "Tyrael",
        map: "Infernal Shrines",
        winRate: 57,
        games: 120,
      },
    ]);
  });

  it("drops a stale empty cached payload before reusing it", async () => {
    const key = "__test-empty-map-cache__";
    await invalidateCached(key);
    await setCached(key, [], 60_000);

    const result = await cachedFetch(
      key,
      async () => [{ hero: "Tyrael", map: "Infernal Shrines", winRate: 57, games: 120 }],
      60_000,
      { isEmpty: (rows) => !Array.isArray(rows) || rows.length === 0 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].hero).toBe("Tyrael");
    await invalidateCached(key);
  });

});

describe("opponent draft explanations", () => {
  it("explains why the enemy projects as dive from tags on their projected heroes", () => {
    expect(
      explainTheirArchetypeRead("Tricky Gooses", "dive", [
        "Tyrael",
        "Genji",
        "Brightwing",
      ]),
    ).toContain("Tricky Gooses project as dive: dive tags on Tyrael / Genji");
  });

  it("explains anti-dive bans as removing a counter to the dive shell", () => {
    expect(
      explainTheirLikelyBan("Tricky Gooses", "Tyrael", "Polarus", "dive"),
    ).toContain("Tyrael is an anti-dive counter, so Tricky Gooses should remove it");
  });

  it("removes the future opposing-ban expectation while we are choosing our own ban", () => {
    expect(
      expectTheirNext(
        [
          { hero: "Auriel", side: "our", kind: "ban" },
          { hero: "Arthas", side: "their", kind: "ban" },
        ],
        0,
        new Set(),
        [],
        true,
      ),
    ).toBeNull();
  });

  it("does not expect a hero from a player who already locked", () => {
    expect(
      expectTheirNext(
        [],
        0,
        new Set(),
        [
          {
            hero: "Valla",
            role: "Ranged Assassin",
            player: "SuperGoBu",
            note: null,
          },
          {
            hero: "Reghar",
            role: "Healer",
            player: "Frijolito",
            note: null,
          },
        ],
        false,
        new Set(["supergobu"]),
      ),
    ).toBe("Expect them toward Reghar (Frijolito) from their likely five.");
  });
});

describe("a locked player cannot be suggested another hero", () => {
  function pocket(tag: string, heroes: [string, number][]): PlayerScout {
    return {
      battletag: tag,
      preferredRole: null,
      topHeroes: heroes.map(([hero, comfort]) => ({
        hero,
        comfort,
        playPct: 0,
        winRate: 0,
        games: 10,
        sources: {
          stormLeague: { games: 10, wins: 6, losses: 4, winRate: 0.6, playPct: 0.2 },
        },
      })),
      ngsWins: 0,
      ngsLosses: 0,
      confidence: "low",
      heroesProfileUrl: "",
      ngsProfileUrl: "",
      returningFromPrior: false,
    };
  }

  it("seats SuperGoBu on an unnamed Dehaka lock and will not offer him Valla", () => {
    const roster = [
      pocket("SuperGoBu#1", [
        ["Valla", 0.9],
        ["Dehaka", 0.7],
      ]),
      pocket("Frijolito#2", [
        ["Reghar", 0.8],
        ["Dehaka", 0.2],
      ]),
    ];
    const seated = playersSeatedOnLocks({
      locks: [{ hero: "Dehaka", player: null }],
      roster,
      claimUnnamed: true,
    });
    expect(seated.has("supergobu")).toBe(true);
    const next = slHeroSuggestions({
      roster,
      gone: new Set(["dehaka"]),
      takenPlayers: seated,
    });
    expect(next.map((pick) => pick.player)).toEqual(["Frijolito"]);
    expect(next.some((pick) => pick.hero === "Valla")).toBe(false);
  });

  it("keeps a named lock without guessing a second owner", () => {
    expect(
      [
        ...playersSeatedOnLocks({
          locks: [{ hero: "Dehaka", player: "SuperGoBu#1" }],
          roster: [],
          claimUnnamed: true,
        }),
      ],
    ).toEqual(["supergobu"]);
  });
});

describe("seat suggestion text stays aligned with the live plan", () => {
  it("lists the needed role before the hero in current-plan blurbs", () => {
    expect(
      planPickLabel({
        hero: "Stitches",
        role: "Tank",
        player: "Beachyman",
        note: "need",
      }),
    ).toBe("NEED    Tank — Beachyman · Stitches");
  });

  it("uses Tank Healer Offlane Assassin Flex seat names for the current plan", () => {
    expect(
      planSeatJob({ hero: "Stitches", role: "Tank", player: null, note: null }),
    ).toBe("Tank");
    expect(
      planSeatJob({ hero: "Whitemane", role: "Healer", player: null, note: null }),
    ).toBe("Healer");
    expect(
      planSeatJob({ hero: "Malthael", role: "Offlane", player: null, note: null }),
    ).toBe("Offlane");
    expect(
      planSeatJob({ hero: "Raynor", role: "Ranged", player: null, note: null }),
    ).toBe("Assassin");
    expect(
      planSeatJob({ hero: "Qhira", role: "4-man", player: null, note: null }),
    ).toBe("Flex");
  });

  it("keeps an unscored final double on the report card as picks 4 and 5", () => {
    const order: { side: "fp" | "sp"; kind: "ban" | "pick" }[] = [
      { side: "fp", kind: "ban" },
      { side: "sp", kind: "ban" },
      { side: "fp", kind: "ban" },
      { side: "sp", kind: "ban" },
      { side: "fp", kind: "pick" },
      { side: "sp", kind: "pick" },
      { side: "sp", kind: "pick" },
      { side: "fp", kind: "pick" },
      { side: "fp", kind: "pick" },
      { side: "sp", kind: "ban" },
      { side: "fp", kind: "ban" },
      { side: "sp", kind: "pick" },
      { side: "sp", kind: "pick" },
      { side: "fp", kind: "pick" },
      { side: "fp", kind: "pick" },
      { side: "sp", kind: "pick" },
    ];
    const counts = { fp: { ban: 0, pick: 0 }, sp: { ban: 0, pick: 0 } };
    const history = order.map((step, index) => {
      counts[step.side][step.kind] += 1;
      const unscored = index === 13 || index === 14;
      return {
        side: (step.side === "fp" ? "their" : "our") as "our" | "their",
        kind: step.kind,
        ordinal: counts[step.side][step.kind],
        hero: index === 13 ? "Yrel" : index === 14 ? "Diablo" : `H${index}`,
        score: unscored
          ? undefined
          : {
              best: 10,
              achieved: 10,
              bestLabel: `H${index}`,
              percentile: 90,
              fieldSize: 4,
            },
      };
    });
    const steps = collectReportSteps(history, () => ({
      best: 40,
      achieved: 8,
      bestLabel: "Rehgar + Sylvanas",
      percentile: 12,
      fieldSize: 20,
    }));
    const theirs = steps.filter((step) => step.side === "their");
    expect(theirs.map((step) => step.label)).toEqual([
      "Ban 1",
      "Ban 2",
      "Pick 1",
      "Picks 2 + 3",
      "Ban 3",
      "Picks 4 + 5",
    ]);
    expect(theirs.find((step) => step.label === "Picks 4 + 5")).toMatchObject({
      locked: "Yrel + Diablo",
      bestLabel: "Rehgar + Sylvanas",
      percentile: 12,
    });
  });

  it("suggests the open plan hero instead of that player's highest-volume Storm League pick", () => {
    const roster = [
      {
        battletag: "MrHustler#1686",
        preferredRole: "Assassin",
        topHeroes: [
          {
            hero: "Qhira",
            comfort: 0.9,
            playPct: 0,
            winRate: 60,
            games: 64,
            sources: {
              stormLeague: {
                games: 64,
                wins: 38,
                losses: 26,
                winRate: 59,
                playPct: 0,
              },
            },
          },
          {
            hero: "Illidan",
            comfort: 0.2,
            playPct: 0,
            winRate: 50,
            games: 8,
            sources: {
              stormLeague: {
                games: 8,
                wins: 4,
                losses: 4,
                winRate: 50,
                playPct: 0,
              },
            },
          },
        ],
        ngsWins: 0,
        ngsLosses: 0,
        confidence: "high" as const,
        heroesProfileUrl: "",
        ngsProfileUrl: "",
        returningFromPrior: false,
      },
    ];
    const plan = [
      {
        hero: "Stitches",
        role: "Tank",
        player: "Beachyman",
        note: "locked",
      },
      {
        hero: "Illidan",
        role: "Assassin",
        player: "MrHustler",
        note: "need",
      },
    ];
    const next = applyPlanSeatsToSlSuggestions(
      [
        {
          player: "MrHustler",
          hero: "Qhira",
          sl: 0.9,
          comfort: 0.9,
          games: 64,
        },
      ],
      plan,
      new Set(),
      roster,
    );
    expect(next.map((pick) => pick.hero)).toEqual(["Illidan"]);
    expect(next[0].games).toBe(8);
    expect(openPlanHeroForPlayer("MrHustler", plan, new Set(["illidan"]))).toBe(
      null,
    );
  });

  it("uses the seat alternative when the planned hero is already gone", () => {
    const plan = [
      {
        hero: "Illidan",
        role: "Assassin",
        player: "MrHustler",
        note: "need",
        alternatives: [{ hero: "Valla", player: "MrHustler" }],
      },
    ];
    expect(
      openPlanHeroForPlayer("MrHustler", plan, new Set(["illidan"])),
    ).toBe("Valla");
  });

  it("allows a same-role swap only when the suggestion is for the same player on that seat", () => {
    const picks = [
      { hero: "Stitches", role: "Tank", player: "Beachman", note: "need" },
      { hero: "Whitemane", role: "Healer", player: "Tyrann", note: "need" },
    ];

    const matched = findSeatForCandidate(picks, "Tyrael", "Beachman");
    expect(matched).not.toBeNull();
    expect(matched?.seat.hero).toBe("Stitches");

    const updated = showSuggestionOnPlan(picks, "Tyrael", "Beachman");
    expect(updated[0].hero).toBe("Tyrael");
    expect(updated[0].player).toBe("Beachman");

    const blocked = findSeatForCandidate(picks, "Tyrael", "Tyrann");
    expect(blocked).toBeNull();
  });

  it("keeps a live locked Whitemane seat green instead of rebinding it to a suggestion", () => {
    const picks = [
      { hero: "Whitemane", role: "Healer", player: "Tyrann", note: "locked" },
      { hero: "Stitches", role: "Tank", player: "Beachman", note: "need" },
    ];

    expect(isLockedPlanSeat(picks[0])).toBe(true);
    expect(showSuggestionOnPlan(picks, "Tyrael", "Beachman")[0].hero).toBe("Whitemane");
  });

  it("does not rewrite multiple seats just because the same hero appears twice in a stale plan", () => {
    const picks = [
      { hero: "Whitemane", role: "Healer", player: "Beachman", note: "need" },
      { hero: "Stitches", role: "Tank", player: "MrHustler", note: "need" },
      { hero: "Malthael", role: "Offlane", player: "MoJoe", note: "need" },
      { hero: "Raynor", role: "Ranged", player: "Topgun707", note: "need" },
    ];

    const updated = showSuggestionOnPlan(picks, "Whitemane", "Beachman");
    expect(updated.filter((p) => p.hero === "Whitemane")).toHaveLength(1);
    expect(updated.find((p) => p.role === "Tank")?.hero).toBe("Stitches");
  });
});

describe("assignUniqueOwners", () => {
  const player = (battletag: string, heroes: [string, number][]) => ({
    battletag,
    preferredRole: null,
    topHeroes: heroes.map(([hero, comfort]) => ({
      hero,
      comfort,
      playPct: 0,
      winRate: 0,
      games: 0,
      sources: {},
    })),
    ngsWins: 0,
    ngsLosses: 0,
    confidence: "high" as const,
    heroesProfileUrl: "",
    ngsProfileUrl: "",
    returningFromPrior: false,
  });

  it("fills every seat instead of letting the strongest claim strand a hero", () => {
    // Greedy: HuckIt takes Tyrande (.34), MoJoE takes Samuro, and Tyrael's only
    // remaining owner (HuckIt .15) is gone — a playable board reads "unplayed".
    const roster = [
      player("MoJoE#1", [["Samuro", 0.28], ["Tyrael", 0.19]]),
      player("MrHustler#1", [["Tyrande", 0.22]]),
      player("HuckIt#1", [["Tyrande", 0.34], ["Tyrael", 0.15]]),
    ];
    const assigned = assignUniqueOwners({
      locked: [{ hero: "Samuro" }, { hero: "Tyrande" }, { hero: "Tyrael" }],
      roster,
    });
    expect(assigned.map((a) => a.player)).toEqual([
      "MoJoE",
      "MrHustler",
      "HuckIt",
    ]);
  });

  it("seats a hero nobody has on record with whoever is left over", () => {
    const roster = [
      player("A#1", [["Genji", 0.4], ["Arthas", 0.1]]),
      player("B#1", [["Arthas", 0.3]]),
      player("C#1", []),
    ];
    const assigned = assignUniqueOwners({
      locked: [{ hero: "Genji" }, { hero: "Arthas" }, { hero: "Probius" }],
      roster,
    });
    expect(assigned.map((a) => a.player)).toEqual(["A", "B", "C"]);
  });

  it("charges the comfort gap when a new lock pushes someone onto an earlier hero", () => {
    const roster = [
      player("HuckIt#1", [
        ["Maiev", 0.4],
        ["Rehgar", 0.5],
      ]),
      player("Beachyman#1", [
        ["Maiev", 0.12],
        ["Rehgar", 0.05],
      ]),
    ];
    const moved = displacedComfort({
      roster,
      locked: [{ hero: "Maiev", player: "HuckIt" }],
      hero: "Rehgar",
    });
    expect(moved.moves).toEqual([
      {
        hero: "Maiev",
        from: "HuckIt",
        to: "Beachyman",
        fromComfort: 0.4,
        toComfort: 0.12,
      },
    ]);
    expect(moved.delta).toBeCloseTo(-0.28);
    expect(moved.detail).toContain("Beachyman takes Maiev from HuckIt");
    expect(moved.detail).toContain("40 → 12");

    const stayed = displacedComfort({
      roster: [
        player("HuckIt#1", [["Maiev", 0.4]]),
        player("Beachyman#1", [
          ["Rehgar", 0.5],
          ["Maiev", 0.05],
        ]),
      ],
      locked: [{ hero: "Maiev", player: "HuckIt" }],
      hero: "Rehgar",
    });
    expect(stayed.moves).toEqual([]);
    expect(stayed.delta).toBe(0);
  });

  it("moves an earlier owner when the swap raises total comfort, and keeps who it was drafted for", () => {
    const roster = [
      player("HuckIt#1", [
        ["Tyrande", 0.3],
        ["Tyrael", 0.4],
      ]),
      player("MrHustler#1", [["Tyrande", 0.28]]),
    ];
    const first = nextSeatLabels({
      picks: [{ hero: "Tyrande" }],
      roster,
      reshuffle: true,
    });
    expect(first[0]).toEqual({
      hero: "Tyrande",
      player: "HuckIt",
      draftedFor: "HuckIt",
    });
    const both = nextSeatLabels({
      picks: [
        { hero: "Tyrande", draftedFor: first[0].draftedFor },
        { hero: "Tyrael" },
      ],
      roster,
      reshuffle: true,
    });
    expect(both.map((a) => [a.hero, a.player, a.draftedFor])).toEqual([
      ["Tyrande", "MrHustler", "HuckIt"],
      ["Tyrael", "HuckIt", "HuckIt"],
    ]);
    const frozen = nextSeatLabels({
      picks: both.map((a) => ({ hero: a.hero, draftedFor: a.draftedFor })),
      roster,
      reshuffle: false,
    });
    expect(frozen.map((a) => [a.player, a.draftedFor])).toEqual([
      ["HuckIt", "HuckIt"],
      ["MrHustler", "HuckIt"],
    ]);
  });

  it("leaves a seat empty only when no player is free", () => {
    const roster = [player("A#1", [["Genji", 0.4]])];
    const assigned = assignUniqueOwners({
      locked: [{ hero: "Genji" }, { hero: "Azmodan" }],
      roster,
    });
    expect(assigned.map((a) => a.player)).toEqual(["A", null]);
  });
});

describe("solveSeatAssignments", () => {
  it("chooses the higher-scoring owner for each same-hero seat competition before trusting a greedy fill", () => {
    const players = [
      {
        battletag: "Topgun#1",
        preferredRole: "Offlane",
        topHeroes: [
          { hero: "Malthael", comfort: 0.82, playPct: 0, winRate: 0, games: 0, sources: {} },
          { hero: "Falstad", comfort: 0.68, playPct: 0, winRate: 0, games: 0, sources: {} },
        ],
        ngsWins: 0,
        ngsLosses: 0,
        confidence: "high",
        heroesProfileUrl: "",
        ngsProfileUrl: "",
        returningFromPrior: false,
      },
      {
        battletag: "MojoE#2",
        preferredRole: "Ranged",
        topHeroes: [
          { hero: "Malthael", comfort: 0.41, playPct: 0, winRate: 0, games: 0, sources: {} },
          { hero: "Falstad", comfort: 0.9, playPct: 0, winRate: 0, games: 0, sources: {} },
        ],
        ngsWins: 0,
        ngsLosses: 0,
        confidence: "high",
        heroesProfileUrl: "",
        ngsProfileUrl: "",
        returningFromPrior: false,
      },
    ] as any;

    const slots = [
      { role: "Offlane", heroes: ["Malthael", "Leoric", "Sonya"], why: "" },
      { role: "Ranged", heroes: ["Falstad", "Jaina", "Kael'thas"], why: "" },
    ];

    const best = solveSeatAssignments({
      players,
      slots,
      preferredTags: [],
    });

    expect(best.map((p) => [p.player, p.hero])).toContainEqual(["Topgun", "Malthael"]);
    expect(best.map((p) => [p.player, p.hero])).toContainEqual(["MojoE", "Falstad"]);
  });

  it("keeps the old fixed-seat behavior when tournament reshuffle is disabled", () => {
    const players = [
      {
        battletag: "Topgun#1",
        preferredRole: "Offlane",
        topHeroes: [
          { hero: "Malthael", comfort: 0.82, playPct: 0, winRate: 0, games: 0, sources: {} },
          { hero: "Falstad", comfort: 0.68, playPct: 0, winRate: 0, games: 0, sources: {} },
        ],
        ngsWins: 0,
        ngsLosses: 0,
        confidence: "high",
        heroesProfileUrl: "",
        ngsProfileUrl: "",
        returningFromPrior: false,
      },
      {
        battletag: "MojoE#2",
        preferredRole: "Ranged",
        topHeroes: [
          { hero: "Malthael", comfort: 0.41, playPct: 0, winRate: 0, games: 0, sources: {} },
          { hero: "Falstad", comfort: 0.9, playPct: 0, winRate: 0, games: 0, sources: {} },
        ],
        ngsWins: 0,
        ngsLosses: 0,
        confidence: "high",
        heroesProfileUrl: "",
        ngsProfileUrl: "",
        returningFromPrior: false,
      },
    ] as any;

    const slots = [
      { role: "Offlane", heroes: ["Malthael", "Leoric", "Sonya"], why: "" },
      { role: "Ranged", heroes: ["Falstad", "Jaina", "Kael'thas"], why: "" },
    ];

    const fixed = solveSeatAssignments({
      players,
      slots,
      preferredTags: [],
      allowSeatReshuffle: false,
    });

    expect(fixed.map((p) => p.hero)).toEqual(["Malthael", "Falstad"]);
    expect(fixed.every((p) => p.player === null)).toBe(true);
  });
});

describe("naked offlane opening risk", () => {
  it("does not flag a naked offlane opening as punished when no real counters remain", () => {
    const table: DraftMetaTable = {
      patch: "1.0",
      source: "heroesprofile-sl",
      byHero: {
        Dehaka: {
          hero: "Dehaka",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 200,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
      },
    };

    const risk = nakedOfflaneOpeningRisk({
      table,
      hero: "Dehaka",
      gone: new Set(),
      ourPickCount: 0,
      inPlan: true,
      planRole: "Offlane",
      answeringTeamLocked: [],
      answeringTeamPool: [],
      lastPick: false,
    });

    expect(risk).toEqual({
      points: 0,
      detail: "Naked offlane first pick — not punished yet",
      isRisk: false,
    });
  });

  it("flags a naked offlane opening as punishable only when real counters are still live", () => {
    const table: DraftMetaTable = {
      patch: "1.0",
      source: "heroesprofile-sl",
      byHero: {
        Dehaka: {
          hero: "Dehaka",
          winRate: 50,
          influence: 0,
          popularity: 0,
          banRate: 0,
          pickRate: 0,
          games: 200,
          timing: "flex",
          counteredBy: [{ hero: "Johanna", theirWinRate: 58, games: 80, deltaPp: 5 }],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
        Johanna: {
          hero: "Johanna",
          winRate: 55,
          influence: 20,
          popularity: 20,
          banRate: 0,
          pickRate: 0,
          games: 200,
          timing: "early",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
      },
    };

    const risk = nakedOfflaneOpeningRisk({
      table,
      hero: "Dehaka",
      gone: new Set(),
      ourPickCount: 0,
      inPlan: true,
      planRole: "Offlane",
      answeringTeamLocked: [],
      answeringTeamPool: ["Johanna"],
      lastPick: false,
    });

    expect(risk).toMatchObject({
      points: -16,
      detail: "Naked offlane first pick — punishable",
      isRisk: true,
    });
  });
});

describe("applyMapToDraftPlan", () => {
  it("rebuilds slots when map changes leave-dive pivot", () => {
    const poke = divePlaybook.pivots.find((p) => p.id === "poke")!;
    const global = divePlaybook.pivots.find((p) => p.id === "global")!;
    const pokeSlots = pivotPlanSlots(poke);
    const stubSide = {
      summary: "test",
      certainty: "medium" as const,
      contested: null,
      wePlayContested: null,
      baitBans: [],
      predicted: [],
      counterNote: "",
      theirLikely: [],
      ourLikely: pokeSlots.map((s) => ({
        role: s.role,
        hero: s.heroes[0],
        player: null,
        note: null,
      })),
      ourCompNote: "",
      ourBrief: {
        kind: "test",
        noTankReason: null,
        mapStrategy: "",
        whyItWorks: "",
        holes: null,
      },
      tree: { id: "t", title: "t", detail: "", children: [] },
    };
    const plan = {
      summary: "s",
      certainty: "medium",
      predictedPicks: [],
      baitBans: [],
      theirComp: "",
      fight: "",
      counter: "",
      macro: "",
      slots: pokeSlots,
      steps: [],
      theirLikely: [],
      ourLikely: stubSide.ourLikely,
      ourCompNote: "",
      ourBrief: stubSide.ourBrief,
      tree: stubSide.tree,
      sides: { weFirst: stubSide, theyFirst: stubSide },
      playbook: {
        intro: "i",
        antiDiveThreat: true,
        antiDiveHeroesSeen: ["Tyrael", "Brightwing"],
        keepQhira: true,
        recommended: {
          id: poke.id,
          name: poke.name,
          objective: poke.objective,
          heroes: [...poke.heroes],
          maps: [...poke.maps],
          why: "why",
        },
        alternates: [],
        pivots: [],
      },
    } as unknown as DraftPlan;

    // Cursed Hollow is on the global pivot map list — should rebuild seats.
    const next = applyMapToDraftPlan(plan, "Cursed Hollow");
    expect(next.playbook?.recommended?.id).toBe(global.id);
    expect(next.slots.map((s) => s.role).join("|")).not.toBe(
      pokeSlots.map((s) => s.role).join("|"),
    );
  });
});
