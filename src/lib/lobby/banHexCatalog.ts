import { readFileSync } from "node:fs";
import path from "node:path";
import { catalogRowFromBanHex, type BanCatalogRow } from "@/lib/lobby/banFace";
import { decodePng } from "@/lib/lobby/pngImage";
import type { Rgb } from "@/lib/lobby/screenLobby";

export type BanHexManifestRow = {
  hero: string;
  file: string;
  /** Lobby still the crop came from, for humans. */
  source?: string;
};

const HEX_DIR = path.join(process.cwd(), "examples", "ban-hexes");
const MANIFEST = path.join(HEX_DIR, "manifest.json");

export function banHexManifest(): BanHexManifestRow[] {
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BanHexManifestRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as BanHexManifestRow).hero === "string" &&
        typeof (row as BanHexManifestRow).file === "string" &&
        !path.basename((row as BanHexManifestRow).file).includes(".."),
    );
  } catch {
    return [];
  }
}

/** Catalog rows built from saved ban-hex PNGs — same pipeline as live reads. */
export function rowsFromBanHexExamples(): BanCatalogRow[] {
  const out: BanCatalogRow[] = [];
  for (const row of banHexManifest()) {
    const file = path.join(HEX_DIR, path.basename(row.file));
    const image = decodePng(readFileSync(file));
    const pixels: Rgb[] = [];
    for (let i = 0; i < image.width * image.height; i++) {
      pixels.push({
        r: image.data[i * 4] ?? 0,
        g: image.data[i * 4 + 1] ?? 0,
        b: image.data[i * 4 + 2] ?? 0,
      });
    }
    const catalog = catalogRowFromBanHex(row.hero, pixels, image.width, image.height);
    if (catalog) out.push(catalog);
  }
  return out;
}
