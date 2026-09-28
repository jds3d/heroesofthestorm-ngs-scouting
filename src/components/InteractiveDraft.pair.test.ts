import { describe, expect, it } from "vitest";
import type { DraftCompPick } from "@/lib/scoring/types";
import { rankDoublePickPairs } from "@/lib/scoring/pickPairs";
import {
  formatScoreGapSentence,
  pairProgressPlanPicks,
  pairSeededPairOptions,
  pairSuggestionCautionLine,
  resolvePairPickSelection,
} from "./InteractiveDraft";

describe("resolvePairPickSelection", () => {
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
          id: "pair-structure",
          label: "Pair structure",
          points: 18,
          detail: "Pair fills ranged damage and waveclear",
        },
      ],
    };

    const alternatives = [
      {
        first: "Whitemane",
        second: "Tyrael",
        pairFactors: [
          {
            id: "pair-structure",
            label: "Pair structure",
            points: 8,
            detail: "Pair leaves the five all-melee",
          },
        ],
      },
    ];

    const msg = pairSuggestionCautionLine(best, alternatives);

    expect(msg).toContain("Why not the other heroes: Whitemane + Tyrael?");
    expect(msg).toContain("Whitemane + Kaelthas fits better because");
  });
});
