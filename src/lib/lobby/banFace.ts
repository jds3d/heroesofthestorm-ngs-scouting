import { banHexFilled, colorfulFraction, type Rgb } from "@/lib/lobby/screenLobby";
import catalogJson from "@/lib/lobby/banPortraits.json";
import banHexCatalogJson from "@/lib/lobby/banHexCatalog.json";
import noBanPlateJson from "@/lib/lobby/noBanPlate.json";

const SAVED_HEX_ROWS: BanCatalogRow[] = banHexCatalogJson as BanCatalogRow[];
const PORTRAIT_CATALOG: BanCatalogRow[] = catalogJson as BanCatalogRow[];
/** Saved hexes that false-match each other's real bans on other maps. */
const LOOSE_SAVED_HEX = new Set(["Cassia", "Qhira", "Sylvanas", "Xal'atath"]);
const LOOSE_HEX_CONFUSER: Record<string, string> = {
  Cassia: "Qhira",
  Sylvanas: "Xal'atath",
};
const LOOSE_HEX_PAIR_MIN = 0.995;

/** Disambiguate saved crops that false-match each other (Cassia vs Qhira, etc.). */
function resolveLooseHexPair(face: BanFace): string | null {
  const portrait = matchBanFace(face, PORTRAIT_CATALOG);
  const cassRow = SAVED_HEX_ROWS.find((entry) => entry.hero === "Cassia");
  const qhiraRow = SAVED_HEX_ROWS.find((entry) => entry.hero === "Qhira");
  const sylRow = SAVED_HEX_ROWS.find((entry) => entry.hero === "Sylvanas");
  const xalRow = SAVED_HEX_ROWS.find((entry) => entry.hero === "Xal'atath");
  const cassHex = cassRow ? banFaceScore(face, cassRow) : -Infinity;
  const qhiraHex = qhiraRow ? banFaceScore(face, qhiraRow) : -Infinity;
  const sylHex = sylRow ? banFaceScore(face, sylRow) : -Infinity;
  const xalHex = xalRow ? banFaceScore(face, xalRow) : -Infinity;
  if (portrait === "Qhira" && cassHex >= 0.9999 && cassHex > qhiraHex) {
    return "Cassia";
  }
  if (portrait === "Xal'atath" && sylHex >= 0.99995 && sylHex > xalHex) {
    return "Sylvanas";
  }
  for (const [a, b] of [
    ["Cassia", "Qhira"],
    ["Sylvanas", "Xal'atath"],
  ] as const) {
    const rowA = SAVED_HEX_ROWS.find((entry) => entry.hero === a);
    const rowB = SAVED_HEX_ROWS.find((entry) => entry.hero === b);
    const sa = rowA ? banFaceScore(face, rowA) : -Infinity;
    const sb = rowB ? banFaceScore(face, rowB) : -Infinity;
    if (!rowA && !rowB) continue;
    if (!rowA || !rowB) {
      const only = rowA ? a : b;
      const score = rowA ? sa : sb;
      const confuser = LOOSE_HEX_CONFUSER[only];
      if (confuser && score >= LOOSE_HEX_PAIR_MIN) {
        const portrait = matchBanFace(face, PORTRAIT_CATALOG);
        const confuseRow = PORTRAIT_CATALOG.find((entry) => entry.hero === confuser);
        const confusePort = confuseRow ? banFaceScore(face, confuseRow) : -Infinity;
        if (portrait === confuser && score > confusePort + 0.15) return only;
      }
      continue;
    }
    if (sa >= LOOSE_HEX_PAIR_MIN && sa > sb + 0.01) return a;
    if (sb >= LOOSE_HEX_PAIR_MIN && sb > sa + 0.01) return b;
  }
  return null;
}
export type BanFace = { color: number[]; hog: number[] };

export type BanCatalogRow = {
  hero: string;
  color: number[];
  hog: number[];
  gw?: number;
  gh?: number;
  gray?: string;
};

