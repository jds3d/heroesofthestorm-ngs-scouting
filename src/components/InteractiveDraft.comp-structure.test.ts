import { describe, expect, it } from "vitest";
import { scoreProjectedCompStructure } from "./InteractiveDraft";
import type { DraftCompPick } from "@/lib/scoring/types";

describe("scoreProjectedCompStructure", () => {
  it("punishes an all-melee five even when the proposed pick is otherwise strong", () => {
    const livePicks: DraftCompPick[] = [
      { hero: "Malthael", role: "Offlane", player: null, note: null },
      { hero: "Tyrael", role: "Tank", player: null, note: null },
      { hero: "Qhira", role: "4-man", player: null, note: null },
    ];
    const projected: DraftCompPick[] = [
      ...livePicks,
      { hero: "Thrall", role: "4-man", player: null, note: null },
    ];

    const score = scoreProjectedCompStructure({
      hero: "Thrall",
      livePicks,
      projected,
    });

    expect(score.extra).toBeLessThan(0);
    expect(score.structureBits.some((bit) => /ranged|all-melee/i.test(bit))).toBe(true);
  });

  it("favors the first ranged damage when the five is otherwise all melee", () => {
    const livePicks: DraftCompPick[] = [
      { hero: "Malthael", role: "Offlane", player: null, note: null },
      { hero: "Tyrael", role: "Tank", player: null, note: null },
      { hero: "Qhira", role: "4-man", player: null, note: null },
      { hero: "Thrall", role: "4-man", player: null, note: null },
    ];

    const score = scoreProjectedCompStructure({
      hero: "Falstad",
      livePicks,
      projected: [
        ...livePicks,
        { hero: "Falstad", role: "Ranged Assassin", player: null, note: null },
      ],
    });

    expect(score.extra).toBeGreaterThan(0);
    expect(score.structureBits.some((bit) => /ranged/i.test(bit))).toBe(true);
  });
});
