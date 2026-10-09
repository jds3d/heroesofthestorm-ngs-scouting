import { describe, expect, it } from "vitest";
import {
  addressedIdsFromMarkdown,
  applyAddressedMarks,
  dataGapId,
  mergeDataGaps,
  renderDataGaps,
  type DataGapDraft,
  type DataGapEntry,
} from "./dataGapLog";

const now = "2026-10-09T16:04:00.000Z";

function draft(over: Partial<DataGapDraft> = {}): DataGapDraft {
  return {
    session: "game-1",
    level: "warning",
    hero: "Valla",
    pairWith: null,
    player: "SKilleen",
    missing: ["into Garrosh: fetching Storm League…"],
    percent: 50,
    loading: true,
    map: "Volskaya Foundry",
    step: "our pick",
    source: "live",
    ...over,
  };
}

describe("data gap log", () => {
  it("keeps one row per hero and updates it as the pull moves", () => {
    const first = mergeDataGaps([], [draft()], now);
    expect(first).toHaveLength(1);
    expect(first[0].seen).toBe(1);
    const again = mergeDataGaps(
      first,
      [draft({ percent: 80, missing: ["with Anduin: fetching Storm League…"] })],
      "2026-10-09T16:05:00.000Z",
    );
    expect(again).toHaveLength(1);
    expect(again[0].percent).toBe(80);
    expect(again[0].seen).toBe(2);
    expect(again[0].firstSeen).toBe(now);
    expect(again[0].lastSeen).toBe("2026-10-09T16:05:00.000Z");
  });

  it("records a failed pull as its own error", () => {
    const rows = mergeDataGaps(
      [],
      [draft(), draft({ level: "error", loading: false, percent: 0, missing: ["Storm League matchups for Valla"] })],
      now,
    );
    expect(rows.map((row) => row.level)).toEqual(["error", "warning"]);
    expect(dataGapId(rows[0])).not.toBe(dataGapId(rows[1]));
  });

  it("keeps a checked item checked when the same gap is seen again", () => {
    const [entry] = mergeDataGaps([], [draft()], now);
    const marked = renderDataGaps([{ ...entry, addressed: false }]).replace("- [ ]", "- [x]");
    const kept = applyAddressedMarks(
      mergeDataGaps([entry], [draft({ percent: 60 })], "2026-10-09T16:06:00.000Z"),
      marked,
    );
    expect(addressedIdsFromMarkdown(marked)).toEqual(new Set([entry.id]));
    expect(kept[0].addressed).toBe(true);
    expect(renderDataGaps(kept)).toContain("- [x] warning · **Valla**");
    expect(renderDataGaps(kept)).toContain("into Garrosh: fetching Storm League…");
    expect(renderDataGaps(kept)).toContain("60% loaded");
  });

  it("leaves an unchecked warning open", () => {
    const entry: DataGapEntry = {
      ...draft(),
      id: dataGapId(draft()),
      firstSeen: now,
      lastSeen: now,
      seen: 1,
      addressed: false,
    };
    expect(addressedIdsFromMarkdown(renderDataGaps([entry])).size).toBe(0);
  });
});
