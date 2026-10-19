import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyWatchMemory, nextWatchedDraft, type WatchFrame } from "@/lib/lobby/watchDraft";
import {
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  plateFill,
  portraitIsLocked,
  settleSharedPicks,
} from "@/lib/lobby/screenLobby";
import { decodePng } from "@/lib/lobby/pngImage";

const FILE = path.join(process.cwd(), "examples", "drafts", "tomb 2.png");

function boxRgb(
  image: ReturnType<typeof decodePng>,
  box: { x: number; y: number; w: number; h: number },
) {
  const x = Math.round(box.x * image.width);
  const y = Math.round(box.y * image.height);
  const w = Math.round(box.w * image.width);
  const h = Math.round(box.h * image.height);
  const pixels: { r: number; g: number; b: number }[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      pixels.push({
        r: image.data[i] ?? 0,
        g: image.data[i + 1] ?? 0,
        b: image.data[i + 2] ?? 0,
      });
    }
  }
  return pixels;
}

describe("tomb 2 Leoric hover", () => {
  it("leaves our dark Leoric plate unlocked and their highlighted plate locked", () => {
    const image = decodePng(readFileSync(FILE));
    const ours = plateFill(boxRgb(image, DRAFT_SLOT_NAMES.left[3]!), true);
    const theirs = plateFill(boxRgb(image, DRAFT_SLOT_NAMES.right[3]!), false);
    expect(ours).not.toBe("locked");
    expect(theirs).toBe("locked");
    expect(
      portraitIsLocked({
        phase: "ban",
        faceFilled: true,
        plate: ours,
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(false);
    expect(
      portraitIsLocked({
        phase: "pick",
        faceFilled: true,
        plate: ours,
        ally: true,
        heroOnPlate: true,
        slotPicking: false,
      }),
    ).toBe(false);
    expect(DRAFT_PLATE_SLOTS.left[3]).toBeTruthy();
  });

  it("gives a hero both sides claimed to the highlighted nameplate", () => {
    const settled = settleSharedPicks({
      ourPicks: ["Kel'Thuzad", "Leoric", "Auriel"],
      theirPicks: ["Anduin", "Gul'dan", "Leoric"],
      ourPlayers: ["furryfather", "Paycheck", "Samismissing"],
      theirPlayers: ["JayberCrow", "Deep", "MCtyyg"],
      ourReads: [
        { hero: "Kel'Thuzad" },
        { hero: "Leoric" },
        { hero: "Auriel" },
      ],
      theirReads: [
        { hero: "Anduin" },
        { hero: "Gul'dan" },
        { hero: "Leoric" },
      ],
      ourSlots: [
        { hero: "Kel'Thuzad", plate: "locked", slot: 0 },
        { hero: "Leoric", plate: "shown", slot: 1 },
        { hero: "Auriel", plate: "locked", slot: 2 },
      ],
      theirSlots: [
        { hero: "Anduin", plate: "locked", slot: 0 },
        { hero: "Gul'dan", plate: "locked", slot: 1 },
        { hero: "Leoric", plate: "locked", slot: 2 },
      ],
    });
    expect(settled.ourPicks).toEqual(["Kel'Thuzad", "Auriel"]);
    expect(settled.ourPlayers).toEqual(["furryfather", "Samismissing"]);
    expect(settled.theirPicks).toEqual(["Anduin", "Gul'dan", "Leoric"]);
    expect(settled.theirPlayers).toEqual(["JayberCrow", "Deep", "MCtyyg"]);
  });

  it("drops our remembered Leoric once their plate is the one highlighted", () => {
    const memory = emptyWatchMemory();
    memory.picksStarted = true;
    memory.draft = {
      ...memory.draft,
      ourPicks: ["Kel'Thuzad", "Leoric"],
      theirPicks: ["Anduin", "Leoric"],
      ourPickPlayers: ["furryfather", "Paycheck"],
      theirPickPlayers: ["JayberCrow", "MCtyyg"],
      phase: "ban",
      firstPick: "them",
    };
    const frame: WatchFrame = {
      left: [],
      right: [],
      leftShown: ["Leoric"],
      rightShown: [],
      leftReads: [
        { hero: "Kel'Thuzad", player: "furryfather" },
        { hero: "Leoric", player: "Paycheck" },
        { hero: null, player: null },
        { hero: null, player: null },
        { hero: null, player: null },
      ],
      rightReads: [
        { hero: "Anduin", player: "JayberCrow" },
        { hero: "Leoric", player: "MCtyyg" },
        { hero: null, player: null },
        { hero: null, player: null },
        { hero: null, player: null },
      ],
      leftSlots: [
        {
          hero: "Kel'Thuzad",
          player: "furryfather",
          slot: 0,
          plate: "locked",
          faceFilled: true,
          ally: true,
        },
        {
          hero: "Leoric",
          player: "Paycheck",
          slot: 1,
          plate: "shown",
          faceFilled: true,
          ally: true,
        },
      ],
      rightSlots: [
        {
          hero: "Anduin",
          player: "JayberCrow",
          slot: 0,
          plate: "locked",
          faceFilled: true,
          ally: false,
        },
        {
          hero: "Leoric",
          player: "MCtyyg",
          slot: 1,
          plate: "locked",
          faceFilled: true,
          ally: false,
        },
      ],
      leftPicking: false,
      rightPicking: false,
      leftPickingFlags: [false, false, false, false, false],
      rightPickingFlags: [false, false, false, false, false],
    };
    const next = nextWatchedDraft({
      memory,
      frame,
      titleText: "Tomb of the Spider Queen",
      statusText: "Waiting for Enemy Ban",
      centerText: "RED BAN",
      leftHexes: [],
      rightHexes: [],
      roster: [],
    });
    expect(next.draft.ourPicks).not.toContain("Leoric");
    expect(next.draft.theirPicks).toContain("Leoric");
    expect(next.draft.ourPickPlayers).not.toContain("Paycheck");
  });
});
