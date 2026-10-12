import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  plateFill,
  portraitFilled,
  portraitIsLocked,
} from "@/lib/lobby/screenLobby";
import { decodePng } from "@/lib/lobby/pngImage";

const BF2 = path.join(process.cwd(), "examples", "drafts", "battlefield 2.png");

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

describe("battlefield 2 plates", () => {
  it("locks only committed ally picks on the left", () => {
    const image = decodePng(readFileSync(BF2));
    const left = DRAFT_PLATE_SLOTS.left.map((portrait, index) => {
      const plate = plateFill(boxRgb(image, DRAFT_SLOT_NAMES.left[index]), true);
      const locked = portraitIsLocked({
        phase: "pick",
        faceFilled: portraitFilled(boxRgb(image, portrait)),
        plate,
        ally: true,
        heroOnPlate: true,
      });
      return { index, plate, locked };
    });
    expect(left.filter((row) => row.locked).map((row) => row.index)).toEqual([0, 1, 2, 4]);
  });
});
