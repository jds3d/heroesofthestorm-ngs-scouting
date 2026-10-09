import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UNSEEN_BAN } from "@/lib/lobby/screenLobby";
import type { ReplayAction } from "@/lib/review/replayDraft";
import {
  duoWithPlayers,
  historyBeforePairLock,
  ReconstructedDraftOrder,
  reconstructedOrderLines,
} from "./InteractiveDraft";

const volskaya: ReplayAction[] = [
  { side: "our", kind: "ban", hero: "Johanna" },
  { side: "their", kind: "ban", hero: "Qhira" },
  { side: "our", kind: "ban", hero: "Sgt. Hammer" },
  { side: "their", kind: "ban", hero: "Xal'atath" },
  { side: "our", kind: "pick", hero: "Abathur", player: "L337#1234" },
  { side: "their", kind: "pick", hero: "Thrall", player: "dgcy023" },
  { side: "their", kind: "pick", hero: "Brightwing", player: "Hoss" },
  { side: "our", kind: "pick", hero: "Tyrande", player: "HuckIt" },
  { side: "our", kind: "pick", hero: "Leoric", player: "Magic" },
  { side: "their", kind: "ban", hero: "E.T.C." },
  { side: "our", kind: "ban", hero: "Tyrael" },
  { side: "their", kind: "pick", hero: "Nazeebo", player: "Cinema" },
  { side: "their", kind: "pick", hero: "Stitches", player: "Silver" },
];

describe("pair grade labels", () => {
  it("names who plays each hero in the suggested duo", () => {
    expect(duoWithPlayers("Alarak", "HuckIt", "Hogger", "PangiTMoDiba")).toBe(
      "Alarak (HuckIt) + Hogger (PangiTMoDiba)",
    );
  });

  it("finds the lock the pair grade should rescore", () => {
    expect(
      historyBeforePairLock(
        [
          { hero: "Zeratul", side: "our" },
          { hero: "Qhira", side: "our" },
          { hero: "Ragnaros", side: "our" },
        ],
        "Qhira",
        "Ragnaros",
      ),
    ).toEqual({ index: 1, ours: true });
  });
});

describe("reconstructed draft order", () => {
  it("lists the Volskaya locks and leaves our pick open", () => {
    const order = reconstructedOrderLines(volskaya, true, true);
    expect(order.done.map((row) => [row.n, row.side, row.kind, row.hero, row.player])).toEqual([
      [1, "our", "ban", "Johanna", null],
      [2, "their", "ban", "Qhira", null],
      [3, "our", "ban", "Sgt. Hammer", null],
      [4, "their", "ban", "Xal'atath", null],
      [5, "our", "pick", "Abathur", "L337"],
      [6, "their", "pick", "Thrall", "dgcy023"],
      [7, "their", "pick", "Brightwing", "Hoss"],
      [8, "our", "pick", "Tyrande", "HuckIt"],
      [9, "our", "pick", "Leoric", "Magic"],
      [10, "their", "ban", "E.T.C.", null],
      [11, "our", "ban", "Tyrael", null],
      [12, "their", "pick", "Nazeebo", "Cinema"],
      [13, "their", "pick", "Stitches", "Silver"],
    ]);
    expect(order.next).toEqual({ side: "our", kind: "pick" });
  });

  it("starts on our ban when nothing is locked and we ban first", () => {
    expect(reconstructedOrderLines([], true, true)).toEqual({
      done: [],
      next: { side: "our", kind: "ban" },
    });
  });

  it("leaves the next step blank until the screen says who bans first", () => {
    expect(reconstructedOrderLines([], false, false).next).toBeNull();
  });

  it("marks a ban the screen has already moved past as unseen", () => {
    const order = reconstructedOrderLines(
      [{ side: "our", kind: "ban", hero: UNSEEN_BAN }],
      true,
      true,
    );
    expect(order.done[0]).toMatchObject({ n: 1, side: "our", kind: "ban", hero: null, player: null });
    expect(order.next).toEqual({ side: "their", kind: "ban" });
  });

  it("renders the sequence under a Draft order heading", () => {
    const html = renderToStaticMarkup(
      createElement(ReconstructedDraftOrder, {
        actions: volskaya,
        weFirst: true,
        sideKnown: true,
        ourLabel: "Us",
        theirLabel: "Them",
      }),
    );
    expect(html).toContain("Draft order");
    expect(html).toContain("Johanna");
    expect(html).toContain("Abathur");
    expect(html).toContain("L337");
    expect(html).toContain("Stitches");
    expect(html).toContain("Silver");
    expect(html).toContain("Next");
    expect(html).toContain("Us pick");
    expect(html).not.toContain("Falstad");
  });

  it("says nothing is locked and names our opening ban", () => {
    const html = renderToStaticMarkup(
      createElement(ReconstructedDraftOrder, {
        actions: [],
        weFirst: true,
        sideKnown: true,
        ourLabel: "Us",
        theirLabel: "Them",
      }),
    );
    expect(html).toContain("Nothing locked yet.");
    expect(html).toContain("Us ban");
  });

  it("waits instead of guessing a side", () => {
    const html = renderToStaticMarkup(
      createElement(ReconstructedDraftOrder, {
        actions: [{ side: "our", kind: "ban", hero: UNSEEN_BAN }],
        weFirst: false,
        sideKnown: false,
        ourLabel: "Us",
        theirLabel: "Them",
      }),
    );
    expect(html).toContain("Waiting to see who bans first.");
    expect(html).toContain("Unseen");
    expect(html).not.toContain("Next");
  });
});
