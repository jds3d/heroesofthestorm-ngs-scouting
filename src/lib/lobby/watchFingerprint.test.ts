import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng } from "@/lib/lobby/pngImage";
import { DRAFT_TITLE_BOX } from "@/lib/lobby/screenLobby";
import {
  draftWatchFingerprintFromRgba,
  regionFingerprintFromRgba,
  watchBoxesForTests,
  watchIdlePauseDue,
  WATCH_IDLE_PAUSE_MS,
} from "@/lib/lobby/watchFingerprint";

describe("watchIdlePauseDue", () => {
  it("pauses after the idle threshold", () => {
    expect(watchIdlePauseDue(WATCH_IDLE_PAUSE_MS - 1)).toBe(false);
    expect(watchIdlePauseDue(WATCH_IDLE_PAUSE_MS)).toBe(true);
  });
});

describe("draftWatchFingerprintKey", () => {
  it("is stable on the same lobby frame", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples/drafts/battlefield.png")),
    );
    const a = draftWatchFingerprintFromRgba(image);
    const b = draftWatchFingerprintFromRgba(image);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(40);
    expect(watchBoxesForTests().length).toBeGreaterThan(20);
  });

  it("changes when a watched region is edited", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples/drafts/battlefield.png")),
    );
    const before = draftWatchFingerprintFromRgba(image);
    const title = regionFingerprintFromRgba(image, DRAFT_TITLE_BOX);
    const x = Math.round(DRAFT_TITLE_BOX.x * image.width);
    const y = Math.round(DRAFT_TITLE_BOX.y * image.height);
    const i = (y * image.width + x) * 4;
    image.data[i] = 255;
    image.data[i + 1] = 0;
    image.data[i + 2] = 255;
    const after = draftWatchFingerprintFromRgba(image);
    expect(after).not.toBe(before);
    expect(regionFingerprintFromRgba(image, DRAFT_TITLE_BOX)).not.toBe(title);
  });
});
