import { heroKey } from "@/lib/scoring/heroMeta";
import {
  SLOT_LINE_STRIDE,
  mapFromTitle,
  playerFold,
  readSlotPlate,
  snapToRoster,
  type DraftBox,
  type LiveDraft,
} from "@/lib/lobby/screenLobby";

const FRAME = { w: 2560, h: 1440 };

function refBox(x0: number, y0: number, x1: number, y1: number): DraftBox {
  return {
    x: x0 / FRAME.w,
    y: y0 / FRAME.h,
    w: (x1 - x0) / FRAME.w,
    h: (y1 - y0) / FRAME.h,
    rotate: 0,
  };
}

/** Tops of the five loading-screen cards, measured on examples/final draft screen.png. */
const CARD_TOPS = [252, 428, 606, 782, 959];

/**
 * Hero name and player name on each loading-screen card.
 * Left cards put the text to the right of the talent icon. Right cards put it
 * to the left of the icon, so that box is wider.
 */
export const FINAL_NAME_BOXES: { left: DraftBox[]; right: DraftBox[] } = {
  left: CARD_TOPS.map((top) => refBox(148, top + 40, 440, top + 150)),
  right: CARD_TOPS.map((top) => refBox(2080, top + 40, 2440, top + 150)),
};

/** "BRAXIS HOLDOUT" under "WELCOME TO" on the loading screen. */
export const FINAL_MAP_BOX = refBox(1000, 85, 1600, 145);

const CARD_SAMPLE_Y = [330, 506, 683, 859, 1036];

export type Rgb = { r: number; g: number; b: number };

export type FinalSeat = { hero: string | null; player: string | null };

export type NameLine = { text: string; top: number; x?: number };

function redCardBorder(pixel: Rgb): boolean {
  return pixel.r > 80 && pixel.r > pixel.g * 3 && pixel.r > pixel.b * 2 && pixel.g < 50;
}

function blueCardBorder(pixel: Rgb): boolean {
  return pixel.b > 80 && pixel.b > pixel.r * 3 && pixel.b > pixel.g && pixel.g < 100;
}

/**
 * The post-draft loading screen: a red card stack on the left and a blue
 * card stack on the right. Draft lobbies do not paint all five borders.
 */
export function finalScreenLikely(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Rgb,
): boolean {
  if (width < 32 || height < 32) return false;
  let red = 0;
  let blue = 0;
  for (const yRef of CARD_SAMPLE_Y) {
    const y = Math.max(0, Math.min(height - 1, Math.round((yRef / FRAME.h) * height)));
    const leftX = Math.max(0, Math.min(width - 1, Math.round((8 / FRAME.w) * width)));
    const rightX = Math.max(0, Math.min(width - 1, Math.round((2550 / FRAME.w) * width)));
    if (redCardBorder(pixelAt(leftX, y))) red += 1;
    if (blueCardBorder(pixelAt(rightX, y))) blue += 1;
  }
  return red >= 4 && blue >= 4;
}

/** Glue fragments of one name ("P" + "enelope") that sit on the same line. */
export function joinNameFragments(lines: readonly NameLine[]): string[] {
  const sorted = [...lines].sort((a, b) => a.top - b.top || (a.x ?? 0) - (b.x ?? 0));
  const groups: { top: number; parts: { text: string; x: number }[] }[] = [];
  for (const line of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(line.top - last.top) <= 30) {
      last.parts.push({ text: line.text, x: line.x ?? 0 });
      continue;
    }
    groups.push({ top: line.top, parts: [{ text: line.text, x: line.x ?? 0 }] });
  }
  return groups.map((group) =>
    group.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.text.trim())
      .join(""),
  );
}

/** Five loading-screen cards from one stacked name column. */
export function seatsFromNameLines(lines: readonly NameLine[]): FinalSeat[] {
  const buckets: NameLine[][] = Array.from({ length: 5 }, () => []);
  for (const line of lines) {
    const index = Math.floor(line.top / SLOT_LINE_STRIDE);
    if (index < 0 || index >= 5) continue;
    buckets[index].push(line);
  }
  return buckets.map((bucket) => readSlotPlate(joinNameFragments(bucket)));
}

