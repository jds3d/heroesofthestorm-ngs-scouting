"use client";

import { useEffect, useRef, useState } from "react";
import { heroKey } from "@/lib/scoring/heroMeta";
import type { Worker } from "tesseract.js";
import {
  DRAFT_BAN_STRIPS,
  DRAFT_NAME_PLATES,
  DRAFT_STATUS_BOX,
  DRAFT_TITLE_BOX,
  DRAFT_TURN_BOX,
  EMPTY_LIVE_DRAFT,
  bannerTurn,
  bansFromStrip,
  inferFirstPick,
  pickCountsFit,
  borderLooksLockedSamples,
  DRAFT_PICK_SLOTS,
  PARTY_NAME_ROW,
  heroesFromColumn,
  heroOnPlate,
  partyNamesFromText,
  mapFromTitle,
  nameFromPlate,
  playerFromSlotText,
  nextTurn,
  ocrFold,
  rememberHeroes,
  shownBanSide,
  sideFromBannerColor,
  screenTooSmallForWatch,
  snapToRoster,
  takeNewLocks,
  turnFromOcr,
  type LiveDraft,
  type OpenTurn,
} from "@/lib/lobby/screenLobby";

type Phase = "idle" | "watching" | "reading";
type Box = { x: number; y: number; w: number; h: number; rotate: number };

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

