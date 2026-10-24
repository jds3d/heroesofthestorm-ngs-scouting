"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { TimeLeftBar } from "@/components/TimeLeftBar";
import { locksAddedSince } from "@/lib/lobby/reviewCase";
import {
  readThreeBanHexSlots,
  setBanHexMapContext,
} from "@/lib/lobby/banFace";
import { matchMapTitle } from "@/lib/lobby/mapTitle";
import { heroKey } from "@/lib/scoring/heroMeta";
import {
  FINAL_MAP_BOX,
  FINAL_NAME_BOXES,
  completeDraftFromFinalScreen,
  finalScreenLikely,
  mismatchQuestion,
  seatsFromNameLines,
} from "@/lib/lobby/finalScreen";
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
  allySlotPlate,
  nameLabelBox,
  portraitIsLocked,
  portraitTeamRim,
  pruneHoverPicks,
  readsBySlot,
  replaceSlotLines,
  keepFresherSlotLines,
  draftHeroList,
  draftFromPartyQueue,
  partyNamesFromText,
  mapFromTitle,
  firstPickFromPickingSlots,
  nextTurn,
  ocrFold,
  sideFromBannerColor,
  sideFromStatus,
  sideFromTeamSplash,
  acceptLockedPlates,
  acceptPlatePicks,
  banFrameKeepsLockedPicks,
  plateLockPhase,
  banSideFromSplash,
  firstBanSideFromStatus,
  snapToRoster,
  takeNewLocks,
  turnFromOcr,
  draftLobbyLikelyOnFrame,
  draftWithoutLock,
  NO_BAN,
  UNSEEN_BAN,
  type ScreenReread,
  draftShortOfPicks,
  bothSidesPickedFive,
  liveDraftBoardFull,
  watchPhase,
  type DraftBox,
  type PlateFill,
  type LiveDraft,
  type OpenTurn,
  type Rgb,
} from "@/lib/lobby/screenLobby";
import { nextWatchedDraft } from "@/lib/lobby/watchDraft";
import {
  WATCH_IDLE_PAUSE_MS,
  allBanSlotSignals,
  draftWatchFingerprintKey,
  joinedRegionFingerprint,
  mergeColumnReads,
  ocrRefreshPlan,
  regionFingerprint,
  shouldReadPartyNames,
  watchIdlePauseDue,
  DRAFT_CENTER_HASH_BOX,
} from "@/lib/lobby/watchFingerprint";

type Phase = "idle" | "watching" | "reading";
type Box = { x: number; y: number; w: number; h: number; rotate: number };

/**
 * While a draft is up, look again well inside a second. An unchanged frame
 * returns before OCR, so this does not re-read the nameplates every tick.
 * A lock has to land within a couple of seconds of the plate changing.
 */
