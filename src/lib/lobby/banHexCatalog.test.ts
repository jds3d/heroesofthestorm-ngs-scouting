import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  banFace,
  banFaceScore,
  catalogRowFromBanHex,
  matchBanPixels,
} from "@/lib/lobby/banFace";
import { banHexManifest, rowsFromBanHexExamples } from "@/lib/lobby/banHexCatalog";
import { DRAFT_BAN_HEXES } from "@/lib/lobby/screenLobby";
import { decodePng, encodePng } from "@/lib/lobby/pngImage";

const HEX_DIR = path.join(process.cwd(), "examples", "ban-hexes");
const CATALOG_JSON = path.join(process.cwd(), "src", "lib", "lobby", "banHexCatalog.json");
const ALTERAC = path.join(process.cwd(), "examples", "drafts", "draft lobby alterac 2.png");

function cropHex(
  image: ReturnType<typeof decodePng>,
  box: { x: number; y: number; w: number; h: number },
) {
  const x = Math.max(0, Math.round(box.x * image.width));
  const y = Math.max(0, Math.round(box.y * image.height));
  const w = Math.max(1, Math.min(image.width - x, Math.round(box.w * image.width)));
  const h = Math.max(1, Math.min(image.height - y, Math.round(box.h * image.height)));
  const pixels: { r: number; g: number; b: number }[] = [];
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      const rgb = { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
      pixels.push(rgb);
      const di = (row * w + col) * 4;
      data[di] = rgb.r;
      data[di + 1] = rgb.g;
      data[di + 2] = rgb.b;
      data[di + 3] = 255;
    }
  }
  return { pixels, width: w, height: h, png: encodePng({ width: w, height: h, data }) };
}

describe("ban hex catalog", () => {
  it("regenerates PNGs and banHexCatalog.json from the manifest sources", () => {
    if (process.env.REGEN_BAN_HEX !== "1") return;
    const image = decodePng(readFileSync(ALTERAC));
    const manifest = [
      { hero: "Hogger", file: "hogger-alterac-2.png", source: "draft lobby alterac 2.png" },
      { hero: "Whitemane", file: "whitemane-alterac-2.png", source: "draft lobby alterac 2.png" },
    ];
    const boxes = [DRAFT_BAN_HEXES.right[0], DRAFT_BAN_HEXES.right[2]];
    mkdirSync(HEX_DIR, { recursive: true });
    const rows = manifest.map((row, index) => {
      const crop = cropHex(image, boxes[index]!);
      writeFileSync(path.join(HEX_DIR, row.file), crop.png);
      const catalog = catalogRowFromBanHex(row.hero, crop.pixels, crop.width, crop.height);
      if (!catalog) throw new Error(`no catalog row for ${row.hero}`);
      return catalog;
    });
    writeFileSync(path.join(HEX_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(CATALOG_JSON, JSON.stringify(rows, null, 2) + "\n");
  });

  it("scores a saved hex at ~100% against its catalog row", () => {
    const rows = rowsFromBanHexExamples();
    expect(rows.length).toBe(banHexManifest().length);
    for (const entry of banHexManifest()) {
      const row = rows.find((r) => r.hero === entry.hero);
      expect(row).toBeDefined();
      const file = path.join(HEX_DIR, path.basename(entry.file));
      const image = decodePng(readFileSync(file));
      const pixels = [];
      for (let i = 0; i < image.width * image.height; i++) {
        pixels.push({
          r: image.data[i * 4] ?? 0,
          g: image.data[i * 4 + 1] ?? 0,
          b: image.data[i * 4 + 2] ?? 0,
        });
      }
      const face = banFace(pixels, image.width, image.height);
      expect(face).not.toBeNull();
      expect(banFaceScore(face!, row!)).toBeGreaterThan(0.99);
    }
  });

  it("names Hogger and Whitemane on Alterac with hex examples in the catalog", () => {
    const image = decodePng(readFileSync(ALTERAC));
    const hogger = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const whitemane = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(hogger.pixels, hogger.width, hogger.height)).toBe("Hogger");
    expect(matchBanPixels(whitemane.pixels, whitemane.width, whitemane.height)).toBe("Whitemane");
  });
});