function foregroundBounds(plate: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = plate.getContext("2d");
  if (!ctx || plate.width < 2 || plate.height < 2) return null;
  const data = ctx.getImageData(0, 0, plate.width, plate.height).data;
  let minX = plate.width;
  let minY = plate.height;
  let maxX = 0;
  let maxY = 0;
  const step = 2;
  for (let y = 0; y < plate.height; y += step) {
    for (let x = 0; x < plate.width; x += step) {
      const i = (y * plate.width + x) * 4;
      if (data[i] < 12 && data[i + 1] < 8 && data[i + 2] < 20) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function edgeSamples(plate: HTMLCanvasElement): { luma: number; sat: number }[] {
  const ctx = plate.getContext("2d");
  if (!ctx) return [];
  const bounds = foregroundBounds(plate) ?? { x: 0, y: 0, w: plate.width, h: plate.height };
  const data = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h).data;
  const band = Math.max(2, Math.round(Math.min(bounds.w, bounds.h) * 0.18));
  const samples: { luma: number; sat: number }[] = [];
  const step = 2;
  for (let y = 0; y < bounds.h; y += step) {
    for (let x = 0; x < bounds.w; x += step) {
      const onEdge = x < band || y < band || x >= bounds.w - band || y >= bounds.h - band;
      if (!onEdge) continue;
      const i = (y * bounds.w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      samples.push({
        luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
        sat: max === 0 ? 0 : (max - min) / max,
      });
    }
  }
  return samples;
}

export function LobbyScreenWatch({
  ourNames,
  rosterNames,
  onLobby,
  onOurSide,
  onDraft,
  onWatchingChange,
  onScreenTooSmall,
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
  /** The drafter's monitor is smaller than the monitor being shared. */
  onScreenTooSmall?: (tooSmall: boolean) => void;
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
  const onScreenTooSmallRef = useRef(onScreenTooSmall);
  const lastKeyRef = useRef("");
  const lastOursKeyRef = useRef("");
  const announcedPicksRef = useRef<string[]>([]);
  const leftSlotHeroes = useRef<(string | null)[]>([null, null, null, null, null]);
  const rightSlotHeroes = useRef<(string | null)[]>([null, null, null, null, null]);
  const leftSlotPlayers = useRef<(string | null)[]>([null, null, null, null, null]);
  const rightSlotPlayers = useRef<(string | null)[]>([null, null, null, null, null]);
  const draftRef = useRef<LiveDraft>({ ...EMPTY_LIVE_DRAFT });
  const openTurnRef = useRef<OpenTurn | null>(null);
  const lineMode = useRef<string | null>(null);
  const sparseMode = useRef<string | null>(null);

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
    onScreenTooSmallRef.current = onScreenTooSmall;
  }, [onScreenTooSmall]);
  useEffect(() => {
    onWatchingRef.current?.(phase !== "idle");
  }, [phase]);

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
    onScreenTooSmallRef.current?.(false);
    setPhase("idle");
  }

  async function readColumn(frame: HTMLCanvasElement, worker: Worker, box: Box): Promise<string> {
    const plate = straightenedPlate(frame, box);
    if (!plate) return "";
    const result = await worker.recognize(plate);
    return result.data.text;
  }

  /** One OCR line per name banner, so both teams are read the same way. */
  async function readNamePlates(
    frame: HTMLCanvasElement,
    worker: Worker,
    boxes: readonly Box[],
  ): Promise<string[]> {
    const names: string[] = [];
    try {
      if (lineMode.current) {
        await worker.setParameters({ tessedit_pageseg_mode: lineMode.current as never });
      }
      for (const box of boxes) {
        const name = nameFromPlate(await readColumn(frame, worker, box));
        if (!name || names.some((have) => have.toLowerCase() === name.toLowerCase())) continue;
        names.push(name);
        if (names.length === 5) break;
      }
    } finally {
      if (sparseMode.current) {
        await worker.setParameters({ tessedit_pageseg_mode: sparseMode.current as never });
      }
    }
    return names;
  }

  async function lockedHeroes(
    frame: HTMLCanvasElement,
    worker: Worker,
    slots: readonly Box[],
    cache: (string | null)[],
    players: (string | null)[],
  ): Promise<{ hero: string; player: string | null }[]> {
    const locks: { hero: string; player: string | null }[] = [];
    for (let i = 0; i < slots.length; i++) {
      const plate = straightenedPlate(frame, slots[i]);
      if (!plate || !borderLooksLockedSamples(edgeSamples(plate))) {
        cache[i] = null;
        players[i] = null;
        continue;
      }
      if (!cache[i] || !players[i]) {
        const text = (await worker.recognize(plate)).data.text;
        if (!cache[i]) cache[i] = heroOnPlate(text);
        if (!players[i]) players[i] = playerFromSlotText(text);
      }
      if (cache[i] && players[i]) locks.push({ hero: cache[i] as string, player: players[i] });
    }
    return locks;
  }

  function clearObserved() {
    announcedPicksRef.current = [];
    leftSlotHeroes.current = [null, null, null, null, null];
    rightSlotHeroes.current = [null, null, null, null, null];
    leftSlotPlayers.current = [null, null, null, null, null];
    rightSlotPlayers.current = [null, null, null, null, null];
    lastKeyRef.current = "";
    lastOursKeyRef.current = "";
    openTurnRef.current = null;
    draftRef.current = {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: [],
      theirPicks: [],
      ourBans: [],
      theirBans: [],
    };
    onDraftRef.current(draftRef.current);
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
      const partyText = await readColumn(frame, worker, PARTY_NAME_ROW);
      const leftPlayers = (await readNamePlates(frame, worker, DRAFT_NAME_PLATES.left)).map((name) =>
        snapToRoster(name, roster),
      );
      const rightPlayers = (await readNamePlates(frame, worker, DRAFT_NAME_PLATES.right)).map((name) =>
        snapToRoster(name, roster),
      );
      const usOnLeft = true;
      const ourColumn = leftPlayers;
      const centerText = await readColumn(frame, worker, DRAFT_TURN_BOX);
      const statusText = await readColumn(frame, worker, DRAFT_STATUS_BOX);
      const banner = bannerTurn(`${centerText}\n${statusText}`);
      const centerRead = turnFromOcr(centerText, roster);
      if (banner.phase) centerRead.phase = banner.phase;
      if ((centerRead.phase ?? banner.phase) === "pick" && centerRead.hero) {
        const announced = announcedPicksRef.current;
        const last = announced[announced.length - 1];
        if (!last || heroKey(last) !== heroKey(centerRead.hero)) announced.push(centerRead.hero);
      }
      const leftLocked = await lockedHeroes(
        frame,
        worker,
        DRAFT_PICK_SLOTS.left,
        leftSlotHeroes.current,
        leftSlotPlayers.current,
      );
      const rightLocked = await lockedHeroes(
        frame,
        worker,
        DRAFT_PICK_SLOTS.right,
        rightSlotHeroes.current,
        rightSlotPlayers.current,
      );
      const draft = draftRef.current;
      const phaseNow = banner.phase ?? centerRead.phase ?? draft.phase;
      const allowPicks = phaseNow === "pick";
      const ourLocked = allowPicks
        ? takeNewLocks(
            draft.ourPicks,
            usOnLeft ? leftLocked : rightLocked,
            announcedPicksRef.current,
            draft.ourPickPlayers,
          )
        : { heroes: [] as string[], players: [] as (string | null)[] };
      const theirLocked = allowPicks
        ? takeNewLocks(
            draft.theirPicks,
            usOnLeft ? rightLocked : leftLocked,
            announcedPicksRef.current,
            draft.theirPickPlayers,
          )
        : { heroes: [] as string[], players: [] as (string | null)[] };
      let ourPicks = ourLocked.heroes;
      let theirPicks = theirLocked.heroes;
      const leftBanText = await readColumn(frame, worker, DRAFT_BAN_STRIPS.left);
      const rightBanText = await readColumn(frame, worker, DRAFT_BAN_STRIPS.right);
      const turn = nextTurn(
        openTurnRef.current,
        centerRead.phase ? centerRead : { ...centerRead, phase: banner.phase },
        (player) => {
          const fold = ocrFold(player);
          if (fold === ocrFold("HuckIt")) return "our";
          if (ourColumn.some((name) => ocrFold(name) === fold)) return "our";
          if (oursRef.current.some((name) => ocrFold(name) === fold)) return "our";
          if (rightPlayers.some((name) => ocrFold(name) === fold)) return "their";
          return null;
        },
        banner.color ? sideFromBannerColor(banner.color, usOnLeft) : null,
      );
      openTurnRef.current = turn.open;
      const ourBanSeen = bansFromStrip(usOnLeft ? leftBanText : rightBanText, ourPicks);
      const theirBanSeen = bansFromStrip(usOnLeft ? rightBanText : leftBanText, theirPicks);
      let ourBans = rememberHeroes(draft.ourBans, ourBanSeen, 3);
      let theirBans = rememberHeroes(draft.theirBans, theirBanSeen, 3);
      if (turn.ban) {
        if (turn.ban.side === "our") ourBans = rememberHeroes(ourBans, [turn.ban.hero], 3);
        else theirBans = rememberHeroes(theirBans, [turn.ban.hero], 3);
      }
      let phase = banner.phase ?? centerRead.phase ?? draft.phase;
      if (phase === "ban" && centerRead.hero) {
        const banSide = shownBanSide({
          center: centerText,
          status: statusText,
          player: centerRead.player,
          ourNames: [...ourColumn, ...oursRef.current],
          theirNames: rightPlayers,
        });
        if (banSide) {
          const key = heroKey(centerRead.hero);
          if (banSide === "our") {
            theirBans = theirBans.filter((hero) => heroKey(hero) !== key);
            ourBans = rememberHeroes(ourBans, [centerRead.hero], 3);
          } else {
            ourBans = ourBans.filter((hero) => heroKey(hero) !== key);
            theirBans = rememberHeroes(theirBans, [centerRead.hero], 3);
          }
        }
      }
      if (ourBans.length + theirBans.length < 2 && phase !== "pick") {
        ourPicks = [];
        theirPicks = [];
      }
      let firstPick = draft.firstPick;
      const turnSide =
        turn.open?.side ??
        (banner.color ? sideFromBannerColor(banner.color, usOnLeft) : null);
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
      let map = draft.map;
      if (!map) map = mapFromTitle(await readColumn(frame, worker, DRAFT_TITLE_BOX));
      const nextDraft: LiveDraft = {
        ourPicks,
        theirPicks,
        ourPickPlayers: ourLocked.players,
        theirPickPlayers: theirLocked.players,
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
      const inParty = partyNames.length >= 3 && ourPicks.length + theirPicks.length === 0;
      if (inParty) {
        const partyKey = partyNames.map((name) => name.toLowerCase()).join("|");
        if (partyKey !== lastOursKeyRef.current) {
          lastOursKeyRef.current = partyKey;
          onOurSideRef.current?.(partyNames);
        }
        setStatus(`In queue. Loading Storm League for ${partyNames.join(", ")}.`);
      } else if (ourColumn.length > 0) {
        const oursKey = ourColumn.map((name) => name.toLowerCase()).join("|");
        if (oursKey !== lastOursKeyRef.current) {
          lastOursKeyRef.current = oursKey;
          onOurSideRef.current?.(ourColumn);
        }
      }
      const opponents = inParty ? [] : rightPlayers;
      if (!inParty && opponents.length > 0) {
        const key = opponents.map((name) => name.toLowerCase()).join("|");
        if (key !== lastKeyRef.current) {
          lastKeyRef.current = key;
          setNames(opponents);
          if (opponents.length === 5) onLobbyRef.current(opponents);
        }
      }
      const locks = ourPicks.length + theirPicks.length + ourBans.length + theirBans.length;
      if (!inParty) setStatus(
        locks > 0
          ? `Draft from the screen: we banned ${ourBans.join(", ") || "—"}, picked ${ourPicks.join(", ") || "—"}. They banned ${theirBans.join(", ") || "—"}, picked ${theirPicks.join(", ") || "—"}.`
          : phase === "pick"
            ? "Pick phase. Opening bans are already done, so the board is on the current pick. Heroes fill in as they lock."
            : opponents.length > 0
              ? `Read ${opponents.length} opponent name${opponents.length === 1 ? "" : "s"}. Waiting for a hero to lock.`
              : "Watching the draft. No nameplates read on either side yet.",
      );
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
    announcedPicksRef.current = [];
    leftSlotHeroes.current = [null, null, null, null, null];
    rightSlotHeroes.current = [null, null, null, null, null];
    leftSlotPlayers.current = [null, null, null, null, null];
    rightSlotPlayers.current = [null, null, null, null, null];
    draftRef.current = {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: [],
      theirPicks: [],
      ourBans: [],
      theirBans: [],
    };
    openTurnRef.current = null;
    onDraftRef.current(draftRef.current);
    setNames([]);
    setPhase("watching");
    setStatus("Choose the main screen in the share dialog.");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
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
      const ratio = window.devicePixelRatio || 1;
      const settings = track.getSettings();
      onScreenTooSmallRef.current?.(
        screenTooSmallForWatch(
          {
            width: Math.round(window.screen.width * ratio),
            height: Math.round(window.screen.height * ratio),
          },
          {
            width: video.videoWidth || settings.width || 0,
            height: video.videoHeight || settings.height || 0,
          },
        ),
      );
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng");
      lineMode.current = PSM.SINGLE_LINE;
      sparseMode.current = PSM.SPARSE_TEXT;
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
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">{status}</p>
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
