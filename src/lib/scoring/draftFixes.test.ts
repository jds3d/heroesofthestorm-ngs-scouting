import { describe, expect, it } from "vitest";
import {
  buildOpeningBanHoldNote,
  explainTheirArchetypeRead,
  explainTheirLikelyBan,
  expectTheirNext,
  findSeatForCandidate,
  isLockedPlanSeat,
  isValidStructureHero,
  planPickLabel,
  scoreProjectedCompStructure,
  showSuggestionOnPlan,
} from "@/components/InteractiveDraft";
import {
  chooseDivePivot,
  divePlaybook,
  pivotPlanSlots,
} from "@/config/divePlaybook";
import { healDenyGuideFor } from "@/config/healDenyPlaybook";
import { applyMapToDraftPlan } from "@/lib/scoring/applyMap";
import { gradeFinishedDraft } from "@/lib/scoring/draftGrade";
import { heroKey } from "@/lib/scoring/heroMeta";
import { solveSeatAssignments } from "@/lib/scoring/draftPlan";
import { pairDuoSynergy, pairStructureDelta } from "@/lib/scoring/pickPairs";
import {
  buildDraftMetaTable,
  isMapSpecialist,
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

describe("draftGrade", () => {
  it("caps grade when missing healer", () => {
    const card = gradeFinishedDraft({
      ourLocked: [
        { hero: "Anub'arak", player: null },
        { hero: "Qhira", player: null },
        { hero: "Genji", player: null },
        { hero: "Malthael", player: null },
        { hero: "Greymane", player: null },
      ],
      theirLocked: [
        { hero: "Johanna", player: null },
        { hero: "Rehgar", player: null },
        { hero: "Valla", player: null },
        { hero: "Sonya", player: null },
        { hero: "Falstad", player: null },
      ],
      ourOptimal: [],
      theirOptimal: [],
      homeRoster: [],
      theirRoster: [],
      table: null,
      map: null,
    });
    expect(["C+", "C", "C-", "D", "F"]).toContain(card.ours.grade);
  });
});

describe("data-driven structure checks", () => {
  it("names the actual hero filling each core seat in a covered pair", () => {
    const result = pairStructureDelta([], [
      { hero: "Tyrael", role: "Tank", player: null, note: "need" },
      { hero: "Whitemane", role: "Healer", player: null, note: "need" },
      { hero: "Leoric", role: "Offlane", player: null, note: "need" },
    ] as DraftCompPick[]);

    expect(result.points).toBeGreaterThan(0);
    expect(result.bits).toContain(
      "Core seats covered: Tyrael (tank) / Whitemane (heal) / Leoric (offlane)",
    );
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
  });

  it("does not punish a valid Deathwing two-bruiser structure when the patch meta says it is viable", () => {
    const table = {
      patch: "test",
      source: "heroesprofile-sl",
      byHero: {
        Deathwing: {
          hero: "Deathwing",
          winRate: 49,
          influence: 25,
          popularity: 14,
          banRate: 0,
          pickRate: 0,
          games: 180,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          mapStrong: [],
          note: "",
        },
      },
    } as any;

    const result = scoreProjectedCompStructure({
      hero: "Deathwing",
      livePicks: [],
      projected: [
        { hero: "Deathwing", role: "Bruiser", player: null, note: "need" },
        { hero: "Leoric", role: "Offlane", player: null, note: "need" },
      ],
      table,
    });

    expect(result.extra).toBe(0);
    expect(result.structureBits).toEqual([]);
  });
});

describe("opening ban hold notes", () => {
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

  it("suppresses hold-note leaks when the recommended ban is Auriel and Anduin is not the same mutual-ban call", () => {
    expect(
      buildOpeningBanHoldNote({
        ourBanCount: 0,
        hero: "Auriel",
        mutualFactor: { points: 18 },
      }),
    ).toBeNull();
  });

  it("keeps the hold note only when the current suggested hero itself is the mutual-ban hold", () => {
    expect(
      buildOpeningBanHoldNote({
        ourBanCount: 0,
        hero: "Anduin",
        mutualFactor: { points: -12 },
      }),
    ).toBe("If Anduin is still up, hold it for opening ban round 2 (our second of two opening bans — not a free 3rd)."
    );
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