/** A ban is named only when one portrait leads the rest of the roster. */
const MIN_SCORE = 0.66;
const MIN_MARGIN = 0.038;
/** The hex sits inside the target portrait. This cut is for that tighter crop. */
const MIN_ALIGN = 0.7;
const MIN_ALIGN_MARGIN = 0.12;

function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/**
 * Face inside the hex, with the frame painted out, then a color grid plus
 * the direction of the edges. Both sides are the official target portrait
 * and the ban hex reduced the same way.
 */
export function banFace(pixels: readonly Rgb[], width: number, height: number): BanFace | null {
  if (width < 8 || height < 8 || pixels.length < width * height) return null;
  const painted = paintFace(pixels, width, height);
  if (!painted) return null;
  const color = normalize(boxAverage(painted, width, height, 3, 10, 10));
  const hog = hogOf(painted, width, height);
  if (!color || !hog) return null;
  return { color, hog };
}

export function banFaceScore(query: BanFace, example: BanFace): number {
  return 0.55 * dot(query.hog, example.hog) + 0.45 * dot(query.color, example.color);
}

/** The hero whose saved portrait is this ban face. Unclear faces stay unnamed. */
export function matchBanFace(
  query: BanFace,
  rows: readonly BanCatalogRow[] = PORTRAIT_CATALOG,
): string | null {
  let best: { hero: string; score: number } | null = null;
  let second = -Infinity;
  for (const row of rows) {
    const score = banFaceScore(query, row);
    if (!best || score > best.score) {
      second = best?.score ?? -Infinity;
      best = { hero: row.hero, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < MIN_SCORE || best.score - second < MIN_MARGIN) return null;
  return best.hero;
}

/**
 * Build a catalog row from a saved ban hex. The same read against this row
 * scores ~1.0 on the color + HOG fingerprint.
 */
export function catalogRowFromBanHex(
  hero: string,
  pixels: readonly Rgb[],
  width: number,
  height: number,
): BanCatalogRow | null {
  const face = banFace(pixels, width, height);
  if (!face) return null;
  const luma = lumaOf(pixels, width, height);
  const bytes = new Uint8Array(width * height);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.round(Math.min(255, luma[i] ?? 0));
  }
  const gray =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(String.fromCharCode(...bytes));
  return { hero, color: face.color, hog: face.hog, gw: width, gh: height, gray };
}

const NO_BAN_PLATE_ROWS: BanCatalogRow[] = noBanPlateJson as BanCatalogRow[];
const NO_BAN_MIN_SCORE = 0.62;

/** Storm League "NO BAN" plate inside a ban hex (muted art, not a hero face). */
export function banHexPassed(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): boolean {
  return matchesNoBanPlate(pixels, width, height);
}

/** NO BAN plates sit between empty hexes and hero faces on colorfulFraction. */
const NO_BAN_MAX_COLORFUL = 0.245;

export function matchesNoBanPlate(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): boolean {
  if (banHexFilled(pixels)) return false;
  if (colorfulFraction(pixels) > NO_BAN_MAX_COLORFUL) return false;
  const face = banFace(pixels, width, height);
  if (!face) return false;
  let best = -Infinity;
  for (const row of NO_BAN_PLATE_ROWS) {
    best = Math.max(best, banFaceScore(face, row));
  }
  return best >= NO_BAN_MIN_SCORE;
}

/** Empty hex frames can align weakly with several portraits; do not name them. */
function banHexAlignAmbiguous(pixels: readonly Rgb[], width: number, height: number): boolean {
  const face = lumaOf(pixels, width, height);
  let best = -Infinity;
  let second = -Infinity;
  for (const row of PORTRAIT_CATALOG) {
    const portrait = rowLuma(row);
    if (!portrait) continue;
    const score = bestAlign(portrait.data, portrait.w, portrait.h, face, width, height);
    if (score > best) {
      second = best;
      best = score;
    } else if (score > second) second = score;
  }
  return best >= 0.62 && best - second < MIN_ALIGN_MARGIN;
}

function savedHexCandidates(face: BanFace): { hero: string; score: number }[] {
  const portrait = matchBanFace(face, PORTRAIT_CATALOG);
  return SAVED_HEX_ROWS.map((row) => ({
    hero: row.hero,
    score: banFaceScore(face, row),
  })).filter((entry) => {
    const confuser = LOOSE_HEX_CONFUSER[entry.hero];
    if (!confuser || entry.score < 0.99) return true;
    const row = PORTRAIT_CATALOG.find((item) => item.hero === entry.hero);
    const other = PORTRAIT_CATALOG.find((item) => item.hero === confuser);
    if (!row || !other) return true;
    const selfPort = banFaceScore(face, row);
    const confusePort = banFaceScore(face, other);
    if (portrait === confuser && entry.score >= 0.99) {
      return entry.score > confusePort + 0.05;
    }
    if (entry.score > confusePort + 0.08) return true;
    return selfPort >= confusePort - MIN_MARGIN;
  });
}

export function matchSavedBanHex(face: BanFace): string | null {
  const scored = savedHexCandidates(face).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1]?.score ?? -Infinity;
  if (!best || best.score < 0.92) return null;
  const portrait = matchBanFace(face, PORTRAIT_CATALOG);
  if (portrait && best.hero !== portrait) {
    const hexRow = SAVED_HEX_ROWS.find((entry) => entry.hero === best.hero);
    const hexSelf = hexRow ? banFaceScore(face, hexRow) : -Infinity;
    const looseConfuser = LOOSE_HEX_CONFUSER[best.hero];
    if (hexSelf >= 0.999) {
      if (looseConfuser) {
        const confuseHex = SAVED_HEX_ROWS.find((entry) => entry.hero === looseConfuser);
        if (confuseHex && hexSelf > banFaceScore(face, confuseHex) + 0.01) {
          return best.hero;
        }
      } else {
        return best.hero;
      }
    } else if (
      hexSelf >= 0.99 &&
      looseConfuser &&
      hexSelf > second + 0.02
    ) {
      const confuseHex = SAVED_HEX_ROWS.find((entry) => entry.hero === looseConfuser);
      if (confuseHex && hexSelf > banFaceScore(face, confuseHex) + 0.01) {
        return best.hero;
      }
    }
    if (
      LOOSE_SAVED_HEX.has(best.hero) ||
      LOOSE_SAVED_HEX.has(portrait)
    ) {
      const portRow = PORTRAIT_CATALOG.find((entry) => entry.hero === portrait);
      const hexPortRow = PORTRAIT_CATALOG.find((entry) => entry.hero === best.hero);
      const portScore = portRow ? banFaceScore(face, portRow) : -Infinity;
      const hexPortScore = hexPortRow ? banFaceScore(face, hexPortRow) : -Infinity;
      if (portScore >= MIN_SCORE && portScore >= hexPortScore + MIN_MARGIN) return null;
    }
  }
  if (best.score >= 0.98) return best.hero;
  if (best.score - second < 0.02) return null;
  return best.hero;
}

