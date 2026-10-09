import { describe, expect, it } from "vitest";
import { applyReplayPlayers, emptyStore } from "@/lib/replay/store";

describe("applyReplayPlayers", () => {
  it("keeps the tag from the most recent shared game", () => {
    const store = emptyStore("/replays");
    applyReplayPlayers(store, [
      { name: "goz", tag: "goz#1111", seen: "2026-01-01T00:00:00.000Z" },
    ]);
    applyReplayPlayers(store, [
      { name: "goz", tag: "goz#11605", seen: "2026-10-09T01:29:55.805Z" },
    ]);
    expect(store.byName.goz?.tag).toBe("goz#11605");
    expect(store.byName.goz?.alternates.some((alt) => alt.tag === "goz#1111")).toBe(true);
  });
});
