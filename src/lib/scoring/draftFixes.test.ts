import { describe, expect, it } from "vitest";
import { cachedFetch, invalidateCached, setCached } from "@/lib/cache";
import {
  explainTheirArchetypeRead,
  explainTheirLikelyBan,
  expectTheirNext,
  findSeatForCandidate,
  isLockedPlanSeat,
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
  pctToGrade,
  stepPct,
  sumStepPoints,
  type DraftStepScore,
} from "@/lib/scoring/draftGrade";
import { heroKey } from "@/lib/scoring/heroMeta";
import { solveSeatAssignments } from "@/lib/scoring/draftPlan";
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
  counterPoolNote,
  enemyDuos,
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
  ): DraftStepScore => ({
    side,
    kind: "pick",
    label: `Pick ${best}`,
    locked: "X",
    bestLabel: "Y",
    best,
    achieved,
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

  it("grades each side on points achieved out of the best available", () => {
    const card = gradeFinishedDraft({
      ...base,
      steps: [step("our", 60, 45), step("our", 75, 40), step("their", 50, 50)],
    });
    expect(card.ours.points).toBe(85);
    expect(card.ours.bestPoints).toBe(135);
    expect(card.ours.pct).toBe(63);
    expect(card.ours.grade).toBe("D");
    expect(card.theirs.pct).toBe(100);
    expect(card.theirs.grade).toBe("A+");
    expect(card.ours.notes[0]).toContain("Biggest miss");
  });

  it("never lets a lock beat its step's best, and counts Varian as the tank", () => {
    expect(sumStepPoints([step("our", 20, 30)]).pct).toBe(100);
    expect(pctToGrade(88)).toBe("B+");
    const card = gradeFinishedDraft({ ...base, steps: [] });
    expect(card.theirs.notes.join(" ")).not.toContain("tank");
    expect(card.ours.notes.join(" ")).toContain("Missing: healer");
    expect(card.draftWinPct).toBeLessThan(50);
  });

  it("letter-grades every step on its own achieved / best", () => {
    const card = gradeFinishedDraft({
      ...base,
      steps: [step("our", 60, 60), step("our", 75, 40), step("our", -5, -12)],
    });
    expect(card.ours.steps.map((s) => s.grade)).toEqual(["A+", "F", "F"]);
    expect(stepPct({ best: -5, achieved: -5 })).toBe(100);
  });

  it("shifts win chance by the team MMR gap on the Elo scale", () => {
    expect(mmrAdjustedWinPct(50, 2400, 2000)).toBe(91);
    expect(mmrAdjustedWinPct(60, 2000, 2000)).toBe(60);
    const card = gradeFinishedDraft({ ...base, steps: [], ourMmr: 2600, theirMmr: 2500 });
    expect(card.mmrWinPct).toBeGreaterThan(card.draftWinPct);
    expect(card.mmrGap).toBe(100);
    expect(favouredLabel(41, "LBB", "TG")).toBe("TG favoured, 59%");
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
    const result = scoreDuos(allyDuos(table, "Tyrael", allies), SYNERGY_DUO, "together", allies);
    expect(result.lines).toEqual([
      "with Falstad: 57% together (90g) → +8",
      "with Whitemane: 54% together (1,000g) → +5",
      "with Valla: no sample with enough games → 0",
    ]);
    expect(Math.round(result.points)).toBe(13);
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

    expect(result.detail).toContain("ally data unavailable");
    expect(result.points).toBe(0);
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
