import { describe, expect, it } from "vitest";
import { findEndDraftSwaps } from "@/lib/scoring/draftSwap";
import type { PlayerScout } from "@/lib/scoring/types";

function player(name: string, heroes: [string, number][]): PlayerScout {
  return {
    battletag: name,
    preferredRole: null,
    topHeroes: heroes.map(([hero, comfort]) => ({
      hero,
      comfort,
      playPct: 0,
      winRate: 0,
      games: 20,
      sources: {},
    })),
    ngsWins: 0,
    ngsLosses: 0,
    confidence: "high",
    heroesProfileUrl: "",
    ngsProfileUrl: "",
    returningFromPrior: false,
  };
}

describe("end-of-draft comfort swaps", () => {
  it("prints the gain on the same 0–100 scale as seat comfort", () => {
    const swaps = findEndDraftSwaps({
      home: [
        player("HuckIt", [
          ["Xal'atath", 0.2],
          ["Rehgar", 0.25],
        ]),
        player("Ang", [
          ["Xal'atath", 0.15],
          ["Rehgar", 0.1],
        ]),
      ],
      locked: [
        { hero: "Xal'atath", player: "HuckIt" },
        { hero: "Rehgar", player: "Ang" },
      ],
    });
    expect(swaps).toHaveLength(1);
    expect(swaps[0].comfortDelta).toBeCloseTo(0.1);
    expect(swaps[0].reason).toBe(
      "HuckIt should have played Rehgar and Ang should have played Xal'atath. Rehgar comfort is 25 for HuckIt and 10 for Ang. Xal'atath comfort is 15 for Ang and 20 for HuckIt. Each is more comfortable on the other hero than on the one they locked. HuckIt is still the more comfortable Xal'atath (20 vs 15). Together that is 10 comfort higher.",
    );
  });

  it("says each player was more comfortable on the hero the other locked", () => {
    const swaps = findEndDraftSwaps({
      home: [
        player("HuckIt", [
          ["Xal'atath", 0.08],
          ["Rehgar", 0.46],
        ]),
        player("Ang", [
          ["Xal'atath", 0.32],
          ["Rehgar", 0.23],
        ]),
      ],
      locked: [
        { hero: "Xal'atath", player: "HuckIt" },
        { hero: "Rehgar", player: "Ang" },
      ],
    });
    expect(swaps[0].reason).toBe(
      "HuckIt should have played Rehgar and Ang should have played Xal'atath. Rehgar comfort is 46 for HuckIt and 23 for Ang. Xal'atath comfort is 32 for Ang and 8 for HuckIt. Each of them is more comfortable on the hero the other locked, 47 comfort higher together.",
    );
  });
});