function banCandidateScore(face: BanFace, hero: string, savedHex: string | null): number {
  const row = PORTRAIT_CATALOG.find((entry) => entry.hero === hero);
  const portraitScore = row ? banFaceScore(face, row) : -Infinity;
  if (hero !== savedHex) return portraitScore;
  const hexRow = SAVED_HEX_ROWS.find((entry) => entry.hero === hero);
  const hexScore = hexRow ? banFaceScore(face, hexRow) : -Infinity;
  if (hexScore >= 0.99) return Math.max(portraitScore, hexScore);
  return portraitScore;
}

/** Among candidates, pick whoever scores best (portrait roster plus near-perfect saved hex). */
function pickBanHero(
  face: BanFace,
  portrait: string | null,
  hex: string | null,
  aligned: string | null,
): string | null {
  const pool: string[] = [];
  for (const hero of [portrait, hex, aligned]) {
    if (hero && !pool.includes(hero)) pool.push(hero);
  }
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0] ?? null;

  if (
    hex &&
    portrait &&
    hex !== portrait &&
    LOOSE_HEX_CONFUSER[hex] &&
    savedHexCandidates(face).some((entry) => entry.hero === hex && entry.score >= 0.99)
  ) {
    return hex;
  }

  let best: { hero: string; score: number } | null = null;
  let second = -Infinity;
  for (const hero of pool) {
    const score = banCandidateScore(face, hero, hex);
    if (!best || score > best.score) {
      second = best?.score ?? -Infinity;
      best = { hero, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < MIN_SCORE) return hex ?? portrait ?? aligned;
  if (best.score - second < MIN_MARGIN) {
    if (hex) {
      const hexRow = SAVED_HEX_ROWS.find((row) => row.hero === hex);
      if (hexRow && banFaceScore(face, hexRow) >= 0.99) return hex;
    }
    return null;
  }
  return best.hero;
}

const SANDWICH_MIN_COLOR = 0.12;

/**
 * Desaturated mid-draft bans (e.g. Chen) can sit below `banHexFilled` while
 * outer hexes are already named. Only run when both neighbors are filled bans.
 */
export function inferSandwichedMutedBan(
  slots: readonly {
    filled: boolean;
    passed: boolean;
    hero: string | null;
    pixels: readonly Rgb[];
    width: number;
    height: number;
  }[],
): void {
  if (slots.length !== 3) return;
  const left = slots[0];
  const mid = slots[1];
  const right = slots[2];
  if (!left || !mid || !right) return;
  if (mid.passed || mid.hero) return;
  if (!left.filled || !right.filled || !left.hero || !right.hero) return;
  if (colorfulFraction(mid.pixels) < SANDWICH_MIN_COLOR) return;
  const face = banFace(mid.pixels, mid.width, mid.height);
  if (!face) return;
  const hex = matchSavedBanHex(face);
  if (!hex) return;
  mid.hero = hex;
  mid.filled = true;
}

export function readThreeBanHexSlots(
  crops: readonly { pixels: readonly Rgb[]; width: number; height: number }[],
): {
  identified: (string | null)[];
  filled: boolean[];
  passed: boolean[];
} {
  const identified: (string | null)[] = [];
  const filled: boolean[] = [];
  const passed: boolean[] = [];
  for (const crop of crops) {
    const pass = banHexPassed(crop.pixels, crop.width, crop.height);
    passed.push(pass);
    if (pass) {
      filled.push(false);
      identified.push(null);
      continue;
    }
    const isFilled = banHexFilled(crop.pixels);
    filled.push(isFilled);
    identified.push(isFilled ? matchBanPixels(crop.pixels, crop.width, crop.height) : null);
  }
  if (crops.length === 3) {
    const slots = crops.map((crop, i) => ({
      filled: filled[i] ?? false,
      passed: passed[i] ?? false,
      hero: identified[i] ?? null,
      pixels: crop.pixels,
      width: crop.width,
      height: crop.height,
    }));
    inferSandwichedMutedBan(slots);
    for (let i = 0; i < 3; i++) {
      filled[i] = slots[i]?.filled ?? false;
      identified[i] = slots[i]?.hero ?? null;
    }
  }
  return { identified, filled, passed };
}

export function matchBanPixels(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): string | null {
  const face = banFace(pixels, width, height);
  if (!face) return null;
  const loosePair = resolveLooseHexPair(face);
  if (loosePair) return finishBanFace(loosePair, face, pixels, width, height);
  const portrait = matchBanFace(face, PORTRAIT_CATALOG);
  const hex = matchSavedBanHex(face);
  const aligned = alignBan(pixels, width, height);
  const hero = pickBanHero(face, portrait, hex, aligned);
  if (!hero) return null;
  return finishBanFace(hero, face, pixels, width, height);
}

function finishBanFace(
  hero: string,
  face: BanFace,
  pixels: readonly Rgb[],
  width: number,
  height: number,
): string | null {
  const row = PORTRAIT_CATALOG.find((entry) => entry.hero === hero);
  const portraitScore = row ? banFaceScore(face, row) : -Infinity;
  const hexRow = SAVED_HEX_ROWS.find((entry) => entry.hero === hero);
  const hexSelf = hexRow ? banFaceScore(face, hexRow) : -Infinity;
  const confident = portraitScore >= 0.95 || hexSelf >= 0.99;
  if (
    !confident &&
    banHexAlignAmbiguous(pixels, width, height) &&
    colorfulFraction(pixels) >= 0.518
  ) {
    return null;
  }
  return hero;
}

/**
 * Slide the ban hex over each target portrait and keep the crop that lines up.
 * Tyrael's hex is the hood opening, not the shoulders in the square icon.
 */
function alignBan(pixels: readonly Rgb[], width: number, height: number): string | null {
  const face = lumaOf(pixels, width, height);
  let best: { hero: string; score: number } | null = null;
  let second = -Infinity;
  for (const row of PORTRAIT_CATALOG) {
    const portrait = rowLuma(row);
    if (!portrait) continue;
    const score = bestAlign(portrait.data, portrait.w, portrait.h, face, width, height);
    if (!best || score > best.score) {
      second = best?.score ?? -Infinity;
      best = { hero: row.hero, score };
    } else if (score > second) second = score;
  }
  if (!best || best.score < MIN_ALIGN || best.score - second < MIN_ALIGN_MARGIN) return null;
  return best.hero;
}

function lumaOf(pixels: readonly Rgb[], width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const pixel = pixels[i];
    out[i] = pixel ? 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b : 0;
  }
  return out;
}