function onRoster(name: string, roster: readonly string[]): boolean {
  const snapped = snapToRoster(name, roster);
  const folded = playerFold(snapped);
  if (!folded) return false;
  return roster.some((tag) => playerFold(tag.split("#")[0] ?? tag) === folded);
}

function preferPlayer(
  existing: string | null,
  screen: string | null,
  roster: readonly string[],
): string | null {
  const screenName = screen ? snapToRoster(screen, roster) : null;
  const existingName = existing ? snapToRoster(existing, roster) : null;
  if (existingName && onRoster(existingName, roster)) return existingName;
  if (screenName && onRoster(screenName, roster)) return screenName;
  return screenName ?? existingName;
}

function screenHeroes(seats: readonly FinalSeat[]): { hero: string; player: string | null }[] {
  const out: { hero: string; player: string | null }[] = [];
  for (const seat of seats) {
    if (!seat.hero) continue;
    if (out.some((have) => heroKey(have.hero) === heroKey(seat.hero!))) continue;
    out.push({ hero: seat.hero, player: seat.player });
  }
  return out;
}

/**
 * Keep heroes already read, in the order they locked, then append anyone
 * the draft missed. A hero the screen does not show is left for the caller
 * to ask about; this does not delete it.
 */
function fillSide(
  picks: readonly string[],
  players: readonly (string | null)[],
  seats: readonly FinalSeat[],
  roster: readonly string[],
): { heroes: string[]; players: (string | null)[] } {
  const screen = screenHeroes(seats);
  const kept: { hero: string; player: string | null }[] = [];
  for (let index = 0; index < picks.length && kept.length < 5; index++) {
    const hero = picks[index];
    if (!hero) continue;
    if (kept.some((have) => heroKey(have.hero) === heroKey(hero))) continue;
    const fromScreen = screen.find((seat) => heroKey(seat.hero) === heroKey(hero));
    kept.push({
      hero,
      player: preferPlayer(players[index] ?? null, fromScreen?.player ?? null, roster),
    });
  }
  if (kept.length < 5) {
    for (const seat of screen) {
      if (kept.length >= 5) break;
      if (kept.some((have) => heroKey(have.hero) === heroKey(seat.hero))) continue;
      kept.push({
        hero: seat.hero,
        player: preferPlayer(null, seat.player, roster),
      });
    }
  }
  return {
    heroes: kept.map((seat) => seat.hero),
    players: kept.map((seat) => seat.player),
  };
}

function rosterHits(seats: readonly FinalSeat[], ourNames: readonly string[]): number {
  if (!ourNames.length) return 0;
  return seats.filter((seat) => seat.player && onRoster(seat.player, ourNames)).length;
}

export type FinalScreenConflict = {
  before: { our: string[]; their: string[] };
  screen: { our: string[]; their: string[] };
};

export type CompletedFinalScreen = {
  draft: LiveDraft;
  ourNames: string[];
  theirNames: string[];
  /** Set when a hero locked during the draft is not on the loading screen. */
  conflict: FinalScreenConflict | null;
};

function listedHeroes(heroes: readonly string[]): string[] {
  const out: string[] = [];
  for (const hero of heroes) {
    if (!hero) continue;
    if (out.some((have) => heroKey(have) === heroKey(hero))) continue;
    out.push(hero);
  }
  return out;
}

/**
 * Heroes the draft already locked that the loading screen does not show.
 * A short draft that is only missing people is not a conflict.
 */
export function heroesMissingFromScreen(
  before: readonly string[],
  screen: readonly string[],
): string[] {
  if (screen.length < 4) return [];
  const screenKeys = new Set(screen.map((hero) => heroKey(hero)));
  return listedHeroes(before).filter((hero) => !screenKeys.has(heroKey(hero)));
}

function listHeroes(heroes: readonly string[]): string {
  return heroes.length ? heroes.join(", ") : "nobody";
}

/** The question to ask when the two comps disagree. */
export function mismatchQuestion(conflict: FinalScreenConflict): string {
  return `The draft and the loading screen don't match. Draft had us ${listHeroes(conflict.before.our)} and them ${listHeroes(conflict.before.their)}. The loading screen has us ${listHeroes(conflict.screen.our)} and them ${listHeroes(conflict.screen.their)}. Which one is right?`;
}

