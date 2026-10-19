import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeNameReader, readNameColumns } from "@/lib/ocr/nameReader";
import {
  FINAL_MAP_BOX,
  FINAL_NAME_BOXES,
  completeDraftFromFinalScreen,
  finalScreenLikely,
  joinNameFragments,
  mismatchQuestion,
  seatsFromNameLines,
} from "@/lib/lobby/finalScreen";
import {
  EMPTY_LIVE_DRAFT,
  NAMEPLATE_CELL_WIDTH,
  SLOT_LINE_STRIDE,
  mapFromTitle,
  nameplateCell,
  ocrFold,
  type DraftBox,
} from "@/lib/lobby/screenLobby";
import { heroKey } from "@/lib/scoring/heroMeta";
import { decodePng, encodePng, type RgbaImage } from "@/lib/lobby/pngImage";

const FINAL = path.join(process.cwd(), "examples", "final draft screen.png");
const DRAFTS = path.join(process.cwd(), "examples", "drafts");

afterAll(() => {
  closeNameReader();
});

function pixelAt(image: RgbaImage): (x: number, y: number) => { r: number; g: number; b: number } {
  return (x, y) => {
    const px = Math.max(0, Math.min(image.width - 1, x));
    const py = Math.max(0, Math.min(image.height - 1, y));
    const i = (py * image.width + px) * 4;
    return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
  };
}

function sample(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const px = Math.max(0, Math.min(image.width - 1, x));
  const py = Math.max(0, Math.min(image.height - 1, y));
  const i = (py * image.width + px) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0, image.data[i + 3] ?? 255];
}

function blitScaled(
  src: RgbaImage,
  dest: Uint8Array,
  destWidth: number,
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
) {
  for (let y = 0; y < to.h; y++) {
    const sy = from.y + ((y + 0.5) * from.h) / to.h - 0.5;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1;
    const fy = sy - y0;
    for (let x = 0; x < to.w; x++) {
      const sx = from.x + ((x + 0.5) * from.w) / to.w - 0.5;
      const x0 = Math.floor(sx);
      const x1 = x0 + 1;
      const fx = sx - x0;
      const mix = (a: number, b: number, t: number) => a + (b - a) * t;
      const c00 = sample(src, x0, y0);
      const c10 = sample(src, x1, y0);
      const c01 = sample(src, x0, y1);
      const c11 = sample(src, x1, y1);
      const di = ((to.y + y) * destWidth + (to.x + x)) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = mix(c00[channel] ?? 0, c10[channel] ?? 0, fx);
        const bottom = mix(c01[channel] ?? 0, c11[channel] ?? 0, fx);
        dest[di + channel] = Math.round(mix(top, bottom, fy));
      }
    }
  }
}

function stackNameplates(image: RgbaImage, boxes: readonly DraftBox[]): RgbaImage {
  const cellW = NAMEPLATE_CELL_WIDTH;
  const height = SLOT_LINE_STRIDE * boxes.length;
  const data = new Uint8Array(cellW * height * 4);
  boxes.forEach((box, index) => {
    const cell = nameplateCell(image.width, image.height, box, index, cellW, SLOT_LINE_STRIDE);
    blitScaled(
      image,
      data,
      cellW,
      { x: cell.sx, y: cell.sy, w: cell.sw, h: cell.sh },
      { x: cell.dx, y: cell.dy, w: cell.dw, h: cell.dh },
    );
  });
  return { width: cellW, height, data };
}

