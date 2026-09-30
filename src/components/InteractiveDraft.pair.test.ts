import { describe, expect, it } from "vitest";
import type { DraftCompPick } from "@/lib/scoring/types";
import {
  pairDuoSynergy,
  pairScoreFactors,
  rankDoublePickPairs,
  scoreOrderedPair,
} from "@/lib/scoring/pickPairs";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";
import { buildPlayerComfort } from "@/lib/scoring/comfort";
import {
  buildPickScorecard,
  formatScoreGapSentence,
  gradeDeviation,
  pairProgressPlanPicks,
  pairCardClickHero,
  pairSeatCandidate,
  pairSeededPairOptions,
  pairStructureProjection,
  pairSideBreakdown,
  pairSuggestionCautionLine,
  resolvePairPickSelection,
  stepHeading,
  undoCount,
} from "./InteractiveDraft";

describe("resolvePairPickSelection", () => {
  it("keeps a lower-ranked hero comfort signal available for its assigned seat", () => {
    const stormLeague = new Map(
      [
        "Hero1", "Hero2", "Hero3", "Hero4", "Hero5", "Hero6", "Hero7", "Hero8", "Tyrael",
      ].map((hero, index) => [
        hero,
        { games: 10, wins: 6, losses: 4, winRate: 0.6, playPct: 0.1 - index * 0.005 },
      ]),
    );
    const scout = buildPlayerComfort({
      battletag: "MoJoE#1234",
      ngsCurrent: new Map(),
      stormLeague,
      ngsPrior: new Map(),
      includePrior: false,
      ngsWins: 0,
      ngsLosses: 0,
      heroesProfileUrl: "",
      ngsProfileUrl: "",
    });

    expect(scout.topHeroes.some((hero) => hero.hero === "Tyrael")).toBe(true);
  });

  it("excludes unlocked plan placeholders from pair structure", () => {
    const pair = pairStructureProjection(
      [],
      [
        { role: "Healer", player: "HuckIt", cands: [{ hero: "Whitemane", role: "Healer", player: "HuckIt", fromAlt: false }] },
        { role: "Tank", player: "MoJoE", cands: [{ hero: "Tyrael", role: "Tank", player: "MoJoE", fromAlt: true }] },
      ],
      "Whitemane",
      "Tyrael",
    );

    expect(pair.map((pick) => pick.hero)).toEqual(["Whitemane", "Tyrael"]);
    expect(pair.some((pick) => pick.hero === "Malthael")).toBe(false);
  });

  it("scores a duo on its absolute win rate together", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Dehaka", winRate: 49.7, influence: 0, popularity: 0, banRate: 0, pickRate: 0, games: 1000 },
        { hero: "Falstad", winRate: 51.4, influence: 0, popularity: 0, banRate: 0, pickRate: 0, games: 1000 },
      ],
      matchups: {},
      allies: {
        Dehaka: [
          { hero: "Falstad", wins: 702, losses: 737, games: 1439, allyWinRate: 48.78 },
        ],
      },
    });

    const result = pairDuoSynergy(table, "Dehaka", "Falstad");
    // (48.8 − 50) × 1.15 = −1.4; solo WRs don't matter.
    expect(result.detail).toContain("48.8% together (1,439g)");
    expect(result.points).toBe(-1);
  });

  it("scores Roles as 0 while missing roles still fit in the remaining picks", () => {
    const factors = pairScoreFactors({
      table: null,
      after: [
        { hero: "Qhira", role: "Bruiser", player: null, note: "locked" },
        { hero: "Dehaka", role: "Offlane", player: null, note: "locked" },
        { hero: "Falstad", role: "Ranged", player: null, note: "locked" },
      ],
      first: "Dehaka",
      second: "Falstad",
    });

    const synergy = factors.find((factor) => factor.id === "duo")!;
    const roles = factors.find((factor) => factor.id === "roles")!;
    expect(synergy.label).toBe("Ally synergy");
    expect(synergy.firstPoints + synergy.secondPoints).toBe(synergy.points);
    expect(roles.label).toBe("Roles");
    expect(roles.points).toBe(0);
    expect(roles.detail).toBe("Still need tank, healer · 2 picks left");
    expect(roles.firstDetail).toBe("Covers offlane");
    expect(roles.secondDetail).toBe("Covers ranged damage");
  });

  it("penalizes a double that leaves the team impossible to complete", () => {
    const factors = pairScoreFactors({
      table: null,
      after: [
        { hero: "Tyrael", role: "Tank", player: null, note: "locked" },
        { hero: "Genji", role: "Ranged", player: null, note: "locked" },
        { hero: "Valla", role: "Ranged", player: null, note: "locked" },
        { hero: "Jaina", role: "Ranged", player: null, note: "locked" },
      ],
      first: "Valla",
      second: "Jaina",
    });

    const roles = factors.find((factor) => factor.id === "roles")!;
    // healer + offlane missing, one pick left → one role can't fit.
    expect(roles.points).toBe(-45);
    expect(roles.detail).toContain("Can't fill");
    expect(roles.firstPoints + roles.secondPoints).toBe(-45);
  });

  it("keeps the first hero in a pair window until a second hero is chosen", () => {
    expect(
      resolvePairPickSelection({
        current: [],
        hero: "Dehaka",
        pairWindow: true,
      }),
    ).toEqual({
      action: "hold-pair",
      picked: ["Dehaka"],
      pair: null,
    });
  });

  it("locks the duo when a second hero is selected", () => {
    expect(
      resolvePairPickSelection({
        current: ["Dehaka"],
        hero: "Falstad",
        pairWindow: true,
      }),
    ).toEqual({
      action: "lock-pair",
      picked: ["Dehaka", "Falstad"],
      pair: ["Dehaka", "Falstad"],
    });
  });

  it("advances repeated pair-card clicks to the displayed second hero", () => {
    expect(pairCardClickHero("Dehaka", "Falstad", [])).toBe("Dehaka");
    expect(pairCardClickHero("Dehaka", "Falstad", ["Dehaka"])).toBe("Falstad");
  });

  it("falls back to a single lock outside the pair window", () => {
    expect(
      resolvePairPickSelection({
        current: [],
        hero: "Dehaka",
        pairWindow: false,
      }),
    ).toEqual({
      action: "lock-single",
      picked: ["Dehaka"],
      pair: null,
    });
  });

  it("keeps the selected seed anchored and preserves three distinct follow-up options", () => {
    const pairs = [
      { first: "Tyrael", second: "Auriel" },
      { first: "Falstad", second: "Dehaka" },
      { first: "Malthael", second: "Zarya" },
    ];

    const result = pairSeededPairOptions({
      pairPick: ["Whitemane"],
      pairs,
    });

    expect(result.map(({ first, second }) => ({ first, second }))).toEqual([
      { first: "Whitemane", second: "Tyrael" },
      { first: "Whitemane", second: "Falstad" },
      { first: "Whitemane", second: "Malthael" },
    ]);
  });

  it("keeps the seeded hero's solo points with the displayed first lock", () => {
    const result = pairSeededPairOptions({
      pairPick: ["Whitemane"],
      pairs: [
        {
          first: "Tyrael",
          second: "Whitemane",
          firstSolo: 5,
          secondSolo: 20,
          total: 25,
        },
      ],
    });

    expect(result[0].first).toBe("Whitemane");
    expect(result[0].second).toBe("Tyrael");
    expect(result[0].firstSolo).toBe(20);
    expect(result[0].secondSolo).toBe(5);
  });

  it("rescores a seeded pair instead of reusing another pair's factors", () => {
    const seats = [
      { role: "Offlane", player: "plio", cands: [{ hero: "Dehaka", role: "Offlane", player: "plio", fromAlt: false }] },
      { role: "Tank", player: "Duck", cands: [{ hero: "Blaze", role: "Tank", player: "Duck", fromAlt: false }] },
      { role: "Ranged", player: "Mojo", cands: [{ hero: "Falstad", role: "Ranged", player: "Mojo", fromAlt: false }] },
    ];
    const common = {
      soloScore: () => 0,
      projectBoth: (a: string, b: string) => pairStructureProjection([], seats, a, b),
      table: null,
    };
    const [source] = rankDoublePickPairs({ ...common, seats: seats.slice(1), contested: () => false });
    const [result] = pairSeededPairOptions({
      pairPick: ["Dehaka"],
      pairs: [source],
      rescore: (first, second) =>
        scoreOrderedPair({
          ...common,
          first: pairSeatCandidate(seats, first),
          second: pairSeatCandidate(seats, second),
        }),
    });

    expect(result.first).toBe("Dehaka");
    expect(result.second).toBe("Blaze");
    const roles = result.pairFactors.find((f) => f.id === "roles")!;
    expect(roles.firstDetail).toBe("Covers offlane");
    expect(roles.secondDetail).toBe("Covers tank");
  });

  it("undoes both heroes of a double pick together", () => {
    expect(undoCount(7)).toBe(2); // their 1st + 2nd picks (steps 6–7)
    expect(undoCount(5)).toBe(1); // lone first pick
    expect(undoCount(10)).toBe(1); // ban after the double
  });

  it("names both picks of a double in the step heading", () => {
    expect(stepHeading({ ours: true, kind: "pick", ordinal: 2, pair: true })).toBe(
      "Our 2nd + 3rd picks — tap the two heroes we lock",
    );
    expect(stepHeading({ ours: false, kind: "pick", ordinal: 1, pair: true })).toBe(
      "Their 1st + 2nd picks — tap the two heroes they locked",
    );
    expect(stepHeading({ ours: true, kind: "ban", ordinal: 3, pair: false })).toBe(
      "Our 3rd ban — tap the hero we ban",
    );
  });

  it("marks a selected pair hero as locked in the current plan once", () => {
    const picks = [
      { hero: "Whitemane", role: "Healer", player: "Beachyman", note: "need" } as DraftCompPick,
      { hero: "Malthael", role: "Offlane", player: "Huckft", note: "need" } as DraftCompPick,
    ];

    const result = pairProgressPlanPicks(picks, ["Whitemane"]);

    expect(result.some((p) => p.hero === "Whitemane")).toBe(true);
    expect(result.find((p) => p.hero === "Whitemane")?.note).toMatch(/locked/i);
  });

  it("explains why the selected pair beats the other alternatives", () => {
    const best = {
      first: "Whitemane",
      second: "Kaelthas",
      pairFactors: [
        {
          id: "roles",
          label: "Roles",
          points: 0,
          detail: "All required roles covered",
        },
      ],
    };

    const alternatives = [
      {
        first: "Whitemane",
        second: "Tyrael",
        pairFactors: [
          {
            id: "roles",
            label: "Roles",
            points: -45,
            detail: "Can't fill ranged damage with 0 picks left",
          },
        ],
      },
    ];

    const msg = pairSuggestionCautionLine(best, alternatives);

    expect(msg).toContain("Why not the other heroes: Whitemane + Tyrael?");
    expect(msg).toContain("Whitemane + Kaelthas fits better because");
  });
});

