"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { TimeLeftBar } from "@/components/TimeLeftBar";
import { heroKey } from "@/lib/scoring/heroMeta";
import {
  readThreeBanHexSlots,
  setBanHexMapContext,
} from "@/lib/lobby/banFace";
import type { Worker } from "tesseract.js";
import {
  DRAFT_BAN_HEXES,
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  DRAFT_STATUS_BOX,
  DRAFT_TITLE_BOX,
  DRAFT_TURN_BOX,
  SLOT_LINE_STRIDE,
  NAMEPLATE_CELL_WIDTH,
  nameplateCell,
  EMPTY_LIVE_DRAFT,
  bannerTurn,
  bansFromHexFaces,
  acceptPortraitExample,
  matchPortrait,
  portraitVector,
  inferFirstPick,
  resolveFirstPick,
  guessWeFirst,
  firstPickFromBanBoard,
  columnPickingFromOcrLines,
  pickingFlagsBySlot,
  pickCountsFit,
  resolveLiveTurn,
  PARTY_NAME_ROW,
  openSeatPlayers,
  reorderOurPicksForDraftZip,
  fitObservedPickOrder,
  pickSlotsFromPlateLocks,
  portraitFilled,
  plateFill,
  portraitIsLocked,
  portraitTeamRim,
  pruneHoverPicks,
  readsBySlot,
  draftHeroList,
  partyNamesFromText,
  mapFromTitle,
  firstPickFromPickingSlots,
  nextTurn,
  ocrFold,
  sideFromBannerColor,
  sideFromStatus,
  sideFromTeamSplash,
  acceptPlatePicks,
  banFrameKeepsLockedPicks,
  plateLockPhase,
  banSideFromSplash,
  firstBanSideFromStatus,
  slotsHoldPicks,
  snapToRoster,
  takeNewLocks,
  turnFromOcr,
  draftLobbyLikelyOnFrame,
  liveDraftBoardFull,
  watchPhase,
  type DraftBox,
  type PlateFill,
  type LiveDraft,
  type OpenTurn,
  type Rgb,
} from "@/lib/lobby/screenLobby";
import {
  WATCH_IDLE_PAUSE_MS,
  allBanSlotSignals,
  draftWatchFingerprintKey,
  watchIdlePauseDue,
} from "@/lib/lobby/watchFingerprint";

type Phase = "idle" | "watching" | "reading";
type Box = { x: number; y: number; w: number; h: number; rotate: number };

/** Full parse while a draft is active. Slower tick when only pixel-gating. */
const WATCH_TICK_DRAFT_MS = 2000;
const WATCH_TICK_IDLE_MS = 6000;

type BanHexSlot = {
  filled: boolean;
  passed: boolean;
  vector: number[] | null;
  hero: string | null;
  pixels: Rgb[];
  width: number;
  height: number;
};

function cropBanHex(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  box: DraftBox,
): { pixels: Rgb[]; width: number; height: number } {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return { pixels: [], width: 0, height: 0 };
  }
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
  }
  return { pixels, width: w, height: h };
}

function readSideBanHexes(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  boxes: readonly DraftBox[],
): BanHexSlot[] {
  const crops = boxes.map((box) => cropBanHex(ctx, frame, box));
  const { identified, filled, passed } = readThreeBanHexSlots(crops);
  return crops.map((crop, i) => ({
    filled: filled[i] ?? false,
    passed: passed[i] ?? false,
    hero: identified[i] ?? null,
    vector: portraitVector(crop.pixels, crop.width, crop.height),
    pixels: crop.pixels,
    width: crop.width,
    height: crop.height,
  }));
}

type FaceRow = { hero: string; vector: number[] };
let faceCatalog: Promise<FaceRow[]> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(url));
    image.src = url;
  });
}

/** In-game portraits saved from watched drafts. */
function loadFaceCatalog(): Promise<FaceRow[]> {
  if (faceCatalog) return faceCatalog;
  faceCatalog = (async () => {
    const res = await fetch("/api/draft-examples");
    if (!res.ok) return [];
    const data = (await res.json()) as { examples?: { hero?: string; image?: string }[] };
    const rows: FaceRow[] = [];
    for (const example of data.examples ?? []) {
      if (!example.hero || !example.image) continue;
      try {
        const image = await loadImage(`data:image/png;base64,${example.image}`);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) continue;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const pixels: Rgb[] = [];
        for (let i = 0; i < data.length; i += 4) {
          pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
        }
        const vector = portraitVector(pixels, canvas.width, canvas.height);
        if (vector) rows.push({ hero: example.hero, vector });
      } catch {
        // One unreadable example does not drop the rest.
      }
    }
    return rows;
  })();
  return faceCatalog;
}

function pngOf(pixels: Rgb[], width: number, height: number): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  const image = context.createImageData(width, height);
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    if (!pixel) continue;
    image.data[i * 4] = pixel.r;
    image.data[i * 4 + 1] = pixel.g;
    image.data[i * 4 + 2] = pixel.b;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      resolve(btoa(binary));
    }, "image/png");
  });
}

function sampleRegion(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  box: DraftBox,
): { pixels: Rgb[]; width: number; height: number } {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const width = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const height = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, width, height).data;
  } catch {
    return { pixels: [], width: 0, height: 0 };
  }
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
  }
  return { pixels, width, height };
}

function sampleBox(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  box: DraftBox,
): Rgb[] {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return [];
  }
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
  }
  return pixels;
}

