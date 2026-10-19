import { describe, expect, it } from "vitest";
import {
  banAfterNextPick,
  nextWindowIsDouble,
  opponentActsBeforeNextWindow,
  orderSuggestedColumns,
  rankTakeOrder,
  type TakeOrderFacts,
  type TakeOrderSeat,
} from "@/lib/scoring/takeOrder";

function facts(overrides: Partial<TakeOrderFacts> = {}): TakeOrderFacts {
  return {
    legalHeroes: () => 4,
    opponentPlays: () => false,
    opponentActsBeforeNextWindow: true,
    banAfterNextPick: false,
    opponentPicksLeft: 3,
    counterOpen: () => false,
    setupFor: () => false,
    pairedWith: () => false,
    doubleWindow: false,
    mapOnly: () => false,
    ...overrides,
  };
}

function names(seats: readonly { hero: string; order: number }[]): string[] {
  return [...seats].sort((a, b) => a.order - b.order).map((seat) => seat.hero);
}

const seats: TakeOrderSeat[] = [
  { hero: "Johanna", player: "TankPlayer", role: "Tank" },
  { hero: "Rehgar", player: "HealPlayer", role: "Healer" },
  { hero: "Genji", player: "FlexPlayer", role: "Flex" },
];

describe("take order", () => {
  it("locks the one-hero player before a deep pool", () => {
    const ranked = rankTakeOrder(
      seats,
      facts({
        legalHeroes: (player) => (player === "TankPlayer" ? 1 : 8),
      }),
    );
    expect(names(ranked)[0]).toBe("Johanna");
    expect(ranked.map((seat) => seat.order)).toEqual([1, 2, 3]);
  });

  it("takes a hero they also play before a hero only we play", () => {
    const ranked = rankTakeOrder(
      [
        { hero: "Valla", player: "A", role: "Ranged" },
        { hero: "Johanna", player: "B", role: "Tank" },
      ],
      facts({ opponentPlays: (hero) => hero === "Valla" }),
    );
    expect(names(ranked)).toEqual(["Valla", "Johanna"]);
  });

  it("holds a dive while their counter is open and no ban follows", () => {
    const ranked = rankTakeOrder(
      [
        { hero: "Genji", player: "A", role: "Flex" },
        { hero: "Johanna", player: "B", role: "Tank" },
      ],
      facts({
        counterOpen: (hero) => hero === "Genji",
        banAfterNextPick: false,
      }),
    );
    expect(names(ranked)).toEqual(["Johanna", "Genji"]);
  });

  it("takes the map specialist they play ahead of a flex fill", () => {
    const ranked = rankTakeOrder(
      [
        { hero: "Imperius", player: "A", role: "Flex" },
        { hero: "Dehaka", player: "B", role: "Offlane" },
      ],
      facts({
        opponentActsBeforeNextWindow: false,
        opponentPlays: (hero) => hero === "Dehaka",
        mapOnly: (hero) => hero === "Dehaka",
        opponentPicksLeft: 0,
      }),
    );
    expect(names(ranked)[0]).toBe("Dehaka");
  });

  it("does not solo-first the setup piece, and puts the partner first in a double window", () => {
    const pair = [
      { hero: "Johanna", player: "A", role: "Tank" },
      { hero: "Genji", player: "B", role: "Flex" },
    ];
    const solo = rankTakeOrder(
      pair,
      facts({
        setupFor: (hero) => hero === "Johanna",
        pairedWith: () => true,
        doubleWindow: false,
        opponentActsBeforeNextWindow: false,
        opponentPicksLeft: 0,
      }),
    );
    expect(names(solo)[0]).toBe("Genji");
    const together = rankTakeOrder(
      pair,
      facts({
        setupFor: (hero) => hero === "Johanna",
        pairedWith: () => true,
        doubleWindow: true,
        opponentActsBeforeNextWindow: false,
        opponentPicksLeft: 0,
      }),
    );
    expect(names(together)).toEqual(["Johanna", "Genji"]);
  });

  it("numbers a lineup 1 through the heroes still open, and leaves alternate faces unnumbered", () => {
    const columns = orderSuggestedColumns(
      [
        [
          { hero: "Johanna", player: "A", role: "Tank" },
          { hero: "Muradin", player: "A", role: "Tank" },
        ],
        [
          { hero: "Valla", player: "B", role: "Ranged" },
          { hero: "Raynor", player: "B", role: "Ranged" },
        ],
      ],
      facts({ opponentPlays: (hero) => hero === "Valla" }),
      false,
    );
    expect(columns[0]?.[0].order).toBe(2);
    expect(columns[1]?.[0].order).toBe(1);
    expect(columns[0]?.[1].order).toBeUndefined();
    expect(columns[1]?.[1].order).toBeUndefined();
  });

  it("ranks each of our lineup rows on its own", () => {
    const columns = orderSuggestedColumns(
      [
        [{ hero: "Johanna", player: "A", role: "Tank" }],
        [{ hero: "Genji", player: "B", role: "Flex" }],
      ],
      facts({
        counterOpen: (hero) => hero === "Genji",
        legalHeroes: (player) => (player === "A" ? 1 : 6),
      }),
      true,
    );
    expect(columns[0]?.[0].order).toBe(1);
    expect(columns[1]?.[0].order).toBe(2);
  });
});

describe("take order windows", () => {
  it("sees their picks between our windows when we are first pick", () => {
    expect(opponentActsBeforeNextWindow(0, true, "our")).toBe(true);
    expect(banAfterNextPick(0, true, "our")).toBe(true);
    expect(nextWindowIsDouble(0, true, "our")).toBe(false);
    expect(nextWindowIsDouble(7, true, "our")).toBe(true);
  });

  it("stops rushing once our last window is the one open now", () => {
    expect(opponentActsBeforeNextWindow(13, true, "our")).toBe(false);
    expect(banAfterNextPick(13, true, "our")).toBe(false);
  });
});
