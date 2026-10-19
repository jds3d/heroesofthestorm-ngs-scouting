import { banHexPassed } from "@/lib/lobby/banFace";
import {
  DRAFT_BAN_HEXES,
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  DRAFT_STATUS_BOX,
  DRAFT_TITLE_BOX,
  DRAFT_TURN_BOX,
  PARTY_NAME_ROW,
  banHexFilled,
  type DraftBox,
  type Rgb,
} from "@/lib/lobby/screenLobby";

/** Stop polling when the lobby fingerprint is unchanged this long (user can resume). */
export const WATCH_IDLE_PAUSE_MS = 60_000;

export function watchIdlePauseDue(stableMs: number): boolean {
  return stableMs >= WATCH_IDLE_PAUSE_MS;
}

/**
 * Center announcement without the countdown ring at the top of `DRAFT_TURN_BOX`.
 * The timer digits change every second and must not invalidate the fingerprint.
 */
export const DRAFT_CENTER_HASH_BOX: DraftBox = {
  x: DRAFT_TURN_BOX.x,
  y: DRAFT_TURN_BOX.y + DRAFT_TURN_BOX.h * 0.2,
  w: DRAFT_TURN_BOX.w,
  h: DRAFT_TURN_BOX.h * 0.55,
  rotate: 0,
};

const WATCH_BOXES: readonly DraftBox[] = [
  DRAFT_TITLE_BOX,
  DRAFT_STATUS_BOX,
  PARTY_NAME_ROW,
  // The center splash is not in this key. Its animation would wake a read
  // every frame and hold the next plate behind that OCR. A lock changes a
  // portrait or a nameplate, which are here. The splash is read afterwards.
  ...DRAFT_BAN_HEXES.left,
  ...DRAFT_BAN_HEXES.right,
  ...DRAFT_PLATE_SLOTS.left,
  ...DRAFT_PLATE_SLOTS.right,
  ...DRAFT_SLOT_NAMES.left,
  ...DRAFT_SLOT_NAMES.right,
];

/**
 * Nameplates and portraits. The draft fingerprint includes both, so a lock
 * still updates the board. OCR hashes the nameplates alone — a portrait glow
 * must not send a column through the reader again.
 */
export const NAME_WATCH_BOXES: readonly DraftBox[] = [
  ...DRAFT_SLOT_NAMES.left,
  ...DRAFT_SLOT_NAMES.right,
  ...DRAFT_PLATE_SLOTS.left,
  ...DRAFT_PLATE_SLOTS.right,
];

function fnv1aStep(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, 0x01000193);
}

/** Subsampled FNV-1a over RGB; fast and stable for “did this crop change?”. */
export function hashRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  let hash = 0x811c9dc5;
  const stepX = Math.max(1, Math.floor(width / 18));
  const stepY = Math.max(1, Math.floor(height / 18));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      hash = fnv1aStep(hash, data[i] ?? 0);
      hash = fnv1aStep(hash, data[i + 1] ?? 0);
      hash = fnv1aStep(hash, data[i + 2] ?? 0);
    }
  }
  return `${width}x${height}:${(hash >>> 0).toString(16)}`;
}

type FrameLike = { width: number; height: number };

function regionBox(frame: FrameLike, box: DraftBox) {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  return { x, y, w, h };
}

export function regionFingerprintFromRgba(
  image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
  box: DraftBox,
): string {
  const { x, y, w, h } = regionBox(image, box);
  const scratch = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((y + row) * image.width + (x + col)) * 4;
      const di = (row * w + col) * 4;
      scratch[di] = image.data[si] ?? 0;
      scratch[di + 1] = image.data[si + 1] ?? 0;
      scratch[di + 2] = image.data[si + 2] ?? 0;
      scratch[di + 3] = image.data[si + 3] ?? 255;
    }
  }
  return hashRgba(scratch, w, h);
}

export function regionFingerprint(
  ctx: CanvasRenderingContext2D,
  frame: FrameLike,
  box: DraftBox,
): string {
  const { x, y, w, h } = regionBox(frame, box);
  try {
    const data = ctx.getImageData(x, y, w, h).data;
    return hashRgba(data, w, h);
  } catch {
    return "0x0:0";
  }
}