function straightenedPlate(frame: HTMLCanvasElement, box: Box): HTMLCanvasElement | null {
  const sx = Math.round(box.x * frame.width);
  const sy = Math.round(box.y * frame.height);
  const sw = Math.max(1, Math.round(box.w * frame.width));
  const sh = Math.max(1, Math.round(box.h * frame.height));
  const scale = Math.min(4, 1100 / sw);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const rad = (box.rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const plate = document.createElement("canvas");
  plate.width = Math.ceil(dw * cos + dh * sin);
  plate.height = Math.ceil(dw * sin + dh * cos);
  const ctx = plate.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#05000c";
  ctx.fillRect(0, 0, plate.width, plate.height);
  ctx.imageSmoothingEnabled = true;
  ctx.translate(plate.width / 2, plate.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(frame, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  return plate;
}

function screenLoad(status: string): {
  label: string;
  expectedMs: number;
  resetKey: string;
} | null {
  if (status.startsWith("In queue. Loading Storm League")) {
    const names = status
      .replace(/^In queue\. Loading Storm League for /, "")
      .replace(/\.$/, "");
    const count = names.split(",").map((name) => name.trim()).filter(Boolean).length;
    return {
      label: status,
      expectedMs: 15_000 + Math.max(1, count) * 3_000,
      resetKey: names,
    };
  }
  if (status.startsWith("Draft reset.")) {
    return {
      label: "Reading this screen from scratch.",
      expectedMs: 18_000,
      resetKey: "draft-reset",
    };
  }
  return null;
}

export function LobbyScreenWatch({
  ourNames,
  rosterNames,
  onLobby,
  onOurSide,
  onDraft,
  onWatchingChange,
  onReplaySync,
  resetEpoch = 0,
  onIdlePausedChange,
  resumeRef,
  autoStart = false,
}: {
  ourNames: string[];
  /** Battletags the OCR names can snap onto (both lineups). */
  rosterNames: string[];
  onLobby: (names: string[]) => void;
  /** Names read on our side of the draft, whoever is actually in those slots. */
  onOurSide?: (names: string[]) => void;
  onDraft: (draft: LiveDraft) => void;
  onWatchingChange?: (watching: boolean) => void;
  /** Pull new `.StormReplay` files into the battletag cache before a draft or after a game. */
  onReplaySync?: () => void | Promise<void>;
  /** Bump to drop the last game and read the current screen from scratch. */
  resetEpoch?: number;
  /** True while auto-paused after no on-screen draft changes. */
  onIdlePausedChange?: (paused: boolean) => void;
  /** Parent calls `.current()` to resume after idle pause. */
  resumeRef?: MutableRefObject<(() => void) | null>;
  /** When true, opens the share dialog on mount (off by default — wait for the button). */
  autoStart?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(autoStart ? "watching" : "idle");
  const [requestingShare, setRequestingShare] = useState(false);
  const [status, setStatus] = useState(
    autoStart
      ? "Opening screen share…"
      : "Click Share main screen when Heroes is on your monitor. Names and draft state read from there.",
  );
  const startWatchRef = useRef<(() => Promise<void>) | null>(null);
  const autoStartOnceRef = useRef(false);
  const [names, setNames] = useState<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const hiddenRef = useRef(false);
  const busyRef = useRef(false);
  const epochRef = useRef(0);
  const appliedReset = useRef(0);
  const oursRef = useRef(ourNames);
  const rosterRef = useRef(rosterNames);
  const onLobbyRef = useRef(onLobby);
  const onOurSideRef = useRef(onOurSide);
  const onDraftRef = useRef(onDraft);
  const onWatchingRef = useRef(onWatchingChange);
  const lastKeyRef = useRef("");
  const lastOursKeyRef = useRef("");
  const announcedPicksRef = useRef<string[]>([]);
  const draftRef = useRef<LiveDraft>({ ...EMPTY_LIVE_DRAFT });
  const openTurnRef = useRef<OpenTurn | null>(null);
  const picksStartedRef = useRef(false);
  const facesRef = useRef<FaceRow[]>([]);
  const frameSavedRef = useRef(false);
  const inDraftRef = useRef(false);
  const watchFingerprintRef = useRef("");
  const stableSinceRef = useRef(0);
  const idlePausedRef = useRef(false);
  /** Draft finished on screen — keep state and sharing until Reset draft. */
  const draftCompleteRef = useRef(false);
  const onReplaySyncRef = useRef(onReplaySync);
  const leftNamesRef = useRef<string[]>([]);
  const rightNamesRef = useRef<string[]>([]);

  useEffect(() => {
    onReplaySyncRef.current = onReplaySync;
  }, [onReplaySync]);

  useEffect(() => {
    oursRef.current = ourNames;
  }, [ourNames]);
  useEffect(() => {
    rosterRef.current = rosterNames;
  }, [rosterNames]);
  useEffect(() => {
    onLobbyRef.current = onLobby;
  }, [onLobby]);
  useEffect(() => {
    onOurSideRef.current = onOurSide;
  }, [onOurSide]);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);
  useEffect(() => {
    onWatchingRef.current = onWatchingChange;
  }, [onWatchingChange]);
  useEffect(() => {
    onWatchingRef.current?.(phase !== "idle");
  }, [phase]);

  useEffect(() => {
    let live = true;
    void loadFaceCatalog().then((rows) => {
      if (live) facesRef.current = rows;
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      stopWatch();
    };
  }, []);

  useEffect(() => {
    if (!autoStart || autoStartOnceRef.current) return;
    autoStartOnceRef.current = true;
    const id = window.requestAnimationFrame(() => {
      void startWatchRef.current?.();
    });
    return () => window.cancelAnimationFrame(id);
  }, [autoStart]);

  function clearWatchTimer() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function setIdlePaused(paused: boolean) {
    idlePausedRef.current = paused;
    onIdlePausedChange?.(paused);
  }

  function enterIdlePause() {
    if (idlePausedRef.current) return;
    clearWatchTimer();
    setIdlePaused(true);
    setPhase("watching");
    setStatus(
      `Paused — no draft changes for ${WATCH_IDLE_PAUSE_MS / 1000}s. Resume when the draft moves again.`,
    );
  }

  function resumeIdleWatch() {
    if (draftCompleteRef.current) return;
    if (!streamRef.current || !videoRef.current || !workerRef.current) return;
    setIdlePaused(false);
    stableSinceRef.current = Date.now();
    setStatus("Watching the main screen.");
    armWatchTimer();
    void readFrame(videoRef.current, workerRef.current);
  }

  if (resumeRef) resumeRef.current = resumeIdleWatch;

  function armWatchTimer() {
    clearWatchTimer();
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || hiddenRef.current || !streamRef.current) return;
    if (idlePausedRef.current) return;
    const ms = inDraftRef.current ? WATCH_TICK_DRAFT_MS : WATCH_TICK_IDLE_MS;
    timerRef.current = window.setInterval(() => {
      void readFrame(video, worker);
    }, ms);
  }

  useEffect(() => {
    const onVisibility = () => {
      hiddenRef.current = document.visibilityState === "hidden";
      if (phase === "idle") return;
      if (hiddenRef.current) {
        if (timerRef.current != null) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setStatus((prev) =>
          prev.includes("tab in background")
            ? prev
            : `${prev.replace(/ \(paused — scout tab in background\)$/, "")} (paused — scout tab in background)`,
        );
        return;
      }
      setStatus((prev) =>
        prev.replace(/ \(paused — scout tab in background\)$/, ""),
      );
      armWatchTimer();
      const video = videoRef.current;
      const worker = workerRef.current;
      if (video && worker) void readFrame(video, worker);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase]);

  function stopWatch() {
    clearWatchTimer();
    setIdlePaused(false);
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    videoRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;
    void worker?.terminate();
    busyRef.current = false;
    setPhase("idle");
  }

  async function readColumn(frame: HTMLCanvasElement, worker: Worker, box: Box): Promise<string> {
    const plate = straightenedPlate(frame, box);
    if (!plate) return "";
    const result = await worker.recognize(plate);
    return result.data.text;
  }

  function scoutHeaders(): Record<string, string> {
    const secret = process.env.NEXT_PUBLIC_SCOUT_API_SECRET?.trim();
    return secret ? { "x-scout-secret": secret } : {};
  }

  function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
  }

  /** The name column, rotated flat and scaled the way the reader was measured. */
  function deskewedColumn(frame: HTMLCanvasElement, box: Box): HTMLCanvasElement | null {
    const sx = Math.round(box.x * frame.width);
    const sy = Math.round(box.y * frame.height);
    const sw = Math.max(1, Math.round(box.w * frame.width));
    const sh = Math.max(1, Math.round(box.h * frame.height));
    const scale = Math.min(4, 1800 / Math.min(sw, sh));
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);
    const rad = (box.rotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const plate = document.createElement("canvas");
    plate.width = Math.ceil(dw * cos + dh * sin);
    plate.height = Math.ceil(dw * sin + dh * cos);
    const ctx = plate.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, plate.width, plate.height);
    ctx.imageSmoothingEnabled = true;
    ctx.translate(plate.width / 2, plate.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(frame, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    return plate;
  }

  async function pictureOf(canvas: HTMLCanvasElement): Promise<string | null> {
    const blob =
      (await canvasBlob(canvas, "image/webp", 0.9)) ?? (await canvasBlob(canvas, "image/jpeg", 0.92));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  type OcrLine = { text: string; top: number };

/** Five nameplates, top to bottom, each in its own cell so line.top maps to a slot. */
function stackNameplates(frame: HTMLCanvasElement, boxes: readonly DraftBox[]): HTMLCanvasElement | null {
  const ctx = frame.getContext("2d");
  if (!ctx || boxes.length === 0) return null;
  const cellW = NAMEPLATE_CELL_WIDTH;
  const cellH = SLOT_LINE_STRIDE;
  const plate = document.createElement("canvas");
  plate.width = cellW;
  plate.height = cellH * boxes.length;
  const out = plate.getContext("2d");
  if (!out) return null;
  out.fillStyle = "#000";
  out.fillRect(0, 0, plate.width, plate.height);
  boxes.forEach((box, index) => {
    const { sx, sy, sw, sh, dx, dy, dw, dh } = nameplateCell(
      frame.width,
      frame.height,
      box,
      index,
      cellW,
      cellH,
    );
    out.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
  });
  return plate;
}

function framePixelAt(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
): ((x: number, y: number) => Rgb) | null {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, frame.width, frame.height).data;
  } catch {
    return null;
  }
  return (x, y) => {
    const i = (y * frame.width + x) * 4;
    return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
  };
}

/** Names and locked heroes from the five slots on each side. */
async function readLobby(
  frame: HTMLCanvasElement,
): Promise<{
  left: string[];
  right: string[];
  leftSlots: {
    hero: string;
    player: string | null;
    slot: number;
    plate: PlateFill;
    faceFilled: boolean;
    teamRim: { blue: number; red: number };
    ally: boolean;
  }[];
  rightSlots: {
    hero: string;
    player: string | null;
    slot: number;
    plate: PlateFill;
    faceFilled: boolean;
    teamRim: { blue: number; red: number };
    ally: boolean;
  }[];
  leftShown: string[];
  rightShown: string[];
  leftReads: { hero: string | null; player: string | null }[];
  rightReads: { hero: string | null; player: string | null }[];
  picksLeft: OcrLine[];
  picksRight: OcrLine[];
  leftPicking: boolean;
  rightPicking: boolean;
  leftPickingFlags: boolean[];
  rightPickingFlags: boolean[];
  center: OcrLine[];
} | null> {
  const leftPlate = stackNameplates(frame, DRAFT_SLOT_NAMES.left);
  const rightPlate = stackNameplates(frame, DRAFT_SLOT_NAMES.right);
  const centerPlate = deskewedColumn(frame, DRAFT_TURN_BOX);
  if (!leftPlate || !rightPlate) return null;
  const [left, right, center] = await Promise.all([
    pictureOf(leftPlate),
    pictureOf(rightPlate),
    centerPlate ? pictureOf(centerPlate) : Promise.resolve(null),
  ]);
  if (!left || !right) return null;
  const res = await fetch("/api/ocr/names", {
    method: "POST",
    headers: { "content-type": "application/json", ...scoutHeaders() },
    body: JSON.stringify({ left, right, center }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    left?: OcrLine[];
    right?: OcrLine[];
    center?: OcrLine[];
  };
  const leftReads = readsBySlot(data.left ?? []);
  const rightReads = readsBySlot(data.right ?? []);
  const leftPickingFlags = pickingFlagsBySlot(data.left ?? []);
  const rightPickingFlags = pickingFlagsBySlot(data.right ?? []);
  const leftPicking = columnPickingFromOcrLines(data.left ?? []);
  const rightPicking = columnPickingFromOcrLines(data.right ?? []);
  const ctx = frame.getContext("2d");
  const pixelAt = ctx ? framePixelAt(ctx, frame) : null;
  const slots = (
    ally: boolean,
    reads: { hero: string | null; player: string | null }[],
    portraitBoxes: readonly DraftBox[],
    nameBoxes: readonly DraftBox[],
    pickingFlags: boolean[],
  ) =>
    reads.flatMap((read, index) => {
      const box = portraitBoxes[index];
      const nameBox = nameBoxes[index];
      if (!read.hero || !box || !nameBox || !ctx || !pixelAt) return [];
      const plate = plateFill(sampleBox(ctx, frame, nameBox), ally);
      return [
        {
          hero: read.hero,
          player: read.player,
          slot: index,
          plate,
          faceFilled: portraitFilled(sampleBox(ctx, frame, box)),
          teamRim: portraitTeamRim(frame.width, frame.height, box, pixelAt),
          ally,
          slotPicking: pickingFlags[index] ?? false,
        },
      ];
    });
  const shownHeroes = (
    reads: { hero: string | null; player: string | null }[],
    nameBoxes: readonly DraftBox[],
  ) => {
    if (!ctx) return [];
    return reads.flatMap((read, index) => {
      const nameBox = nameBoxes[index];
      if (!read.hero || !nameBox) return [];
      if (plateFill(sampleBox(ctx, frame, nameBox), true) !== "shown") return [];
      return [read.hero];
    });
  };
  const players = (reads: { hero: string | null; player: string | null }[]) =>
    reads.flatMap((read) => (read.player ? [read.player] : []));
  const leftNames = players(leftReads);
  const rightNames = players(rightReads);
  return {
    left: leftNames,
    right: rightNames,
    leftSlots: slots(
      true,
      leftReads,
      DRAFT_PLATE_SLOTS.left,
      DRAFT_SLOT_NAMES.left,
      leftPickingFlags,
    ),
    rightSlots: slots(
      false,
      rightReads,
      DRAFT_PLATE_SLOTS.right,
      DRAFT_SLOT_NAMES.right,
      rightPickingFlags,
    ),
    leftShown: shownHeroes(leftReads, DRAFT_SLOT_NAMES.left),
    rightShown: [],
    leftReads,
    rightReads,
    picksLeft: [],
    picksRight: [],
    leftPicking,
    rightPicking,
    leftPickingFlags,
    rightPickingFlags,
    center: data.center ?? [],
  };
}

  function forgetNames() {
    if (!lastOursKeyRef.current && !lastKeyRef.current) return;
    lastOursKeyRef.current = "";
    lastKeyRef.current = "";
    onOurSideRef.current?.([]);
    setNames([]);
  }

  function clearObserved() {
    draftCompleteRef.current = false;
    inDraftRef.current = false;
    watchFingerprintRef.current = "";
    stableSinceRef.current = 0;
    setIdlePaused(false);
    announcedPicksRef.current = [];
    lastKeyRef.current = "";
    lastOursKeyRef.current = "";
    leftNamesRef.current = [];
    rightNamesRef.current = [];
    openTurnRef.current = null;
    picksStartedRef.current = false;
    draftRef.current = {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: [],
      theirPicks: [],
      ourBans: [],
      theirBans: [],
    };
    onDraftRef.current(draftRef.current);
    onOurSideRef.current?.([]);
    setNames([]);
    setStatus("Draft reset. Reading this screen from scratch.");
  }

  useEffect(() => {
    if (resetEpoch === appliedReset.current) return;
    appliedReset.current = resetEpoch;
    epochRef.current = resetEpoch;
    clearObserved();
  }, [resetEpoch]);

  function titleBrightShare(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
  ): number {
    const { pixels } = sampleRegion(ctx, frame, DRAFT_TITLE_BOX);
    if (!pixels.length) return 0;
    const bright = pixels.filter((p) => p.r + p.g + p.b > 200).length;
    return bright / pixels.length;
  }

  async function readFrame(video: HTMLVideoElement, worker: Worker) {
    if (busyRef.current || video.readyState < 2) return;
    if (hiddenRef.current) return;
    if (idlePausedRef.current) return;
    if (draftCompleteRef.current) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    try {
      const frame = document.createElement("canvas");
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      const ctx = frame.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const fingerprint = draftWatchFingerprintKey(ctx, frame);
      const banSlots = allBanSlotSignals(ctx, frame);
      const lobbyLikely = draftLobbyLikelyOnFrame({
        titleBrightShare: titleBrightShare(ctx, frame),
        banSlots,
      });
      if (!inDraftRef.current && !lobbyLikely) {
        watchFingerprintRef.current = "";
        if (lastKeyRef.current || lastOursKeyRef.current) forgetNames();
        setStatus(
          "Watching the main screen. No draft lobby visible — checking slowly.",
        );
        return;
      }
      if (
        inDraftRef.current &&
        watchFingerprintRef.current &&
        fingerprint === watchFingerprintRef.current
      ) {
        const stableMs = Date.now() - stableSinceRef.current;
        if (watchIdlePauseDue(stableMs)) {
          enterIdlePause();
        }
        return;
      }
      setPhase("reading");
      const roster = rosterRef.current;
      const titleText = await readColumn(frame, worker, DRAFT_TITLE_BOX);
      const centerText = await readColumn(frame, worker, DRAFT_TURN_BOX);
      const statusText = await readColumn(frame, worker, DRAFT_STATUS_BOX);
      if (epoch !== epochRef.current) return;
      const screenPhase = watchPhase(
        `${titleText}\n${centerText}\n${statusText}`,
        inDraftRef.current,
      );
      if (screenPhase !== "draft") {
        if (
          screenPhase === "menu" &&
          (inDraftRef.current || lastOursKeyRef.current || lastKeyRef.current)
        ) {
          if (draftCompleteRef.current || liveDraftBoardFull(draftRef.current)) {
            setStatus(
              "Draft complete — still on the board until you click Reset draft.",
            );
            return;
          }
          await onReplaySyncRef.current?.();
          if (epoch !== epochRef.current) return;
          clearObserved();
        } else if (screenPhase === "wait") {
          forgetNames();
        }
        setStatus(
          screenPhase === "menu"
            ? "On the game menu. Waiting for the draft."
            : "Watching the main screen. Waiting for the draft.",
        );
        return;
      }
      if (!inDraftRef.current) {
        await onReplaySyncRef.current?.();
        if (epoch !== epochRef.current) return;
      }
      inDraftRef.current = true;
      const lobbyPromise = readLobby(frame);
      const partyText = await readColumn(frame, worker, PARTY_NAME_ROW);
      const mapHint = mapFromTitle(titleText) ?? draftRef.current.map ?? null;
      setBanHexMapContext(mapHint);
      const leftHexes = readSideBanHexes(ctx, frame, DRAFT_BAN_HEXES.left);
      const rightHexes = readSideBanHexes(ctx, frame, DRAFT_BAN_HEXES.right);
      setBanHexMapContext(null);
      const lobby = await lobbyPromise;
      const rapidCenter = (lobby?.center ?? []).map((line) => line.text).join("\n");
      const centerSource = rapidCenter.trim() ? rapidCenter : centerText;
      const usOnLeft = true;
      const banner = bannerTurn(`${centerSource}\n${statusText}`);
      const centerRead = turnFromOcr(centerSource, roster);
      if (banner.phase) centerRead.phase = banner.phase;
      if ((centerRead.phase ?? banner.phase) === "pick" && centerRead.hero) {
        const announced = announcedPicksRef.current;
        const last = announced[announced.length - 1];
        if (!last || heroKey(last) !== heroKey(centerRead.hero)) announced.push(centerRead.hero);
      }
      const draft = draftRef.current;
      const knownNames = [...(lobby?.left ?? []), ...(lobby?.right ?? []), ...roster];
      const snapPlate = (locks: { hero: string; player: string | null; slot: number }[]) =>
        locks.map((lock) => ({
          hero: lock.hero,
          player: lock.player ? snapToRoster(lock.player, knownNames) : null,
          slot: lock.slot,
        }));
      const banPhase = banner.phase === "ban" || centerRead.phase === "ban";
      const bannerPhase = banPhase
        ? "ban"
        : (banner.phase ?? centerRead.phase ?? null);
      const keepCommitted =
        banPhase &&
        banFrameKeepsLockedPicks(`${centerSource}\n${statusText}`);
      const priorLockedPicks =
        draft.ourPicks.length + draft.theirPicks.length;
      const lockPhase = plateLockPhase({
        bannerPhase,
        picksStarted: picksStartedRef.current,
        priorLockedPicks,
      });
      const platePhase = lockPhase ?? bannerPhase;
      const lockedSlots = (
        rows: {
          hero: string;
          player: string | null;
          slot: number;
          plate: PlateFill;
          faceFilled: boolean;
          teamRim: { blue: number; red: number };
          ally: boolean;
          slotPicking?: boolean;
        }[],
      ) =>
        snapPlate(
          rows.filter((row) =>
            portraitIsLocked({
              phase: platePhase,
              keepCommitted: keepCommitted && platePhase === "ban",
              faceFilled: row.faceFilled,
              plate: row.plate,
              ally: row.ally,
              heroOnPlate: true,
              slotPicking: row.slotPicking,
            }),
          ),
        );
      const leftLocked = lockedSlots(lobby?.leftSlots ?? []);
      const rightLocked = lockedSlots(lobby?.rightSlots ?? []);
      const slotted =
        slotsHoldPicks(leftLocked.length + rightLocked.length) &&
        (lockPhase === "pick" || (keepCommitted && platePhase === "ban"));
      const fromSlots = null;
      if (slotted) picksStartedRef.current = true;
      if (!banPhase && (banner.phase === "pick" || fromSlots === "pick")) {
        picksStartedRef.current = true;
      }
      const allowPicks =
        slotted ||
        acceptPlatePicks({
          banPhase,
          picksStarted: picksStartedRef.current,
        }) ||
        (lockPhase === "pick" && picksStartedRef.current);
      const ourShown = usOnLeft ? lobby?.leftShown ?? [] : lobby?.rightShown ?? [];
      const theirShown = usOnLeft ? lobby?.rightShown ?? [] : lobby?.leftShown ?? [];
      const ourPruned = pruneHoverPicks(
        draft.ourPicks,
        draft.ourPickPlayers,
        ourShown,
      );
      const theirPruned = pruneHoverPicks(
        draft.theirPicks,
        draft.theirPickPlayers,
        theirShown,
      );
      const ourLocked = allowPicks
        ? takeNewLocks(
            ourPruned.heroes,
            usOnLeft ? leftLocked : rightLocked,
            announcedPicksRef.current,
            ourPruned.players,
          )
        : null;
      const theirLocked = allowPicks
        ? takeNewLocks(
            theirPruned.heroes,
            usOnLeft ? rightLocked : leftLocked,
            announcedPicksRef.current,
            theirPruned.players,
          )
        : null;
      let ourPicks = ourLocked
        ? ourLocked.heroes
        : picksStartedRef.current
          ? draft.ourPicks
          : [];
      let theirPicks = theirLocked
        ? theirLocked.heroes
        : picksStartedRef.current
          ? draft.theirPicks
          : [];
      if (epoch !== epochRef.current) return;
      if (lobby) {
        const leftPlayers = lobby.left.map((name) => snapToRoster(name, roster));
        const rightPlayers = lobby.right.map((name) => snapToRoster(name, roster));
        if (leftPlayers.length >= 3) leftNamesRef.current = leftPlayers;
        if (rightPlayers.length >= 3) rightNamesRef.current = rightPlayers;
      }
      const ourColumn = leftNamesRef.current;
      const theirColumn = rightNamesRef.current;
      const turn = nextTurn(
        openTurnRef.current,
        centerRead.phase ? centerRead : { ...centerRead, phase: banner.phase },
        (player) => {
          const fold = ocrFold(player);
          if (fold === ocrFold("HuckIt")) return "our";
          if (ourColumn.some((name) => ocrFold(name) === fold)) return "our";
          if (oursRef.current.some((name) => ocrFold(name) === fold)) return "our";
          if (theirColumn.some((name) => ocrFold(name) === fold)) return "their";
          return null;
        },
        banner.color
          ? sideFromBannerColor(banner.color, usOnLeft)
          : banSideFromSplash(`${centerSource}\n${statusText}`),
      );
      openTurnRef.current = turn.open;
      const nativeFrame = frame.height >= 1440;
      const learnPlate = (
        lock: { hero: string; slot: number | null },
        slots: readonly DraftBox[],
      ) => {
        if (!nativeFrame || lock.slot == null) return;
        const box = slots[lock.slot];
        if (!box) return;
        const region = sampleRegion(ctx, frame, box);
        const vector = portraitVector(region.pixels, region.width, region.height);
        if (!vector || !acceptPortraitExample(vector, lock.hero, facesRef.current)) return;
        facesRef.current = [...facesRef.current, { hero: lock.hero, vector }];
        void pngOf(region.pixels, region.width, region.height).then((image) => {
          if (!image) return;
          void fetch("/api/draft-examples", {
            method: "POST",
            headers: { "content-type": "application/json", ...scoutHeaders() },
            body: JSON.stringify({ kind: "portrait", hero: lock.hero, image }),
          }).catch(() => undefined);
        });
      };
      for (const lock of leftLocked) learnPlate(lock, DRAFT_PLATE_SLOTS.left);
      for (const lock of rightLocked) learnPlate(lock, DRAFT_PLATE_SLOTS.right);
      if (nativeFrame && !frameSavedRef.current) {
        frameSavedRef.current = true;
        void new Promise<string | null>((resolve) => {
          frame.toBlob(async (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            resolve(btoa(binary));
          }, "image/jpeg", 0.8);
        }).then((image) => {
          if (!image) return;
          void fetch("/api/draft-examples", {
            method: "POST",
            headers: { "content-type": "application/json", ...scoutHeaders() },
            body: JSON.stringify({ kind: "frame", image }),
          }).catch(() => undefined);
        });
      }
      const namedHexes = (hexes: { filled: boolean; vector: number[] | null; hero: string | null }[]) =>
        hexes.map((hex) =>
          hex.hero ??
          (hex.vector && facesRef.current.length ? matchPortrait(hex.vector, facesRef.current) : null),
        );
      const ourHexes = usOnLeft ? leftHexes : rightHexes;
      const theirHexes = usOnLeft ? rightHexes : leftHexes;
      const ourBans = bansFromHexFaces(
        namedHexes(ourHexes),
        ourHexes.map((hex) => hex.filled),
        draft.ourBans,
        ourHexes.map((hex) => hex.passed),
      );
      const theirBans = bansFromHexFaces(
        namedHexes(theirHexes),
        theirHexes.map((hex) => hex.filled),
        draft.theirBans,
        theirHexes.map((hex) => hex.passed),
      );
      const phase = banner.phase ?? centerRead.phase ?? fromSlots ?? (slotted ? "pick" : draft.phase);
      if (banPhase && !picksStartedRef.current && !slotted) {
        ourPicks = [];
        theirPicks = [];
      }
      const fromBanBoard = firstPickFromBanBoard(ourBans, theirBans);
      let firstPick = fromBanBoard ?? draft.firstPick;
      if (
        !firstPick &&
        ourPicks.length + theirPicks.length === 0 &&
        lobby
      ) {
        const fromSlotsSide = firstPickFromPickingSlots({
          leftPicking: lobby.leftPicking,
          rightPicking: lobby.rightPicking,
          usOnLeft,
        });
        if (fromSlotsSide) firstPick = fromSlotsSide;
      }
      if (
        !firstPick &&
        ourBans.length + theirBans.length + ourPicks.length + theirPicks.length === 0
      ) {
        const fromStatus = firstBanSideFromStatus(`${statusText}\n${centerText}`);
        if (fromStatus) firstPick = fromStatus;
      }
      const turnSide =
        turn.open?.side ??
        (banner.color ? sideFromBannerColor(banner.color, usOnLeft) : null) ??
        sideFromStatus(`${statusText}\n${centerSource}`) ??
        sideFromTeamSplash(`${centerSource}\n${statusText}`);
      if (!firstPick && turn.open?.phase === "ban") {
        firstPick = turn.open.side === "our" ? "us" : "them";
      }
      if (
        !firstPick &&
        banner.color &&
        banner.phase &&
        ourPicks.length + theirPicks.length === 0 &&
        ourBans.length + theirBans.length === 0
      ) {
        const side = sideFromBannerColor(banner.color, usOnLeft);
        firstPick = side === "our" ? "us" : "them";
      }
      if (ourPicks.length + theirPicks.length === 0) {
        if (ourBans.length > 0 && theirBans.length === 0) firstPick = "us";
        else if (theirBans.length > 0 && ourBans.length === 0) firstPick = "them";
      }
      if (firstPick === "them" && theirPicks.length === 0 && ourPicks.length > 0) {
        firstPick = "us";
      }
      if (ourPicks.length + theirPicks.length > 0) {
        const usFits = pickCountsFit(true, ourPicks.length, theirPicks.length);
        const themFits = pickCountsFit(false, ourPicks.length, theirPicks.length);
        if (usFits && !themFits) {
          firstPick = "us";
        } else if (themFits && !usFits) {
          firstPick = "them";
        } else {
          const inferred = inferFirstPick({
            ourPicks: ourPicks.length,
            theirPicks: theirPicks.length,
            phase,
            turnSide,
          });
          const currentFits = firstPick
            ? pickCountsFit(firstPick === "us", ourPicks.length, theirPicks.length)
            : false;
          if (inferred && (!firstPick || !currentFits)) firstPick = inferred;
        }
      }
      let map = draft.map;
      if (!map) map = mapFromTitle(titleText);
      const seatCtx = frame.getContext("2d");
      const seatPixels = seatCtx ? framePixelAt(seatCtx, frame) : null;
      const namedSeats = (
        reads: readonly { player: string | null }[],
      ) =>
        reads.map((read) => ({
          player: read.player ? snapToRoster(read.player, knownNames) : null,
        }));
      const ourReads = usOnLeft ? lobby?.leftReads ?? [] : lobby?.rightReads ?? [];
      const theirReads = usOnLeft ? lobby?.rightReads ?? [] : lobby?.leftReads ?? [];
      const lockedFlags = (
        boxes: readonly DraftBox[],
        nameBoxes: readonly DraftBox[],
        ally: boolean,
        reads: readonly { hero: string | null; player: string | null }[],
      ) =>
        boxes.map((box, index) => {
          if (!seatCtx || !seatPixels) return false;
          const nameBox = nameBoxes[index];
          const read = reads[index];
          const pickingFlags = ally
            ? lobby?.leftPickingFlags ?? []
            : lobby?.rightPickingFlags ?? [];
          return portraitIsLocked({
            phase: platePhase,
            keepCommitted: keepCommitted && platePhase === "ban",
            faceFilled: portraitFilled(sampleBox(seatCtx, frame, box)),
            plate: nameBox
              ? plateFill(sampleBox(seatCtx, frame, nameBox), ally)
              : undefined,
            ally,
            heroOnPlate: Boolean(read?.hero),
            slotPicking: pickingFlags[index] ?? false,
          });
        });
      const ourBoxes = usOnLeft ? DRAFT_PLATE_SLOTS.left : DRAFT_PLATE_SLOTS.right;
      const theirBoxes = usOnLeft ? DRAFT_PLATE_SLOTS.right : DRAFT_PLATE_SLOTS.left;
      const ourNameBoxes = usOnLeft ? DRAFT_SLOT_NAMES.left : DRAFT_SLOT_NAMES.right;
      const theirNameBoxes = usOnLeft ? DRAFT_SLOT_NAMES.right : DRAFT_SLOT_NAMES.left;
      const ourOpenPlayers =
        lobby && ourReads.some((read) => read.player)
          ? openSeatPlayers(
              namedSeats(ourReads),
              lockedFlags(ourBoxes, ourNameBoxes, true, ourReads),
            )
          : draft.ourOpenPlayers ?? [];
      const theirOpenPlayers =
        lobby && theirReads.some((read) => read.player)
          ? openSeatPlayers(
              namedSeats(theirReads),
              lockedFlags(theirBoxes, theirNameBoxes, false, theirReads),
            )
          : draft.theirOpenPlayers ?? [];
      let ourPickPlayers = ourLocked?.players ?? draft.ourPickPlayers;
      let theirPickPlayers = theirLocked?.players ?? draft.theirPickPlayers;
      if (allowPicks && firstPick && slotted) {
        const ourZip = reorderOurPicksForDraftZip(ourPicks, ourPickPlayers);
        ourPicks = ourZip.heroes;
        ourPickPlayers = ourZip.players;
      }
      const turnPhase =
        phase === "ban" || phase === "pick"
          ? phase
          : platePhase === "ban" || platePhase === "pick"
            ? platePhase
            : null;
      const liveTurn = resolveLiveTurn({
        phase: turnPhase,
        leftPicking: lobby?.leftPicking ?? false,
        rightPicking: lobby?.rightPicking ?? false,
        usOnLeft,
        bannerSide: turnSide,
        openTurn: turn.open,
        ourOpenPlayers,
        theirOpenPlayers,
      });
      const weFirstGuess =
        firstPick === "us" || firstPick === "them"
          ? firstPick === "us"
          : guessWeFirst({
              firstPick,
              ourBans,
              theirBans,
              ourPicks,
              theirPicks,
              ourPickPlayers,
              theirPickPlayers,
              phase,
              turn: liveTurn,
              map,
            });
      const ourLockRows = usOnLeft ? leftLocked : rightLocked;
      const theirLockRows = usOnLeft ? rightLocked : leftLocked;
      const fittedPicks = fitObservedPickOrder(
        {
          weFirst: weFirstGuess,
          firstPick,
          phase,
          map,
          ourBans,
          theirBans,
          ourPicks,
          theirPicks,
          ourPickPlayers,
          theirPickPlayers,
        },
        {
          our: pickSlotsFromPlateLocks(ourPicks, ourLockRows),
          their: pickSlotsFromPlateLocks(theirPicks, theirLockRows),
        },
      );
      ourPicks = fittedPicks.ourPicks;
      theirPicks = fittedPicks.theirPicks;
      ourPickPlayers = fittedPicks.ourPickPlayers;
      theirPickPlayers = fittedPicks.theirPickPlayers;
      const resolvedFirst =
        resolveFirstPick({
          firstPick,
          ourBans,
          theirBans,
          ourPicks,
          theirPicks,
          phase,
          turn: liveTurn,
          ourPickSlots: pickSlotsFromPlateLocks(ourPicks, ourLockRows),
          theirPickSlots: pickSlotsFromPlateLocks(theirPicks, theirLockRows),
        }) ?? firstPick;
      const nextDraft: LiveDraft = {
        ourPicks,
        theirPicks,
        ourPickPlayers,
        theirPickPlayers,
        ourOpenPlayers,
        theirOpenPlayers,
        ourBans,
        theirBans,
        firstPick: resolvedFirst,
        phase,
        turn: liveTurn,
        map,
      };
      if (epoch !== epochRef.current) return;
      draftRef.current = nextDraft;
      onDraftRef.current(nextDraft);
      if (liveDraftBoardFull(nextDraft) && !draftCompleteRef.current) {
        draftCompleteRef.current = true;
        clearWatchTimer();
        setStatus(
          "Draft complete. Board stays here until you click Reset draft.",
        );
        return;
      }

      const partyNames = partyNamesFromText(partyText).map((name) => snapToRoster(name, roster));
      const inParty =
        partyNames.length >= 3 && ourPicks.length + theirPicks.length === 0 && ourColumn.length < 3;
      if (ourColumn.length >= 3) {
        const oursKey = ourColumn.map((name) => name.toLowerCase()).join("|");
        if (oursKey !== lastOursKeyRef.current) {
          lastOursKeyRef.current = oursKey;
          onOurSideRef.current?.(ourColumn);
        }
      } else if (inParty) {
        const partyKey = partyNames.map((name) => name.toLowerCase()).join("|");
        if (partyKey !== lastOursKeyRef.current) {
          lastOursKeyRef.current = partyKey;
          onOurSideRef.current?.(partyNames);
        }
        setStatus(`In queue. Loading Storm League for ${partyNames.join(", ")}.`);
      }
      const opponents = inParty ? [] : theirColumn;
      if (!inParty && opponents.length >= 3) {
        const key = opponents.map((name) => name.toLowerCase()).join("|");
        if (key !== lastKeyRef.current) {
          lastKeyRef.current = key;
          setNames(opponents);
          if (opponents.length === 5) onLobbyRef.current(opponents);
        }
      }
      const locks = ourPicks.length + theirPicks.length + ourBans.length + theirBans.length;
      if (!inParty) {
        const who =
          ourColumn.length + theirColumn.length > 0
            ? `Us: ${ourColumn.join(", ") || "…"}. Them: ${theirColumn.join(", ") || "…"}.`
            : "Reading the name banners.";
        setStatus(
          locks > 0
            ? `${who} We banned ${draftHeroList(ourBans)}, picked ${draftHeroList(ourPicks)}. They banned ${draftHeroList(theirBans)}, picked ${draftHeroList(theirPicks)}.`
            : who,
        );
      }
      watchFingerprintRef.current = fingerprint;
      stableSinceRef.current = Date.now();
    } catch {
      setStatus("Could not read that frame. The watch is still running.");
    } finally {
      busyRef.current = false;
      if (streamRef.current) {
        setPhase("watching");
        armWatchTimer();
      }
    }
  }

  async function startWatch() {
    stopWatch();
    lastKeyRef.current = "";
    lastOursKeyRef.current = "";
    leftNamesRef.current = [];
    rightNamesRef.current = [];
    announcedPicksRef.current = [];
    draftRef.current = {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: [],
      theirPicks: [],
      ourBans: [],
      theirBans: [],
    };
    openTurnRef.current = null;
    picksStartedRef.current = false;
    inDraftRef.current = false;
    watchFingerprintRef.current = "";
    stableSinceRef.current = 0;
    onDraftRef.current(draftRef.current);
    setNames([]);
    setRequestingShare(true);
    setStatus(
      "In the browser dialog, choose your main monitor (not a window or this tab).",
    );
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 2 },
        },
        audio: false,
        // Chrome: monitors only; no tab/window list when supported.
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "include",
        windowTypeSurfaces: "exclude",
        browserTypeSurfaces: "exclude",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("No video track");
      track.addEventListener("ended", () => {
        stopWatch();
        setStatus("Screen share ended.");
      });
      streamRef.current = stream;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng");
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'",
      });
      workerRef.current = worker;
      videoRef.current = video;
      hiddenRef.current = document.visibilityState === "hidden";
      setPhase("watching");
      setStatus(
        hiddenRef.current
          ? "Watching the main screen. (paused — scout tab in background)"
          : "Watching the main screen.",
      );
      armWatchTimer();
      if (!hiddenRef.current) void readFrame(video, worker);
    } catch (err) {
      stopWatch();
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setStatus(
        denied
          ? "Screen share was dismissed. Click Share main screen when you are ready."
          : "Could not start the screen watch.",
      );
    } finally {
      setRequestingShare(false);
    }
  }

  startWatchRef.current = startWatch;

  if (phase !== "idle") {
    const load = screenLoad(status);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {load ? (
            <TimeLeftBar
              label={load.label}
              expectedMs={load.expectedMs}
              resetKey={load.resetKey}
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">{status}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            stopWatch();
            setStatus("Screen watch stopped.");
          }}
          className="h-10 shrink-0 rounded-md border border-[var(--accent)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
        >
          Stop watching
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--background)] p-4">
      <p className="min-w-0 flex-1 text-sm text-[var(--muted)]">{status}</p>
      <button
        type="button"
        disabled={requestingShare}
        onClick={() => void startWatch()}
        className="h-10 shrink-0 rounded-md border border-[var(--accent)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-50"
      >
        {requestingShare ? "Choose monitor…" : "Share main screen"}
      </button>
    </div>
  );
}