function rowLuma(row: BanCatalogRow): { data: Float32Array; w: number; h: number } | null {
  if (!row.gray || !row.gw || !row.gh) return null;
  const bytes = decode64(row.gray);
  if (bytes.length < row.gw * row.gh) return null;
  const data = new Float32Array(row.gw * row.gh);
  for (let i = 0; i < data.length; i++) data[i] = bytes[i] ?? 0;
  return { data, w: row.gw, h: row.gh };
}

function decode64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function resizeLuma(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const dest = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += src[yy * sw + xx] ?? 0;
          n += 1;
        }
      }
      dest[y * dw + x] = n ? sum / n : 0;
    }
  }
  return dest;
}

function windowScore(
  big: Float32Array,
  bw: number,
  face: Float32Array,
  x: number,
  y: number,
  tw: number,
  th: number,
): number {
  let meanA = 0;
  let meanB = 0;
  const count = tw * th;
  for (let row = 0; row < th; row++) {
    for (let col = 0; col < tw; col++) {
      meanA += big[(y + row) * bw + (x + col)] ?? 0;
      meanB += face[row * tw + col] ?? 0;
    }
  }
  meanA /= count;
  meanB /= count;
  let dotSum = 0;
  let normA = 0;
  let normB = 0;
  for (let row = 0; row < th; row++) {
    for (let col = 0; col < tw; col++) {
      const a = (big[(y + row) * bw + (x + col)] ?? 0) - meanA;
      const b = (face[row * tw + col] ?? 0) - meanB;
      dotSum += a * b;
      normA += a * a;
      normB += b * b;
    }
  }
  if (normA < 1e-6 || normB < 1e-6) return -1;
  return dotSum / Math.sqrt(normA * normB);
}

