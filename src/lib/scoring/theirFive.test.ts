import { describe, expect, it } from "vitest";
import { playerFromStormLeague } from "@/lib/scoring/comfort";
import {
  likelyPicksUnderOpenSlots,
  rebuildTheirRemainingFive,
} from "@/lib/scoring/theirFive";
import type { SourceHeroStat } from "@/lib/scoring/types";

function sl(wins: number, losses: number): SourceHeroStat {
  const games = wins + losses;
  return {
    games,
    wins,
    losses,
    winRate: games > 0 ? wins / games : 0,
    playPct: 0.2,
  };
}

function scout(name: string, heroes: [string, number, number][]) {
  return playerFromStormLeague(
    name,
    new Map(heroes.map(([hero, wins, losses]) => [hero, sl(wins, losses)])),
  );
}

const volskayaBans = new Set([
  "Johanna",
  "Sgt. Hammer",
  "Tyrael",
  "Qhira",
  "Xal'atath",
  "E.T.C.",
  "Abathur",
  "Falstad",
  "Tyrande",
  "Leoric",
]);

describe("likelyPicksUnderOpenSlots", () => {
  it("lines projections up under empty pick slots left to right", () => {
    const seats = [
      {
        player: "pokes",
        hero: "Varian",
        role: "Tank" as const,
        locked: false,
        sl: 1,
        comfort: 1,
        games: 10,
      },
      {
        player: "Regenbogen",
        hero: "Ragnaros",
        role: "Offlane" as const,
        locked: false,
        sl: 1,
        comfort: 1,
        games: 10,
      },
    ];
    const slots = likelyPicksUnderOpenSlots(
      [{ hero: "A" }, { hero: "B" }, null, null, null],
      seats,
    );
    expect(slots[0]).toBeNull();
    expect(slots[2]?.hero).toBe("Varian");
    expect(slots[3]?.hero).toBe("Ragnaros");
    expect(slots[4]).toBeNull();
  });
});

describe("rebuildTheirRemainingFive", () => {
  it("fills the Volskaya seat that still needs offlane and drops banned and picked heroes", () => {
    const five = rebuildTheirRemainingFive({
      locked: [
        { hero: "Thrall", player: "dgcy023" },
        { hero: "Brightwing", player: "Hoss" },
        { hero: "Nazeebo", player: "Cinema" },
        { hero: "Stitches", player: "Silver" },
      ],
      openPlayers: ["SKilleen"],
      roster: [
        scout("SKilleen", [
          ["Falstad", 40, 10],
          ["Brightwing", 30, 8],
          ["Qhira", 24, 6],
          ["Johanna", 18, 4],
          ["Leoric", 14, 6],
          ["Sonya", 10, 6],
        ]),
      ],
      gone: volskayaBans,
    });

    expect(five.map((seat) => [seat.role, seat.player, seat.hero, seat.locked])).toEqual([
      ["Offlane", "SKilleen", "Sonya", false],
    ]);
  });

  it("gives the missing tank to the player who can play one, not their best hero", () => {
    const five = rebuildTheirRemainingFive({
      locked: [{ hero: "Brightwing", player: "Hoss" }],
      openPlayers: ["SKilleen", "Cinema"],
      roster: [
        scout("SKilleen", [
          ["Falstad", 40, 10],
          ["Johanna", 8, 4],
        ]),
        scout("Cinema", [
          ["Raynor", 10, 6],
        ]),
      ],
      gone: new Set(["Brightwing"]),
    });

    expect(five.find((seat) => seat.player === "SKilleen")).toMatchObject({
      hero: "Johanna",
      role: "Tank",
      locked: false,
    });
    expect(five.find((seat) => seat.player === "Cinema")).toMatchObject({
      hero: "Raynor",
      role: "Ranged",
    });
    expect(five).toHaveLength(2);
  });

  it("still projects every open player when one has no storm league pool", () => {
    const five = rebuildTheirRemainingFive({
      locked: [
        { hero: "Brightwing", player: "AmateurDead" },
        { hero: "Abathur", player: "vsierra01" },
      ],
      openPlayers: ["Regenbogen", "pokes"],
      roster: [
        scout("Regenbogen", [["Ragnaros", 30, 10]]),
        scout("pokes", [["Varian", 22, 8]]),
        scout("SirWatsonll", []),
      ],
      gone: new Set(["Brightwing", "Abathur", "Hogger", "Xal'atath"]),
      heroPool: [
        "Varian",
        "Ragnaros",
        "Valla",
        "Jaina",
        "Raynor",
        "Johanna",
      ],
    });

    expect(five).toHaveLength(3);
    expect(five.map((seat) => seat.player).sort()).toEqual([
      "Regenbogen",
      "SirWatsonll",
      "pokes",
    ]);
    expect(five.every((seat) => seat.hero && !seat.locked)).toBe(true);
  });

  it("rebuilds again after the next lock and will not seat someone who already locked", () => {
    const roster = [
      scout("SKilleen", [
        ["Falstad", 40, 10],
        ["Leoric", 12, 6],
      ]),
      scout("Cinema", [["Nazeebo", 20, 8]]),
    ];
    const before = rebuildTheirRemainingFive({
      locked: [{ hero: "Stitches", player: "Silver" }],
      openPlayers: ["SKilleen", "Cinema"],
      roster,
      gone: new Set(["Stitches"]),
    });
    expect(before.map((seat) => [seat.player, seat.hero])).toEqual([
      ["SKilleen", "Leoric"],
      ["Cinema", "Nazeebo"],
    ]);

    const after = rebuildTheirRemainingFive({
      locked: [
        { hero: "Stitches", player: "Silver" },
        { hero: "Nazeebo", player: "Cinema" },
      ],
      openPlayers: ["SKilleen", "Cinema"],
      roster,
      gone: new Set(["Stitches", "Nazeebo", "Leoric"]),
    });
    expect(after.map((seat) => [seat.player, seat.hero, seat.role])).toEqual([
      ["SKilleen", "Falstad", "Flex"],
    ]);
  });
});
