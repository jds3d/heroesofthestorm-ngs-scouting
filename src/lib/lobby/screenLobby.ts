import { NGS_MAP_POOL } from "@/config/ngsMaps";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { HERO_META, heroKey } from "@/lib/scoring/heroMeta";
import { allDraftHeroes, heroDraftSlug } from "@/lib/scoring/heroPortrait";
import type { ReplayAction } from "@/lib/review/replayDraft";

const UI_WORDS = new Set([
  "allied",
  "alterac",
  "and",
  "ban",
  "banning",
  "bans",
  "battlefield",
  "blue",
  "bonus",
  "braxis",
  "core",
  "cursed",
  "defeat",
  "disconnect",
  "doom",
  "draft",
  "dragon",
  "enemy",
  "eternity",
  "experience",
  "first",
  "fort",
  "foundry",
  "fourth",
  "from",
  "garden",
  "hanamura",
  "hero",
  "heroes",
  "holdout",
  "hollow",
  "infernal",
  "junction",
  "keep",
  "league",
  "left",
  "level",
  "loading",
  "lobby",
  "map",
  "match",
  "starting",
  "mercenary",
  "objective",
  "pass",
  "pick",
  "picking",
  "picks",
  "placement",
  "player",
  "players",
  "queen",
  "queue",
  "ranked",
  "ready",
  "reconnect",
  "red",
  "right",
  "score",
  "second",
  "shire",
  "shrines",
  "sky",
  "spider",
  "storm",
  "team",
  "temple",
  "terror",
  "that",
  "the",
  "third",
  "this",
  "time",
  "tomb",
  "towers",
  "versus",
  "victory",
  "volskaya",
  "warhead",
  "well",
  "with",
  "your",
]);

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

export type DraftBox = { x: number; y: number; w: number; h: number; rotate: number };

/**
 * One plate per player, top to bottom. Text on the Storm League draft is
 * horizontal, so these are not rotated. Each box includes the portrait and
 * the hero and player names beside it.
 */
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

/** Center announcement, including the hero name under the model. */
export const DRAFT_TURN_BOX = { x: 0.26, y: 0.16, w: 0.48, h: 0.58, rotate: 0 } as const;

/** Map title along the top of a 16:9 draft. */
export const DRAFT_TITLE_BOX = { x: 0.28, y: 0, w: 0.44, h: 0.1, rotate: 0 } as const;

/**
 * Locked ban portraits sit in a row under the map, inside the nameplates.
 * The strips stay clear of the diagonal player columns so a pick is not read as a ban.
 */
export const DRAFT_BAN_STRIPS = {
  left: { x: 0.06, y: 0, w: 0.28, h: 0.09, rotate: 0 },
  right: { x: 0.66, y: 0, w: 0.28, h: 0.09, rotate: 0 },
} as const;

/** In-client titles that are not the hero's draft name. */
const PLATE_TITLES: Record<string, string> = {
  xalatath: "Alarak",
};

/** A ban that already locked before it could be read. It advances the board and removes no hero. */
export const UNSEEN_BAN = "__unseen__";

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
  /** Who banned first. In this lobby that side also picks first. */
  firstPick: "us" | "them" | null;
  /** Last phase read from the center banner. */
  phase: "ban" | "pick" | null;
  map: string | null;
};

