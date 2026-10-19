import { MAP_TITLE_MASKS } from "@/lib/lobby/mapTitleMasks";

/** Glyph grid for a map title. Coarse enough that two captures of one map still overlap. */
export const TITLE_MASK_W = 96;
export const TITLE_MASK_H = 12;

/** Same-map drafts score about 0.84. A different map stays under 0.4. */
const TITLE_MATCH_SCORE = 0.7;
const TITLE_MATCH_MARGIN = 0.15;

export type TitlePixel = { r: number; g: number; b: number };

/**
 * Bright glyphs in the map title, ignoring the timer arc under the words.
 * Box downsample so a 1080p frame and a 1440p frame land on the same grid.
 */
export function titleGlyphMask(
  pixels: readonly TitlePixel[],
  width: number,
  height: number,
): Uint8Array {
  const rows = Math.max(1, Math.floor(height * 0.72));
  const bits = new Uint8Array(TITLE_MASK_W * TITLE_MASK_H);
  if (width < 2 || height < 2 || pixels.length < width * height) return bits;
  for (let gy = 0; gy < TITLE_MASK_H; gy++) {
    const y0 = Math.floor((gy * rows) / TITLE_MASK_H);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * rows) / TITLE_MASK_H));
    for (let gx = 0; gx < TITLE_MASK_W; gx++) {
      const x0 = Math.floor((gx * width) / TITLE_MASK_W);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / TITLE_MASK_W));
      let bright = 0;
      let total = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const pixel = pixels[y * width + x];
          total += 1;
          if (pixel && pixel.r + pixel.g + pixel.b > 420) bright += 1;
        }
      }
      if (total > 0 && bright / total > 0.28) bits[gy * TITLE_MASK_W + gx] = 1;
    }
  }
  return bits;
}

function maskIou(left: Uint8Array, right: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (a && b) inter += 1;
    if (a || b) union += 1;
  }
  return union ? inter / union : 0;
}

function bitsFromRow(row: string): Uint8Array {
  const bits = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) bits[i] = row.charCodeAt(i) === 49 ? 1 : 0;
  return bits;
}

/**
 * The map whose saved title glyph matches this crop.
 * A weak or ambiguous match returns null so the caller can read the line.
 */
export function matchMapTitle(
  pixels: readonly TitlePixel[],
  width: number,
  height: number,
): string | null {
  if (!pixels.length || width < 8 || height < 4) return null;
  const mask = titleGlyphMask(pixels, width, height);
  let bright = 0;
  for (let i = 0; i < mask.length; i++) bright += mask[i] ?? 0;
  if (bright < 12) return null;
  const byMap = new Map<string, number>();
  for (const template of MAP_TITLE_MASKS) {
    const score = maskIou(mask, bitsFromRow(template.bits));
    const prev = byMap.get(template.map) ?? 0;
    if (score > prev) byMap.set(template.map, score);
  }
  let bestName = "";
  let best = 0;
  let second = 0;
  for (const [name, score] of byMap) {
    if (score > best) {
      second = best;
      best = score;
      bestName = name;
    } else if (score > second) {
      second = score;
    }
  }
  if (!bestName || best < TITLE_MATCH_SCORE || best - second < TITLE_MATCH_MARGIN) return null;
  return bestName;
}
