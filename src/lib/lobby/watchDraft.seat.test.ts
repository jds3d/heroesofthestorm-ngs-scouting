import { describe, expect, it } from "vitest";
import { emptyWatchMemory, mergeSeatNames, nextWatchedDraft, type WatchFrame } from "@/lib/lobby/watchDraft";

const ROSTER = ["JohnnyB#1111", "omnyD#2222", "UnderRain#3333", "Borceside#4444", "Huckit#5555"];

describe("seat names", () => {
  it("keeps JohnnyB when a later read of that seat says omnyD", () => {
    const first = mergeSeatNames(
      [],
      [{ player: "JohnnyB" }, { player: "UnderRain" }, { player: null }, { player: null }, { player: null }],
      ROSTER,
    );
    const second = mergeSeatNames(
      first,
      [{ player: "omnyD" }, { player: "UnderRain" }, { player: "Borceside" }, { player: null }, { player: null }],
      ROSTER,
    );
    expect(second[0]).toBe("JohnnyB");
    expect(second[1]).toBe("UnderRain");
    expect(second[2]).toBe("Borceside");
  });

  it("replaces an unread garbage name when the roster name arrives", () => {
    const first = mergeSeatNames([], [{ player: "Xv4qq" }], ["JohnnyB#1111"]);
    const second = mergeSeatNames(first, [{ player: "JohnnyB" }], ["JohnnyB#1111"]);
    expect(second[0]).toBe("JohnnyB");
  });

  it("keeps JohnnyB on the live column after the open seat is misread", () => {
    const frame = (seat: string): WatchFrame => ({
      left: [seat, "UnderRain", "Borceside"],
      right: ["Blood", "aliluz", "Stux"],
      leftSlots: [],
      rightSlots: [],
      leftShown: [],
      rightShown: [],
      leftReads: [
        { hero: "Rehgar", player: seat },
        { hero: "Tychus", player: "UnderRain" },
        { hero: "Hogger", player: "Borceside" },
        { hero: null, player: null },
        { hero: null, player: null },
      ],
      rightReads: ["Blood", "aliluz", "Stux", null, null].map((player) => ({
        hero: player ? "Qhira" : null,
        player,
      })),
      leftPicking: true,
      rightPicking: false,
      leftPickingFlags: [true, false, false, false, false],
      rightPickingFlags: [false, false, false, false, false],
    });
    const first = nextWatchedDraft({
      memory: emptyWatchMemory(),
      frame: frame("JohnnyB"),
      titleText: "Volskaya Foundry",
      statusText: "",
      centerText: "",
      leftHexes: [],
      rightHexes: [],
      roster: ROSTER,
    });
    const second = nextWatchedDraft({
      memory: first.memory,
      frame: frame("omnyD"),
      titleText: "Volskaya Foundry",
      statusText: "",
      centerText: "",
      leftHexes: [],
      rightHexes: [],
      roster: ROSTER,
    });
    expect(second.memory.ourColumn).toContain("JohnnyB");
    expect(second.memory.ourColumn).not.toContain("omnyD");
    expect(second.draft.ourOpenPlayers).toContain("JohnnyB");
    expect(second.draft.ourOpenPlayers).not.toContain("omnyD");
  });

  it("keeps an ally hover off the locks and on the hover list", () => {
    const memory = emptyWatchMemory();
    memory.picksStarted = true;
    const frame: WatchFrame = {
      left: ["Sporty", "HuckIt"],
      right: ["Deep"],
      leftShown: ["Johanna"],
      rightShown: [],
      leftReads: [
        { hero: "Johanna", player: "Sporty" },
        { hero: null, player: "HuckIt" },
        { hero: null, player: null },
        { hero: null, player: null },
        { hero: null, player: null },
      ],
      rightReads: [
        { hero: "Anduin", player: "Deep" },
        { hero: null, player: null },
        { hero: null, player: null },
        { hero: null, player: null },
        { hero: null, player: null },
      ],
      leftSlots: [
        {
          hero: "Johanna",
          player: "Sporty",
          slot: 0,
          plate: "shown",
          faceFilled: true,
          ally: true,
        },
      ],
      rightSlots: [
        {
          hero: "Anduin",
          player: "Deep",
          slot: 0,
          plate: "locked",
          faceFilled: true,
          ally: false,
        },
      ],
      leftPicking: true,
      rightPicking: false,
      leftPickingFlags: [true, false, false, false, false],
      rightPickingFlags: [false, false, false, false, false],
    };
    const next = nextWatchedDraft({
      memory,
      frame,
      titleText: "Volskaya Foundry",
      statusText: "Picking",
      centerText: "BLUE PICK",
      leftHexes: [],
      rightHexes: [],
      roster: ["Sporty#1", "HuckIt#1", "Deep#1"],
    });
    expect(next.draft.ourPicks).not.toContain("Johanna");
    expect(next.draft.ourHovers).toEqual([{ hero: "Johanna", player: "Sporty" }]);
    expect(next.draft.theirPicks).toContain("Anduin");
  });
});
