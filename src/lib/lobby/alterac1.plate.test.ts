import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  plateFill,
  portraitFilled,
  portraitIsLocked,
  portraitTeamRim,
} from "@/lib/lobby/screenLobby";
import { decodePng } from "@/lib/lobby/pngImage";

const ALTERAC = path.join(process.cwd(), "examples", "drafts", "draft lobby alterac.png");

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

describe("alterac pass plate reads", () => {
  it("locks qhira and both enemy picks but not greymane or alarak hovers", () => {
    const image = decodePng(readFileSync(ALTERAC));
    const pixelAt = (px: number, py: number) => {
      const x = Math.max(0, Math.min(image.width - 1, px));
      const y = Math.max(0, Math.min(image.height - 1, py));
      const i = (y * image.width + x) * 4;
      return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
    };
    const readSide = (
      side: "left" | "right",
      portraits: typeof DRAFT_PLATE_SLOTS.left,
      names: typeof DRAFT_SLOT_NAMES.left,
    ) =>
      portraits.map((box, index) => {
        const face = boxRgb(image, box);
        const plate = plateFill(boxRgb(image, names[index]));
        const teamRim = portraitTeamRim(image.width, image.height, box, pixelAt);
        const locked = portraitIsLocked({
          phase: "pick",
          faceFilled: portraitFilled(face),
          teamRim,
          plate,
          ally: side === "left",
        });
        return { index, plate, teamRim, locked, face: portraitFilled(face) };
      });
    const left = readSide("left", DRAFT_PLATE_SLOTS.left, DRAFT_SLOT_NAMES.left);
    const right = readSide("right", DRAFT_PLATE_SLOTS.right, DRAFT_SLOT_NAMES.right);
    expect(left.filter((slot) => slot.locked).map((slot) => slot.index)).toEqual([3]);
    expect(right.filter((slot) => slot.locked).map((slot) => slot.index)).toEqual([0, 2]);
    expect(left.filter((slot) => slot.plate === "shown").map((slot) => slot.index)).toContain(0);
    expect(left.filter((slot) => slot.plate === "shown").map((slot) => slot.index)).toContain(1);
  });
});