const WATCH_TICK_DRAFT_MS = 400;
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
  saveReviewRef,
  rereadRef,
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
  /** Parent calls `.current()` to store the screen and the draft as read so far. */
  saveReviewRef?: MutableRefObject<(() => Promise<string>) | null>;
  /** Parent calls `.current(lock)` to drop one ban or pick and read that slot again. */
  rereadRef?: MutableRefObject<((lock: ScreenReread) => void) | null>;
  /** When true, opens the share dialog on mount (off by default — wait for the button). */
  autoStart?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(autoStart ? "watching" : "idle");
  const [requestingShare, setRequestingShare] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewNote, setReviewNote] = useState<string | null>(null);
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
  const timerMsRef = useRef(0);
  /** Bumped when a newer frame or a reset should drop an in-flight splash read. */
  const frameSeqRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const hiddenRef = useRef(false);
  const busyRef = useRef(false);
  const fastBusyRef = useRef(false);
  const publishGenRef = useRef(0);
  /** A read that started at or before a click must not write the board back over that fix. */
  const ignoreDraftThroughRef = useRef(0);
  const slotFpRef = useRef<{ left: string[]; right: string[] } | null>(null);
  /** When a single-plate read finished, so a slower column read does not overwrite it. */
  const slotFreshAtRef = useRef<Record<string, number>>({});
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
  const ocrCacheRef = useRef<{
    fingerprints: {
      title: string;
      status: string;
      namesLeft: string;
      namesRight: string;
      center: string;
    };
    title: string;
    status: string;
    center: string;
    lines: {
      left: { text: string; top: number }[];
      right: { text: string; top: number }[];
      center: { text: string; top: number }[];
    };
    lobby: Awaited<ReturnType<typeof readLobby>>;
  } | null>(null);
  const stableSinceRef = useRef(0);
  const idlePausedRef = useRef(false);
  /** Draft finished on screen — keep state and sharing until Reset draft. */
  const draftCompleteRef = useRef(false);
  /** Loading screen grabbed while a lobby read was still running. */
  const heldLoadingRef = useRef<HTMLCanvasElement | null>(null);
  const loadingArrivedDuringBusyRef = useRef(false);
  const loadingTriesRef = useRef(0);
  /** Last draft-lobby frame, kept so the loading screen is not what gets saved. */
  const lastLobbyShotRef = useRef<{ frame: HTMLCanvasElement; draft: LiveDraft } | null>(null);
  /** Lobby frames that locked a new ban or pick. Kept only after Save for review. */
  const heldPickFramesRef = useRef<
    {
      blob: Blob;
      at: string;
      added: { kind?: "ban" | "pick"; side: "us" | "them"; hero: string; player: string | null }[];
    }[]
  >([]);
  const heldSentRef = useRef(0);
  const keptReviewIdRef = useRef<string | null>(null);
  const onReplaySyncRef = useRef(onReplaySync);
  const leftNamesRef = useRef<string[]>([]);
  const rightNamesRef = useRef<string[]>([]);
  const ourSeatNamesRef = useRef<(string | null)[]>([]);
  const theirSeatNamesRef = useRef<(string | null)[]>([]);
  const mismatchSavedRef = useRef(false);

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
    timerMsRef.current = 0;
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

  function readStartedBeforeClick(readToken: number) {
    return ignoreDraftThroughRef.current > 0 && readToken <= ignoreDraftThroughRef.current;
  }

  async function rereadLock(lock: ScreenReread) {
    ignoreDraftThroughRef.current = publishGenRef.current;
    draftCompleteRef.current = false;
    announcedPicksRef.current = announcedPicksRef.current.filter(
      (hero) => heroKey(hero) !== heroKey(lock.hero),
    );
    const cleared = draftWithoutLock(draftRef.current, lock);
    draftRef.current = cleared;
    onDraftRef.current(cleared);
    const label =
      lock.hero === UNSEEN_BAN || lock.hero === NO_BAN ? "that ban" : lock.hero;
    const video = videoRef.current;
    const frame = video ? snapshotVideo(video) : null;
    const ctx = frame?.getContext("2d", { willReadFrequently: true }) ?? null;
    if (!frame || !ctx) {
      setStatus(`Removed ${label}. Share the main screen to read it again.`);
      return;
    }
    setStatus(`Reading ${label} from the screen.`);
    const epoch = epochRef.current;
    const readToken = ++publishGenRef.current;
    if (lock.kind === "ban") {
      const cache = ocrCacheRef.current;
      await publishWatched(
        cache?.lobby ??
          lobbyFromLines(frame, cache?.lines ?? { left: [], right: [], center: [] }),
        cache?.title ?? "",
        cache?.status ?? "",
        cache?.center ?? "",
        false,
        frame,
        ctx,
        draftWatchFingerprintKey(ctx, frame),
        epoch,
        readToken,
      );
      return;
    }
    const column = lock.side === "our" ? "left" : "right";
    const cache = ocrCacheRef.current;
    const lines = cache?.lines ?? { left: [], right: [], center: [] };
    const reads = readsBySlot(column === "left" ? lines.left : lines.right);
    const found = reads.findIndex(
      (read) => read.hero && heroKey(read.hero) === heroKey(lock.hero),
    );
    const slotIndexes = found >= 0 ? [found] : [0, 1, 2, 3, 4];
    let left = lines.left;
    let right = lines.right;
    for (const index of slotIndexes) {
      if (column === "left") left = replaceSlotLines(left, index, []);
      else right = replaceSlotLines(right, index, []);
      if (slotFpRef.current) {
        const fps = {
          left: [...slotFpRef.current.left],
          right: [...slotFpRef.current.right],
        };
        fps[column][index] = "";
        slotFpRef.current = fps;
      }
    }
    const stripped = lobbyFromLines(frame, { left, right, center: lines.center });
    if (cache) {
      ocrCacheRef.current = {
        ...cache,
        lines: { left, right, center: lines.center },
        lobby: stripped,
      };
    }
    fastBusyRef.current = true;
    try {
      const boxes = column === "left" ? DRAFT_SLOT_NAMES.left : DRAFT_SLOT_NAMES.right;
      const pictures: { side: "left" | "right"; index: number; image: string }[] = [];
      for (const index of slotIndexes) {
        const box = boxes[index];
        if (!box) continue;
        const plate = slotPlateCanvas(frame, box);
        if (!plate) continue;
        const image = await pictureOf(plate);
        if (!image) continue;
        pictures.push({ side: column, index, image });
      }
      if (pictures.length === 0 || epoch !== epochRef.current) return;
      const res = await fetch("/api/ocr/names", {
        method: "POST",
        headers: { "content-type": "application/json", ...scoutHeaders() },
        body: JSON.stringify({ slots: pictures }),
      });
      if (!res.ok || epoch !== epochRef.current) return;
      const data = (await res.json()) as {
        slots?: { side?: string; index?: number; lines?: { text: string; top: number }[] }[];
      };
      if (!data.slots) return;
      const now = Date.now();
      for (const slot of data.slots) {
        const side = slot.side === "left" || slot.side === "right" ? slot.side : null;
        const index = slot.index ?? -1;
        if (!side || index < 0 || index > 4) continue;
        if (side === "left") left = replaceSlotLines(left, index, slot.lines ?? []);
        else right = replaceSlotLines(right, index, slot.lines ?? []);
        slotFreshAtRef.current[`${side}:${index}`] = now;
        if (slotFpRef.current) {
          const fps = {
            left: [...slotFpRef.current.left],
            right: [...slotFpRef.current.right],
          };
          fps[side][index] = fingerprintSlots(ctx, frame)[side][index] ?? "";
          slotFpRef.current = fps;
        }
      }
      const lobby = lobbyFromLines(frame, { left, right, center: lines.center });
      const current = ocrCacheRef.current;
      ocrCacheRef.current = {
        fingerprints: current?.fingerprints ?? {
          title: "",
          status: "",
          namesLeft: "",
          namesRight: "",
          center: "",
        },
        title: current?.title ?? "",
        status: current?.status ?? "",
        center: current?.center ?? "",
        lines: { left, right, center: lines.center },
        lobby,
      };
      await publishWatched(
        lobby,
        current?.title ?? "",
        current?.status ?? "",
        current?.center ?? "",
        false,
        frame,
        ctx,
        draftWatchFingerprintKey(ctx, frame),
        epoch,
        readToken,
      );
    } catch {
      setStatus(`Removed ${label}. Could not read that slot.`);
    } finally {
      fastBusyRef.current = false;
    }
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
  if (saveReviewRef) saveReviewRef.current = saveCurrentReview;
  if (rereadRef) rereadRef.current = rereadLock;

  function armWatchTimer() {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || hiddenRef.current || !streamRef.current || idlePausedRef.current) {
      clearWatchTimer();
      return;
    }
    const ms = inDraftRef.current ? WATCH_TICK_DRAFT_MS : WATCH_TICK_IDLE_MS;
    if (timerRef.current != null && timerMsRef.current === ms) return;
    clearWatchTimer();
    timerMsRef.current = ms;
    timerRef.current = window.setInterval(() => {
      void readChangedSlots(video);
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
    frameSeqRef.current += 1;
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

  async function readMapTitle(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
    worker: Worker,
  ): Promise<string> {
    const region = sampleRegion(ctx, frame, DRAFT_TITLE_BOX);
    const matched = matchMapTitle(region.pixels, region.width, region.height);
    if (matched) return matched;
    return readColumn(frame, worker, DRAFT_TITLE_BOX);
  }

  function reviewBoard(draft: LiveDraft) {
    const picks = (heroes: string[], players: (string | null)[]) =>
      heroes.flatMap((hero, index) =>
        hero && hero !== "__unseen__"
          ? [{ hero, player: players[index] ?? null }]
          : [],
      );
    return {
      map: draft.map,
      firstPick: draft.firstPick,
      ourBans: draft.ourBans.filter((hero) => hero && hero !== "__unseen__"),
      theirBans: draft.theirBans.filter((hero) => hero && hero !== "__unseen__"),
      ourPicks: picks(draft.ourPicks, draft.ourPickPlayers),
      theirPicks: picks(draft.theirPicks, draft.theirPickPlayers),
    };
  }

  function discardPickFrames() {
    heldPickFramesRef.current = [];
    heldSentRef.current = 0;
    keptReviewIdRef.current = null;
  }

  async function blobBase64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  /** Remember the frame when it locks a ban or pick that was not already on the board. */
  async function rememberPickFrame(frame: HTMLCanvasElement, prev: LiveDraft, next: LiveDraft) {
    const added = locksAddedSince(prev, next);
    if (!added.length) return;
    const blob = await canvasBlob(frame, "image/jpeg", 0.82);
    if (!blob) return;
    heldPickFramesRef.current = [
      ...heldPickFramesRef.current,
      { blob, added, at: new Date().toISOString() },
    ];
    if (keptReviewIdRef.current) await flushHeldFrames(reviewBoard(next));
  }

  async function flushHeldFrames(board: ReturnType<typeof reviewBoard>): Promise<{ ok: boolean; count: number }> {
    while (heldSentRef.current < heldPickFramesRef.current.length) {
      const frame = heldPickFramesRef.current[heldSentRef.current];
      if (!frame) break;
      const response = await fetch("/api/draft-examples", {
        method: "POST",
        headers: { "content-type": "application/json", ...scoutHeaders() },
        body: JSON.stringify({
          kind: "review",
          id: keptReviewIdRef.current,
          board,
          frames: [{ image: await blobBase64(frame.blob), added: frame.added, at: frame.at }],
        }),
      }).catch(() => null);
      if (!response?.ok) return { ok: false, count: heldSentRef.current };
      const data = (await response.json()) as { id?: string };
      if (data.id) keptReviewIdRef.current = data.id;
      heldSentRef.current += 1;
    }
    return { ok: true, count: heldSentRef.current };
  }

  async function saveCurrentReview(): Promise<string> {
    if (heldPickFramesRef.current.length === 0) {
      const video = videoRef.current;
      const live = video ? snapshotVideo(video) : null;
      const frame = live ?? lastLobbyShotRef.current?.frame ?? null;
      if (!frame) return "No screen to save. Share the main screen first.";
      const blob = await canvasBlob(frame, "image/jpeg", 0.82);
      if (!blob) return "Could not capture the screen.";
      heldPickFramesRef.current = [{ blob, added: [], at: new Date().toISOString() }];
    }
    const result = await flushHeldFrames(reviewBoard(draftRef.current));
    if (!result.ok) return "Could not save that screen.";
    if (result.count === 0) return "No lobby screenshots to keep.";
    return result.count === 1
      ? "Saved 1 lobby screenshot for review."
      : `Saved ${result.count} lobby screenshots for review.`;
  }

  function scoutHeaders(): Record<string, string> {
    const secret = process.env.NEXT_PUBLIC_SCOUT_API_SECRET?.trim();
    return secret ? { "x-scout-secret": secret } : {};
  }

  function canvasBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number,
  ): Promise<Blob | null> {
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
    // Nameplates stay PNG so a light plate still reads "QHIRA". The center
    // splash PNG is about 3.7MB and the OCR route then rejects the whole
    // request, which drops every player name and every pick.
    const png = await canvasBlob(canvas, "image/png");
    const blob =
      png && png.size <= 1_600_000
        ? png
        : ((await canvasBlob(canvas, "image/webp", 0.9)) ??
          (await canvasBlob(canvas, "image/jpeg", 0.92)));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  type OcrLine = { text: string; top: number };

/** One nameplate, scaled like the bench that still reads Tyrael. Not the 2200-wide column. */
function slotPlateCanvas(
  frame: HTMLCanvasElement,
  box: DraftBox,
): HTMLCanvasElement | null {
  const sx = Math.max(0, Math.round(box.x * frame.width));
  const sy = Math.max(0, Math.round(box.y * frame.height));
  const sw = Math.max(1, Math.min(frame.width - sx, Math.round(box.w * frame.width)));
  const sh = Math.max(1, Math.min(frame.height - sy, Math.round(box.h * frame.height)));
  const scale = Math.min(2, 960 / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  if (dw < 8 || dh < 8) return null;
  const plate = document.createElement("canvas");
  plate.width = dw;
  plate.height = dh;
  const out = plate.getContext("2d");
  if (!out) return null;
  out.drawImage(frame, sx, sy, sw, sh, 0, 0, dw, dh);
  return plate;
}

function fingerprintSlots(ctx: CanvasRenderingContext2D, frame: HTMLCanvasElement) {
  return {
    left: DRAFT_SLOT_NAMES.left.map((box) => regionFingerprint(ctx, frame, box)),
    right: DRAFT_SLOT_NAMES.right.map((box) => regionFingerprint(ctx, frame, box)),
  };
}

type LobbyLines = {
  left: { text: string; top: number; x?: number }[];
  right: { text: string; top: number; x?: number }[];
  center: { text: string; top: number; x?: number }[];
};

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

function snapshotVideo(video: HTMLVideoElement): HTMLCanvasElement | null {
  if (video.readyState < 2 || video.videoWidth < 32 || video.videoHeight < 32) return null;
  const frame = document.createElement("canvas");
  frame.width = video.videoWidth;
  frame.height = video.videoHeight;
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return frame;
}

function canvasIsLoadingScreen(frame: HTMLCanvasElement): boolean {
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const pixelAt = framePixelAt(ctx, frame);
  return Boolean(pixelAt && finalScreenLikely(frame.width, frame.height, pixelAt));
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
  plan: { left: boolean; right: boolean; center: boolean },
  cachedLines: {
    left: OcrLine[];
    right: OcrLine[];
    center: OcrLine[];
  } | null,
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
  lines: { left: OcrLine[]; right: OcrLine[]; center: OcrLine[] };
} | null> {
  let fresh: { left?: OcrLine[]; right?: OcrLine[]; center?: OcrLine[] } = {};
  if (plan.left || plan.right || plan.center) {
    const leftPlate = plan.left ? stackNameplates(frame, DRAFT_SLOT_NAMES.left) : null;
    const rightPlate = plan.right ? stackNameplates(frame, DRAFT_SLOT_NAMES.right) : null;
    const centerPlate = plan.center ? deskewedColumn(frame, DRAFT_TURN_BOX) : null;
    if (plan.left && !leftPlate) return null;
    if (plan.right && !rightPlate) return null;
    const [left, right, center] = await Promise.all([
      leftPlate ? pictureOf(leftPlate) : Promise.resolve(""),
      rightPlate ? pictureOf(rightPlate) : Promise.resolve(""),
      centerPlate ? pictureOf(centerPlate) : Promise.resolve(""),
    ]);
    if (plan.left && !left) return null;
    if (plan.right && !right) return null;
    if (!left && !right && !center) return null;
    const res = await fetch("/api/ocr/names", {
      method: "POST",
      headers: { "content-type": "application/json", ...scoutHeaders() },
      body: JSON.stringify({
        left: left || "",
        right: right || "",
        center: center || "",
      }),
    });
    if (!res.ok) return null;
    fresh = (await res.json()) as {
      left?: OcrLine[];
      right?: OcrLine[];
      center?: OcrLine[];
    };
  }
  const lines = mergeColumnReads(plan, fresh, cachedLines);
  return lobbyFromLines(frame, lines);
}

function lobbyFromLines(frame: HTMLCanvasElement, lines: LobbyLines) {
  const leftReads = readsBySlot(lines.left);
  const rightReads = readsBySlot(lines.right);
  const leftPickingFlags = pickingFlagsBySlot(lines.left);
  const rightPickingFlags = pickingFlagsBySlot(lines.right);
  const leftPicking = columnPickingFromOcrLines(lines.left);
  const rightPicking = columnPickingFromOcrLines(lines.right);
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
      const namePixels = sampleBox(ctx, frame, nameBox);
      const plate = ally
        ? allySlotPlate(namePixels, sampleBox(ctx, frame, nameLabelBox(nameBox, box)))
        : plateFill(namePixels, false);
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
      const portrait = DRAFT_PLATE_SLOTS.left[index];
      if (
        !portrait ||
        allySlotPlate(
          sampleBox(ctx, frame, nameBox),
          sampleBox(ctx, frame, nameLabelBox(nameBox, portrait)),
        ) !== "shown"
      )
        return [];
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
    center: lines.center,
    lines,
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
    frameSeqRef.current += 1;
    draftCompleteRef.current = false;
    inDraftRef.current = false;
    watchFingerprintRef.current = "";
    ocrCacheRef.current = null;
    slotFpRef.current = null;
    slotFreshAtRef.current = {};
    stableSinceRef.current = 0;
    setIdlePaused(false);
    announcedPicksRef.current = [];
    lastKeyRef.current = "";
    lastOursKeyRef.current = "";
    leftNamesRef.current = [];
    rightNamesRef.current = [];
    ourSeatNamesRef.current = [];
    theirSeatNamesRef.current = [];
    mismatchSavedRef.current = false;
    heldLoadingRef.current = null;
    loadingArrivedDuringBusyRef.current = false;
    loadingTriesRef.current = 0;
    lastLobbyShotRef.current = null;
    discardPickFrames();
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

  async function saveMismatch(
    frame: HTMLCanvasElement,
    conflict: {
      before: { our: string[]; their: string[] };
      screen: { our: string[]; their: string[] };
    },
  ) {
    const blob = await canvasBlob(frame, "image/png");
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    await fetch("/api/draft-examples", {
      method: "POST",
      headers: { "content-type": "application/json", ...scoutHeaders() },
      body: JSON.stringify({ kind: "mismatch", image: btoa(binary), conflict }),
    }).catch(() => undefined);
  }

  async function finishFromLoadingScreen(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
    worker: Worker,
  ): Promise<boolean> {
    const pixelAt = framePixelAt(ctx, frame);
    if (!pixelAt || !finalScreenLikely(frame.width, frame.height, pixelAt)) return false;
    const draft = draftRef.current;
    const leftPlate = stackNameplates(frame, FINAL_NAME_BOXES.left);
    const rightPlate = stackNameplates(frame, FINAL_NAME_BOXES.right);
    if (!leftPlate || !rightPlate) return true;
    const [left, right] = await Promise.all([pictureOf(leftPlate), pictureOf(rightPlate)]);
    if (!left || !right) return true;
    const res = await fetch("/api/ocr/names", {
      method: "POST",
      headers: { "content-type": "application/json", ...scoutHeaders() },
      body: JSON.stringify({ left, right, center: "" }),
    });
    if (!res.ok) return true;
    const data = (await res.json()) as {
      left?: { text: string; top: number; x?: number }[];
      right?: { text: string; top: number; x?: number }[];
    };
    const mapText = draft.map ? "" : await readColumn(frame, worker, FINAL_MAP_BOX);
    const completed = completeDraftFromFinalScreen({
      draft,
      blue: seatsFromNameLines(data.right ?? []),
      red: seatsFromNameLines(data.left ?? []),
      ourNames: oursRef.current,
      roster: rosterRef.current,
      mapText,
    });
    if (!completed) {
      setStatus("Loading screen is up. Still reading both teams.");
      return true;
    }
    if (completed.conflict) {
      const question = mismatchQuestion(completed.conflict);
      if (!mismatchSavedRef.current) {
        mismatchSavedRef.current = true;
        await saveMismatch(frame, completed.conflict);
      }
      draftCompleteRef.current = true;
      clearWatchTimer();
      setStatus(question);
      return true;
    }
    await rememberPickFrame(frame, draft, completed.draft);
    draftRef.current = completed.draft;
    onDraftRef.current(completed.draft);
    inDraftRef.current = true;
    if (completed.ourNames.length >= 3) {
      const oursKey = completed.ourNames.map((name) => name.toLowerCase()).join("|");
      if (oursKey !== lastOursKeyRef.current) {
        lastOursKeyRef.current = oursKey;
        onOurSideRef.current?.(completed.ourNames);
      }
    }
    if (completed.theirNames.length >= 3) {
      const key = completed.theirNames.map((name) => name.toLowerCase()).join("|");
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        setNames(completed.theirNames);
        if (completed.theirNames.length === 5) onLobbyRef.current(completed.theirNames);
      }
    }
    if (completed.draft.sealed) {
      draftCompleteRef.current = true;
      clearWatchTimer();
      const held = heldPickFramesRef.current.length;
      setStatus(
        keptReviewIdRef.current
          ? "Draft complete. Filled the remaining picks from the loading screen. Lobby screenshots are saved."
          : held > 0
            ? `Draft complete. Filled the remaining picks from the loading screen. ${held} lobby screenshots are held — Save for review to keep them.`
            : "Draft complete. Filled the remaining picks from the loading screen.",
      );
    } else {
      setStatus("Loading screen is up. Still reading both teams.");
    }
    return true;
  }

  function titleBrightShare(
    ctx: CanvasRenderingContext2D,
    frame: HTMLCanvasElement,
  ): number {
    const { pixels } = sampleRegion(ctx, frame, DRAFT_TITLE_BOX);
    if (!pixels.length) return 0;
    const bright = pixels.filter((p) => p.r + p.g + p.b > 200).length;
    return bright / pixels.length;
  }

  /**
   * Push one read onto the board. `learn` saves portrait examples; the fast
   * nameplate pass skips that and leaves the fingerprint for the full pass.
   * Returns true when this frame should stop (draft finished, or a reset landed).
   */
  async function publishWatched(
    lobby: Awaited<ReturnType<typeof readLobby>>,
    titleText: string,
    statusText: string,
    centerSource: string,
    learn: boolean,
    frame: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    fingerprint: string,
    epoch: number,
    readToken = 0,
  ): Promise<boolean> {
    const gen = readToken;
    const roster = rosterRef.current;
    const partyText = "";
    const mapHint = mapFromTitle(titleText) ?? draftRef.current.map ?? null;
    setBanHexMapContext(mapHint);
    const leftHexes = readSideBanHexes(ctx, frame, DRAFT_BAN_HEXES.left);
    const rightHexes = readSideBanHexes(ctx, frame, DRAFT_BAN_HEXES.right);
    setBanHexMapContext(null);
    const watched = nextWatchedDraft({
      memory: {
        draft: draftRef.current,
        announced: announcedPicksRef.current,
        picksStarted: picksStartedRef.current,
        openTurn: openTurnRef.current,
        ourColumn: leftNamesRef.current,
        theirColumn: rightNamesRef.current,
        ourSeatNames: ourSeatNamesRef.current,
        theirSeatNames: theirSeatNamesRef.current,
        ourRoster: oursRef.current,
      },
      frame: lobby,
      titleText,
      statusText,
      centerText: centerSource,
      leftHexes,
      rightHexes,
      roster,
      faces: facesRef.current,
      partyText,
    });
    announcedPicksRef.current = watched.memory.announced;
    picksStartedRef.current = watched.memory.picksStarted;
    openTurnRef.current = watched.memory.openTurn;
    leftNamesRef.current = watched.memory.ourColumn;
    rightNamesRef.current = watched.memory.theirColumn;
    ourSeatNamesRef.current = watched.memory.ourSeatNames;
    theirSeatNamesRef.current = watched.memory.theirSeatNames;
    const leftLocked = watched.leftLocked;
    const rightLocked = watched.rightLocked;
    let nextDraft = watched.draft;
    if (bothSidesPickedFive(nextDraft) && !nextDraft.sealed) {
      nextDraft = { ...nextDraft, sealed: true };
    }
    const ourColumn = watched.memory.ourColumn;
    const theirColumn = watched.memory.theirColumn;
    const inParty = watched.inParty;
    const partyNames = partyNamesFromText(partyText).map((name) => snapToRoster(name, roster));
    if (learn) {
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
    }
    lastLobbyShotRef.current = { frame, draft: nextDraft };
    if (epoch !== epochRef.current) return true;
    if (readStartedBeforeClick(gen)) return false;
    await rememberPickFrame(frame, draftRef.current, nextDraft);
    draftRef.current = nextDraft;
    onDraftRef.current(nextDraft);
    if (liveDraftBoardFull(nextDraft) && !draftCompleteRef.current) {
      draftCompleteRef.current = true;
      clearWatchTimer();
      const held = heldPickFramesRef.current.length;
      setStatus(
        keptReviewIdRef.current
          ? "Draft complete. Lobby screenshots are saved for review."
          : held > 0
            ? `Draft complete. ${held} lobby screenshots are held — Save for review to keep them.`
            : "Draft complete.",
      );
      return true;
    }
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
    const locks =
      nextDraft.ourPicks.length +
      nextDraft.theirPicks.length +
      nextDraft.ourBans.length +
      nextDraft.theirBans.length;
    if (!inParty) {
      const who =
        ourColumn.length + theirColumn.length > 0
          ? `Us: ${ourColumn.join(", ") || "…"}. Them: ${theirColumn.join(", ") || "…"}.`
          : "Reading the name banners.";
      setStatus(
        locks > 0
          ? `${who} We banned ${draftHeroList(nextDraft.ourBans)}, picked ${draftHeroList(nextDraft.ourPicks)}. They banned ${draftHeroList(nextDraft.theirBans)}, picked ${draftHeroList(nextDraft.theirPicks)}.`
          : who,
      );
    }
    if (learn) {
      watchFingerprintRef.current = fingerprint;
      stableSinceRef.current = Date.now();
    }
    return false;
  }

  function slotsFresherThan(side: "left" | "right", started: number): number[] {
    return [0, 1, 2, 3, 4].filter(
      (index) => (slotFreshAtRef.current[`${side}:${index}`] ?? 0) > started,
    );
  }

  function mergeFreshLobby(
    full: NonNullable<Awaited<ReturnType<typeof readLobby>>>,
    started: number,
    fallbackFrame: HTMLCanvasElement,
  ) {
    const leftFresh = slotsFresherThan("left", started);
    const rightFresh = slotsFresherThan("right", started);
    if (leftFresh.length === 0 && rightFresh.length === 0) return full;
    const live = ocrCacheRef.current?.lines;
    if (!live) return full;
    const left = keepFresherSlotLines(full.lines.left, live.left, leftFresh);
    const right = keepFresherSlotLines(full.lines.right, live.right, rightFresh);
    const latest = videoRef.current
      ? (snapshotVideo(videoRef.current) ?? fallbackFrame)
      : fallbackFrame;
    return lobbyFromLines(latest, { left, right, center: full.lines.center });
  }

  /** A changed nameplate, read on its own, so a lock is not waiting on the whole column. */
  async function readChangedSlots(video: HTMLVideoElement) {
    if (fastBusyRef.current || !inDraftRef.current || draftCompleteRef.current) return;
    if (hiddenRef.current || idlePausedRef.current || video.readyState < 2) return;
    const prev = slotFpRef.current;
    if (!prev) return;
    const frame = snapshotVideo(video);
    if (!frame) return;
    const ctx = frame.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const nextFp = fingerprintSlots(ctx, frame);
    const changed: { side: "left" | "right"; index: number }[] = [];
    nextFp.left.forEach((fp, index) => {
      if (fp !== prev.left[index]) changed.push({ side: "left", index });
    });
    nextFp.right.forEach((fp, index) => {
      if (fp !== prev.right[index]) changed.push({ side: "right", index });
    });
    if (changed.length === 0) return;
    const leftCount = changed.filter((slot) => slot.side === "left").length;
    if (leftCount > 2 || changed.length - leftCount > 2) return;
    fastBusyRef.current = true;
    const epoch = epochRef.current;
    const readToken = ++publishGenRef.current;
    try {
      const pictures: { side: "left" | "right"; index: number; image: string }[] = [];
      for (const slot of changed) {
        const boxes = slot.side === "left" ? DRAFT_SLOT_NAMES.left : DRAFT_SLOT_NAMES.right;
        const box = boxes[slot.index];
        if (!box) continue;
        const plate = slotPlateCanvas(frame, box);
        if (!plate) continue;
        const image = await pictureOf(plate);
        if (!image) continue;
        pictures.push({ side: slot.side, index: slot.index, image });
      }
      if (pictures.length === 0 || epoch !== epochRef.current) return;
      const res = await fetch("/api/ocr/names", {
        method: "POST",
        headers: { "content-type": "application/json", ...scoutHeaders() },
        body: JSON.stringify({ slots: pictures }),
      });
      if (!res.ok || epoch !== epochRef.current) return;
      const data = (await res.json()) as {
        slots?: { side?: string; index?: number; lines?: { text: string; top: number }[] }[];
      };
      if (!data.slots) return;
      const cache = ocrCacheRef.current;
      let left = cache?.lines.left ?? [];
      let right = cache?.lines.right ?? [];
      const now = Date.now();
      for (const slot of data.slots ?? []) {
        const side = slot.side === "left" || slot.side === "right" ? slot.side : null;
        const index = slot.index ?? -1;
        if (!side || index < 0 || index > 4) continue;
        const lines = slot.lines ?? [];
        if (side === "left") left = replaceSlotLines(left, index, lines);
        else right = replaceSlotLines(right, index, lines);
        slotFreshAtRef.current[`${side}:${index}`] = now;
      }
      if (readStartedBeforeClick(readToken)) return;
      const lobby = lobbyFromLines(frame, {
        left,
        right,
        center: cache?.lines.center ?? [],
      });
      ocrCacheRef.current = {
        fingerprints: cache?.fingerprints ?? {
          title: "",
          status: "",
          namesLeft: nextFp.left.join("|"),
          namesRight: nextFp.right.join("|"),
          center: "",
        },
        title: cache?.title ?? "",
        status: cache?.status ?? "",
        center: cache?.center ?? "",
        lines: { left, right, center: cache?.lines.center ?? [] },
        lobby,
      };
      slotFpRef.current = nextFp;
      await publishWatched(
        lobby,
        cache?.title ?? "",
        cache?.status ?? "",
        cache?.center ?? "",
        false,
        frame,
        ctx,
        draftWatchFingerprintKey(ctx, frame),
        epoch,
        readToken,
      );
    } catch {
      // The slot fingerprints stay put, so the next tick reads the plate again.
    } finally {
      fastBusyRef.current = false;
    }
  }

  async function readFrame(video: HTMLVideoElement, worker: Worker) {
    if (video.readyState < 2) return;
    if (hiddenRef.current) return;
    if (idlePausedRef.current) return;
    if (draftCompleteRef.current) return;
    const live = snapshotVideo(video);
    if (live && canvasIsLoadingScreen(live)) {
      if (!heldLoadingRef.current) loadingTriesRef.current = 0;
      heldLoadingRef.current = live;
    }
    if (busyRef.current) {
      if (heldLoadingRef.current) loadingArrivedDuringBusyRef.current = true;
      void readChangedSlots(video);
      return;
    }
    const epoch = epochRef.current;
    const readToken = ++publishGenRef.current;
    busyRef.current = true;
    try {
      const held = heldLoadingRef.current;
      if (held) {
        const heldCtx = held.getContext("2d", { willReadFrequently: true });
        if (heldCtx) {
          loadingTriesRef.current += 1;
          await finishFromLoadingScreen(heldCtx, held, worker);
        }
        if (draftCompleteRef.current || loadingTriesRef.current >= 3) {
          heldLoadingRef.current = null;
          loadingTriesRef.current = 0;
        }
        return;
      }
      if (!live) return;
      const frame = live;
      const ctx = frame.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      if (await finishFromLoadingScreen(ctx, frame, worker)) return;
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
      const currentFp = {
        title: regionFingerprint(ctx, frame, DRAFT_TITLE_BOX),
        status: regionFingerprint(ctx, frame, DRAFT_STATUS_BOX),
        namesLeft: joinedRegionFingerprint(ctx, frame, DRAFT_SLOT_NAMES.left),
        namesRight: joinedRegionFingerprint(ctx, frame, DRAFT_SLOT_NAMES.right),
        center: regionFingerprint(ctx, frame, DRAFT_CENTER_HASH_BOX),
      };
      const cached = ocrCacheRef.current;
      const plan = ocrRefreshPlan(currentFp, cached?.fingerprints ?? null);
      const haveLines = Boolean(cached?.lines);
      const refresh = {
        left: plan.left || !haveLines,
        right: plan.right || !haveLines,
        center: plan.center || !haveLines,
      };
      if (!slotFpRef.current) slotFpRef.current = fingerprintSlots(ctx, frame);
      const liveSlots = fingerprintSlots(ctx, frame);
      const slotDelta = {
        left: liveSlots.left.filter((fp, index) => fp !== slotFpRef.current?.left[index]).length,
        right: liveSlots.right.filter((fp, index) => fp !== slotFpRef.current?.right[index]).length,
      };
      const fastOwnsNames =
        inDraftRef.current &&
        haveLines &&
        slotDelta.left <= 2 &&
        slotDelta.right <= 2 &&
        slotDelta.left + slotDelta.right > 0;
      if (fastOwnsNames && !plan.title && !plan.status && !plan.center) {
        watchFingerprintRef.current = fingerprint;
        stableSinceRef.current = Date.now();
        void readChangedSlots(video);
        return;
      }
      const namesNeeded = (refresh.left || refresh.right) && !fastOwnsNames;
      const nameReadStarted = Date.now();
      const seq = ++frameSeqRef.current;
      // Nameplates commit a lock. The center splash is a second read so a
      // hero is not stuck behind the big picture.
      const namesPromise = namesNeeded
        ? readLobby(
            frame,
            { left: refresh.left, right: refresh.right, center: false },
            cached?.lines ?? null,
          )
        : Promise.resolve(null);
      const centerPromise = refresh.center
        ? readLobby(
            frame,
            { left: false, right: false, center: true },
            cached?.lines ?? null,
          )
        : Promise.resolve(null);
      const titlePromise = plan.title
        ? readMapTitle(ctx, frame, worker)
        : Promise.resolve(cached?.title ?? "");
      const statusPromise = plan.status
        ? readColumn(frame, worker, DRAFT_STATUS_BOX)
        : Promise.resolve(cached?.status ?? "");
      if (inDraftRef.current && namesNeeded) {
        const quick = await namesPromise;
        if (epoch !== epochRef.current || seq !== frameSeqRef.current) return;
        const merged = quick ? mergeFreshLobby(quick, nameReadStarted, frame) : null;
        if (
          merged &&
          (await publishWatched(
            merged,
            cached?.title ?? "",
            cached?.status ?? "",
            cached?.center ?? "",
            false,
            frame,
            ctx,
            fingerprint,
            epoch,
            readToken,
          ))
        ) {
          return;
        }
      }
      const [titleText, statusText] = await Promise.all([titlePromise, statusPromise]);
      if (epoch !== epochRef.current || seq !== frameSeqRef.current) return;
      const centerNow = inDraftRef.current ? null : await centerPromise;
      if (epoch !== epochRef.current || seq !== frameSeqRef.current) return;
      const lobbyFresh = namesNeeded ? await namesPromise : null;
      const lobby = lobbyFresh
        ? mergeFreshLobby(lobbyFresh, nameReadStarted, frame)
        : (cached?.lobby ?? null);
      const centerLines = centerNow?.center ?? lobby?.center ?? [];
      const rapidCenter = centerLines.map((line) => line.text).join("\n");
      const centerSource = rapidCenter.trim() ? rapidCenter : (cached?.center ?? "");
      if (readStartedBeforeClick(readToken)) return;
      ocrCacheRef.current = {
        fingerprints: {
          title: currentFp.title,
          status: currentFp.status,
          namesLeft:
            refresh.left && namesNeeded && !lobbyFresh
              ? (cached?.fingerprints.namesLeft ?? "")
              : currentFp.namesLeft,
          namesRight:
            refresh.right && namesNeeded && !lobbyFresh
              ? (cached?.fingerprints.namesRight ?? "")
              : currentFp.namesRight,
          center: centerNow
            ? currentFp.center
            : (cached?.fingerprints.center ?? ""),
        },
        title: titleText,
        status: statusText,
        center: centerSource,
        lines: {
          left: lobby?.lines.left ?? cached?.lines?.left ?? [],
          right: lobby?.lines.right ?? cached?.lines?.right ?? [],
          center:
            centerNow?.lines.center ??
            lobby?.lines.center ??
            cached?.lines?.center ??
            [],
        },
        lobby,
      };
      let screenPhase = watchPhase(
        `${titleText}\n${statusText}`,
        inDraftRef.current,
      );
      if (screenPhase !== "draft") {
        screenPhase = watchPhase(
          `${titleText}\n${centerSource}\n${statusText}`,
          inDraftRef.current,
        );
      }
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
          if (draftShortOfPicks(draftRef.current)) {
            setStatus(
              "A pick is still missing. Holding this draft until the loading screen shows who locked it.",
            );
            return;
          }
          await onReplaySyncRef.current?.();
          if (epoch !== epochRef.current) return;
          clearObserved();
        } else if (screenPhase === "wait") {
          forgetNames();
        }
        if (shouldReadPartyNames(screenPhase)) {
          const partyText = await readColumn(frame, worker, PARTY_NAME_ROW);
          const partyNames = partyNamesFromText(partyText).map((name) =>
            snapToRoster(name, roster),
          );
          const draftAlreadyLocked =
            draftRef.current.ourPicks.length + draftRef.current.theirPicks.length > 0;
          if (partyNames.length >= 3 && !draftAlreadyLocked) {
            const partyKey = partyNames.map((name) => name.toLowerCase()).join("|");
            if (partyKey !== lastOursKeyRef.current) {
              lastOursKeyRef.current = partyKey;
              onOurSideRef.current?.(partyNames);
            }
            const queued = draftFromPartyQueue(partyNames);
            draftRef.current = queued;
            onDraftRef.current(queued);
            setStatus(`In queue. Loading Storm League for ${partyNames.join(", ")}.`);
            return;
          }
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
      armWatchTimer();
      if (
        await publishWatched(
          lobby,
          titleText,
          statusText,
          centerSource,
          true,
          frame,
          ctx,
          fingerprint,
          epoch,
          readToken,
        )
      ) {
        return;
      }
      if (refresh.center && !centerNow && lobby) {
        void centerPromise.then(async (splash) => {
          if (!splash) return;
          if (epoch !== epochRef.current || seq !== frameSeqRef.current) return;
          if (!inDraftRef.current || draftCompleteRef.current) return;
          const text = splash.center.map((line) => line.text).join("\n").trim();
          const cache = ocrCacheRef.current;
          if (cache) {
            ocrCacheRef.current = {
              ...cache,
              fingerprints: { ...cache.fingerprints, center: currentFp.center },
              center: text || cache.center,
              lines: { ...cache.lines, center: splash.lines.center },
            };
          }
          if (!text) return;
          await publishWatched(
            lobby,
            titleText,
            statusText,
            text,
            false,
            frame,
            ctx,
            fingerprint,
            epoch,
            readToken,
          );
        });
      }
    } catch {
      setStatus("Could not read that frame. The watch is still running.");
    } finally {
      busyRef.current = false;
      const arrivedDuringRead = loadingArrivedDuringBusyRef.current;
      loadingArrivedDuringBusyRef.current = false;
      if (
        arrivedDuringRead &&
        heldLoadingRef.current &&
        !draftCompleteRef.current &&
        !hiddenRef.current
      ) {
        const pendingVideo = videoRef.current;
        const pendingWorker = workerRef.current;
        if (pendingVideo && pendingWorker) void readFrame(pendingVideo, pendingWorker);
      }
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
    ourSeatNamesRef.current = [];
    theirSeatNamesRef.current = [];
    mismatchSavedRef.current = false;
    heldLoadingRef.current = null;
    loadingArrivedDuringBusyRef.current = false;
    loadingTriesRef.current = 0;
    lastLobbyShotRef.current = null;
    discardPickFrames();
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
    ocrCacheRef.current = null;
    slotFpRef.current = null;
    slotFreshAtRef.current = {};
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
          frameRate: { ideal: 8 },
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
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
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
          {reviewNote ? <p className="text-sm text-[var(--ink)]">{reviewNote}</p> : null}
        </div>
        <button
          type="button"
          disabled={savingReview}
          onClick={() => {
            setSavingReview(true);
            setReviewNote(null);
            void saveCurrentReview().then((note) => {
              setReviewNote(note);
              setSavingReview(false);
            });
          }}
          className="h-10 shrink-0 rounded-md border border-[var(--accent)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-50"
        >
          {savingReview ? "Saving…" : "Save for review"}
        </button>
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