describe("final loading screen", () => {
  it("recognizes the welcome screen and not a draft lobby", () => {
    const finalScreen = decodePng(readFileSync(FINAL));
    const lobby = decodePng(readFileSync(path.join(DRAFTS, "braxis 1.png")));
    expect(finalScreenLikely(finalScreen.width, finalScreen.height, pixelAt(finalScreen))).toBe(true);
    expect(finalScreenLikely(lobby.width, lobby.height, pixelAt(lobby))).toBe(false);
  });

  it("joins a split player name and keeps the hero line separate", () => {
    expect(
      joinNameFragments([
        { text: "Valla", top: 1680, x: 40 },
        { text: "P", top: 1740, x: 20 },
        { text: "enelope", top: 1742, x: 40 },
      ]),
    ).toEqual(["Valla", "Penelope"]);
  });

  it("keeps heroes already locked and adds the ones the loading screen still has", () => {
    const blue = [
      { hero: "Hogger", player: "Hucklt" },
      { hero: "Kel'Thuzad", player: "JonnyB" },
      { hero: "Johanna", player: "Auramir" },
      { hero: "Li Li", player: "TheOCLoc" },
      { hero: "Valla", player: "Penelope" },
    ];
    const red = [
      { hero: "Li-Ming", player: "Stinktrap" },
      { hero: "Muradin", player: "Revolt" },
      { hero: "Chen", player: "Fluff" },
      { hero: "Alexstrasza", player: "nvtural" },
      { hero: "Fenix", player: "TinyTinaFart" },
    ];
    const completed = completeDraftFromFinalScreen({
      draft: {
        ...EMPTY_LIVE_DRAFT,
        ourPicks: ["Hogger", "Kel'Thuzad"],
        ourPickPlayers: ["Huckit", null],
        theirPicks: ["Li-Ming"],
        theirPickPlayers: ["Stinktrap"],
        ourBans: ["Brightwing", "Xal'atath"],
        theirBans: ["Johanna"],
        map: "Braxis Holdout",
      },
      blue,
      red,
      ourNames: ["Huckit", "JonnyB"],
      roster: ["Huckit#1111", "JonnyB#2222", "Stinktrap#3333"],
    });
    expect(completed?.conflict).toBeNull();
    expect(completed?.draft.ourPicks).toEqual(["Hogger", "Kel'Thuzad", "Johanna", "Li Li", "Valla"]);
    expect(completed?.draft.ourPickPlayers[0]).toBe("Huckit");
    expect(completed?.draft.ourPickPlayers[1]).toBe("JonnyB");
    expect(completed?.draft.theirPicks).toEqual([
      "Li-Ming",
      "Muradin",
      "Chen",
      "Alexstrasza",
      "Fenix",
    ]);
    expect(completed?.draft.sealed).toBe(true);
    expect(completed?.draft.ourOpenPlayers).toEqual([]);
    expect(completed?.draft.ourBans).toEqual(["Brightwing", "Xal'atath"]);
  });

  it("keeps a draft that disagrees with the loading screen and asks which is right", () => {
    const completed = completeDraftFromFinalScreen({
      draft: {
        ...EMPTY_LIVE_DRAFT,
        ourPicks: ["Hogger", "Zeratul"],
        ourPickPlayers: ["Huckit", "Wrong"],
        theirPicks: ["Li-Ming"],
        theirPickPlayers: ["Stinktrap"],
      },
      blue: [
        { hero: "Hogger", player: "Huckit" },
        { hero: "Kel'Thuzad", player: "JonnyB" },
        { hero: "Johanna", player: "Auramir" },
        { hero: "Li Li", player: "TheOCLoc" },
        { hero: "Valla", player: "Penelope" },
      ],
      red: [
        { hero: "Li-Ming", player: "Stinktrap" },
        { hero: "Muradin", player: "Revolt" },
        { hero: "Chen", player: "Fluff" },
        { hero: "Alexstrasza", player: "nvtural" },
        { hero: "Fenix", player: "TinyTinaFart" },
      ],
      ourNames: ["Huckit"],
      roster: [],
    });
    expect(completed?.draft.ourPicks).toEqual(["Hogger", "Zeratul"]);
    expect(completed?.draft.sealed).toBeUndefined();
    expect(completed?.conflict?.before.our).toEqual(["Hogger", "Zeratul"]);
    expect(completed?.conflict?.screen.our).toContain("Valla");
    expect(completed?.conflict?.screen.our).not.toContain("Zeratul");
    const question = mismatchQuestion(completed!.conflict!);
    expect(question).toContain("Zeratul");
    expect(question).toContain("Which one is right?");
  });

  it(
    "reads both teams off the Braxis loading screen",
    async () => {
      const image = decodePng(readFileSync(FINAL));
      const names = await readNameColumns(
        encodePng(stackNameplates(image, FINAL_NAME_BOXES.left)).toString("base64"),
        encodePng(stackNameplates(image, FINAL_NAME_BOXES.right)).toString("base64"),
      );
      const red = seatsFromNameLines(names.left);
      const blue = seatsFromNameLines(names.right);
      expect(red.map((seat) => seat.hero)).toEqual([
        "Li-Ming",
        "Muradin",
        "Chen",
        "Alexstrasza",
        "Fenix",
      ]);
      expect(blue.map((seat) => seat.hero)).toEqual([
        "Hogger",
        "Kel'Thuzad",
        "Johanna",
        "Li Li",
        "Valla",
      ]);
      expect(blue.map((seat) => ocrFold(seat.player ?? ""))).toEqual([
        ocrFold("Huckit"),
        ocrFold("JonnyB"),
        ocrFold("Auramir"),
        ocrFold("TheOCLoc"),
        ocrFold("Penelope"),
      ]);
      const completed = completeDraftFromFinalScreen({
        draft: { ...EMPTY_LIVE_DRAFT, ourPicks: ["Hogger"], ourPickPlayers: ["Huckit"] },
        blue,
        red,
        ourNames: ["Huckit", "JonnyB"],
        roster: ["Huckit#1111", "JonnyB#2222"],
        mapText: "BRAXIS HOLDOUT",
      });
      expect(completed?.draft.map).toBe("Braxis Holdout");
      expect(completed?.draft.ourPicks.map(heroKey)).toEqual(
        ["Hogger", "Kel'Thuzad", "Johanna", "Li Li", "Valla"].map(heroKey),
      );
      expect(completed?.draft.theirPicks).toHaveLength(5);
      expect(mapFromTitle("welcome to braxis holdout")).toBe("Braxis Holdout");
      expect(FINAL_MAP_BOX.h).toBeGreaterThan(0);
    },
    120_000,
  );
});
