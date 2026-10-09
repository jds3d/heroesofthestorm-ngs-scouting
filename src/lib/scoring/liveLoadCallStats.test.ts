import { describe, expect, it, beforeEach } from "vitest";
import {
  addLiveLoadCallStats,
  getLiveLoadCallStats,
  liveLoadTallyLine,
  recordMatchupLoadBatch,
  resetLiveLoadCallStats,
} from "./liveLoadCallStats";

describe("liveLoadCallStats", () => {
  beforeEach(() => {
    resetLiveLoadCallStats();
  });

  it("sums API and cache loads for the pizza tracker line", () => {
    recordMatchupLoadBatch("api", 3);
    addLiveLoadCallStats({ cacheCalls: 2 });
    expect(getLiveLoadCallStats()).toEqual({ apiCalls: 3, cacheCalls: 2 });
    expect(liveLoadTallyLine(getLiveLoadCallStats())).toBe(
      "3 API calls · 2 cache calls before suggestions were ready",
    );
  });

  it("treats session and disk matchup batches as cache calls", () => {
    recordMatchupLoadBatch("session");
    recordMatchupLoadBatch("cache");
    expect(getLiveLoadCallStats()).toEqual({ apiCalls: 0, cacheCalls: 2 });
  });
});
