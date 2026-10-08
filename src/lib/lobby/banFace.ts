import type { Rgb } from "@/lib/lobby/screenLobby";
import catalogJson from "@/lib/lobby/banPortraits.json";

export type BanFace = { color: number[]; hog: number[] };

type CatalogRow = {
  hero: string;
  color: number[];
  hog: number[];
  gw?: number;
  gh?: number;
  gray?: string;
};

const CATALOG = catalogJson as CatalogRow[];

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
export function matchBanFace(query: BanFace, rows: readonly CatalogRow[] = CATALOG): string | null {
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

export function matchBanPixels(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): string | null {
  const aligned = alignBan(pixels, width, height);
  if (aligned) return aligned;
  const face = banFace(pixels, width, height);
  if (!face) return null;
  return matchBanFace(face);
}

/**
 * Slide the ban hex over each target portrait and keep the crop that lines up.
 * Tyrael's hex is the hood opening, not the shoulders in the square icon.
 */
function alignBan(pixels: readonly Rgb[], width: number, height: number): string | null {
  const face = lumaOf(pixels, width, height);
  let best: { hero: string; score: number } | null = null;
  let second = -Infinity;
  for (const row of CATALOG) {
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

function rowLuma(row: CatalogRow): { data: Float32Array; w: number; h: number } | null {
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
