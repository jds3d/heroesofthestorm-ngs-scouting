import { describe, expect, it } from "vitest";
import { playerFromStormLeague } from "@/lib/scoring/comfort";
import {
  compFitPoints,
  likelyPickStacksUnderOpenSlots,
  likelyPicksUnderOpenSlots,
  ourCompStacksUnderOpenSlots,
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

  it("does not rebuild a roster player whose lock was read with an i/l slip", () => {
    const roster = [
      scout("HuckIt#1686", [
        ["Whitemane", 40, 10],
        ["Rehgar", 20, 8],
      ]),
      scout("MoJoE#2", [["Malthael", 20, 8]]),
    ];
    const five = rebuildTheirRemainingFive({
      locked: [{ hero: "Xal'atath", player: "Hucklt" }],
      openPlayers: ["HuckIt", "MoJoE"],
      roster,
      gone: new Set(["Xal'atath"]),
    });
    expect(five.map((seat) => seat.player)).toEqual(["MoJoE"]);
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

  it("treats an OCR slip of a locked player as the same person", () => {
    const huck = {
      player: "HuckIt",
      hero: "Whitemane",
      role: "Healer" as const,
      locked: false,
      sl: 1,
      comfort: 1,
      games: 40,
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
        { hero: "Xal'atath", player: "Hucklt" },
        { hero: "Qhira", player: "MrHustler" },
        { hero: "Arthas", player: "Beachyman" },
        null,
        null,
      ],
      [huck, mojoe],
    );
    expect(slots.map((seat) => seat?.player ?? null)).toEqual([
      null,
      null,
      null,
      "MoJoE",
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
    const kerrigan = beach.find((row) => row.hero === "Kerrigan");
    expect(kerrigan?.why).toContain("Storm League");
    expect(kerrigan?.why).toContain("=");
    expect(kerrigan?.why).not.toContain("Pick one");
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

  it("does not treat a four-game second tank as the pick when the comp still needs a healer", () => {
    const roster = [
      scout("APex", [
        ["Muradin", 3, 1],
      ]),
    ];
    const seat = {
      player: "APex",
      hero: "Muradin",
      role: "Tank" as const,
      locked: false,
      sl: 0.2,
      comfort: 0.2,
      games: 4,
    };
    const stack = seatSuggestionStack(
      seat,
      roster,
      new Set(["Johanna"]),
      3,
      ["Rehgar", "Valla"],
      ["Johanna"],
      { bias: "likely" },
    );
    expect(stack[0]?.hero).not.toBe("Muradin");
    expect(stack.map((row) => row.hero)).toEqual(
      expect.arrayContaining(["Rehgar"]),
    );
  });

  it("keeps a deep opposing pool on the hero they actually play", () => {
    const roster = [
      scout("APex", [
        ["Muradin", 80, 40],
      ]),
    ];
    const seat = {
      player: "APex",
      hero: "Muradin",
      role: "Tank" as const,
      locked: false,
      sl: 0.4,
      comfort: 0.4,
      games: 120,
    };
    const stack = seatSuggestionStack(
      seat,
      roster,
      new Set(["Johanna"]),
      3,
      ["Rehgar", "Valla"],
      ["Johanna"],
      { bias: "likely" },
    );
    expect(stack[0]?.hero).toBe("Muradin");
  });

  it("keeps a tank on the suggestion list when their frontline is only an offlaner", () => {
    const roster = [
      scout("waztp", [
        ["Whitemane", 40, 10],
        ["Tyrande", 30, 10],
        ["Kharazim", 24, 8],
        ["Anub'arak", 8, 4],
      ]),
    ];
    const stack = seatSuggestionStack(
      {
        player: "waztp",
        hero: "Whitemane",
        role: "Healer",
        locked: false,
        sl: 0.4,
        comfort: 0.4,
        games: 50,
      },
      roster,
      new Set(["Hanzo", "Tychus", "Leoric", "Johanna", "E.T.C."]),
      3,
      ["Anub'arak", "Muradin", "Jaina"],
      ["Hanzo", "Tychus", "Leoric"],
      { bias: "likely" },
    );
    expect(stack.some((row) => row.hero === "Anub'arak")).toBe(true);
    expect(stack[0]?.hero).not.toBe("Anub'arak");
  });

  it("projects three bruisers when that is the frontline they play", () => {
    const five = rebuildTheirRemainingFive({
      locked: [{ hero: "Anduin", player: "Hoss" }],
      openPlayers: ["SKilleen", "Cinema", "MoJoE"],
      roster: [
        scout("SKilleen", [
          ["Sonya", 40, 10],
          ["Johanna", 6, 2],
        ]),
        scout("Cinema", [["Dehaka", 30, 10]]),
        scout("MoJoE", [["Imperius", 24, 8]]),
      ],
      gone: new Set(["Anduin"]),
    });

    expect(five.map((seat) => seat.hero).sort()).toEqual([
      "Dehaka",
      "Imperius",
      "Sonya",
    ]);
  });

  it("ranks a third bruiser above a tank once two bruisers are the frontline", () => {
    const roster = [
      scout("SKilleen", [
        ["Sonya", 40, 10],
        ["Johanna", 8, 4],
      ]),
    ];
    const stack = seatSuggestionStack(
      {
        player: "SKilleen",
        hero: "Sonya",
        role: "Offlane",
        locked: false,
        sl: 0.3,
        comfort: 0.3,
        games: 50,
      },
      roster,
      new Set(["Anduin", "Dehaka", "Imperius"]),
      3,
      ["Johanna"],
      ["Anduin", "Dehaka", "Imperius"],
      { bias: "should" },
    );
    const sonya = stack.findIndex((row) => row.hero === "Sonya");
    const johanna = stack.findIndex((row) => row.hero === "Johanna");
    expect(sonya).toBeGreaterThanOrEqual(0);
    expect(sonya).toBeLessThan(johanna === -1 ? 99 : johanna);
  });

  it("on our side ranks the missing healer above a comfort second tank", () => {
    const roster = [
      scout("HuckIt", [
        ["Muradin", 80, 20],
        ["Rehgar", 10, 6],
      ]),
    ];
    const seat = {
      player: "HuckIt",
      hero: "Muradin",
      role: "Tank" as const,
      locked: false,
      sl: 0.4,
      comfort: 0.4,
      games: 100,
    };
    const stack = seatSuggestionStack(
      seat,
      roster,
      new Set(["Johanna"]),
      3,
      [],
      ["Johanna"],
      { bias: "should" },
    );
    const rehgar = stack.findIndex((row) => row.hero === "Rehgar");
    const muradin = stack.findIndex((row) => row.hero === "Muradin");
    expect(rehgar).toBeGreaterThanOrEqual(0);
    expect(rehgar).toBeLessThan(muradin);
  });
});

describe("our comp rows", () => {
  function seat(player: string, hero: string) {
    return {
      player,
      hero,
      role: "Flex" as const,
      locked: false,
      sl: 0,
      comfort: 0,
      games: 0,
    };
  }

  it("pairs each tank with an offlaner instead of both players' best tank", () => {
    const roster = [
      scout("SKilleen", [
        ["Johanna", 45, 5],
        ["Sonya", 10, 6],
      ]),
      scout("Cinema", [
        ["Muradin", 22, 18],
        ["Dehaka", 10, 6],
      ]),
    ];
    const columns = ourCompStacksUnderOpenSlots(
      [{ hero: "Anduin" }, null, null],
      [seat("SKilleen", "Johanna"), seat("Cinema", "Muradin")],
      roster,
      new Set(["Anduin"]),
    );

    const skilleen = columns[1] ?? [];
    const cinema = columns[2] ?? [];
    expect(skilleen[0]?.hero).toBe("Johanna");
    expect(skilleen[0]?.role).toBe("Tank");
    expect(cinema[0]?.hero).toBe("Dehaka");
    expect(cinema[0]?.role).toBe("Offlane");
    expect(skilleen[1]?.hero).toBe("Sonya");
    expect(skilleen[1]?.role).toBe("Offlane");
    expect(cinema[1]?.hero).toBe("Muradin");
    expect(cinema[1]?.role).toBe("Tank");
    expect(skilleen[0]?.why).toContain("combined");
    const row1 = (skilleen[0]?.points ?? 0) + (cinema[0]?.points ?? 0);
    const row2 = (skilleen[1]?.points ?? 0) + (cinema[1]?.points ?? 0);
    expect(row1).toBeGreaterThan(row2);
  });

  it("favors a tank by a little over another bruiser", () => {
    const tank = compFitPoints("Johanna", ["Sonya"]);
    const secondBruiser = compFitPoints("Imperius", ["Sonya"]);
    const tankBesideTwo = compFitPoints("Johanna", ["Sonya", "Dehaka"]);
    const thirdBruiser = compFitPoints("Imperius", ["Sonya", "Dehaka"]);
    expect(tank.points).toBe(36);
    expect(secondBruiser.points).toBe(32);
    expect(tankBesideTwo.points).toBe(12);
    expect(thirdBruiser.points).toBe(10);
  });

  it("keeps a tank in one suggested lineup when the pools are bruisers", () => {
    const roster = [
      scout("SKilleen", [
        ["Sonya", 40, 10],
        ["Valla", 20, 10],
      ]),
      scout("Cinema", [
        ["Dehaka", 40, 10],
        ["Jaina", 20, 10],
      ]),
    ];
    const columns = ourCompStacksUnderOpenSlots(
      [{ hero: "Anduin" }, null, null],
      [seat("SKilleen", "Sonya"), seat("Cinema", "Dehaka")],
      roster,
      new Set(["Anduin"]),
      3,
      ["Johanna", "Rehgar", "Raynor"],
    );
    const heroes = [0, 1, 2].flatMap((row) => [columns[1]?.[row]?.hero, columns[2]?.[row]?.hero]);
    expect(heroes).toContain("Johanna");
  });
});
