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

const BRAXIS1 = path.join(process.cwd(), "examples", "drafts", "braxis 1.png");
const BRAXIS2 = path.join(process.cwd(), "examples", "drafts", "braxis 2.png");

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

describe("Braxis draft plates", () => {
  it("keeps ally hover plates blue on braxis 1 (only Johanna on the plate)", () => {
    const image = decodePng(readFileSync(BRAXIS1));
    const plates = DRAFT_SLOT_NAMES.left.map((box) => plateFill(boxRgb(image, box), true));
    expect(plates[0]).toBe("shown");
    expect(plates.slice(1).every((fill) => fill === "shown" || fill === "empty")).toBe(
      true,
    );
  });

  it("locks every committed pick on braxis 2", () => {
    const image = decodePng(readFileSync(BRAXIS2));
    const locked = (ally: boolean) =>
      (ally ? DRAFT_PLATE_SLOTS.left : DRAFT_PLATE_SLOTS.right).map((portrait, index) => {
        const names = ally ? DRAFT_SLOT_NAMES.left : DRAFT_SLOT_NAMES.right;
        const plate = plateFill(boxRgb(image, names[index]), ally);
        return portraitIsLocked({
          phase: "pick",
          faceFilled: portraitFilled(boxRgb(image, portrait)),
          plate,
          ally,
          heroOnPlate: true,
        });
      });
    expect(locked(true).every(Boolean)).toBe(true);
    expect(locked(false).every(Boolean)).toBe(true);
  });
});