function bestAlign(
  portrait: Float32Array,
  pw: number,
  ph: number,
  face: Float32Array,
  fw: number,
  fh: number,
): number {
  const faceSmall = resizeLuma(face, fw, fh, 28, 36);
  let best = -1;
  for (const scale of [1.3, 1.6, 1.9, 2.3]) {
    const dw = Math.max(30, Math.round((pw * scale * 28) / 74));
    const dh = Math.max(38, Math.round((ph * scale * 36) / 96));
    const big = resizeLuma(portrait, pw, ph, dw, dh);
    for (let y = 0; y <= dh - 36; y += 2) {
      for (let x = 0; x <= dw - 28; x += 2) {
        const score = windowScore(big, dw, faceSmall, x, y, 28, 36);
        if (score > best) best = score;
      }
    }
  }
  return best;
}

function paintFace(pixels: readonly Rgb[], width: number, height: number): Float32Array | null {
  const out = new Float32Array(width * height * 3);
  const cy = height / 2;
  const cx = width / 2;
  const yScale = height * 0.46;
  const xScale = width * 0.46;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const inside = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const dy = (y - cy) / yScale;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / xScale;
      if (dy * dy + dx * dx > 1) continue;
      const pixel = pixels[y * width + x];
      if (!pixel) continue;
      const i = y * width + x;
      inside[i] = 1;
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
      n += 1;
    }
  }
  if (n < 8) return null;
  const mr = r / n;
  const mg = g / n;
  const mb = b / n;
  for (let i = 0; i < width * height; i++) {
    const pixel = pixels[i];
    const at = i * 3;
    if (inside[i] && pixel) {
      out[at] = pixel.r;
      out[at + 1] = pixel.g;
      out[at + 2] = pixel.b;
    } else {
      out[at] = mr;
      out[at + 1] = mg;
      out[at + 2] = mb;
    }
  }
  return out;
}

