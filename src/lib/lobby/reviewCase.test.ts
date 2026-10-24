import { describe, expect, it } from "vitest";
import {
  boardFromReviewSource,
  framesFromReviewSource,
  locksAddedSince,
  picksAddedSince,
  reviewCaseSource,
  type DraftReviewBoard,
} from "@/lib/lobby/reviewCase";

const board: DraftReviewBoard = {
  map: "Tomb of the Spider Queen",
  firstPick: "them",
  ourBans: ["Xal'atath", "Yrel", "Stitches"],
  theirBans: ["Qhira", "Johanna"],
  ourPicks: [
    { hero: "Kel'Thuzad", player: "furryfather" },
    { hero: "Auriel", player: "Samismissing" },
  ],
  theirPicks: [{ hero: "Anduin", player: "JayberCrow" }],
};

describe("draft review cases", () => {
  it("writes a skipped test the review page can read back", () => {
    const source = reviewCaseSource(
      [
        {
          file: "examples/reviews/review-20261019T153000Z-1.jpg",
          at: "2026-10-19T15:30:00.000Z",
          added: [{ kind: "ban", side: "us", hero: "Xal'atath", player: null }],
        },
        {
          file: "examples/reviews/review-20261019T153000Z-2.jpg",
          at: "2026-10-19T15:31:12.000Z",
          added: [{ kind: "pick", side: "us", hero: "Kel'Thuzad", player: "furryfather" }],
        },
        {
          file: "examples/reviews/review-20261019T153000Z-3.jpg",
          at: "2026-10-19T15:32:40.000Z",
          added: [{ kind: "pick", side: "them", hero: "Anduin", player: "JayberCrow" }],
        },
      ],
      board,
    );
    expect(source).toContain("it.skip");
    expect(source).toContain("examples/reviews/review-20261019T153000Z-1.jpg");
    expect(source).toContain("Kel'Thuzad");
    expect(boardFromReviewSource(source)).toEqual(board);
    expect(framesFromReviewSource(source)).toHaveLength(3);
    expect(framesFromReviewSource(source)[0]?.at).toBe("2026-10-19T15:30:00.000Z");
    expect(framesFromReviewSource(source)[0]?.added[0]?.kind).toBe("ban");
    expect(framesFromReviewSource(source)[2]?.added[0]?.hero).toBe("Anduin");
  });

  it("names only the heroes a frame newly locked", () => {
    const prev = {
      ourPicks: ["Kel'Thuzad"],
      theirPicks: [],
      ourPickPlayers: ["furryfather"],
      theirPickPlayers: [],
    };
    expect(
      picksAddedSince(prev, {
        ourPicks: ["Kel'Thuzad", "Auriel"],
        theirPicks: ["Anduin"],
        ourPickPlayers: ["furryfather", "Samismissing"],
        theirPickPlayers: ["JayberCrow"],
      }),
    ).toEqual([
      { kind: "pick", side: "us", hero: "Auriel", player: "Samismissing" },
      { kind: "pick", side: "them", hero: "Anduin", player: "JayberCrow" },
    ]);
    expect(picksAddedSince(prev, prev)).toEqual([]);
  });

  it("keeps a frame when a ban is read", () => {
    expect(
      locksAddedSince(
        {
          ourBans: [],
          theirBans: ["Qhira"],
          ourPicks: [],
          theirPicks: [],
        },
        {
          ourBans: ["Johanna"],
          theirBans: ["Qhira", "__no_ban__"],
          ourPicks: [],
          theirPicks: [],
        },
      ),
    ).toEqual([
      { kind: "ban", side: "us", hero: "Johanna", player: null },
      { kind: "ban", side: "them", hero: "__no_ban__", player: null },
    ]);
  });
});
