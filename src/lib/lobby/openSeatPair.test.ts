import { describe, expect, it } from "vitest";
import { playerFromStormLeague } from "@/lib/scoring/comfort";
import {
  describeOpenSeatPair,
  openSeatDoublePick,
} from "@/lib/scoring/pickPairs";
import type { SourceHeroStat } from "@/lib/scoring/types";

function sl(wins: number, losses: number): SourceHeroStat {
  const games = wins + losses;
  return {
    games,
    wins,
    losses,
    winRate: wins / games,
    playPct: 0.05,
  };
}

describe("live double-pick windows", () => {
  it("names our Volskaya closing pair and who locks which", () => {
    const dante = playerFromStormLeague(
      "Dante",
      new Map([
        ["Falstad", sl(40, 20)],
        ["Greymane", sl(10, 8)],
      ]),
    );
    const hiimrick = playerFromStormLeague(
      "hiimrick",
      new Map([
        ["Falstad", sl(12, 10)],
        ["Zeratul", sl(8, 6)],
      ]),
    );
    const pairs = openSeatDoublePick({
      openPlayers: ["Dante", "hiimrick"],
      roster: [dante, hiimrick],
      gone: new Set(["abathur", "tyrande", "leoric"]),
      lockedHeroes: ["Abathur", "Tyrande", "Leoric"],
    });
    const pair = pairs[0];
    expect(pair.first).toMatchObject({ player: "Dante", hero: "Falstad", role: "Ranged" });
    expect(pair.second).toMatchObject({ player: "hiimrick", hero: "Zeratul", role: "Flex" });
    expect(pair.roleSplit).toBe("Ranged + Flex");
    expect(
      describeOpenSeatPair({ pair, side: "our", last: true }),
    ).toBe(
      "Next is our last picks. Dante locks Falstad, hiimrick locks Zeratul. Role split: Ranged + Flex.",
    );
  });

  it("predicts their role split without naming who locks which", () => {
    const skilleen = playerFromStormLeague(
      "SKilleen",
      new Map([
        ["Valla", sl(40, 20)],
        ["Johanna", sl(8, 6)],
      ]),
    );
    const cinema = playerFromStormLeague(
      "Cinema",
      new Map([["Jaina", sl(30, 15)]]),
    );
    const pairs = openSeatDoublePick({
      openPlayers: ["SKilleen", "Cinema"],
      roster: [skilleen, cinema],
      gone: new Set(["tyrande", "leoric", "falstad"]),
      lockedHeroes: ["Tyrande", "Leoric", "Falstad"],
    });
    const pair = pairs[0];
    expect(pair.first).toMatchObject({ player: "SKilleen", hero: "Johanna", role: "Tank" });
    expect(pair.second).toMatchObject({ player: "Cinema", hero: "Jaina", role: "Flex" });
    expect(pair.roleSplit).toBe("Tank + Flex");
    const line = describeOpenSeatPair({ pair, side: "their", last: false });
    expect(line).toBe("Next is their double. Role split: Tank + Flex (Johanna + Jaina).");
    expect(line).not.toContain("locks");
  });

  it("leaves a single open seat for the one-hero suggestion", () => {
    const dante = playerFromStormLeague("Dante", new Map([["Falstad", sl(40, 20)]]));
    expect(
      openSeatDoublePick({
        openPlayers: ["Dante"],
        roster: [dante],
        gone: new Set(),
        lockedHeroes: [],
      }),
    ).toEqual([]);
  });
});
