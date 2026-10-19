import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DRAFT_TITLE_BOX, type Rgb } from "@/lib/lobby/screenLobby";
import { matchMapTitle } from "@/lib/lobby/mapTitle";
import { decodePng, type RgbaImage } from "@/lib/lobby/pngImage";
import {
  mergeColumnReads,
  ocrRefreshPlan,
  shouldReadPartyNames,
} from "@/lib/lobby/watchFingerprint";

const DRAFTS: { file: string; map: string }[] = [
  { file: "alterac 1.png", map: "Alterac Pass" },
  { file: "draft lobby alterac.png", map: "Alterac Pass" },
  { file: "battlefield 3.png", map: "Battlefield of Eternity" },
  { file: "braxis 2.png", map: "Braxis Holdout" },
  { file: "cursed hollow.png", map: "Cursed Hollow" },
  { file: "draft lobby shrines.png", map: "Infernal Shrines" },
  { file: "draft lobby volskaya.png", map: "Volskaya Foundry" },
  { file: "garden of terror.png", map: "Garden of Terror" },
  { file: "haunted mines 2.png", map: "Haunted Mines" },
  { file: "sky temple 1.png", map: "Sky Temple" },
  { file: "sky temple 2.png", map: "Sky Temple" },
  { file: "tomb 1.png", map: "Tomb of the Spider Queen" },
];

function titlePixels(image: RgbaImage): { pixels: Rgb[]; width: number; height: number } {
  const x = Math.max(0, Math.round(DRAFT_TITLE_BOX.x * image.width));
  const y = Math.max(0, Math.round(DRAFT_TITLE_BOX.y * image.height));
  const width = Math.max(1, Math.min(image.width - x, Math.round(DRAFT_TITLE_BOX.w * image.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(DRAFT_TITLE_BOX.h * image.height)));
  const pixels: Rgb[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      pixels.push({
        r: image.data[i] ?? 0,
        g: image.data[i + 1] ?? 0,
        b: image.data[i + 2] ?? 0,
      });
    }
  }
  return { pixels, width, height };
}

describe("matchMapTitle", () => {
  it("names every saved draft from the title glyphs, without reading the letters", () => {
    for (const draft of DRAFTS) {
      const image = decodePng(
        readFileSync(path.join(process.cwd(), "examples", "drafts", draft.file)),
      );
      const title = titlePixels(image);
      expect(matchMapTitle(title.pixels, title.width, title.height), draft.file).toBe(draft.map);
    }
  });
});

describe("ocrRefreshPlan", () => {
  const current = {
    title: "t",
    status: "s",
    namesLeft: "l",
    namesRight: "r",
    center: "c",
  };

  it("reads every region on the first frame", () => {
    expect(ocrRefreshPlan(current, null)).toEqual({
      title: true,
      status: true,
      left: true,
      right: true,
      center: true,
    });
  });

  it("rereads only the name column whose pixels changed", () => {
    expect(ocrRefreshPlan({ ...current, namesLeft: "l2" }, current)).toEqual({
      title: false,
      status: false,
      left: true,
      right: false,
      center: false,
    });
    expect(ocrRefreshPlan({ ...current, namesRight: "r2" }, current)).toEqual({
      title: false,
      status: false,
      left: false,
      right: true,
      center: false,
    });
  });

  it("keeps cached lines for a column that was not reread", () => {
    const cached = {
      left: [{ text: "Zeratul", top: 0 }],
      right: [{ text: "Blaze", top: 400 }],
      center: [{ text: "YOUR TURN", top: 10 }],
    };
    expect(
      mergeColumnReads(
        { left: true, right: false, center: false },
        { left: [{ text: "Probius", top: 400 }], right: [], center: [] },
        cached,
      ),
    ).toEqual({
      left: [{ text: "Probius", top: 400 }],
      right: cached.right,
      center: cached.center,
    });
  });

  it("leaves the party row off a draft frame", () => {
    expect(shouldReadPartyNames("draft")).toBe(false);
    expect(shouldReadPartyNames("menu")).toBe(true);
    expect(shouldReadPartyNames("wait")).toBe(true);
  });
});
