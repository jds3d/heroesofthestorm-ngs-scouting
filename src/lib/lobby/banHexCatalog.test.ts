import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  banFace,
  banFaceScore,
  catalogRowFromBanHex,
  matchBanPixels,
  matchSavedBanHex,
  readThreeBanHexSlots,
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
    const manifest = banHexManifest();
    const drafts = path.join(process.cwd(), "examples", "drafts");
    mkdirSync(HEX_DIR, { recursive: true });
    const rows = manifest.map((row) => {
      const source = path.join(drafts, row.source ?? "draft lobby alterac 2.png");
      const image = decodePng(readFileSync(source));
      const side = row.side ?? "right";
      const slot = row.slot ?? 0;
      const box = DRAFT_BAN_HEXES[side][slot];
      if (!box) throw new Error(`no ban box for ${row.hero}`);
      const crop = cropHex(image, box);
      writeFileSync(path.join(HEX_DIR, row.file), crop.png);
      const catalog = catalogRowFromBanHex(row.hero, crop.pixels, crop.width, crop.height);
      if (!catalog) throw new Error(`no catalog row for ${row.hero}`);
      return catalog;
    });
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

  it("names Xal'atath on Battlefield (not Sylvanas hex false positive)", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "battlefield.png")),
    );
    const xal = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    expect(matchBanPixels(xal.pixels, xal.width, xal.height)).toBe("Xal'atath");
  });

  it("names Hogger and Whitemane on Alterac with hex examples in the catalog", () => {
    const image = decodePng(readFileSync(ALTERAC));
    const hogger = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const whitemane = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(hogger.pixels, hogger.width, hogger.height)).toBe("Hogger");
    expect(matchBanPixels(whitemane.pixels, whitemane.width, whitemane.height)).toBe("Whitemane");
  }, 20_000);

  it("names Braxis ban hexes from saved crops (not Maiev for Anub'arak)", () => {
    const drafts = path.join(process.cwd(), "examples", "drafts");
    const braxis1 = decodePng(readFileSync(path.join(drafts, "braxis 1.png")));
    const braxis2 = decodePng(readFileSync(path.join(drafts, "braxis 2.png")));
    const qhira = cropHex(braxis1, DRAFT_BAN_HEXES.left[0]);
    const anub = cropHex(braxis1, DRAFT_BAN_HEXES.right[0]);
    expect(matchBanPixels(qhira.pixels, qhira.width, qhira.height)).toBe("Qhira");
    expect(matchBanPixels(anub.pixels, anub.width, anub.height)).toBe("Anub'arak");
    expect(matchBanPixels(anub.pixels, anub.width, anub.height)).not.toBe("Maiev");
    const chromie = cropHex(braxis1, DRAFT_BAN_HEXES.right[1]);
    expect(matchBanPixels(chromie.pixels, chromie.width, chromie.height)).toBe("Chromie");
    const cassia = cropHex(braxis2, DRAFT_BAN_HEXES.left[0]);
    const chen = cropHex(braxis2, DRAFT_BAN_HEXES.left[1]);
    const sylvanas = cropHex(braxis2, DRAFT_BAN_HEXES.left[2]);
    const tyrande = cropHex(braxis2, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(chen.pixels, chen.width, chen.height)).toBe("Chen");
    const row = readThreeBanHexSlots([cassia, chen, sylvanas]);
    expect(row.identified).toEqual(["Cassia", "Chen", "Sylvanas"]);
    expect(matchBanPixels(sylvanas.pixels, sylvanas.width, sylvanas.height)).toBe("Sylvanas");
    const rows = rowsFromBanHexExamples();
    const tyrandeRow = rows.find((row) => row.hero === "Tyrande");
    expect(tyrandeRow).toBeDefined();
    const tyrandeFace = banFace(tyrande.pixels, tyrande.width, tyrande.height);
    expect(tyrandeFace).not.toBeNull();
    expect(banFaceScore(tyrandeFace!, tyrandeRow!)).toBeGreaterThan(0.99);
    expect(matchBanPixels(tyrande.pixels, tyrande.width, tyrande.height)).toBe("Tyrande");
  }, 180_000);
});
