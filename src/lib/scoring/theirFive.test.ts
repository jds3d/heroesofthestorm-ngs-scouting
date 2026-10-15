import { describe, expect, it } from "vitest";
import { playerFromStormLeague } from "@/lib/scoring/comfort";
import {
  likelyPickStacksUnderOpenSlots,
  likelyPicksUnderOpenSlots,
  rebuildTheirRemainingFive,
  seatSuggestionStack,
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

describe("seat suggestion stacks", () => {
  it("puts three of that player's heroes under one open slot", () => {
    const roster = [
      scout("EKevin", [
        ["Nazeebo", 30, 10],
        ["Jaina", 20, 8],
        ["Valla", 12, 6],
      ]),
    ];
    const seat = {
      player: "EKevin",
      hero: "Nazeebo",
      role: "Ranged" as const,
      locked: false,
      sl: 1,
      comfort: 1,
      games: 10,
    };
    const stack = seatSuggestionStack(seat, roster, new Set(["Johanna"]), 3);
    expect(stack.map((row) => row.hero)).toEqual(["Nazeebo", "Jaina", "Valla"]);
    const slots = likelyPickStacksUnderOpenSlots(
      [null, { hero: "Leoric" }, null, null, null],
      [seat],
      roster,
      new Set(["Johanna"]),
    );
    expect(slots[0]?.map((row) => row.hero)).toEqual(["Nazeebo", "Jaina", "Valla"]);
    expect(slots[1]).toBeNull();
    expect(slots[2]).toBeNull();
  });

  it("never gives an open column to a player who already locked", () => {
    const huck = {
      player: "HuckIt",
      hero: "Tychus",
      role: "Ranged" as const,
      locked: false,
      sl: 1,
      comfort: 1,
      games: 4,
    };
    const mojoe = {
      player: "MoJoE",
      hero: "Malthael",
      role: "Flex" as const,
      locked: false,
      sl: 1,
      comfort: 1,
      games: 4,
    };
    const slots = likelyPicksUnderOpenSlots(
      [
        { hero: "Brightwing", player: "HuckIt" },
        { hero: "Artanis", player: "Topgun707" },
        null,
        null,
        null,
      ],
      [huck, mojoe],
    );
    expect(slots.map((seat) => seat?.player ?? null)).toEqual([
      null,
      null,
      "MoJoE",
      null,
      null,
    ]);
  });

  it("shows each player's own heroes, including a second tank, until a tank locks", () => {
    const roster = [
      scout("Beachyman", [
        ["Kerrigan", 40, 10],
        ["Stitches", 20, 8],
        ["Anub'arak", 12, 6],
      ]),
      scout("MoJoE", [
        ["Malthael", 30, 8],
        ["Muradin", 22, 8],
        ["Samuro", 10, 6],
      ]),
    ];
    const open = {
      locked: false,
      sl: 0.3,
      comfort: 0.3,
      games: 20,
    };
    const beach = seatSuggestionStack(
      { ...open, player: "Beachyman", hero: "Kerrigan", role: "Flex" },
      roster,
      new Set(),
    );
    const mo = seatSuggestionStack(
      { ...open, player: "MoJoE", hero: "Malthael", role: "Flex" },
      roster,
      new Set(),
    );
    expect(beach.map((row) => row.hero)).toEqual(
      expect.arrayContaining(["Kerrigan", "Stitches"]),
    );
    expect(mo.map((row) => row.hero)).toContain("Muradin");
    expect(beach.every((row) => row.why?.includes("Pick one for Beachyman"))).toBe(
      true,
    );
    expect(beach.find((row) => row.hero === "Kerrigan")?.role).not.toBe("Tank");

    const afterLock = seatSuggestionStack(
      { ...open, player: "MoJoE", hero: "Malthael", role: "Flex" },
      roster,
      new Set(["Stitches"]),
      3,
      [],
      ["Stitches"],
    );
    const malthael = afterLock.findIndex((row) => row.hero === "Malthael");
    const muradin = afterLock.findIndex((row) => row.hero === "Muradin");
    expect(malthael).toBeGreaterThanOrEqual(0);
    expect(malthael).toBeLessThan(muradin === -1 ? 99 : muradin);
  });
});
