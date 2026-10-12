import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogRowFromBanHex } from "@/lib/lobby/banFace";
import { banHexPassed } from "@/lib/lobby/banFace";
import { DRAFT_BAN_HEXES } from "@/lib/lobby/screenLobby";
import { decodePng, encodePng } from "@/lib/lobby/pngImage";

function crop(image: ReturnType<typeof decodePng>, box: { x: number; y: number; w: number; h: number }) {
  const x = Math.round(box.x * image.width);
  const y = Math.round(box.y * image.height);
  const w = Math.round(box.w * image.width);
  const h = Math.round(box.h * image.height);
  const pixels: { r: number; g: number; b: number }[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      pixels.push({ r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 });
    }
  }
  return { pixels, width: w, height: h };
}

describe("banHexPassed", () => {
  it("regenerates noBanPlate.json from battlefield.png", () => {
    if (process.env.REGEN_NO_BAN !== "1") return;
    const bf = decodePng(
      readFileSync(path.join(process.cwd(), "examples/drafts/battlefield.png")),
    );
    const boxes = [DRAFT_BAN_HEXES.left[0], DRAFT_BAN_HEXES.right[1]];
    const rows = boxes.map((box, index) => {
      const { pixels, width, height } = crop(bf, box);
      const row = catalogRowFromBanHex(`no-ban-${index}`, pixels, width, height);
      if (!row) throw new Error(`no row for box ${index}`);
      return row;
    });
    writeFileSync(
      path.join(process.cwd(), "src/lib/lobby/noBanPlate.json"),
      JSON.stringify(rows, null, 2) + "\n",
    );
    const { pixels, width, height } = crop(bf, DRAFT_BAN_HEXES.left[0]);
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i]!;
      data[i * 4] = p.r;
      data[i * 4 + 1] = p.g;
      data[i * 4 + 2] = p.b;
      data[i * 4 + 3] = 255;
    }
    const assetDir = path.join(process.cwd(), "public", "draft");
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(
      path.join(assetDir, "no-ban-plate.png"),
      encodePng({ width, height, data }),
    );
  });

  it("flags battlefield no-ban plates but not empty shrines hexes", () => {
    const shrines = decodePng(
      readFileSync(path.join(process.cwd(), "examples/drafts/draft lobby shrines.png")),
    );
    const bf = decodePng(
      readFileSync(path.join(process.cwd(), "examples/drafts/battlefield.png")),
    );
    const shrinesPx = crop(shrines, DRAFT_BAN_HEXES.left[0]);
    const bfLeft = crop(bf, DRAFT_BAN_HEXES.left[0]);
    const bfRight = crop(bf, DRAFT_BAN_HEXES.right[1]);
    expect(banHexPassed(shrinesPx.pixels, shrinesPx.width, shrinesPx.height)).toBe(false);
    expect(banHexPassed(bfLeft.pixels, bfLeft.width, bfLeft.height)).toBe(true);
    expect(banHexPassed(bfRight.pixels, bfRight.width, bfRight.height)).toBe(true);
  });
});
