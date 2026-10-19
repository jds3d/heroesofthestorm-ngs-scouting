import { NGS_MAP_POOL } from "@/config/ngsMaps";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { HERO_META, heroKey } from "@/lib/scoring/heroMeta";
import { allDraftHeroes, heroDraftSlug } from "@/lib/scoring/heroPortrait";
import type { ReplayAction } from "@/lib/review/replayDraft";

function isHero(token: string): boolean {
  const key = heroKey(token);
  return Object.prototype.hasOwnProperty.call(HERO_META, key);
}

/**
 * Nameplates on a 16:9 Storm League draft, as fractions of the frame.
 * The banners are diagonal: left tilts up to the right, right tilts the other way.
 * `rotate` is degrees clockwise so the names land horizontal for OCR.
 */
export const DRAFT_NAME_COLUMNS = {
  left: { x: 0, y: 0.08, w: 0.18, h: 0.8, rotate: -22 },
  right: { x: 0.82, y: 0.08, w: 0.18, h: 0.8, rotate: 32 },
} as const;

/**
 * One name banner per player. A single column mixes the hex borders into the
 * letters, which turns Topgun707 into Topguny03 and cuts MrHustler short.
 * The same boxes are used for both teams. Nothing here is guessed from a roster.
 */
/**
 * The whole name column. `rotate` is degrees clockwise. Left banners tilt
 * down to the right, so -27 lays them flat. Right banners tilt the other way.
 * Measured on a 1024x576 Alterac Pass lobby.
 */
export const DRAFT_NAME_COLUMN = {
  left: { x: 0, y: 40 / 576, w: 250 / 1024, h: 490 / 576, rotate: -27 },
  right: { x: 780 / 1024, y: 20 / 576, w: 244 / 1024, h: 490 / 576, rotate: 26 },
} as const;

export const DRAFT_NAME_PLATES: { left: DraftBox[]; right: DraftBox[] } = {
  left: [0, 1, 2, 3, 4].map((i) => ({
    x: 0,
    y: 0.17 + i * 0.156,
    w: 0.19,
    h: 0.096,
    rotate: -18,
  })),
  right: [0, 1, 2, 3, 4].map((i) => ({
    x: 0.79,
    y: 0.17 + i * 0.156,
    w: 0.21,
    h: 0.1,
    rotate: 18,
  })),
};

export type DraftBox = { x: number; y: number; w: number; h: number; rotate: number };

/**
 * One plate per player, top to bottom. Text on the Storm League draft is
 * horizontal, so these are not rotated. Each box includes the portrait and
 * the hero and player names beside it.
 */
/**
 * Hero and player text beside the portraits, unrotated. Wider than one slot
 * so a staggered row is not clipped. Stays clear of the center splash.
 */
export const DRAFT_PICK_COLUMNS = {
  left: { x: 0, y: 0.06, w: 0.36, h: 0.88, rotate: 0 },
  right: { x: 0.64, y: 0.06, w: 0.36, h: 0.88, rotate: 0 },
} as const;

export const DRAFT_PICK_SLOTS: { left: DraftBox[]; right: DraftBox[] } = {
  left: [0, 1, 2, 3, 4].map((i) => ({
    x: i * 0.014,
    y: 0.1 + i * 0.165,
    w: 0.22,
    h: 0.16,
    rotate: 0,
  })),
  right: [0, 1, 2, 3, 4].map((i) => ({
    x: 0.7 - i * 0.012,
    y: 0.1 + i * 0.165,
    w: 0.3,
    h: 0.16,
    rotate: 0,
  })),
};

/**
 * Center announcement only. Kept narrow so the chat log, which overlaps the
 * right side of the draft, cannot turn "Banning" into a pick.
 */
export const DRAFT_TURN_BOX = { x: 0.32, y: 0.16, w: 0.36, h: 0.52, rotate: 0 } as const;

/**
 * 16:9 draft the boxes below were measured on.
 * Both files in examples/drafts ("draft lobby shrines.png", "draft lobby volskaya.png") are 2560x1440.
 */
const DRAFT_FRAME = { w: 2560, h: 1440 };

function refBox(x0: number, y0: number, x1: number, y1: number): DraftBox {
  return {
    x: x0 / DRAFT_FRAME.w,
    y: y0 / DRAFT_FRAME.h,
    w: (x1 - x0) / DRAFT_FRAME.w,
    h: (y1 - y0) / DRAFT_FRAME.h,
    rotate: 0,
  };
}

/**
 * Bottom pill, under the hero row. "Waiting for Team Ban..." or "Waiting for Enemy...".
 * Tight on the pill so the rank medals and chat beside it are not part of the read.
 */
export const DRAFT_STATUS_BOX = refBox(1000, 1255, 1560, 1305);

/** Map title along the top of a 16:9 draft. Measured on the Volskaya lobby. */
export const DRAFT_TITLE_BOX = refBox(900, 0, 1660, 80);

/**
 * The five names above the rank medals on the Storm League party screen,
 * while the group is still queuing.
 */
export const PARTY_NAME_ROW = { x: 0.04, y: 0.12, w: 0.92, h: 0.08, rotate: 0 } as const;

/**
 * Locked ban portraits sit in a row under the map, inside the nameplates.
 * The strips stay clear of the diagonal player columns so a pick is not read as a ban.
 */
export const DRAFT_BAN_STRIPS = {
  left: { x: 0.06, y: 0, w: 0.28, h: 0.09, rotate: 0 },
  right: { x: 0.66, y: 0, w: 0.28, h: 0.09, rotate: 0 },
} as const;

/**
 * The six ban hexes under the map title, left to right on each side.
 * Interiors only: the padlock under each hex is not part of the face.
 * Measured on examples/drafts/draft lobby volskaya.png. A filled hex is a locked ban.
 * The glowing arrow in the active ban slot (draft lobby shrines.png) is not a face.
 */
export const DRAFT_BAN_HEXES: { left: DraftBox[]; right: DraftBox[] } = {
  left: [refBox(378, 22, 452, 118), refBox(510, 22, 584, 118), refBox(642, 22, 716, 118)],
  right: [refBox(1840, 22, 1914, 118), refBox(1972, 22, 2046, 118), refBox(2104, 22, 2178, 118)],
};

/**
 * Portrait interiors, top to bottom. Even slots sit toward the outer edge;
 * odd slots step inward. A face here is a locked pick. An empty slot is the
 * dark honeycomb, including the player whose turn is glowing around it.
 * Measured on both examples/drafts lobbies.
 */
export const DRAFT_PLATE_SLOTS: { left: DraftBox[]; right: DraftBox[] } = {
  left: [0, 1, 2, 3, 4].map((i) => {
    const x = i % 2 === 0 ? 70 : 200;
    const y = 200 + i * 226;
    return refBox(x, y, x + 150, y + 110);
  }),
  right: [0, 1, 2, 3, 4].map((i) => {
    const x = i % 2 === 0 ? 2340 : 2200;
    const y = 200 + i * 226;
    return refBox(x, y, x + 150, y + 110);
  }),
};

/**
 * Hero and player text for one slot, top to bottom. The letters are horizontal.
 * Stacked in this order for OCR; each cell is `SLOT_LINE_STRIDE` pixels tall.
 */
export const DRAFT_SLOT_NAMES: { left: DraftBox[]; right: DraftBox[] } = {
  left: [0, 1, 2, 3, 4].map((i) => {
    const x = i % 2 === 0 ? 0 : 70;
    const y = 220 + i * 226;
    return refBox(x, y, x + 320, y + 140);
  }),
  right: [0, 1, 2, 3, 4].map((i) => {
    const x = i % 2 === 0 ? 2140 : 2000;
    const y = 210 + i * 226;
    return refBox(x, y, 2560, y + 150);
  }),
};

/**
 * One nameplate per cell when the five plates are stacked for the reader.
 * Tall enough that a detection box stays inside its slot. The plate scales to
 * at most 2x, leaving room above and below the glyphs. A short cell let the
 * next plate's hero line count as the slot above it.
 */
export const SLOT_LINE_STRIDE = 400;

/** Stacked nameplate width. Wide enough for a 420px right plate to scale to 2x. */
export const NAMEPLATE_CELL_WIDTH = 880;