export const EMPTY_LIVE_DRAFT: LiveDraft = {
  ourPicks: [],
  theirPicks: [],
  ourPickPlayers: [],
  theirPickPlayers: [],
  ourBans: [],
  theirBans: [],
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

/** One line from a draft nameplate. Drops 1–3 letter OCR scraps. */
export function nameFromPlate(text: string): string | null {
  const tokens = text.split(/[^A-Za-z0-9']+/).filter(Boolean);
  const ranked = tokens
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => /^[A-Za-z][A-Za-z0-9']{3,17}$/.test(token))
    .filter((token) => !UI_WORDS.has(token.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return ranked[0] ?? null;
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
  const heroNorms = new Set<string>();
  for (const hero of heroesFromColumn(text)) {
    heroNorms.add(plateNorm(hero));
    heroNorms.add(plateNorm(heroKey(hero)));
  }
  for (const line of text.split(/\n+/)) {
    for (const token of line.split(/[^A-Za-z0-9']+/)) {
      if (token.length < 4) continue;
      if (heroFromPlateText(token)) continue;
      const tokenNorm = plateNorm(token);
      if (
        heroNorms.has(tokenNorm) ||
        [...heroNorms].some((norm) => norm.includes(tokenNorm))
      ) {
        continue;
      }
      const name = nameFromPlate(token);
      if (name && !heroFromPlateText(name)) return name;
    }
  }
  return null;
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
  for (const lock of bright) {
    const key = heroKey(lock.hero);
    const have = playerByHero.get(key);
    if (lock.player && !have) playerByHero.set(key, lock.player);
    else if (!playerByHero.has(key)) playerByHero.set(key, lock.player);
  }
  const have = new Set(prev.map((hero) => heroKey(hero)));
  const fresh = bright.filter((lock) => !have.has(heroKey(lock.hero)));
  const announcedAt = (hero: string) =>
    announced.findIndex((name) => heroKey(name) === heroKey(hero));
  const slotAt = (hero: string) =>
    bright.findIndex((lock) => heroKey(lock.hero) === heroKey(hero));
  fresh.sort((a, b) => {
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
  for (const [alias, hero] of Object.entries(PLATE_TITLES)) {
    const known = byNorm.get(plateNorm(hero));
    byNorm.set(alias, known ?? hero);
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
  if (joined.length >= 8) {
    const prefix = list.filter(
      (hero) => hero.norm.startsWith(joined) || joined.startsWith(hero.norm),
    );
    if (prefix.length === 1) return prefix[0].hero;
  }
  for (const token of text.split(/[^A-Za-z0-9']+/)) {
    if (token.length < 3) continue;
    const hit = list.find((hero) => hero.norm === plateNorm(token));
    if (hit) return hit.hero;
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
    if (
      folded.length >= 5 &&
      dist > 0 &&
      dist <= limit &&
      (!closest || dist < closest.dist)
    ) {
      closest = { base, dist };
    }
  }
  return closest?.base ?? name;
}

/** Center banner such as "RED PICK" or "BLUE BAN". OCR may glue the words together. */
export function bannerTurn(text: string): {
  phase: "ban" | "pick" | null;
  color: "red" | "blue" | null;
} {
  const tight = text.toLowerCase().replace(/[^a-z]/g, "");
  let phase: "ban" | "pick" | null = null;
  if (
    tight.includes("picking") ||
    tight.includes("redpick") ||
    tight.includes("bluepick") ||
    /(^|[^a-z])pick([^a-z]|$)/.test(text.toLowerCase())
  ) {
    phase = "pick";
  } else if (
    tight.includes("banning") ||
    tight.includes("redban") ||
    tight.includes("blueban") ||
    /(^|[^a-z])ban([^a-z]|$)/.test(text.toLowerCase())
  ) {
    phase = "ban";
  }
  const color = tight.includes("red") ? "red" : tight.includes("blue") ? "blue" : null;
  return { phase, color };
}

/** Blue is the left column, red is the right. */
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
  for (const map of NGS_MAP_POOL) {
    const norm = plateNorm(map.name);
    if (folded.includes(norm)) return map.name;
  }
  return null;
}

export function turnFromOcr(text: string, roster: readonly string[]): TurnRead {
  let phase: TurnRead["phase"] = null;
  let player: string | null = null;
  let hero: string | null = null;
  for (const line of text.split(/\n+/)) {
    const fold = line.trim().toLowerCase();
    if (!fold) continue;
    if (/\bbanning\b/.test(fold) || /(^|[^a-z])ban([^a-z]|$)/.test(fold)) phase = "ban";
    else if (/\bpicking\b/.test(fold) || /(^|[^a-z])pick([^a-z]|$)/.test(fold)) phase = "pick";
    const heroHit = heroFromPlateText(line);
    if (heroHit) {
      hero = heroHit;
      continue;
    }
    const name = nameFromPlate(line);
    if (name) player = snapToRoster(name, roster);
  }
  return { player, phase, hero };
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

function draftSide(
  step: { side: "fp" | "sp" },
  weFirst: boolean,
): "our" | "their" {
  return (step.side === "fp") === weFirst ? "our" : "their";
}

/** True when these lock counts can happen if `weFirst` picked first. */
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
        player ? { side, kind: step.kind, hero, player } : { side, kind: step.kind, hero },
      );
      continue;
    }
    if (step.kind !== "ban") break;
    if (!banAlreadyPassed(stepIndex, observedPicks, draft.phase)) break;
    actions.push({ side, kind: "ban", hero: UNSEEN_BAN });
  }
  return actions;
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

function nameToken(raw: string): string | null {
  const cleaned = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (!/^[A-Za-z][A-Za-z0-9]{2,17}$/.test(cleaned)) return null;
  if (cleaned.replace(/[0-9]/g, "").length < 3) return null;
  const fold = cleaned.toLowerCase();
  if (UI_WORDS.has(fold) || isHero(cleaned)) return null;
  return cleaned;
}

/**
 * Player names read off a draft or lobby screenshot.
 * Drops heroes, map words, and the five names already on our side.
 * Returns at most five opponents, in the order they were read.
 */
export function lobbyNamesFromOcr(text: string, ourNames: readonly string[]): string[] {
  const ours = new Set(
    ourNames.map((name) => name.split("#")[0]?.trim().toLowerCase()).filter(Boolean),
  );
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/[\s,;|/]+/)) {
    const name = nameToken(raw);
    if (!name) continue;
    const fold = name.toLowerCase();
    if (ours.has(fold) || seen.has(fold)) continue;
    seen.add(fold);
    names.push(name);
    if (names.length === 5) break;
  }
  return names;
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
