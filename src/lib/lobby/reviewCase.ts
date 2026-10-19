/** What the watcher had on the last lobby frame, before the loading screen. */
export type DraftReviewBoard = {
  map: string | null;
  firstPick: "us" | "them" | null;
  ourBans: string[];
  theirBans: string[];
  ourPicks: { hero: string; player: string | null }[];
  theirPicks: { hero: string; player: string | null }[];
};

export function reviewCaseSource(imageFile: string, board: DraftReviewBoard): string {
  const file = imageFile.replace(/\\/g, "/");
  const ourHeroes = board.ourPicks.map((pick) => pick.hero);
  const theirHeroes = board.theirPicks.map((pick) => pick.hero);
  return `import { describe, expect, it } from "vitest";

/** Lobby frame saved before the loading screen. */
export const REVIEW_IMAGE = ${JSON.stringify(file)};

export const BOARD = ${JSON.stringify(board, null, 2)};

describe(${JSON.stringify(file)}, () => {
  it.skip("review this read next to the lobby screenshot", () => {
    expect(BOARD.map).toBe(${JSON.stringify(board.map)});
    expect(BOARD.firstPick).toBe(${JSON.stringify(board.firstPick)});
    expect(BOARD.ourBans).toEqual(${JSON.stringify(board.ourBans)});
    expect(BOARD.theirBans).toEqual(${JSON.stringify(board.theirBans)});
    expect(BOARD.ourPicks.map((pick) => pick.hero)).toEqual(${JSON.stringify(ourHeroes)});
    expect(BOARD.theirPicks.map((pick) => pick.hero)).toEqual(${JSON.stringify(theirHeroes)});
  });
});
`;
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