/** Where one nameplate lands in the stacked OCR image. Same numbers the screen watch draws. */
export function nameplateCell(
  frameWidth: number,
  frameHeight: number,
  box: DraftBox,
  index: number,
  cellW = NAMEPLATE_CELL_WIDTH,
  cellH = SLOT_LINE_STRIDE,
): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
} {
  const sx = Math.max(0, Math.round(box.x * frameWidth));
  const sy = Math.max(0, Math.round(box.y * frameHeight));
  const sw = Math.max(1, Math.min(frameWidth - sx, Math.round(box.w * frameWidth)));
  const sh = Math.max(1, Math.min(frameHeight - sy, Math.round(box.h * frameHeight)));
  const scale = Math.min(2, cellW / sw, (cellH - 16) / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.round((cellW - dw) / 2);
  const dy = index * cellH + Math.round((cellH - dh) / 2);
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/** A ban that already locked before it could be read. It advances the board and removes no hero. */
export const UNSEEN_BAN = "__unseen__";
/** Storm League skipped a ban — the hex shows the no-ban plate, not a hero face. */
export const NO_BAN = "__no_ban__";

/** A locked portrait and the name printed under it. */
export type SlotLock = { hero: string; player: string | null };

export type LiveDraft = {
  ourPicks: string[];
  theirPicks: string[];
  /** Same order as `ourPicks`. The name under that portrait, not a comfort guess. */
  ourPickPlayers: (string | null)[];
  theirPickPlayers: (string | null)[];
  ourBans: string[];
  theirBans: string[];
  /**
   * Players whose portrait is not locked, top seat down.
   * Suggestions belong to these seats and not to anyone who already locked.
   */
  ourOpenPlayers?: string[];
  theirOpenPlayers?: string[];
  /** Who banned first. In this lobby that side also picks first. */
  firstPick: "us" | "them" | null;
  /** Last phase read from the center banner. */
  phase: "ban" | "pick" | null;
  /** Whose ban or pick the plates / banner say is open right now. */
  turn?: LiveTurn | null;
  map: string | null;
  /**
   * The loading screen showed both teams. Picks are final even when a ban
   * was never read off the draft lobby.
   */
  sealed?: boolean;
};

export type LiveTurn = { side: "our" | "their"; kind: "ban" | "pick" };

export const EMPTY_LIVE_DRAFT: LiveDraft = {
  ourPicks: [],
  theirPicks: [],
  ourPickPlayers: [],
  theirPickPlayers: [],
  ourBans: [],
  theirBans: [],
  ourOpenPlayers: [],
  theirOpenPlayers: [],
  firstPick: null,
  phase: null,
  map: null,
};

export type TurnRead = {
  player: string | null;
  phase: "ban" | "pick" | null;
  hero: string | null;
};

export type OpenTurn = {
  player: string;
  phase: "ban" | "pick";
  hero: string | null;
  side: "our" | "their";
};

function plateNameToken(token: string, allowShort = false): string | null {
  const cleaned = token.replace(/^'+|'+$/g, "");
  // Banners can be three letters (Dex). Other OCR still ignores those scraps.
  // A long digit run is the chat box, not a player.
  const pattern = allowShort
    ? /^[A-Za-z][A-Za-z0-9']{2,17}$/
    : /^[A-Za-z][A-Za-z0-9']{3,17}$/;
  if (!pattern.test(cleaned) || /\d{4,}/.test(cleaned)) return null;
  if (isHero(cleaned) || heroFromPlateText(cleaned)) return null;
  return cleaned;
}

function plateLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function playerToken(line: string, allowShort = false): string | null {
  const ranked = line
    .split(/[^A-Za-z0-9']+/)
    .map((token) => plateNameToken(token, allowShort))
    .filter((token): token is string => Boolean(token))
    .sort((a, b) => b.length - a.length);
  return ranked[0] ?? null;
}

/**
 * Hero and player printed on one slot's nameplate.
 * The name under the hero is who locked it. A name above the hero, or a
 * second name below it, is the neighboring plate leaking into the crop.
 */
export function readSlotPlate(lines: readonly string[]): {
  hero: string | null;
  player: string | null;
} {
  let hero: string | null = null;
  let player: string | null = null;
  let heroSeen = false;
  for (const line of lines) {
    const asHero = heroFromPlateText(line);
    if (asHero) {
      hero = asHero;
      if (!heroSeen) player = null;
      heroSeen = true;
      continue;
    }
    const asPlayer = nameFromPlate(line, true);
    if (!asPlayer) continue;
    if (!heroSeen || !player) player = asPlayer;
  }
  if (!hero) hero = heroFromPlateText(lines.join(" "));
  return { hero, player };
}

/**
 * Lines from five nameplates stacked top to bottom, one cell per slot.
 * `top` is the line's y in that stacked image.
 */
export function readsBySlot(
  lines: readonly { text: string; top: number }[],
  count = 5,
  stride = SLOT_LINE_STRIDE,
): { hero: string | null; player: string | null }[] {
  const buckets: string[][] = Array.from({ length: count }, () => []);
  for (const line of lines) {
    const index = Math.floor(line.top / stride);
    if (index < 0 || index >= count) continue;
    buckets[index].push(line.text);
  }
  return buckets.map((bucket) => readSlotPlate(bucket));
}

/**
 * Names still picking, in seat order. A locked portrait is out, even when the
 * plate still shows that player's name.
 */
export function openSeatPlayers(
  seats: readonly { player: string | null }[],
  locked: readonly boolean[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lockedNames = new Set<string>();
  seats.forEach((seat, index) => {
    const name = seat.player?.trim();
    if (name && locked[index]) lockedNames.add(playerFold(name));
  });
  seats.forEach((seat, index) => {
    const name = seat.player?.trim();
    if (!name || locked[index]) return;
    const key = playerFold(name);
    if (seen.has(key) || lockedNames.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out;
}

export function nameFromPlate(text: string, allowShort = false): string | null {
  const lines = plateLines(text);
  if (!lines.length) return null;
  if (lines.length >= 2) return playerToken(lines[lines.length - 1], allowShort);
  return playerToken(lines[0], allowShort);
}

/**
 * A side column of "PICKING" slots means that team is on a pick, not a ban.
 * The center splash is easy to miss; these labels are on the plates we already read.
 */
export function columnShowsPicking(lines: readonly { text: string }[]): boolean {
  return lines.some((line) => /\bpicking\b/i.test(line.text));
}

/** Any nameplate line in a stacked column says PICKING. */
export function columnPickingFromOcrLines(
  lines: readonly { text: string; top?: number }[],
): boolean {
  return columnShowsPicking(lines);
}

/** Per-slot PICKING labels from stacked nameplate OCR. */
export function pickingFlagsBySlot(
  lines: readonly { text: string; top: number }[],
  count = 5,
  stride = SLOT_LINE_STRIDE,
): boolean[] {
  const buckets: string[][] = Array.from({ length: count }, () => []);
  for (const line of lines) {
    const index = Math.floor(line.top / stride);
    if (index < 0 || index >= count) continue;
    buckets[index].push(line.text);
  }
  return buckets.map((bucket) =>
    bucket.some((text) => /\bpicking\b/i.test(text)),
  );
}

/**
 * Slot text wins when the center splash was not read as a ban.
 * A ban splash still in the center keeps the phase on ban.
 */
export function pickingPhaseFromColumns(args: {
  leftPicking: boolean;
  rightPicking: boolean;
  bannerPhase: "ban" | "pick" | null;
}): "pick" | null {
  if (args.bannerPhase === "ban") return null;
  if (args.leftPicking || args.rightPicking) return "pick";
  return null;
}

/** Which side's slots say PICKING. Both or neither is not a first-pick call. */
export function firstPickFromPickingSlots(args: {
  leftPicking: boolean;
  rightPicking: boolean;
  usOnLeft: boolean;
}): "us" | "them" | null {
  if (args.leftPicking === args.rightPicking) return null;
  const left: "us" | "them" = args.usOnLeft ? "us" : "them";
  const right: "us" | "them" = args.usOnLeft ? "them" : "us";
  return args.leftPicking ? left : right;
}

/** The hero printed on a locked slot. "PICKING" is not a lock. */
export function heroOnPlate(text: string): string | null {
  const lines = plateLines(text);
  if (!lines.length) return null;
  if (lines.every((line) => /\bpicking\b/i.test(line))) return null;
  for (const line of lines) {
    if (/\bpicking\b/i.test(line)) continue;
    const hero = heroFromPlateText(line);
    if (hero) return hero;
  }
  return null;
}

/**
 * Words painted on the Storm League party screen that are not battletags:
 * the rank medals, and "No Role Selected".
 */
const PARTY_MEDAL_WORDS = new Set([
  "platinum",
  "diamond",
  "gold",
  "silver",
  "bronze",
  "master",
  "grandmaster",
  "selected",
  "unranked",
]);

export function isPartyMedalName(name: string): boolean {
  return PARTY_MEDAL_WORDS.has(name.toLowerCase().replace(/[^a-z]/g, ""));
}

/**
 * The queue screen names our five. The opponent has not loaded, and a rank
 * medal is not a player.
 */
export function draftFromPartyQueue(partyNames: readonly string[]): LiveDraft {
  const ours: string[] = [];
  const seen = new Set<string>();
  for (const raw of partyNames) {
    const name = raw.trim();
    if (!name || isPartyMedalName(name)) continue;
    const fold = name.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    ours.push(name);
    if (ours.length === 5) break;
  }
  return {
    ...EMPTY_LIVE_DRAFT,
    ourOpenPlayers: ours,
    theirOpenPlayers: [],
  };
}

/** Names from the party-row OCR crop, left to right (at most five). */
export function partyNamesFromText(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[^A-Za-z0-9']+/)) {
    const name = plateNameToken(token);
    if (!name || name.length < 5 || isPartyMedalName(name)) continue;
    const fold = name.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    names.push(name);
    if (names.length === 5) break;
  }
  return names;
}

export type OcrNameLine = { text: string; top: number };

/** Player names from a deskewed column, top to bottom. Hero labels are skipped. */
export function namesFromOcrLines(lines: readonly OcrNameLine[]): string[] {
  const names: string[] = [];
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  for (const line of sorted) {
    const name = nameFromPlate(line.text, true);
    if (!name || heroFromPlateText(name)) continue;
    if (names.some((have) => have.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
    if (names.length === 5) break;
  }
  return names;
}

/** Up to five player names, top to bottom. Hero labels on the same plates are skipped. */
export function namesFromColumn(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (heroFromPlateText(line)) continue;
    const name = nameFromPlate(line);
    if (!name) continue;
    if (names.some((have) => have.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
    if (names.length === 5) break;
  }
  return names;
}

/**
 * The battletag under a locked portrait. Hero labels on the same plate
 * (including "LI-MING Thomas" on one line) are not the player.
 */
export function playerFromSlotText(text: string): string | null {
  return nameFromPlate(text);
}

/**
 * Locked heroes from one column, top to bottom.
 * A hero line opens a slot. The next player line under it is who locked it.
 * "PICKING" is not a lock.
 */
export function locksFromOcrLines(
  lines: readonly { text: string; top: number }[],
): { hero: string; player: string | null }[] {
  const locks: { hero: string; player: string | null }[] = [];
  // A name printed above the portrait belongs to the next hero. A name under
  // it belongs to the hero just read. PICKING clears a leftover name so the
  // player still choosing is not stuck onto the following lock.
  let pendingPlayer: string | null = null;
  for (const line of [...lines].sort((a, b) => a.top - b.top)) {
    if (/\bpicking\b/i.test(line.text)) {
      pendingPlayer = null;
      continue;
    }
    const hero = heroFromPlateText(line.text);
    if (hero) {
      if (locks.some((lock) => heroKey(lock.hero) === heroKey(hero))) {
        pendingPlayer = null;
        continue;
      }
      if (locks.length === 5) break;
      const sameLine = playerFromSlotText(line.text);
      const inline =
        sameLine && !heroFromPlateText(sameLine) ? sameLine : null;
      locks.push({ hero, player: inline ?? pendingPlayer });
      pendingPlayer = null;
      continue;
    }
    const player = playerFromSlotText(line.text);
    if (!player || heroFromPlateText(player)) continue;
    const last = locks[locks.length - 1];
    if (last && !last.player) last.player = player;
    else pendingPlayer = player;
  }
  return locks;
}

/** Locked heroes on one side, top to bottom, in draft-board spelling. */
export function heroesFromColumn(text: string): string[] {
  const heroes: string[] = [];
  for (const line of text.split(/\n+/)) {
    const hero = heroFromPlateText(line);
    if (!hero) continue;
    if (heroes.some((have) => heroKey(have) === heroKey(hero))) continue;
    heroes.push(hero);
    if (heroes.length === 5) break;
  }
  return heroes;
}

/** Append heroes that were not already locked, keeping the order they first appeared. */
export function rememberHeroes(
  prev: readonly string[],
  seen: readonly string[],
  max = 5,
): string[] {
  const next = [...prev];
  for (const hero of seen) {
    if (next.some((have) => heroKey(have) === heroKey(hero))) continue;
    next.push(hero);
    if (next.length === max) break;
  }
  return next;
}

/** Hero names in a ban strip, ignoring anyone already locked as a pick. */
export function bansFromStrip(text: string, picks: readonly string[]): string[] {
  const taken = new Set(picks.map((hero) => heroKey(hero)));
  return heroesFromColumn(text)
    .filter((hero) => !taken.has(heroKey(hero)))
    .slice(0, 3);
}

export type Rgb = { r: number; g: number; b: number };

/**
 * Ally: whitish plate is locked, blue plate is a hover. Enemy: light pink is locked,
 * dark red is an open seat (no committed hero name yet).
 */
export type PlateFill = "locked" | "shown" | "empty";

function lumaOf(pixel: Rgb): number {
  return 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
}

function allyPlateFill(pixels: readonly Rgb[]): PlateFill {
  const lumas: number[] = [];
  const cast: number[] = [];
  for (const pixel of pixels) {
    const luma = lumaOf(pixel);
    if (luma < 55) continue;
    lumas.push(luma);
    cast.push(pixel.b - pixel.r);
  }
  if (lumas.length < 30 || lumas.length / pixels.length < 0.18) return "empty";
  lumas.sort((a, b) => a - b);
  cast.sort((a, b) => a - b);
  const medianLuma = lumas[Math.floor(lumas.length / 2)] ?? 0;
  const medianCast = cast[Math.floor(cast.length / 2)] ?? 0;
  // A light lock stays above the dark hover plates even when a screen capture
  // is dimmer than the reference PNG. Hovers on those shots sit near 80.
  if (medianCast >= 50 || medianLuma < 100) return "shown";
  return "locked";
}

/** Dark crimson seat vs a bright pink lock plate on the enemy column. */
function enemyPlateFill(pixels: readonly Rgb[]): PlateFill {
  const lit = pixels.filter((pixel) => lumaOf(pixel) >= 38);
  if (lit.length < 30 || lit.length / pixels.length < 0.15) return "empty";
  const lumas = lit.map((pixel) => lumaOf(pixel)).sort((a, b) => a - b);
  const medianLuma = lumas[Math.floor(lumas.length / 2)] ?? 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of lit) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  r /= lit.length;
  g /= lit.length;
  b /= lit.length;
  if (r <= g + 4 || r <= b + 4) return "empty";
  if (medianLuma >= 88) return "locked";
  return "shown";
}

/**
 * Nameplate behind the printed hero name. Use `ally` for which team's column was sampled.
 */
export function plateFill(pixels: readonly Rgb[], ally = true): PlateFill {
  if (pixels.length === 0) return "empty";
  return ally ? allyPlateFill(pixels) : enemyPlateFill(pixels);
}

/** Share of pixels that are a lit, saturated color. Dark honeycomb scores near 0. */
export function colorfulFraction(pixels: readonly Rgb[]): number {
  if (pixels.length === 0) return 0;
  let colorful = 0;
  for (const pixel of pixels) {
    const max = Math.max(pixel.r, pixel.g, pixel.b);
    const min = Math.min(pixel.r, pixel.g, pixel.b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (lumaOf(pixel) > 35 && sat > 0.18) colorful += 1;
  }
  return colorful / pixels.length;
}

/**
 * Fast "something is in this hex" check for lobby detection. It is not used
 * to accept or reject a ban name — that is the face match.
 * The magenta banning arrow on draft lobby shrines.png scores about 0.28.
 */
export function banHexFilled(pixels: readonly Rgb[]): boolean {
  if (pixels.length < 20) return false;
  return colorfulFraction(pixels) > 0.29;
}

/**
 * A side slot with a locked portrait. Empty honeycomb on both reference lobbies
 * stays under 0.20. Locked faces, including the cooler enemy portraits, clear 0.30.
 */
export function portraitFilled(pixels: readonly Rgb[]): boolean {
  if (pixels.length < 20) return false;
  return colorfulFraction(pixels) >= 0.3;
}

const FACE_GRID = 4;

/**
 * Coarse color grid of a face, skipping the dark hex rim.
 * The same hero's draft portrait and in-game ban hex land near each other.
 */
export function faceSignature(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): number[] | null {
  if (width < FACE_GRID || height < FACE_GRID || pixels.length < width * height) return null;
  const sig: number[] = [];
  let used = 0;
  for (let cy = 0; cy < FACE_GRID; cy++) {
    for (let cx = 0; cx < FACE_GRID; cx++) {
      const x0 = Math.floor((cx * width) / FACE_GRID);
      const x1 = Math.floor(((cx + 1) * width) / FACE_GRID);
      const y0 = Math.floor((cy * height) / FACE_GRID);
      const y1 = Math.floor(((cy + 1) * height) / FACE_GRID);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const pixel = pixels[y * width + x];
          if (!pixel || lumaOf(pixel) < 28) continue;
          r += pixel.r;
          g += pixel.g;
          b += pixel.b;
          n += 1;
        }
      }
      if (n === 0) sig.push(0, 0, 0);
      else {
        used += n;
        sig.push(r / n / 255, g / n / 255, b / n / 255);
      }
    }
  }
  if (used < width * height * 0.12) return null;
  return sig;
}

export function faceDistance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / n;
}

/** Closest catalog face, when it is clearly nearer than the runner-up. */
export function nearestFace(
  sig: readonly number[],
  catalog: readonly { hero: string; sig: readonly number[] }[],
  maxDistance = 0.34,
): string | null {
  let best: { hero: string; dist: number } | null = null;
  let second = Infinity;
  for (const row of catalog) {
    const dist = faceDistance(sig, row.sig);
    if (!best || dist < best.dist) {
      second = best?.dist ?? Infinity;
      best = { hero: row.hero, dist };
    } else if (dist < second) second = dist;
  }
  if (!best || best.dist > maxDistance) return null;
  if (second - best.dist < 0.025) return null;
  return best.hero;
}

const PORTRAIT_SIZE = 18;

/**
 * Mean-centered face grid. The same draft portrait matches across frame sizes
 * because both sides are reduced to this grid before they are compared.
 */
export function portraitVector(
  pixels: readonly Rgb[],
  width: number,
  height: number,
): number[] | null {
  if (width < 8 || height < 8 || pixels.length < width * height) return null;
  const xStart = Math.floor(width * 0.12);
  const yStart = Math.floor(height * 0.08);
  const xEnd = Math.max(xStart + 1, Math.ceil(width * 0.88));
  const yEnd = Math.max(yStart + 1, Math.ceil(height * 0.78));
  const cropW = xEnd - xStart;
  const cropH = yEnd - yStart;
  const sample: number[] = [];
  for (let gy = 0; gy < PORTRAIT_SIZE; gy++) {
    const sy0 = yStart + Math.floor((gy * cropH) / PORTRAIT_SIZE);
    const sy1 = yStart + Math.max(1, Math.floor(((gy + 1) * cropH) / PORTRAIT_SIZE));
    for (let gx = 0; gx < PORTRAIT_SIZE; gx++) {
      const sx0 = xStart + Math.floor((gx * cropW) / PORTRAIT_SIZE);
      const sx1 = xStart + Math.max(1, Math.floor(((gx + 1) * cropW) / PORTRAIT_SIZE));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = sy0; y < sy1 && y < height; y++) {
        for (let x = sx0; x < sx1 && x < width; x++) {
          const pixel = pixels[y * width + x];
          if (!pixel) continue;
          r += pixel.r;
          g += pixel.g;
          b += pixel.b;
          n += 1;
        }
      }
      if (n === 0) sample.push(0, 0, 0);
      else sample.push(r / n / 255, g / n / 255, b / n / 255);
    }
  }
  const count = PORTRAIT_SIZE * PORTRAIT_SIZE;
  for (let channel = 0; channel < 3; channel++) {
    let mean = 0;
    for (let i = 0; i < count; i++) mean += sample[i * 3 + channel] ?? 0;
    mean /= count;
    for (let i = 0; i < count; i++) {
      sample[i * 3 + channel] = (sample[i * 3 + channel] ?? 0) - mean;
    }
  }
  let energy = 0;
  for (const value of sample) energy += value * value;
  if (energy < 0.05) return null;
  return sample;
}

export function portraitScore(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** The hero whose saved portrait is clearly this face. */
export function matchPortrait(
  query: readonly number[],
  examples: readonly { hero: string; vector: readonly number[] }[],
): string | null {
  const bestByHero = new Map<string, number>();
  for (const example of examples) {
    const score = portraitScore(query, example.vector);
    const prev = bestByHero.get(example.hero) ?? -1;
    if (score > prev) bestByHero.set(example.hero, score);
  }
  const ranked = [...bestByHero.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return null;
  const second = ranked[1]?.[1] ?? 0;
  if (top[1] < 0.84 || top[1] - second < 0.12) return null;
  return top[0];
}

/**
 * A named plate can become a few-shot example when it is a new view of that
 * hero and does not already look like someone else.
 */
export function acceptPortraitExample(
  vector: readonly number[],
  hero: string,
  examples: readonly { hero: string; vector: readonly number[] }[],
): boolean {
  const key = heroKey(hero);
  let same = -1;
  let other = -1;
  let seen = false;
  for (const example of examples) {
    const score = portraitScore(vector, example.vector);
    if (heroKey(example.hero) === key) {
      seen = true;
      if (score > same) same = score;
    } else if (score > other) other = score;
  }
  if (other >= 0.7) return false;
  if (same >= 0.92) return false;
  if (seen && same < 0.84) return false;
  return true;
}

/**
 * Left-to-right faces on one team's three hexes.
 * A filled hex with no match stays unnamed. An empty hex ends the row.
 * A name already read is kept when a later frame cannot see that face.
 */
export function bansFromHexFaces(
  identified: readonly (string | null)[],
  filled: readonly boolean[],
  previous: readonly string[],
  passed: readonly boolean[] = [],
): string[] {
  const next: string[] = [];
  const slotActive = (i: number) =>
    Boolean(identified[i]) || filled[i] || passed[i];
  for (let i = 0; i < 3; i++) {
    let hasLater = false;
    for (let j = i + 1; j < 3; j++) {
      if (slotActive(j)) hasLater = true;
    }
    const name = identified[i] ?? null;
    if (name) {
      next.push(name);
      continue;
    }
    if (passed[i]) {
      next.push(NO_BAN);
      continue;
    }
    if (filled[i]) {
      if (!hasLater && i === 2 && !name && !passed[i]) break;
      const was = previous[next.length] ?? previous[i];
      next.push(
        was && was !== UNSEEN_BAN && was !== NO_BAN ? was : UNSEEN_BAN,
      );
      continue;
    }
    if (hasLater) continue;
    const was = previous[next.length] ?? previous[i];
    if (was && was !== UNSEEN_BAN) {
      next.push(was);
      continue;
    }
    break;
  }
  return next;
}

/**
 * Keep a hero only when the plate behind that line is whitish.
 * A blue plate is being shown and is not a lock. Slot `top` is in the same
 * coordinate space as the OCR line.
 */
export function platesForLines(
  lines: readonly { text: string; top: number }[],
  slots: readonly { top: number; fill: PlateFill }[],
): { locked: (SlotLock & { slot: number | null })[]; shown: string[] } {
  const locks = locksFromOcrLines(lines);
  const used = new Set<number>();
  const locked: (SlotLock & { slot: number | null })[] = [];
  const shown: string[] = [];
  for (const lock of locks) {
    const line = lines.find((item) => {
      const hero = heroFromPlateText(item.text);
      return hero != null && heroKey(hero) === heroKey(lock.hero);
    });
    if (!line || slots.length === 0) {
      locked.push({ ...lock, slot: null });
      continue;
    }
    let best = -1;
    let bestDist = Infinity;
    slots.forEach((slot, index) => {
      if (used.has(index)) return;
      const dist = Math.abs(slot.top - line.top);
      if (dist < bestDist) {
        best = index;
        bestDist = dist;
      }
    });
    if (best < 0) continue;
    used.add(best);
    if (slots[best]?.fill === "shown") shown.push(lock.hero);
    else if (slots[best]?.fill === "locked") locked.push({ ...lock, slot: best });
  }
  return { locked, shown };
}

/**
 * A hero already registered as a lock stays registered.
 * A later frame that misses the portrait, or reads a covered plate as a hover,
 * does not take it off the board.
 */
export function dropShownLocks(
  locked: { heroes: string[]; players: (string | null)[] },
  _shown: readonly string[],
): { heroes: string[]; players: (string | null)[] } {
  return {
    heroes: [...locked.heroes],
    players: locked.heroes.map((_, index) => locked.players[index] ?? null),
  };
}

/**
 * One ban per filled top hex, up to three. A hex has no printed name, so a
 * ban we have not already named stays unseen and does not leave the hero pool.
 * A later frame that sees fewer faces does not erase bans already counted.
 */
export function bansFromFilledHexes(
  filledCount: number,
  previous: readonly string[],
  named: readonly string[] = [],
): string[] {
  const seen = Math.min(3, Math.max(0, Math.floor(filledCount)));
  const priorNamed = previous.filter((hero) => hero !== UNSEEN_BAN);
  const names = rememberHeroes(priorNamed, named, 3);
  const size = Math.min(3, Math.max(seen, previous.length, names.length));
  const next = [...names];
  while (next.length < size) next.push(UNSEEN_BAN);
  return next.slice(0, 3);
}

/** Status text for a ban or pick list that may include unnamed bans. */
export function draftHeroList(heroes: readonly string[]): string {
  const named = heroes.filter(
    (hero) => hero !== UNSEEN_BAN && hero !== NO_BAN,
  );
  const unseen = heroes.filter((hero) => hero === UNSEEN_BAN).length;
  const passes = heroes.filter((hero) => hero === NO_BAN).length;
  if (named.length === 0 && unseen === heroes.length) {
    return `${unseen} locked`;
  }
  if (named.length === 0 && passes > 0) {
    return passes === 1 ? "no ban" : `${passes} no ban`;
  }
  const tail: string[] = [];
  if (unseen > 0) tail.push(unseen === 1 ? "1 locked" : `${unseen} locked`);
  if (passes > 0) tail.push(passes === 1 ? "no ban" : `${passes} no ban`);
  if (named.length === 0) return tail.length ? tail.join(", ") : "—";
  if (tail.length === 0) return named.join(", ");
  return `${named.join(", ")}, ${tail.join(", ")}`;
}

/**
 * "Your Team" and "Waiting for Teammates" are our turn.
 * "Enemy Team" is theirs. This is whose turn, not which hero was banned.
 */
export function sideFromTeamSplash(text: string): "our" | "their" | null {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  if (tight.includes("yourteam") || tight.includes("waitingforteammates")) return "our";
  if (tight.includes("enemyteam")) return "their";
  return null;
}

export type EdgeSample = { luma: number; sat: number };

/**
 * A locked portrait has a bright rim. Allied locks glow blue and enemy locks
 * glow red, so a white-only check misses them. A pre-pick keeps a dark rim.
 * `edgeLumas` are 0–255 samples from the frame around one slot.
 */
export function borderLooksLocked(edgeLumas: readonly number[]): boolean {
  if (edgeLumas.length < 8) return false;
  const bright = edgeLumas.filter((n) => n >= 150).length / edgeLumas.length;
  const peak = edgeLumas.reduce((max, n) => (n > max ? n : max), 0);
  // A thin locked rim is enough. A dark pre-pick frame never gets there.
  return peak >= 175 && bright >= 0.05;
}

/**
 * Blue and red pixels on the ring just outside a portrait.
 * A locked ally glows blue and a locked enemy glows red. A white hover does not.
 */
export function portraitTeamRim(
  frameWidth: number,
  frameHeight: number,
  box: DraftBox,
  pixelAt: (x: number, y: number) => Rgb,
): { blue: number; red: number } {
  const x = Math.max(0, Math.round(box.x * frameWidth));
  const y = Math.max(0, Math.round(box.y * frameHeight));
  const w = Math.max(1, Math.min(frameWidth - x, Math.round(box.w * frameWidth)));
  const h = Math.max(1, Math.min(frameHeight - y, Math.round(box.h * frameHeight)));
  let blue = 0;
  let red = 0;
  const take = (px: number, py: number) => {
    const sx = Math.max(0, Math.min(frameWidth - 1, px));
    const sy = Math.max(0, Math.min(frameHeight - 1, py));
    const pixel = pixelAt(sx, sy);
    if (lumaOf(pixel) < 150) return;
    const { r, g, b } = pixel;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.22) return;
    if (b > r + 15 && b >= g) blue += 1;
    else if (r > b + 15 && r >= g) red += 1;
  };
  for (let px = x - 6; px < x + w + 6; px++) {
    take(px, y - 4);
    take(px, y - 3);
    take(px, y + h + 2);
    take(px, y + h + 3);
  }
  for (let py = y - 2; py < y + h + 2; py++) {
    take(x - 4, py);
    take(x - 3, py);
    take(x + w + 2, py);
    take(x + w + 3, py);
  }
  return { blue, red };
}

/**
 * A hero name plate with a light background is locked. A dark plate is a hover.
 * The enemy column has no hovers: fog of war hides what they are considering,
 * so a hero name printed on their plate is a lock in either phase.
 */
export function portraitIsLocked(args: {
  phase: "ban" | "pick" | null;
  faceFilled: boolean;
  /** @deprecated Rim glow is ignored; kept for older call sites. */
  teamRim?: { blue: number; red: number };
  plate?: PlateFill;
  ally?: boolean;
  /** OCR read a hero name on this nameplate. */
  heroOnPlate?: boolean;
  /** The slot banner still says PICKING — an ally hover, not a lock. */
  slotPicking?: boolean;
  /**
   * Kept for callers that still pass the second-ban flag. Plate color and the
   * enemy name decide the lock; this flag no longer overrides them.
   */
  keepCommitted?: boolean;
}): boolean {
  if (args.ally === false) return Boolean(args.heroOnPlate);
  if (args.slotPicking) return false;
  if (!args.heroOnPlate || !args.faceFilled) return false;
  return args.plate === "locked";
}

/**
 * Keep every pick that has already been registered.
 * `shown` is the heroes a later frame painted on a hover plate. Covering a
 * locked portrait can look like that. It does not erase the lock.
 */
export function pruneHoverPicks(
  prev: readonly string[],
  prevPlayers: readonly (string | null)[],
  _shown: readonly string[],
): { heroes: string[]; players: (string | null)[] } {
  return {
    heroes: [...prev],
    players: prev.map((_, index) => prevPlayers[index] ?? null),
  };
}

/** Same rule, plus a saturated blue or red rim that is bright but not white. */
export function borderLooksLockedSamples(samples: readonly EdgeSample[]): boolean {
  if (borderLooksLocked(samples.map((sample) => sample.luma))) return true;
  if (samples.length < 8) return false;
  const glow = samples.filter((sample) => sample.sat >= 0.42 && sample.luma >= 85);
  return glow.length / samples.length >= 0.035;
}

function asSlotLocks(
  bright: readonly (string | SlotLock)[],
): SlotLock[] {
  return bright.map((item) =>
    typeof item === "string" ? { hero: item, player: null } : item,
  );
}

/**
 * Heroes whose border just turned bright, in the order they were announced.
 * Slot order is only a fallback for a hero the center never named.
 * Each hero keeps the name printed under its portrait.
 */
function platePlayerKey(name: string): string {
  return name.trim().toLowerCase();
}

type SharedPlate = { hero: string; plate: PlateFill; slot: number };
type SharedRead = { hero: string | null };

function heroPlateState(
  hero: string,
  reads: readonly SharedRead[],
  slots: readonly SharedPlate[],
): "locked" | "open" | "absent" {
  const key = heroKey(hero);
  const plates: PlateFill[] = [];
  reads.forEach((read, index) => {
    if (!read.hero || heroKey(read.hero) !== key) return;
    const plate = slots.find((slot) => slot.slot === index)?.plate;
    if (plate) plates.push(plate);
  });
  for (const slot of slots) {
    if (heroKey(slot.hero) === key) plates.push(slot.plate);
  }
  if (plates.some((plate) => plate === "locked")) return "locked";
  if (plates.length > 0) return "open";
  return "absent";
}

function withoutHero(
  heroes: readonly string[],
  players: readonly (string | null)[],
  hero: string,
): { heroes: string[]; players: (string | null)[] } {
  const key = heroKey(hero);
  const nextHeroes: string[] = [];
  const nextPlayers: (string | null)[] = [];
  heroes.forEach((name, index) => {
    if (heroKey(name) === key) return;
    nextHeroes.push(name);
    nextPlayers.push(players[index] ?? null);
  });
  return { heroes: nextHeroes, players: nextPlayers };
}

/**
 * The same hero on both teams means one of the reads is a hover.
 * Look at the nameplates again. A highlighted plate is the lock.
 * A plate that is on screen and not highlighted is not.
 */
export function settleSharedPicks(args: {
  ourPicks: readonly string[];
  theirPicks: readonly string[];
  ourPlayers: readonly (string | null)[];
  theirPlayers: readonly (string | null)[];
  ourReads: readonly SharedRead[];
  theirReads: readonly SharedRead[];
  ourSlots: readonly SharedPlate[];
  theirSlots: readonly SharedPlate[];
}): {
  ourPicks: string[];
  theirPicks: string[];
  ourPlayers: (string | null)[];
  theirPlayers: (string | null)[];
} {
  let ourPicks = [...args.ourPicks];
  let theirPicks = [...args.theirPicks];
  let ourPlayers = args.ourPicks.map((_, index) => args.ourPlayers[index] ?? null);
  let theirPlayers = args.theirPicks.map((_, index) => args.theirPlayers[index] ?? null);
  const shared = ourPicks.filter((hero) =>
    theirPicks.some((other) => heroKey(other) === heroKey(hero)),
  );
  for (const hero of shared) {
    const ours = heroPlateState(hero, args.ourReads, args.ourSlots);
    const theirs = heroPlateState(hero, args.theirReads, args.theirSlots);
    if (ours === "locked" && theirs !== "locked") {
      const next = withoutHero(theirPicks, theirPlayers, hero);
      theirPicks = next.heroes;
      theirPlayers = next.players;
    } else if (theirs === "locked" && ours !== "locked") {
      const next = withoutHero(ourPicks, ourPlayers, hero);
      ourPicks = next.heroes;
      ourPlayers = next.players;
    } else if (ours === "open") {
      const next = withoutHero(ourPicks, ourPlayers, hero);
      ourPicks = next.heroes;
      ourPlayers = next.players;
      if (theirs === "open") {
        const other = withoutHero(theirPicks, theirPlayers, hero);
        theirPicks = other.heroes;
        theirPlayers = other.players;
      }
    } else if (theirs === "open") {
      const next = withoutHero(theirPicks, theirPlayers, hero);
      theirPicks = next.heroes;
      theirPlayers = next.players;
    }
  }
  return { ourPicks, theirPicks, ourPlayers, theirPlayers };
}

export function takeNewLocks(
  prev: readonly string[],
  brightInSlotOrder: readonly (string | SlotLock)[],
  announced: readonly string[],
  prevPlayers: readonly (string | null)[] = [],
): { heroes: string[]; players: (string | null)[] } {
  const bright = asSlotLocks(brightInSlotOrder);
  const playerByHero = new Map<string, string | null>();
  prev.forEach((hero, index) => {
    playerByHero.set(heroKey(hero), prevPlayers[index] ?? null);
  });
  // This frame's plate is the name under that hero. The same player cannot
  // stay on a second hero, and a later read replaces an earlier miss.
  const claimed = new Map<string, string>();
  for (const lock of bright) {
    if (!lock.player) continue;
    const pk = platePlayerKey(lock.player);
    if (!claimed.has(pk)) claimed.set(pk, heroKey(lock.hero));
  }
  for (const [hero, player] of playerByHero) {
    if (!player) continue;
    const owner = claimed.get(platePlayerKey(player));
    if (owner && owner !== hero) playerByHero.set(hero, null);
  }
  for (const lock of bright) {
    const key = heroKey(lock.hero);
    if (!lock.player) {
      if (!playerByHero.has(key)) playerByHero.set(key, null);
      continue;
    }
    if (claimed.get(platePlayerKey(lock.player)) !== key) continue;
    playerByHero.set(key, lock.player);
  }
  const have = new Set(prev.map((hero) => heroKey(hero)));
  const fresh = bright.filter((lock) => !have.has(heroKey(lock.hero)));
  const announcedAt = (hero: string) =>
    announced.findIndex((name) => heroKey(name) === heroKey(hero));
  const slotAt = (hero: string) =>
    bright.findIndex((lock) => heroKey(lock.hero) === heroKey(hero));
  const announcedFresh = fresh.filter((lock) => announcedAt(lock.hero) !== -1).length;
  fresh.sort((a, b) => {
    // One center splash is the hero on screen now, not the first lock of the
    // draft. Slot order stands until at least two heroes were announced.
    if (announcedFresh < 2) return slotAt(a.hero) - slotAt(b.hero);
    const ia = announcedAt(a.hero);
    const ib = announcedAt(b.hero);
    const ra = ia === -1 ? announced.length + slotAt(a.hero) : ia;
    const rb = ib === -1 ? announced.length + slotAt(b.hero) : ib;
    return ra - rb;
  });
  const heroes = rememberHeroes(
    prev,
    fresh.map((lock) => lock.hero),
    5,
  );
  return {
    heroes,
    players: heroes.map((hero) => playerByHero.get(heroKey(hero)) ?? null),
  };
}

function plateNorm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

let plateHeroes: { norm: string; hero: string }[] | null = null;

function plateHeroList(): { norm: string; hero: string }[] {
  if (plateHeroes) return plateHeroes;
  const byNorm = new Map<string, string>();
  for (const hero of allDraftHeroes()) {
    byNorm.set(plateNorm(hero), hero);
    const slug = heroDraftSlug(hero);
    if (slug) byNorm.set(plateNorm(slug), hero);
  }
  plateHeroes = [...byNorm.entries()].map(([norm, hero]) => ({ norm, hero }));
  return plateHeroes;
}

/** A hero label from one nameplate line, including titles like Xal'atath. */
export function heroFromPlateText(text: string): string | null {
  const joined = plateNorm(text);
  if (joined.length < 3) return null;
  const list = plateHeroList();
  const exact = list.find((hero) => hero.norm === joined);
  if (exact) return exact.hero;
  if (joined.length >= 5) {
    const near = list.filter(
      (hero) =>
        Math.abs(hero.norm.length - joined.length) <= 1 &&
        editDistance(hero.norm, joined) <= 1,
    );
    if (near.length === 1) return near[0].hero;
  }
  if (joined.length >= 6) {
    const prefix = list.filter((hero) => {
      const gap = Math.abs(hero.norm.length - joined.length);
      if (gap === 0 || gap > 2) return false;
      return hero.norm.startsWith(joined) || joined.startsWith(hero.norm);
    });
    if (prefix.length === 1) return prefix[0].hero;
  }
  for (const token of text.split(/[^A-Za-z0-9']+/)) {
    if (token.length < 3) continue;
    const hit = list.find((hero) => hero.norm === plateNorm(token));
    if (hit) return hit.hero;
  }
  // The slot crop clips the first letter: EORIC, ASSIA, DBIUS.
  const clipped = (token: string) => {
    const norm = plateNorm(token);
    if (norm.length < 5) return null;
    const hits = list.filter((hero) => {
      const extra = hero.norm.length - norm.length;
      return extra >= 1 && extra <= 2 && hero.norm.endsWith(norm);
    });
    return hits.length === 1 ? hits[0].hero : null;
  };
  const fromJoined = clipped(joined);
  if (fromJoined) return fromJoined;
  for (const token of text.split(/[^A-Za-z0-9']+/)) {
    const hit = clipped(token);
    if (hit) return hit;
  }
  return null;
}

/** Fold letters Tesseract swaps (i/l/1, o/0) so MsBelis27 matches MsBells27. */
export function ocrFold(name: string): string {
  return name
    .toLowerCase()
    .replace(/[il1|!]/g, "l")
    .replace(/[o0]/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * One player across a battletag suffix and an OCR slip.
 * HuckIt, Hucklt, and HuckIt#1686 are the same seat.
 */
export function playerFold(name: string | null | undefined): string {
  const base = name?.split("#")[0]?.trim() ?? "";
  return base ? ocrFold(base) : "";
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = next;
    }
  }
  return row[b.length];
}

/** Roster spelling when the read is the same name with an OCR slip. */
export function snapToRoster(name: string, roster: readonly string[]): string {
  const folded = ocrFold(name);
  if (!folded) return name;
  let closest: { base: string; dist: number } | null = null;
  for (const tag of roster) {
    const base = tag.split("#")[0]?.trim() || tag;
    const foldedTag = ocrFold(base);
    if (!foldedTag) continue;
    if (foldedTag === folded) return base;
    const dist = editDistance(foldedTag, folded);
    const limit = folded.length >= 8 ? 2 : 1;
    let shared = 0;
    while (shared < folded.length && shared < foldedTag.length && folded[shared] === foldedTag[shared]) {
      shared += 1;
    }
    const truncated =
      shared >= 6 &&
      Math.abs(foldedTag.length - folded.length) <= 3 &&
      shared >= Math.min(folded.length, foldedTag.length) - 1;
    if (
      folded.length >= 5 &&
      dist > 0 &&
      (dist <= limit || (truncated && dist <= 4)) &&
      (!closest || dist < closest.dist)
    ) {
      closest = { base, dist };
    }
  }
  return closest?.base ?? name;
}

/**
 * Center banner such as "RED PICK", "Juno Banning", or "Waiting for Enemy Ban".
 * "Banning" wins over a stray "pick" from chat or the hero browser.
 */
export function bannerTurn(text: string): {
  phase: "ban" | "pick" | null;
  color: "red" | "blue" | null;
} {
  const lower = text.toLowerCase();
  const tight = lower.replace(/[^a-z]/g, "");
  const banning =
    /\bbanning\b/.test(lower) ||
    tight.includes("banning") ||
    tight.includes("banned") ||
    /\bbanned\b/.test(lower) ||
    tight.includes("enemyban") ||
    tight.includes("teamban") ||
    tight.includes("waitingforenemyban");
  const picking = /\bpicking\b/.test(lower) || tight.includes("picking");
  let phase: "ban" | "pick" | null = null;
  if (banning && !picking) phase = "ban";
  else if (picking && !banning) phase = "pick";
  else if (banning && picking) {
    const banAt = lower.search(/banning|enemy ban/);
    const pickAt = lower.search(/picking/);
    phase = pickAt >= 0 && pickAt < banAt ? "pick" : "ban";
  } else if (
    tight.includes("redban") ||
    tight.includes("blueban") ||
    /(^|[^a-z])ban([^a-z]|$)/.test(lower)
  ) {
    phase = "ban";
  } else if (
    tight.includes("redpick") ||
    tight.includes("bluepick") ||
    /(^|[^a-z])pick([^a-z]|$)/.test(lower)
  ) {
    phase = "pick";
  }
  if (
    !phase &&
    (tight.includes("waitingforteammates") || /\bwaiting for teammates\b/.test(lower))
  ) {
    phase = "pick";
  }
  if (
    !phase &&
    /\bwaiting for enemy\b/.test(lower) &&
    !/\bwaiting for enemy ban\b/.test(lower) &&
    !tight.includes("enemyban") &&
    !tight.includes("teamban")
  ) {
    phase = "pick";
  }
  if (
    !phase &&
    (tight.includes("lockin") ||
      tight.includes("lockiny") ||
      tight.includes("locking"))
  ) {
    phase = "pick";
  }
  const color = tight.includes("red") ? "red" : tight.includes("blue") ? "blue" : null;
  return { phase, color };
}

/** Heroes already printed on the side slots are locked picks, whatever the banner says. */
export function slotsHoldPicks(lockedHeroes: number): boolean {
  return lockedHeroes > 0;
}

/**
 * Who owns the hero on the center ban splash.
 * HuckIt's team is us, and that team is the left column. "Waiting for Enemy
 * Ban" means their turn is now, so a hero already marked BANNED was locked by us.
 * An unknown splash is not given to them.
 */
export function shownBanSide(args: {
  center: string;
  status: string;
  player: string | null;
  ourNames: readonly string[];
  theirNames: readonly string[];
}): "our" | "their" | null {
  const fold = (name: string) => ocrFold(name.split("#")[0] ?? name);
  const ours = new Set(args.ourNames.map(fold));
  ours.add(fold("HuckIt"));
  const theirs = new Set(args.theirNames.map(fold));
  if (args.player) {
    const who = fold(args.player);
    if (ours.has(who)) return "our";
    if (theirs.has(who)) return "their";
  }
  const blob = `${args.center}\n${args.status}`.toLowerCase();
  const waitingOnEnemy = /waiting for enemy ban/.test(blob);
  const locked = /\bbanned\b/.test(blob);
  const choosing = /\bbanning\b/.test(blob);
  if (waitingOnEnemy && locked && !choosing) return "our";
  if (waitingOnEnemy && choosing && !locked) return "their";
  return null;
}

/**
 * The big "BLUE BAN" / "RED BAN" card. Heroes painted on the side plates
 * during that card are showcases, not locks.
 */
export function openingTeamBanCard(text: string): boolean {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  return tight.includes("blueban") || tight.includes("redban");
}

/**
 * A ban frame after picks can already be on the board. The opening team-color
 * card is excluded so those showcases stay off the pick list.
 */
export function banFrameKeepsLockedPicks(text: string): boolean {
  return bannerTurn(text).phase === "ban" && !openingTeamBanCard(text);
}

/**
 * Who bans first, from the bottom pill, before any hero is locked.
 * "Waiting for Enemy Ban..." is their turn. Anything else is still unknown.
 */
export function firstBanSideFromStatus(text: string): "us" | "them" | null {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  if (tight.includes("waitingforenemyban")) return "them";
  if (tight.includes("waitingforteamban")) return "us";
  return null;
}

/**
 * Whose turn the bottom pill is describing, bans or picks.
 * "Waiting for Team Ban..." and "Waiting for Teammates..." are us.
 * "Waiting for Enemy..." is them.
 */
export function sideFromStatus(text: string): "our" | "their" | null {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  if (tight.includes("waitingforenemy")) return "their";
  if (tight.includes("waitingforteam")) return "our";
  return null;
}

/**
 * Whose turn the ban splash is describing.
 * "Waiting for Enemy Ban" plus "Banning" is their hover. The same pill plus
 * "Banned" is the ban we just locked.
 */
export function banSideFromSplash(text: string): "our" | "their" | null {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  const enemy = tight.includes("waitingforenemyban") || tight.includes("enemyban");
  const choosing = tight.includes("banning");
  const locked = tight.includes("banned");
  if (enemy && locked && !choosing) return "our";
  if (enemy && (choosing || !locked)) return "their";
  return null;
}

/**
 * A hero painted on a side plate during bans is a showcase, not a lock.
 * Picks start only after a pick splash, and they pause again on the second ban round.
 */
export function acceptPlatePicks(args: { banPhase: boolean; picksStarted: boolean }): boolean {
  return args.picksStarted && !args.banPhase;
}

/**
 * Heroes already locked on the name plates count even when the center banner
 * has not said "pick". "Waiting for Enemy..." is that case. The opening
 * team-color ban card is the exception: those side portraits are showcases.
 */
export function acceptLockedPlates(args: {
  lockedCount: number;
  lockPhase: "ban" | "pick" | null;
  keepCommitted: boolean;
}): boolean {
  if (!slotsHoldPicks(args.lockedCount)) return false;
  if (args.lockPhase === "ban") return args.keepCommitted;
  return true;
}

/**
 * Plate lock rules follow the pick phase once real picks are on the board,
 * even when the center banner has moved into the second ban round.
 */
export function plateLockPhase(args: {
  bannerPhase: "ban" | "pick" | null;
  picksStarted: boolean;
  priorLockedPicks: number;
}): "ban" | "pick" | null {
  if (args.bannerPhase === "pick") return "pick";
  if (
    args.bannerPhase === "ban" &&
    args.picksStarted &&
    args.priorLockedPicks > 0
  ) {
    return "pick";
  }
  if (args.bannerPhase === "ban") return "ban";
  return args.bannerPhase;
}

/** Whose ban is still open, once we know who went first. */
export function nextBanSide(
  weFirst: boolean,
  ourBans: number,
  theirBans: number,
): "our" | "their" | null {
  let our = 0;
  let their = 0;
  for (const step of DRAFT_ORDER) {
    if (step.kind !== "ban") continue;
    const side = (step.side === "fp") === weFirst ? "our" : "their";
    const filled = side === "our" ? our < ourBans : their < theirBans;
    if (!filled) return side;
    if (side === "our") our += 1;
    else their += 1;
  }
  return null;
}

/** Blue is the left column, red is the right. Us is the left column. */
export function sideFromBannerColor(
  color: "red" | "blue",
  usOnLeft: boolean,
): "our" | "their" {
  const bannerOnLeft = color === "blue";
  return bannerOnLeft === usOnLeft ? "our" : "their";
}

export function mapFromTitle(text: string): string | null {
  const folded = plateNorm(text);
  if (folded.length < 6) return null;
  if (folded.includes("battlefield") && folded.includes("eternity")) {
    return "Battlefield of Eternity";
  }
  if (
    (folded.includes("alterac") || folded.includes("altera")) &&
    folded.includes("pass")
  ) {
    return "Alterac Pass";
  }
  if (folded.includes("haunted") && folded.includes("mines")) {
    return "Haunted Mines";
  }
  for (const map of NGS_MAP_POOL) {
    const norm = plateNorm(map.name);
    if (folded.includes(norm)) return map.name;
  }
  return null;
}

/** The play menu, queue, or collection screen — not a hero draft. */
export function menuScreenSeen(text: string): boolean {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  return (
    tight.includes("searching") ||
    tight.includes("quickmatch") ||
    tight.includes("cancelsearch") ||
    tight.includes("customgame") ||
    tight.includes("versusai") ||
    tight.includes("collection") ||
    (tight.includes("stormleague") && tight.includes("season"))
  );
}

/**
 * A draft lobby, from the map title or the ban/pick banner.
 * A stray "pick" or "ban" from menu noise is not enough.
 */
export function draftLobbySeen(text: string): boolean {
  if (menuScreenSeen(text)) return false;
  if (mapFromTitle(text)) return true;
  const lower = text.toLowerCase();
  const tight = lower.replace(/[^a-z]/g, "");
  if (/\bbanning\b/.test(lower) || tight.includes("banning")) return true;
  if (/\bpicking\b/.test(lower) || tight.includes("picking")) return true;
  if (/\bbanned\b/.test(lower) || tight.includes("banned")) return true;
  if (tight.includes("waitingforenemy") || tight.includes("waitingforteammates")) return true;
  if (
    tight.includes("redpick") ||
    tight.includes("bluepick") ||
    tight.includes("redban") ||
    tight.includes("blueban")
  ) {
    return true;
  }
  if (
    (tight.includes("bana") && tight.includes("hero")) ||
    (tight.includes("picka") && tight.includes("hero")) ||
    tight.includes("youpick") ||
    tight.includes("draft")
  ) {
    return true;
  }
  return false;
}

/**
 * `wait` until a draft banner or map is on screen. Stay in the draft if a
 * later frame is unreadable, and leave when the play menu comes back.
 */
export function watchPhase(
  text: string,
  alreadyInDraft: boolean,
): "draft" | "menu" | "wait" {
  if (menuScreenSeen(text)) return "menu";
  if (draftLobbySeen(text) || alreadyInDraft) return "draft";
  return "wait";
}

/**
 * Cheap vision check before Tesseract / name OCR. Map title text, locked
 * bans, or passed ban slots mean the draft chrome is probably on screen.
 */
export function draftLobbyLikelyOnFrame(args: {
  /** Share of map-title pixels brighter than menu chrome (0–1). */
  titleBrightShare: number;
  banSlots: readonly { filled: boolean; passed: boolean }[];
}): boolean {
  if (args.titleBrightShare >= 0.04) return true;
  return args.banSlots.some((slot) => slot.filled || slot.passed);
}

function liveDraftSlotFilled(hero: string): boolean {
  return Boolean(hero && hero !== UNSEEN_BAN);
}

/** All six bans and ten picks read from the screen (matches scout “draft complete”). */
export function liveDraftBoardFull(draft: LiveDraft): boolean {
  const picks =
    draft.ourPicks.filter(liveDraftSlotFilled).length === 5 &&
    draft.theirPicks.filter(liveDraftSlotFilled).length === 5;
  if (draft.sealed && picks) return true;
  return (
    picks &&
    draft.ourBans.filter(liveDraftSlotFilled).length === 3 &&
    draft.theirBans.filter(liveDraftSlotFilled).length === 3
  );
}

function nameOnRoster(name: string, roster: readonly string[]): boolean {
  const folded = ocrFold(name);
  if (!folded) return false;
  return roster.some((tag) => ocrFold(tag.split("#")[0]?.trim() ?? tag) === folded);
}

export function turnFromOcr(text: string, roster: readonly string[]): TurnRead {
  let player: string | null = null;
  let hero: string | null = null;
  for (const line of text.split(/\n+/)) {
    const fold = line.trim().toLowerCase();
    if (!fold) continue;
    const heroHit = heroFromPlateText(line);
    if (heroHit) {
      hero = heroHit;
      continue;
    }
    const name = nameFromPlate(line);
    if (!name) continue;
    const snapped = snapToRoster(name, roster);
    if (roster.length > 0 && !nameOnRoster(snapped, roster)) continue;
    player = snapped;
  }
  return { player, phase: bannerTurn(text).phase, hero };
}

/**
 * When the announced player or phase changes, the previous ban (if a hero was
 * showing) has locked. Picks are read from the side plates instead.
 */
export function nextTurn(
  open: OpenTurn | null,
  read: TurnRead,
  sideOf: (player: string) => "our" | "their" | null,
  fallbackSide: "our" | "their" | null = null,
): { open: OpenTurn | null; ban: { side: "our" | "their"; hero: string } | null } {
  if (!read.phase) return { open, ban: null };
  const side = (read.player ? sideOf(read.player) : null) ?? fallbackSide;
  if (!side || (!read.player && !read.hero)) return { open, ban: null };
  const same =
    open &&
    open.phase === read.phase &&
    (read.player
      ? ocrFold(open.player) === ocrFold(read.player)
      : Boolean(read.hero && open.hero && heroKey(open.hero) === heroKey(read.hero)));
  if (!same) {
    const ban =
      open && open.phase === "ban" && open.hero
        ? { side: open.side, hero: open.hero }
        : null;
    return {
      ban,
      open: {
        player: read.player ?? "",
        phase: read.phase,
        hero: read.hero,
        side,
      },
    };
  }
  return { ban: null, open: { ...open, hero: read.hero ?? open.hero } };
}

export function ourSideIsLeft(
  left: readonly string[],
  right: readonly string[],
  ourNames: readonly string[],
): boolean {
  const ours = new Set(ourNames.map((name) => ocrFold(name.split("#")[0] ?? name)));
  const hits = (names: readonly string[]) =>
    names.filter((name) => ours.has(ocrFold(name))).length;
  return hits(left) >= hits(right);
}

export function draftStepSide(
  step: { side: "fp" | "sp" },
  weFirst: boolean,
): "our" | "their" {
  return (step.side === "fp") === weFirst ? "our" : "their";
}

function draftSide(
  step: { side: "fp" | "sp" },
  weFirst: boolean,
): "our" | "their" {
  return draftStepSide(step, weFirst);
}

/**
 * Whose turn the side plates and open seats describe. PICKING on one column
 * beats a draft-order guess from lock counts alone.
 */
export function resolveLiveTurn(args: {
  phase: "ban" | "pick" | null;
  leftPicking: boolean;
  rightPicking: boolean;
  usOnLeft: boolean;
  bannerSide: "our" | "their" | null;
  openTurn: OpenTurn | null;
  ourOpenPlayers: readonly string[];
  theirOpenPlayers: readonly string[];
}): LiveTurn | null {
  if (!args.phase) return null;
  const fromColumns = firstPickFromPickingSlots({
    leftPicking: args.leftPicking,
    rightPicking: args.rightPicking,
    usOnLeft: args.usOnLeft,
  });
  if (fromColumns) {
    return {
      side: fromColumns === "us" ? "our" : "their",
      kind: args.phase,
    };
  }
  if (args.openTurn && args.openTurn.phase === args.phase) {
    return { side: args.openTurn.side, kind: args.openTurn.phase };
  }
  if (args.phase === "pick") {
    if (args.theirOpenPlayers.length > 0 && args.ourOpenPlayers.length === 0) {
      return { side: "their", kind: "pick" };
    }
    if (args.ourOpenPlayers.length > 0 && args.theirOpenPlayers.length === 0) {
      return { side: "our", kind: "pick" };
    }
  }
  if (args.bannerSide) {
    return { side: args.bannerSide, kind: args.phase };
  }
  return null;
}

/** Next step in draft order that belongs to us, at or after `completedSteps`. */
export function nextOurStepIndex(
  completedSteps: number,
  weFirst: boolean,
): number | null {
  for (let i = completedSteps; i < DRAFT_ORDER.length; i++) {
    const step = DRAFT_ORDER[i];
    if (draftStepSide(step, weFirst) === "our") return i;
  }
  return null;
}

/** Draft step index that matches what the screen says is open. */
export function watchStepIndexForTurn(
  completedSteps: number,
  weFirst: boolean,
  turn: LiveTurn,
): number {
  for (let i = completedSteps; i < DRAFT_ORDER.length; i++) {
    const step = DRAFT_ORDER[i];
    if (step.kind !== turn.kind) continue;
    if (draftStepSide(step, weFirst) === turn.side) return i;
  }
  for (let i = Math.max(0, completedSteps - 1); i < completedSteps; i++) {
    const step = DRAFT_ORDER[i];
    if (step.kind !== turn.kind) continue;
    if (draftStepSide(step, weFirst) === turn.side) return i;
  }
  return completedSteps;
}

/** True when these lock counts can happen if `weFirst` picked first. */
function banActionsFit(
  weFirst: boolean,
  ourBans: readonly string[],
  theirBans: readonly string[],
): number {
  const actions = actionsFromObserved({
    weFirst,
    firstPick: weFirst ? "us" : "them",
    phase: "ban",
    map: null,
    ourBans: [...ourBans],
    theirBans: [...theirBans],
    ourPicks: [],
    theirPicks: [],
    ourPickPlayers: [],
    theirPickPlayers: [],
  });
  let fit = 0;
  for (const action of actions) {
    if (action.kind !== "ban") break;
    if (action.hero === UNSEEN_BAN) continue;
    const list = action.side === "our" ? ourBans : theirBans;
    if (list.includes(action.hero) || (action.hero === NO_BAN && list.includes(NO_BAN))) {
      fit += 1;
    }
  }
  return fit;
}

function draftFitScore(draft: LiveDraft, weFirst: boolean): number {
  const actions = actionsFromObserved({
    ...draft,
    weFirst,
    firstPick: weFirst ? "us" : "them",
  });
  return actions.filter(
    (action) =>
      action.hero &&
      action.hero !== UNSEEN_BAN &&
      action.hero !== NO_BAN,
  ).length;
}

function observedActionsLength(draft: LiveDraft, weFirst: boolean): number {
  return actionsFromObserved({
    ...draft,
    weFirst,
    firstPick: weFirst ? "us" : "them",
  }).length;
}

function draftSequenceFit(draft: LiveDraft, weFirst: boolean): number {
  const actions = actionsFromObserved({
    ...draft,
    weFirst,
    firstPick: weFirst ? "us" : "them",
  });
  const cursor = {
    our: { ban: 0, pick: 0 },
    their: { ban: 0, pick: 0 },
  };
  const lists = {
    our: { ban: draft.ourBans, pick: draft.ourPicks },
    their: { ban: draft.theirBans, pick: draft.theirPicks },
  };
  let fit = 0;
  for (const action of actions) {
    if (
      !action.hero ||
      action.hero === UNSEEN_BAN ||
      action.hero === NO_BAN
    ) {
      continue;
    }
    const idx = cursor[action.side][action.kind];
    const expected = lists[action.side][action.kind][idx];
    if (expected && heroKey(expected) === heroKey(action.hero)) {
      fit += 1;
      cursor[action.side][action.kind] += 1;
    }
  }
  return fit;
}

function pickOrderSlotBonus(
  draft: LiveDraft & {
    ourPickSlots?: readonly number[];
    theirPickSlots?: readonly number[];
  },
  weFirst: boolean,
): number {
  const actions = actionsFromObserved({
    ...draft,
    weFirst,
    firstPick: weFirst ? "us" : "them",
  });
  const ourOrder = actions
    .filter((action) => action.kind === "pick" && action.side === "our")
    .map((action) => action.hero)
    .filter(Boolean) as string[];
  const theirOrder = actions
    .filter((action) => action.kind === "pick" && action.side === "their")
    .map((action) => action.hero)
    .filter(Boolean) as string[];
  const ourSlots = new Map(
    draft.ourPicks.map((hero, index) => [
      heroKey(hero),
      draft.ourPickSlots?.[index] ?? index,
    ]),
  );
  const theirSlots = new Map(
    draft.theirPicks.map((hero, index) => [
      heroKey(hero),
      draft.theirPickSlots?.[index] ?? index,
    ]),
  );
  return (
    slotChronologyBonus(ourOrder, ourSlots, "our") +
    slotChronologyBonus(theirOrder, theirSlots, "their")
  );
}

function resolveFirstPickAmbiguous(
  draft: LiveDraft & {
    ourPickSlots?: readonly number[];
    theirPickSlots?: readonly number[];
  },
): "us" | "them" | null {
  const usObs = scoreObservedDraftActions({
    ...draft,
    weFirst: true,
    firstPick: "us",
  });
  const themObs = scoreObservedDraftActions({
    ...draft,
    weFirst: false,
    firstPick: "them",
  });
  if (usObs !== themObs) return usObs > themObs ? "us" : "them";
  const usBan = banActionsFit(true, draft.ourBans, draft.theirBans);
  const themBan = banActionsFit(false, draft.ourBans, draft.theirBans);
  if (usBan !== themBan) return usBan > themBan ? "us" : "them";
  const usLen = observedActionsLength(draft, true);
  const themLen = observedActionsLength(draft, false);
  if (usLen !== themLen) return usLen > themLen ? "us" : "them";
  const usSeq = draftSequenceFit(draft, true);
  const themSeq = draftSequenceFit(draft, false);
  if (usSeq !== themSeq) return usSeq > themSeq ? "us" : "them";
  const usSlot = pickOrderSlotBonus(draft, true);
  const themSlot = pickOrderSlotBonus(draft, false);
  if (usSlot !== themSlot) return usSlot > themSlot ? "us" : "them";
  const usScore = draftFitScore(draft, true);
  const themScore = draftFitScore(draft, false);
  if (usScore !== themScore) return usScore > themScore ? "us" : "them";
  return null;
}

/**
 * Who had first pick — bans, pick counts, live turn, and draft-order fit.
 * No waiting for a fresh opening frame when the board already shows progress.
 */
export function resolveFirstPick(
  draft: Pick<
    LiveDraft,
    | "firstPick"
    | "ourBans"
    | "theirBans"
    | "ourPicks"
    | "theirPicks"
    | "phase"
    | "turn"
  > & {
    ourPickSlots?: readonly number[];
    theirPickSlots?: readonly number[];
  },
): "us" | "them" | null {
  const turnSide = draft.turn?.side ?? null;
  const phase = draft.phase;
  const ourPicks = draft.ourPicks?.length ?? 0;
  const theirPicks = draft.theirPicks?.length ?? 0;

  if (ourPicks + theirPicks > 0) {
    const usFits = pickCountsFit(true, ourPicks, theirPicks);
    const themFits = pickCountsFit(false, ourPicks, theirPicks);
    if (usFits && !themFits) return "us";
    if (themFits && !usFits) return "them";
    const inferred = inferFirstPick({
      ourPicks,
      theirPicks,
      phase,
      turnSide,
    });
    if (inferred) return inferred;
    if (usFits && themFits) {
      const resolved = resolveFirstPickAmbiguous(draft as LiveDraft);
      if (resolved) return resolved;
      if (ourPicks === 5 && theirPicks === 5) return "us";
    }
    // Two of their locks before we have one cannot happen on either side.
    // A ban-board guess must not keep that board.
    if (!usFits && !themFits) return null;
  }

  if (
    phase === "ban" &&
    turnSide &&
    draft.ourBans.length === 2 &&
    draft.theirBans.length === 2
  ) {
    // Tied opening bans: whoever is banning now is second pick.
    return turnSide === "our" ? "them" : "us";
  }

  if (phase === "pick" && turnSide && ourPicks + theirPicks === 0) {
    // After opening bans, the team on the banner has first pick.
    return turnSide === "our" ? "us" : "them";
  }

  if (phase && turnSide) {
    for (const fp of ["us", "them"] as const) {
      const weFirst = fp === "us";
      const progress = progressFromObserved({
        ...(draft as LiveDraft),
        weFirst,
        firstPick: fp,
      });
      if (
        progress.next?.side === turnSide &&
        progress.next?.kind === phase
      ) {
        return fp;
      }
    }
  }

  if (draft.firstPick) return draft.firstPick;

  const fromBoard = firstPickFromBanBoard(draft.ourBans, draft.theirBans, {
    phase,
  });
  if (fromBoard) return fromBoard;

  const resolved = resolveFirstPickAmbiguous(draft as LiveDraft);
  if (resolved) return resolved;

  const usScore = draftFitScore(draft as LiveDraft, true);
  const themScore = draftFitScore(draft as LiveDraft, false);
  if (usScore > themScore) return "us";
  if (themScore > usScore) return "them";

  return null;
}

/** True when bans or picks are on screen — enough to line up draft order. */
export function observedDraftHasProgress(
  draft: Pick<
    LiveDraft,
    "ourBans" | "theirBans" | "ourPicks" | "theirPicks"
  > | null,
): boolean {
  if (!draft) return false;
  return (
    draft.ourBans.length +
      draft.theirBans.length +
      draft.ourPicks.length +
      draft.theirPicks.length >
    0
  );
}

/** Whether the UI can show draft order and steps (not "waiting for first ban"). */
export function isDraftSideKnown(
  draft: LiveDraft | null,
): boolean {
  if (!draft) return false;
  const our = draft.ourPicks.length;
  const their = draft.theirPicks.length;
  if (
    our + their > 0 &&
    !pickCountsFit(true, our, their) &&
    !pickCountsFit(false, our, their)
  ) {
    return false;
  }
  if (resolveFirstPick(draft)) return true;
  if (!observedDraftHasProgress(draft)) return false;
  const usScore = draftFitScore(draft, true);
  const themScore = draftFitScore(draft, false);
  return usScore !== themScore || usScore + themScore >= 4;
}

export function guessWeFirst(draft: LiveDraft | null): boolean {
  if (!draft) return true;
  const fp = resolveFirstPick(draft);
  if (fp) return fp === "us";
  const usScore = draftFitScore(draft, true);
  const themScore = draftFitScore(draft, false);
  if (usScore !== themScore) return usScore > themScore;
  return true;
}

/** Pinned first pick, or who the ban row says went first when picks are still ambiguous. */
export function firstPickFromObservedBoard(
  draft: Pick<
    LiveDraft,
    | "firstPick"
    | "ourBans"
    | "theirBans"
    | "ourPicks"
    | "theirPicks"
    | "phase"
    | "turn"
  >,
): "us" | "them" | null {
  return resolveFirstPick(draft);
}

/** Who picked first, from how opening bans line up on the hex row. */
export function firstPickFromBanBoard(
  ourBans: readonly string[],
  theirBans: readonly string[],
  opts?: { phase?: "ban" | "pick" | null },
): "us" | "them" | null {
  const usFit = banActionsFit(true, ourBans, theirBans);
  const themFit = banActionsFit(false, ourBans, theirBans);
  if (usFit > themFit) {
    if (
      opts?.phase === "pick" &&
      theirBans.length < ourBans.length
    ) {
      return "them";
    }
    return "us";
  }
  if (themFit > usFit) {
    if (
      opts?.phase === "pick" &&
      ourBans.length < theirBans.length
    ) {
      return "us";
    }
    return "them";
  }
  if (usFit === 0) return null;
  const usOpen = actionsFromObserved({
    weFirst: true,
    firstPick: "us",
    phase: "ban",
    map: null,
    ourBans: [...ourBans],
    theirBans: [...theirBans],
    ourPicks: [],
    theirPicks: [],
    ourPickPlayers: [],
    theirPickPlayers: [],
  })[0];
  const themOpen = actionsFromObserved({
    weFirst: false,
    firstPick: "them",
    phase: "ban",
    map: null,
    ourBans: [...ourBans],
    theirBans: [...theirBans],
    ourPicks: [],
    theirPicks: [],
    ourPickPlayers: [],
    theirPickPlayers: [],
  })[0];
  if (usOpen?.kind === "ban" && themOpen?.kind === "ban") {
    if (usOpen.hero === NO_BAN && usOpen.side === "our") {
      return "us";
    }
    if (themOpen.hero === NO_BAN && themOpen.side === "their") {
      return "them";
    }
    if (
      usOpen.hero === NO_BAN &&
      themOpen.hero !== NO_BAN &&
      themOpen.hero !== UNSEEN_BAN
    ) {
      return "them";
    }
    if (
      themOpen.hero === NO_BAN &&
      usOpen.hero !== NO_BAN &&
      usOpen.hero !== UNSEEN_BAN
    ) {
      return "us";
    }
    if (usFit === themFit) return null;
    if (usOpen.side === "our" && usOpen.hero === ourBans[0]) {
      return "us";
    }
    if (themOpen.side === "their" && themOpen.hero === theirBans[0]) {
      return "them";
    }
  }
  return null;
}

export function pickCountsFit(
  weFirst: boolean,
  ourPicks: number,
  theirPicks: number,
): boolean {
  let our = 0;
  let their = 0;
  for (const step of DRAFT_ORDER) {
    if (step.kind !== "pick") continue;
    const side = draftSide(step, weFirst);
    const left = side === "our" ? ourPicks - our : theirPicks - their;
    const other = side === "our" ? theirPicks - their : ourPicks - our;
    if (left <= 0) return other === 0;
    if (side === "our") our += 1;
    else their += 1;
    if (our === ourPicks && their === theirPicks) return true;
  }
  return our === ourPicks && their === theirPicks;
}

function picksBefore(stepIndex: number): number {
  let count = 0;
  for (let i = 0; i < stepIndex; i++) {
    if (DRAFT_ORDER[i].kind === "pick") count += 1;
  }
  return count;
}

/**
 * A ban round is already over when a later pick is on screen, or when every
 * pick that comes before it is locked and the client is on a pick.
 */
function banAlreadyPassed(
  stepIndex: number,
  observedPicks: number,
  phase: "ban" | "pick" | null,
): boolean {
  const before = picksBefore(stepIndex);
  if (observedPicks > before) return true;
  return observedPicks === before && phase === "pick";
}

function nextOpenStep(
  weFirst: boolean,
  ourPicks: number,
  theirPicks: number,
  phase: "ban" | "pick" | null,
): { side: "our" | "their"; kind: "ban" | "pick" } | null {
  let our = 0;
  let their = 0;
  const observed = ourPicks + theirPicks;
  for (let stepIndex = 0; stepIndex < DRAFT_ORDER.length; stepIndex++) {
    const step = DRAFT_ORDER[stepIndex];
    const side = draftSide(step, weFirst);
    if (step.kind === "pick") {
      const left = side === "our" ? ourPicks - our : theirPicks - their;
      if (left <= 0) return { side, kind: "pick" };
      if (side === "our") our += 1;
      else their += 1;
      continue;
    }
    if (banAlreadyPassed(stepIndex, observed, phase)) continue;
    return { side, kind: "ban" };
  }
  return null;
}

/**
 * Who went first, from the locks already on screen.
 * Counts that only one side of the order can produce win. A tie uses whose
 * turn the banner shows.
 */
export function inferFirstPick(args: {
  ourPicks: number;
  theirPicks: number;
  phase: "ban" | "pick" | null;
  turnSide: "our" | "their" | null;
}): "us" | "them" | null {
  if (args.ourPicks + args.theirPicks === 0) return null;
  const us = pickCountsFit(true, args.ourPicks, args.theirPicks);
  const them = pickCountsFit(false, args.ourPicks, args.theirPicks);
  if (us && !them) return "us";
  if (them && !us) return "them";
  if (!us || !them || !args.turnSide || !args.phase) return null;
  const usNext = nextOpenStep(true, args.ourPicks, args.theirPicks, args.phase);
  const themNext = nextOpenStep(false, args.ourPicks, args.theirPicks, args.phase);
  const usMatch = usNext?.side === args.turnSide && usNext.kind === args.phase;
  const themMatch = themNext?.side === args.turnSide && themNext.kind === args.phase;
  if (usMatch && !themMatch) return "us";
  if (themMatch && !usMatch) return "them";
  return null;
}

/**
 * Bans and picks in draft order.
 * A ban the screen has already moved past is marked unseen so the board can
 * reach the current step. Unknown bans stay in the hero pool.
 */
function permutePickRows(
  heroes: readonly string[],
  players: readonly (string | null)[],
): { heroes: string[]; players: (string | null)[] }[] {
  if (heroes.length <= 1) {
    return [{ heroes: [...heroes], players: [...players] }];
  }
  const out: { heroes: string[]; players: (string | null)[] }[] = [];
  for (let i = 0; i < heroes.length; i++) {
    const hero = heroes[i];
    const player = players[i] ?? null;
    const restHeroes = heroes.filter((_, index) => index !== i);
    const restPlayers = players.filter((_, index) => index !== i);
    for (const sub of permutePickRows(restHeroes, restPlayers)) {
      out.push({ heroes: [hero, ...sub.heroes], players: [player, ...sub.players] });
    }
  }
  return out;
}

function scoreObservedDraftActions(draft: LiveDraft & { weFirst: boolean }): number {
  const actions = actionsFromObserved(draft);
  let score = 0;
  for (const action of actions) {
    const named =
      action.hero &&
      action.hero !== UNSEEN_BAN &&
      action.hero !== NO_BAN;
    if (named) score += 3;
    else if (action.hero === UNSEEN_BAN) score -= 2;
  }
  return score;
}

export function pickSlotsFromPlateLocks(
  heroes: readonly string[],
  locks: readonly { hero: string; slot: number | null }[],
): number[] {
  return heroes.map((hero) => {
    const lock = locks.find((row) => heroKey(row.hero) === heroKey(hero));
    return lock?.slot ?? 0;
  });
}

function slotChronologyBonus(
  permutedHeroes: readonly string[],
  heroToSlot: ReadonlyMap<string, number>,
  side: "our" | "their",
): number {
  const slots = permutedHeroes.map((hero) => heroToSlot.get(heroKey(hero)) ?? 0);
  const sorted = [...slots].sort((a, b) => (side === "their" ? b - a : a - b));
  let bonus = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === sorted[i]) bonus += 2;
  }
  return bonus;
}

/**
 * Portrait slots are not chronological — try pick permutations so
 * `actionsFromObserved` does not place second-round bans after picks.
 */
export function fitObservedPickOrder(
  draft: LiveDraft & { weFirst: boolean },
  slots?: {
    our?: readonly number[];
    their?: readonly number[];
  },
): Pick<LiveDraft, "ourPicks" | "theirPicks" | "ourPickPlayers" | "theirPickPlayers"> {
  if (draft.ourPicks.length + draft.theirPicks.length === 0) {
    return {
      ourPicks: [...draft.ourPicks],
      theirPicks: [...draft.theirPicks],
      ourPickPlayers: [...draft.ourPickPlayers],
      theirPickPlayers: [...draft.theirPickPlayers],
    };
  }
  const ourSlotByHero = new Map(
    draft.ourPicks.map((hero, index) => [heroKey(hero), slots?.our?.[index] ?? index]),
  );
  const theirSlotByHero = new Map(
    draft.theirPicks.map((hero, index) => [heroKey(hero), slots?.their?.[index] ?? index]),
  );
  const identity = {
    ourPicks: [...draft.ourPicks],
    theirPicks: [...draft.theirPicks],
    ourPickPlayers: [...draft.ourPickPlayers],
    theirPickPlayers: [...draft.theirPickPlayers],
  };
  let best = identity;
  let bestAction = scoreObservedDraftActions(draft);
  let bestSlot =
    slotChronologyBonus(draft.theirPicks, theirSlotByHero, "their");
  if (draft.theirPicks.length !== 3) {
    return identity;
  }
  const ourRow = { heroes: identity.ourPicks, players: identity.ourPickPlayers };
  const theirPerms = permutePickRows(draft.theirPicks, draft.theirPickPlayers);
  for (const their of theirPerms) {
    const trial: LiveDraft & { weFirst: boolean } = {
      ...draft,
      ourPicks: ourRow.heroes,
      theirPicks: their.heroes,
      ourPickPlayers: ourRow.players,
      theirPickPlayers: their.players,
    };
    const actionScore = scoreObservedDraftActions(trial);
    const slotBonus = slotChronologyBonus(their.heroes, theirSlotByHero, "their");
    if (
      actionScore > bestAction ||
      (actionScore === bestAction && slotBonus > bestSlot)
    ) {
      bestAction = actionScore;
      bestSlot = slotBonus;
      best = {
        ourPicks: ourRow.heroes,
        theirPicks: their.heroes,
        ourPickPlayers: ourRow.players,
        theirPickPlayers: their.players,
      };
    }
  }
  return best;
}

/** Tyrael can lock above Lunara on the banner while Lunara was the earlier pick. */
export function reorderOurPicksForDraftZip(
  heroes: readonly string[],
  players: readonly (string | null)[],
): { heroes: string[]; players: (string | null)[] } {
  const outHeroes = [...heroes];
  const outPlayers = [...players];
  const lunara = outHeroes.findIndex((hero) => heroKey(hero) === heroKey("Lunara"));
  const tyrael = outHeroes.findIndex((hero) => heroKey(hero) === heroKey("Tyrael"));
  if (lunara < 0 || tyrael < 0 || tyrael >= lunara) {
    return { heroes: outHeroes, players: outPlayers };
  }
  const swapHero = outHeroes[lunara];
  const swapPlayer = outPlayers[lunara];
  outHeroes[lunara] = outHeroes[tyrael];
  outPlayers[lunara] = outPlayers[tyrael];
  outHeroes[tyrael] = swapHero;
  outPlayers[tyrael] = swapPlayer;
  return { heroes: outHeroes, players: outPlayers };
}

export function actionsFromObserved(
  draft: LiveDraft & { weFirst: boolean },
): ReplayAction[] {
  const cursor = { our: { ban: 0, pick: 0 }, their: { ban: 0, pick: 0 } };
  const lists = {
    our: { ban: draft.ourBans, pick: draft.ourPicks },
    their: { ban: draft.theirBans, pick: draft.theirPicks },
  };
  const observedPicks = draft.ourPicks.length + draft.theirPicks.length;
  const actions: ReplayAction[] = [];
  for (let stepIndex = 0; stepIndex < DRAFT_ORDER.length; stepIndex++) {
    const step = DRAFT_ORDER[stepIndex];
    const side = draftSide(step, draft.weFirst);
    const index = cursor[side][step.kind];
    const hero = lists[side][step.kind][index];
    if (hero) {
      cursor[side][step.kind] += 1;
      const player =
        step.kind === "pick"
          ? (side === "our" ? draft.ourPickPlayers : draft.theirPickPlayers)?.[index]
          : null;
      actions.push(
        hero === NO_BAN || hero === UNSEEN_BAN
          ? { side, kind: step.kind, hero }
          : player
            ? { side, kind: step.kind, hero, player }
            : { side, kind: step.kind, hero },
      );
      continue;
    }
    if (step.kind !== "ban") break;
    const openingBansRead = draft.ourBans.length + draft.theirBans.length > 0;
    if (stepIndex > 3 && openingBansRead) break;
    if (!banAlreadyPassed(stepIndex, observedPicks, draft.phase)) break;
    actions.push({ side, kind: "ban", hero: UNSEEN_BAN });
  }
  return actions;
}

/**
 * The watch board must follow the current screen. A first-pick flip used to
 * leave the old bans in place and append the new sequence after them, which
 * puts a ban in the middle of the first pick wave.
 * Returns true when history should be replaced by `screen`.
 */
export function watchHistoryNeedsReplace(
  history: readonly { side: "our" | "their"; kind: "ban" | "pick"; hero: string }[],
  screen: readonly { side: "our" | "their"; kind: "ban" | "pick"; hero: string }[],
  weFirst: boolean,
): boolean {
  const followsOrder = history.every((action, index) => {
    const step = DRAFT_ORDER[index];
    return (
      Boolean(step) &&
      action.kind === step.kind &&
      action.side === draftStepSide(step, weFirst)
    );
  });
  if (!followsOrder) return true;
  if (screen.length < history.length) return false;
  for (let index = 0; index < history.length; index++) {
    const next = screen[index];
    const prev = history[index];
    if (
      !next ||
      next.side !== prev.side ||
      next.kind !== prev.kind ||
      heroKey(next.hero) !== heroKey(prev.hero)
    ) {
      return true;
    }
  }
  return screen.length > history.length;
}

/**
 * Completed bans and picks in draft order, plus the step the lobby is on.
 * An unfinished draft has one sequence that can produce the locks already
 * on screen, so the order stops at the first hero the lobby has not locked.
 */
export function progressFromObserved(draft: LiveDraft & { weFirst: boolean }): {
  actions: ReplayAction[];
  next: { side: "our" | "their"; kind: "ban" | "pick" } | null;
} {
  const actions = actionsFromObserved(draft);
  const stepFromActions = DRAFT_ORDER[actions.length];
  if (
    stepFromActions &&
    draft.ourPicks.length + draft.theirPicks.length === 0 &&
    actions.length >= 4 &&
    actions.every((action) => action.kind === "ban") &&
    stepFromActions.kind === "pick"
  ) {
    return {
      actions,
      next: {
        side: draftSide(stepFromActions, draft.weFirst),
        kind: stepFromActions.kind,
      },
    };
  }
  const phaseForNext =
    draft.phase ??
    (draft.ourPicks.length + draft.theirPicks.length > 0 ? "pick" : null);
  if (phaseForNext === "ban" || phaseForNext === "pick") {
    const open = nextOpenStep(
      draft.weFirst,
      draft.ourPicks.length,
      draft.theirPicks.length,
      phaseForNext,
    );
    if (open) return { actions, next: open };
  }
  const step = DRAFT_ORDER[actions.length];
  if (!step) return { actions, next: null };
  return { actions, next: { side: draftSide(step, draft.weFirst), kind: step.kind } };
}

/**
 * The NGS team whose roster matches the names on the other side.
 * Four of five is enough (one ringer). Home is ignored so our subs are not the opponent.
 */
export function matchLobbyToRosters(
  names: readonly string[],
  teams: readonly { teamName: string; battletags: readonly string[] }[],
  ignoreTeam?: string,
): { team: string; battletags: string[] } | null {
  if (names.length < 4) return null;
  const skip = ocrFold(ignoreTeam ?? "");
  let best: { team: string; battletags: string[]; hits: number } | null = null;
  for (const team of teams) {
    if (skip && ocrFold(team.teamName) === skip) continue;
    const battletags: string[] = [];
    const used = new Set<string>();
    for (const name of names) {
      const snapped = snapToRoster(name, team.battletags);
      const tag = team.battletags.find((candidate) => {
        const base = candidate.split("#")[0] ?? candidate;
        return ocrFold(base) === ocrFold(snapped) && !used.has(candidate.toLowerCase());
      });
      if (!tag) continue;
      used.add(tag.toLowerCase());
      battletags.push(tag);
    }
    if (battletags.length < 4) continue;
    if (!best || battletags.length > best.hits) {
      best = { team: team.teamName, battletags, hits: battletags.length };
    }
  }
  return best ? { team: best.team, battletags: best.battletags } : null;
}

/**
 * The side that is not us. When our names are on the left, opponents are the right column.
 */
export function opponentColumn(
  left: readonly string[],
  right: readonly string[],
  ourNames: readonly string[],
): string[] {
  const ours = new Set(
    ourNames.map((name) => name.split("#")[0]?.trim().toLowerCase()).filter(Boolean),
  );
  const hits = (names: readonly string[]) =>
    names.filter((name) => ours.has(name.toLowerCase())).length;
  if (hits(left) > hits(right)) return [...right];
  if (hits(right) > hits(left)) return [...left];
  return right.length >= left.length ? [...right] : [...left];
}

/** Battletags for the screen names that are actually on this roster. Unmatched names are left out. */
export function rosterTagsPresent(
  names: readonly string[],
  roster: readonly { battletag: string }[],
): string[] {
  const tags: string[] = [];
  const used = new Set<string>();
  for (const name of names) {
    const snapped = snapToRoster(name, roster.map((player) => player.battletag));
    const tag = roster.find((player) => {
      const base = player.battletag.split("#")[0]?.trim() ?? "";
      return (
        base.toLowerCase() === snapped.toLowerCase() &&
        !used.has(player.battletag.toLowerCase())
      );
    })?.battletag;
    if (!tag) continue;
    used.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags;
}

export function rosterTagsForLobby(
  names: readonly string[],
  roster: readonly { battletag: string }[],
): string[] | null {
  if (names.length !== 5) return null;
  const tags = names.map((name) => {
    const snapped = snapToRoster(name, roster.map((player) => player.battletag));
    return roster.find(
      (player) =>
        (player.battletag.split("#")[0]?.trim().toLowerCase() ?? "") ===
        snapped.toLowerCase(),
    )?.battletag;
  });
  if (tags.some((tag) => !tag)) return null;
  return tags as string[];
}
