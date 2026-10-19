import { describe, expect, it } from "vitest";
import { boardFromReviewSource, reviewCaseSource, type DraftReviewBoard } from "@/lib/lobby/reviewCase";

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
    const source = reviewCaseSource("examples/reviews/review-20261019T153000Z.png", board);
    expect(source).toContain("it.skip");
    expect(source).toContain("examples/reviews/review-20261019T153000Z.png");
    expect(source).toContain("Kel'Thuzad");
    expect(boardFromReviewSource(source)).toEqual(board);
  });
});
