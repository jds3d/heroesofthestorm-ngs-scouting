import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftTracker } from "./DraftTracker";
import {
  formatTimeLeft,
  scoutExpectedMs,
  timeLeftEstimate,
  timeLeftLabel,
} from "./TimeLeftBar";

describe("time left", () => {
  it("counts down from the expected duration before any work is measured", () => {
    const estimate = timeLeftEstimate({ elapsedMs: 0, expectedMs: 60_000 });
    expect(estimate.remainingMs).toBe(60_000);
    expect(estimate.fill).toBe(0);
    expect(estimate.overrun).toBe(false);
    expect(formatTimeLeft(estimate.remainingMs)).toBe("About 60s left");
  });

  it("uses finished work once a real fraction is in", () => {
    const estimate = timeLeftEstimate({
      elapsedMs: 20_000,
      expectedMs: 60_000,
      progress: 0.5,
    });
    expect(estimate.remainingMs).toBe(20_000);
    expect(estimate.fill).toBe(50);
  });

  it("keeps the original estimate on the first paint, even if some work is already done", () => {
    const estimate = timeLeftEstimate({
      elapsedMs: 0,
      expectedMs: 40_000,
      progress: 0.25,
    });
    expect(estimate.remainingMs).toBe(30_000);
    expect(estimate.fill).toBe(25);
    expect(timeLeftLabel(estimate)).toBe("About 30s left");
  });

  it("keeps moving after the first estimate without claiming it is done", () => {
    const estimate = timeLeftEstimate({ elapsedMs: 90_000, expectedMs: 60_000 });
    expect(estimate.overrun).toBe(true);
    expect(estimate.fill).toBeGreaterThan(92);
    expect(estimate.fill).toBeLessThan(100);
    expect(timeLeftLabel(estimate)).toMatch(/^Taking longer than usual/);
  });

  it("sizes a scout pass from the call list, and a later pass from the proxy window", () => {
    expect(scoutExpectedMs([], 1)).toBe(25_000);
    expect(scoutExpectedMs([{ count: 40 }], 1)).toBe(95_000);
    expect(scoutExpectedMs([{ count: 400 }], 1)).toBe(180_000);
    expect(scoutExpectedMs([{ count: 4 }], 2)).toBe(90_000);
  });

  it("speaks minutes once the wait is past a minute and a half", () => {
    expect(formatTimeLeft(2_000)).toBe("A few seconds left");
    expect(formatTimeLeft(6_000)).toBe("About 6s left");
    expect(formatTimeLeft(120_000)).toBe("About 2 min left");
  });

  it("stops guessing a finish time once the wait is more than twice the estimate", () => {
    const estimate = timeLeftEstimate({ elapsedMs: 130_000, expectedMs: 60_000 });
    expect(estimate.fill).toBeLessThan(100);
    expect(timeLeftLabel(estimate)).toBe(
      "Still working — this is taking longer than usual",
    );
  });

  it("shows a countdown while the draft sync is still reading names", () => {
    const html = renderToStaticMarkup(createElement(DraftTracker, { rows: [] }));
    expect(html).toContain("Reading the map title and the ten player names");
    expect(html).toContain("About 18s left");
    expect(html).toContain("progressbar");
  });

  it("shows who is left while Storm League history is still coming in", () => {
    const html = renderToStaticMarkup(
      createElement(DraftTracker, {
        rows: [
          { name: "HuckIt", side: "us", status: "pulling", games: 0 },
          { name: "gaz", side: "them", status: "found", games: 10 },
        ],
      }),
    );
    expect(html).toContain("Storm League history still loading for HuckIt");
    expect(html).toContain("progressbar");
    expect(html).toContain('aria-valuenow="50"');
  });

  it("drops the countdown once every Storm League lookup has settled", () => {
    const html = renderToStaticMarkup(
      createElement(DraftTracker, {
        rows: [{ name: "HuckIt", side: "us", status: "found", games: 10 }],
      }),
    );
    expect(html).not.toContain("progressbar");
    expect(html).toContain("Ready");
  });
});
