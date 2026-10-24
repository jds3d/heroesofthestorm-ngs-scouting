import { heroKey } from "@/lib/scoring/heroMeta";

/** What the watcher had on the last lobby frame, before the loading screen. */
export type DraftReviewBoard = {
  map: string | null;
  firstPick: "us" | "them" | null;
  ourBans: string[];
  theirBans: string[];
  ourPicks: { hero: string; player: string | null }[];
  theirPicks: { hero: string; player: string | null }[];
};

/** One lobby frame that locked at least one new ban or pick. */
export type ReviewFrameNote = {
  file: string;
  /** When this screenshot was taken. */
  at?: string;
  added: {
    kind?: "ban" | "pick";
    side: "us" | "them";
    hero: string;
    player: string | null;
  }[];
};

type LockSide = {
  ourBans?: readonly string[];
  theirBans?: readonly string[];
  ourPicks: readonly string[];
  theirPicks: readonly string[];
  ourPickPlayers?: readonly (string | null)[];
  theirPickPlayers?: readonly (string | null)[];
};

function isReadableLock(hero: string): boolean {
  return Boolean(hero) && hero !== "__unseen__";
}

/** True when this hero was already on the earlier list. A repeated no-ban still counts once each. */
function alreadyListed(before: readonly string[], hero: string, used: boolean[]): boolean {
  const key = heroKey(hero);
  const index = before.findIndex(
    (prior, slot) => !used[slot] && isReadableLock(prior) && heroKey(prior) === key,
  );
  if (index < 0) return false;
  used[index] = true;
  return true;
}

/** Bans and picks that were not locked before this frame. */
export function locksAddedSince(prev: LockSide, next: LockSide): ReviewFrameNote["added"] {
  const added: ReviewFrameNote["added"] = [];
  const take = (
    kind: "ban" | "pick",
    side: "us" | "them",
    before: readonly string[],
    after: readonly string[],
    players?: readonly (string | null)[],
  ) => {
    const used = before.map(() => false);
    after.forEach((hero, index) => {
      if (!isReadableLock(hero) || alreadyListed(before, hero, used)) return;
      added.push({
        kind,
        side,
        hero,
        player: kind === "pick" ? (players?.[index] ?? null) : null,
      });
    });
  };
  take("ban", "us", prev.ourBans ?? [], next.ourBans ?? []);
  take("ban", "them", prev.theirBans ?? [], next.theirBans ?? []);
  take("pick", "us", prev.ourPicks, next.ourPicks, next.ourPickPlayers);
  take("pick", "them", prev.theirPicks, next.theirPicks, next.theirPickPlayers);
  return added;
}

/** @deprecated Prefer locksAddedSince. Picks only, kept for older call sites. */
export function picksAddedSince(
  prev: LockSide,
  next: LockSide,
): ReviewFrameNote["added"] {
  return locksAddedSince(
    { ...prev, ourBans: prev.ourBans ?? next.ourBans ?? [], theirBans: prev.theirBans ?? next.theirBans ?? [] },
    next,
  ).filter((lock) => lock.kind !== "ban");
}

export function reviewCaseSource(frames: readonly ReviewFrameNote[], board: DraftReviewBoard): string {
  const notes = frames.map((frame) => ({
    file: frame.file.replace(/\\/g, "/"),
    ...(frame.at ? { at: frame.at } : {}),
    added: frame.added,
  }));
  const file = notes[0]?.file ?? "";
  const ourHeroes = board.ourPicks.map((pick) => pick.hero);
  const theirHeroes = board.theirPicks.map((pick) => pick.hero);
  return `import { describe, expect, it } from "vitest";

/** Lobby frames that locked a ban or a pick. Kept because Save for review was clicked. */
export const REVIEW_IMAGE = ${JSON.stringify(file)};

export const REVIEW_FRAMES = ${JSON.stringify(notes, null, 2)};

export const BOARD = ${JSON.stringify(board, null, 2)};

describe(${JSON.stringify(file)}, () => {
  it.skip("review this read next to the lobby screenshot", () => {
    expect(BOARD.map).toBe(${JSON.stringify(board.map)});
    expect(BOARD.firstPick).toBe(${JSON.stringify(board.firstPick)});
    expect(BOARD.ourBans).toEqual(${JSON.stringify(board.ourBans)});
    expect(BOARD.theirBans).toEqual(${JSON.stringify(board.theirBans)});
    expect(BOARD.ourPicks.map((pick) => pick.hero)).toEqual(${JSON.stringify(ourHeroes)});
    expect(BOARD.theirPicks.map((pick) => pick.hero)).toEqual(${JSON.stringify(theirHeroes)});
    expect(REVIEW_FRAMES).toHaveLength(${notes.length});
  });
});
`;
}

/** Pull the pick frames back out of a generated review test. */
export function framesFromReviewSource(source: string): ReviewFrameNote[] {
  const match = source.match(/export const REVIEW_FRAMES = (\[[\s\S]*?\n\]);/);
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(match[1]) as ReviewFrameNote[];
      if (Array.isArray(parsed)) return parsed.filter((frame) => frame && typeof frame.file === "string");
    } catch {
      // Fall through to the single image.
    }
  }
  const image = source.match(/export const REVIEW_IMAGE = "([^"]+)";/);
  return image?.[1] ? [{ file: image[1], added: [] }] : [];
}

/** Pull the saved board back out of a generated review test. */
export function boardFromReviewSource(source: string): DraftReviewBoard | null {
  const match = source.match(/export const BOARD = (\{[\s\S]*?\n\});/);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as DraftReviewBoard;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.ourBans) || !Array.isArray(parsed.theirBans)) return null;
    if (!Array.isArray(parsed.ourPicks) || !Array.isArray(parsed.theirPicks)) return null;
    return parsed;
  } catch {
    return null;
  }
}