describe("ban deviation grading", () => {
  it("does not add ban-list rank as a second scoring factor", () => {
    const card = buildPickScorecard({
      hero: "Auriel",
      table: null,
      gone: new Set<string>(),
      map: null,
      ourPickCount: 0,
      inPlan: false,
      fromAlt: false,
      planRole: null,
      lockedAllies: [],
      theirLocked: [],
      theirLikely: [],
      banPriority: [
        { hero: "Auriel", reason: "Signature / high-comfort pocket" },
      ],
      comfort: 0,
      swapDelta: 0,
      takeAndRebuild: false,
      kind: "ban",
    });

    expect(card.factors.some((factor) => factor.id === "banPri")).toBe(false);
    expect(card.factors.some((factor) => factor.id === "mutualBan")).toBe(false);
  });

  it("does not score a ban candidate against heroes the opponent would play alongside it", () => {
    const card = buildPickScorecard({
      hero: "Anduin",
      table: null,
      gone: new Set<string>(),
      map: null,
      ourPickCount: 0,
      inPlan: false,
      fromAlt: false,
      planRole: null,
      lockedAllies: [],
      theirLocked: [],
      theirLikely: [
        { hero: "Tyrael", role: "Tank", player: null, note: null },
      ],
      banPriority: [],
      comfort: 0,
      swapDelta: 0,
      takeAndRebuild: false,
      kind: "ban",
    });

    expect(card.factors.some((factor) => factor.id === "matchup")).toBe(false);
  });

  it("does not treat an off-list ban as a structural throw", () => {
    const result = gradeDeviation({
      ours: true,
      kind: "ban",
      suggested: "Auriel",
      chosen: "Azmodan",
      planPicks: [],
      banPriority: [
        { hero: "Auriel", reason: "Signature / high-comfort pocket (Zloth)" },
      ],
      theirLikely: [],
      table: null,
      gone: new Set<string>(),
      map: "Infernal Shrines",
      ourPickCount: 0,
      suggestedTotal: 53,
      chosenTotal: 15,
    });

    expect(result?.structuralReasons).toEqual([]);
    expect(result?.summary).toContain("Azmodan was not worth the ban slot");
  });
});

describe("pairSideBreakdown", () => {
  it("keeps the solo scorecard and that hero's share of the pair", () => {
    const solo = [
      { id: "patch", label: "Patch win rate", points: 10, detail: "50% WR" },
    ];
    const first = pairSideBreakdown(
      solo,
      [
        {
          id: "duo",
          label: "Ally synergy",
          points: 8,
          detail: "54% together",
          firstPoints: 5,
          secondPoints: 3,
        },
      ],
      "first",
    );
    expect(first.total).toBe(15);
    expect(first.factors.map((factor) => [factor.label, factor.points])).toEqual([
      ["Patch win rate", 10],
      ["Pair synergy", 5],
    ]);
  });
});