export function joinedRegionFingerprint(
  ctx: CanvasRenderingContext2D,
  frame: FrameLike,
  boxes: readonly DraftBox[],
): string {
  return boxes.map((box) => regionFingerprint(ctx, frame, box)).join("|");
}

/** One key for every crop the watch pipeline can change draft state from. */
export function draftWatchFingerprintKey(
  ctx: CanvasRenderingContext2D,
  frame: FrameLike,
): string {
  return WATCH_BOXES.map((box) => regionFingerprint(ctx, frame, box)).join("|");
}

export function draftWatchFingerprintFromRgba(
  image: { width: number; height: number; data: Uint8Array | Uint8ClampedArray },
): string {
  return WATCH_BOXES.map((box) => regionFingerprintFromRgba(image, box)).join("|");
}

export function watchBoxesForTests(): readonly DraftBox[] {
  return WATCH_BOXES;
}

export type OcrFingerprints = {
  title: string;
  status: string;
  /** Left nameplates only. Portrait glow is not part of this hash. */
  namesLeft: string;
  /** Right nameplates only. */
  namesRight: string;
  center: string;
};

/**
 * Which text reads a new frame still needs.
 * A column whose nameplates match the last read is reused. One side locking
 * does not send the other column through OCR again.
 */
export function ocrRefreshPlan(
  current: OcrFingerprints,
  cached: OcrFingerprints | null,
): { title: boolean; status: boolean; left: boolean; right: boolean; center: boolean } {
  if (!cached) {
    return { title: true, status: true, left: true, right: true, center: true };
  }
  return {
    title: current.title !== cached.title,
    status: current.status !== cached.status,
    left: current.namesLeft !== cached.namesLeft,
    right: current.namesRight !== cached.namesRight,
    center: current.center !== cached.center,
  };
}

/**
 * Keep last lines for a column that was not sent to OCR.
 * An empty picture comes back as an empty list, and that list must not wipe
 * the column we skipped.
 */
export function mergeColumnReads<T>(
  plan: { left: boolean; right: boolean; center: boolean },
  fresh: { left?: T[]; right?: T[]; center?: T[] },
  cached: { left: T[]; right: T[]; center: T[] } | null,
): { left: T[]; right: T[]; center: T[] } {
  return {
    left: plan.left ? (fresh.left ?? []) : (cached?.left ?? []),
    right: plan.right ? (fresh.right ?? []) : (cached?.right ?? []),
    center: plan.center ? (fresh.center ?? []) : (cached?.center ?? []),
  };
}

/** The queue row is not on the draft lobby. A draft frame reads the ten plates instead. */
export function shouldReadPartyNames(phase: "draft" | "menu" | "wait"): boolean {
  return phase !== "draft";
}

function cropRgb(
  ctx: CanvasRenderingContext2D,
  frame: { width: number; height: number },
  box: DraftBox,
): { pixels: Rgb[]; width: number; height: number } | null {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return null;
  }
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
  }
  return { pixels, width: w, height: h };
}

/** For `draftLobbyLikelyOnFrame` without running ban portrait matching. */
export function cheapBanSlotSignals(
  ctx: CanvasRenderingContext2D,
  frame: { width: number; height: number },
  box: DraftBox,
): { filled: boolean; passed: boolean } {
  const crop = cropRgb(ctx, frame, box);
  if (!crop) return { filled: false, passed: false };
  const filled = banHexFilled(crop.pixels);
  return {
    filled,
    passed: !filled && banHexPassed(crop.pixels, crop.width, crop.height),
  };
}

export function allBanSlotSignals(
  ctx: CanvasRenderingContext2D,
  frame: { width: number; height: number },
): { filled: boolean; passed: boolean }[] {
  return [...DRAFT_BAN_HEXES.left, ...DRAFT_BAN_HEXES.right].map((box) =>
    cheapBanSlotSignals(ctx, frame, box),
  );
}