function boxAverage(
  src: Float32Array,
  width: number,
  height: number,
  channels: number,
  dw: number,
  dh: number,
): number[] {
  const dest: number[] = [];
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * height) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * width) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / dw));
      for (let c = 0; c < channels; c++) {
        let sum = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            sum += src[(yy * width + xx) * channels + c] ?? 0;
            n += 1;
          }
        }
        dest.push(n ? sum / n : 0);
      }
    }
  }
  return dest;
}

function normalize(values: number[]): number[] | null {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let energy = 0;
  const centered = values.map((value) => {
    const next = value - mean;
    energy += next * next;
    return next;
  });
  if (energy < 1e-8) return null;
  const scale = Math.sqrt(energy);
  return centered.map((value) => value / scale);
}

function hogOf(painted: Float32Array, width: number, height: number): number[] | null {
  const size = 48;
  const gray = boxAverage(painted, width, height, 3, size, size);
  const luma = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    luma[i] = (0.299 * (gray[i * 3] ?? 0) + 0.587 * (gray[i * 3 + 1] ?? 0) + 0.114 * (gray[i * 3 + 2] ?? 0));
  }
  const gy = new Float32Array(size * size);
  const gx = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const x0 = luma[y * size + Math.max(0, x - 1)] ?? 0;
      const x1 = luma[y * size + Math.min(size - 1, x + 1)] ?? 0;
      const y0 = luma[Math.max(0, y - 1) * size + x] ?? 0;
      const y1 = luma[Math.min(size - 1, y + 1) * size + x] ?? 0;
      const xEdge = x === 0 || x === size - 1;
      const yEdge = y === 0 || y === size - 1;
      gx[i] = xEdge ? (x === 0 ? x1 - (luma[i] ?? 0) : (luma[i] ?? 0) - x0) : (x1 - x0) / 2;
      gy[i] = yEdge ? (y === 0 ? y1 - (luma[i] ?? 0) : (luma[i] ?? 0) - y0) : (y1 - y0) / 2;
    }
  }
  const bins = 8;
  const cell = 8;
  const feat: number[] = [];
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const hist = new Array<number>(bins).fill(0);
      for (let yy = y; yy < y + cell; yy++) {
        for (let xx = x; xx < x + cell; xx++) {
          const i = yy * size + xx;
          const mag = Math.hypot(gx[i] ?? 0, gy[i] ?? 0);
          let ang = Math.atan2(gy[i] ?? 0, gx[i] ?? 0);
          ang = (ang + Math.PI) / (2 * Math.PI);
          const bin = Math.min(bins - 1, Math.max(0, Math.floor(ang * bins)));
          hist[bin] = (hist[bin] ?? 0) + mag;
        }
      }
      feat.push(...hist);
    }
  }
  let energy = 0;
  for (const value of feat) energy += value * value;
  if (energy < 1e-8) return null;
  const scale = Math.sqrt(energy);
  return feat.map((value) => value / scale);
}