/** A skipped test that keeps both comps until someone says which is right. */
export function mismatchCaseSource(imageFile: string, conflict: FinalScreenConflict): string {
  const file = imageFile.replace(/\\/g, "/");
  return `import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finalScreenLikely } from "@/lib/lobby/finalScreen";
import { decodePng } from "@/lib/lobby/pngImage";

const image = decodePng(readFileSync(path.join(process.cwd(), ${JSON.stringify(file)})));

describe(${JSON.stringify(file)}, () => {
  it("saved the loading screen", () => {
    const pixelAt = (x: number, y: number) => {
      const i = (y * image.width + x) * 4;
      return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
    };
    expect(finalScreenLikely(image.width, image.height, pixelAt)).toBe(true);
  });

  it.skip(${JSON.stringify(mismatchQuestion(conflict))}, () => {
    const before = ${JSON.stringify(conflict.before)};
    const screen = ${JSON.stringify(conflict.screen)};
    const right: "draft" | "screen" | null = null;
    expect(right === "draft" ? before : screen).toEqual(right === "draft" ? before : screen);
    expect(right).not.toBeNull();
  });
});
`;
}

/**
 * Fill a draft that never reached ten picks. Blue is our team unless more of
 * the home roster is sitting on the red cards.
 */
export function completeDraftFromFinalScreen(args: {
  draft: LiveDraft;
  blue: readonly FinalSeat[];
  red: readonly FinalSeat[];
  ourNames: readonly string[];
  roster: readonly string[];
  mapText?: string;
}): CompletedFinalScreen | null {
  const blueHeroes = args.blue.filter((seat) => seat.hero).length;
  const redHeroes = args.red.filter((seat) => seat.hero).length;
  if (blueHeroes < 4 || redHeroes < 4) return null;
  const blueHits = rosterHits(args.blue, args.ourNames);
  const redHits = rosterHits(args.red, args.ourNames);
  const ourSeats = redHits > blueHits ? args.red : args.blue;
  const theirSeats = ourSeats === args.blue ? args.red : args.blue;
  const ourScreen = screenHeroes(ourSeats).map((seat) => seat.hero);
  const theirScreen = screenHeroes(theirSeats).map((seat) => seat.hero);
  const ourMissing = heroesMissingFromScreen(args.draft.ourPicks, ourScreen);
  const theirMissing = heroesMissingFromScreen(args.draft.theirPicks, theirScreen);
  const names = (seats: readonly FinalSeat[]) =>
    seats.flatMap((seat) => {
      if (!seat.player) return [];
      const snapped = snapToRoster(seat.player, args.roster);
      return snapped ? [snapped] : [];
    });
  if (ourMissing.length || theirMissing.length) {
    return {
      draft: args.draft,
      ourNames: names(ourSeats),
      theirNames: names(theirSeats),
      conflict: {
        before: {
          our: listedHeroes(args.draft.ourPicks),
          their: listedHeroes(args.draft.theirPicks),
        },
        screen: { our: ourScreen, their: theirScreen },
      },
    };
  }
  const our = fillSide(args.draft.ourPicks, args.draft.ourPickPlayers, ourSeats, args.roster);
  const their = fillSide(
    args.draft.theirPicks,
    args.draft.theirPickPlayers,
    theirSeats,
    args.roster,
  );
  const map = args.draft.map ?? mapFromTitle(args.mapText ?? "");
  const draft: LiveDraft = {
    ...args.draft,
    ourPicks: our.heroes,
    ourPickPlayers: our.players,
    theirPicks: their.heroes,
    theirPickPlayers: their.players,
    ourOpenPlayers: our.heroes.length >= 5 ? [] : args.draft.ourOpenPlayers,
    theirOpenPlayers: their.heroes.length >= 5 ? [] : args.draft.theirOpenPlayers,
    map,
    phase: our.heroes.length >= 5 && their.heroes.length >= 5 ? null : args.draft.phase,
    turn: our.heroes.length >= 5 && their.heroes.length >= 5 ? null : args.draft.turn,
    sealed: our.heroes.length >= 5 && their.heroes.length >= 5,
  };
  return { draft, ourNames: names(ourSeats), theirNames: names(theirSeats), conflict: null };
}
