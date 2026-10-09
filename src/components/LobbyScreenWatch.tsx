"use client";

import { useEffect, useRef, useState } from "react";
import { TimeLeftBar } from "@/components/TimeLeftBar";
import { heroKey } from "@/lib/scoring/heroMeta";
import { matchBanPixels } from "@/lib/lobby/banFace";
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
  banHexFilled,
  bansFromHexFaces,
  acceptPortraitExample,
  matchPortrait,
  portraitVector,
  inferFirstPick,
  pickCountsFit,
  PARTY_NAME_ROW,
  openSeatPlayers,
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
  banSideFromSplash,
  firstBanSideFromStatus,
  slotsHoldPicks,
  snapToRoster,
  takeNewLocks,
  turnFromOcr,
  watchPhase,
  type DraftBox,
  type PlateFill,
  type LiveDraft,
  type OpenTurn,
  type Rgb,
} from "@/lib/lobby/screenLobby";

type Phase = "idle" | "watching" | "reading";
type Box = { x: number; y: number; w: number; h: number; rotate: number };

function readHex(
  ctx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  box: DraftBox,
): { filled: boolean; vector: number[] | null; hero: string | null } {
  const x = Math.max(0, Math.round(box.x * frame.width));
  const y = Math.max(0, Math.round(box.y * frame.height));
  const w = Math.max(1, Math.min(frame.width - x, Math.round(box.w * frame.width)));
  const h = Math.max(1, Math.min(frame.height - y, Math.round(box.h * frame.height)));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return { filled: false, vector: null, hero: null };
  }
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 });
  }
  return {
    filled: banHexFilled(pixels),
    vector: portraitVector(pixels, w, h),
    hero: banHexFilled(pixels) ? matchBanPixels(pixels, w, h) : null,
  };
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
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState(
    "Share the main screen once. While a draft lobby is visible, the five opponent names fill in here.",
  );
  const [names, setNames] = useState<string[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
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

  function stopWatch() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
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
  const ctx = frame.getContext("2d");
  const pixelAt = ctx ? framePixelAt(ctx, frame) : null;
  const slots = (
    ally: boolean,
    reads: { hero: string | null; player: string | null }[],
    portraitBoxes: readonly DraftBox[],
    nameBoxes: readonly DraftBox[],
  ) =>
    reads.flatMap((read, index) => {
      const box = portraitBoxes[index];
      const nameBox = nameBoxes[index];
      if (!read.hero || !box || !nameBox || !ctx || !pixelAt) return [];
      const plate = plateFill(sampleBox(ctx, frame, nameBox));
      return [
        {
          hero: read.hero,
          player: read.player,
          slot: index,
          plate,
          faceFilled: portraitFilled(sampleBox(ctx, frame, box)),
          teamRim: portraitTeamRim(frame.width, frame.height, box, pixelAt),
          ally,
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
      if (plateFill(sampleBox(ctx, frame, nameBox)) !== "shown") return [];
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
    leftSlots: slots(true, leftReads, DRAFT_PLATE_SLOTS.left, DRAFT_SLOT_NAMES.left),
    rightSlots: slots(false, rightReads, DRAFT_PLATE_SLOTS.right, DRAFT_SLOT_NAMES.right),
    leftShown: shownHeroes(leftReads, DRAFT_SLOT_NAMES.left),
    rightShown: shownHeroes(rightReads, DRAFT_SLOT_NAMES.right),
    leftReads,
    rightReads,
    picksLeft: [],
    picksRight: [],
    leftPicking: false,
    rightPicking: false,
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
    inDraftRef.current = false;
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

  async function readFrame(video: HTMLVideoElement, worker: Worker) {
    if (busyRef.current || video.readyState < 2) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    setPhase("reading");
    try {
      const frame = document.createElement("canvas");
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      const ctx = frame.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
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
      const leftHexes = DRAFT_BAN_HEXES.left.map((hex) => readHex(ctx, frame, hex));
      const rightHexes = DRAFT_BAN_HEXES.right.map((hex) => readHex(ctx, frame, hex));
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
      const platePhase = banPhase ? "ban" : (banner.phase ?? centerRead.phase);
      const lockedSlots = (
        rows: {
          hero: string;
          player: string | null;
          slot: number;
          plate: PlateFill;
          faceFilled: boolean;
          teamRim: { blue: number; red: number };
          ally: boolean;
        }[],
      ) =>
        snapPlate(
          rows.filter((row) =>
            portraitIsLocked({
              phase: platePhase,
              faceFilled: row.faceFilled,
              teamRim: row.teamRim,
              plate: row.plate,
              ally: row.ally,
            }),
          ),
        );
      const leftLocked = lockedSlots(lobby?.leftSlots ?? []);
      const rightLocked = lockedSlots(lobby?.rightSlots ?? []);
      const slotted = slotsHoldPicks(leftLocked.length + rightLocked.length);
      const fromSlots = null;
      if (!banPhase && slotted) picksStartedRef.current = true;
      if (!banPhase && (banner.phase === "pick" || fromSlots === "pick")) {
        picksStartedRef.current = true;
      }
      const allowPicks =
        slotted ||
        acceptPlatePicks({
          banPhase,
          picksStarted: picksStartedRef.current,
        });
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
      );
      const theirBans = bansFromHexFaces(
        namedHexes(theirHexes),
        theirHexes.map((hex) => hex.filled),
        draft.theirBans,
      );
      const phase = banner.phase ?? centerRead.phase ?? fromSlots ?? (slotted ? "pick" : draft.phase);
      if (banPhase && !picksStartedRef.current) {
        ourPicks = [];
        theirPicks = [];
      }
      let firstPick = draft.firstPick;
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
      const lockedFlags = (boxes: readonly DraftBox[], nameBoxes: readonly DraftBox[], ally: boolean) =>
        boxes.map((box, index) => {
          if (!seatCtx || !seatPixels) return false;
          const nameBox = nameBoxes[index];
          return portraitIsLocked({
            phase: platePhase,
            faceFilled: portraitFilled(sampleBox(seatCtx, frame, box)),
            teamRim: portraitTeamRim(frame.width, frame.height, box, seatPixels),
            plate: nameBox ? plateFill(sampleBox(seatCtx, frame, nameBox)) : undefined,
            ally,
          });
        });
      const namedSeats = (
        reads: readonly { player: string | null }[],
      ) =>
        reads.map((read) => ({
          player: read.player ? snapToRoster(read.player, knownNames) : null,
        }));
      const ourReads = usOnLeft ? lobby?.leftReads ?? [] : lobby?.rightReads ?? [];
      const theirReads = usOnLeft ? lobby?.rightReads ?? [] : lobby?.leftReads ?? [];
      const ourBoxes = usOnLeft ? DRAFT_PLATE_SLOTS.left : DRAFT_PLATE_SLOTS.right;
      const theirBoxes = usOnLeft ? DRAFT_PLATE_SLOTS.right : DRAFT_PLATE_SLOTS.left;
      const ourNameBoxes = usOnLeft ? DRAFT_SLOT_NAMES.left : DRAFT_SLOT_NAMES.right;
      const theirNameBoxes = usOnLeft ? DRAFT_SLOT_NAMES.right : DRAFT_SLOT_NAMES.left;
      const ourOpenPlayers =
        lobby && ourReads.some((read) => read.player)
          ? openSeatPlayers(namedSeats(ourReads), lockedFlags(ourBoxes, ourNameBoxes, true))
          : draft.ourOpenPlayers ?? [];
      const theirOpenPlayers =
        lobby && theirReads.some((read) => read.player)
          ? openSeatPlayers(namedSeats(theirReads), lockedFlags(theirBoxes, theirNameBoxes, false))
          : draft.theirOpenPlayers ?? [];
      const nextDraft: LiveDraft = {
        ourPicks,
        theirPicks,
        ourPickPlayers: ourLocked?.players ?? draft.ourPickPlayers,
        theirPickPlayers: theirLocked?.players ?? draft.theirPickPlayers,
        ourOpenPlayers,
        theirOpenPlayers,
        ourBans,
        theirBans,
        firstPick,
        phase,
        map,
      };
      if (epoch !== epochRef.current) return;
      draftRef.current = nextDraft;
      onDraftRef.current(nextDraft);

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
    } catch {
      setStatus("Could not read that frame. The watch is still running.");
    } finally {
      busyRef.current = false;
      if (streamRef.current) setPhase("watching");
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
    onDraftRef.current(draftRef.current);
    setNames([]);
    setPhase("watching");
    setStatus("Choose the main screen in the share dialog.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 2 },
        },
        audio: false,
        // Chrome-only hints: ask for a monitor, not this browser tab.
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error("No video track");
      const surface = track.getSettings().displaySurface;
      if (surface && surface !== "monitor") {
        track.stop();
        setStatus("That share is a window. Share the whole main screen so the lobby can be read.");
        return;
      }
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
      setPhase("watching");
      setStatus("Watching the main screen.");
      void readFrame(video, worker);
      timerRef.current = window.setInterval(() => {
        void readFrame(video, worker);
      }, 2000);
    } catch (err) {
      stopWatch();
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setStatus(
        denied
          ? "Screen share was dismissed. Share the main screen to fill the lobby."
          : "Could not start the screen watch.",
      );
    }
  }

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
    <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--background)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Live lobby</h3>
          <p className="text-sm text-[var(--muted)]">{status}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (phase === "idle") {
              void startWatch();
              return;
            }
            stopWatch();
            setStatus("Screen watch stopped.");
          }}
          className="h-10 shrink-0 rounded-md border border-[var(--accent)] px-4 text-sm font-semibold uppercase tracking-wide text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
        >
          {phase === "idle" ? "Watch main screen" : "Stop watching"}
        </button>
      </div>
      {names.length > 0 && (
        <p className="text-sm text-[var(--ink)]">
          Their side from the draft:{" "}
          <span className="font-semibold">{names.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
