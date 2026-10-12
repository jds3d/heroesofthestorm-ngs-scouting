import { afterEach, describe, expect, it, vi } from "vitest";

describe("scheduleReplaySyncOnStartup", () => {
  afterEach(() => {
    delete (globalThis as { __ngsReplayStartupSync?: unknown }).__ngsReplayStartupSync;
    vi.resetModules();
  });

  it("returns the same promise when called twice", async () => {
    vi.doMock("./syncReplays", () => ({
      syncReplayBattletags: vi.fn().mockResolvedValue({
        ok: true,
        replayDir: "/replays",
        queued: 0,
        processed: 0,
        failed: 0,
        newNames: [],
      }),
    }));
    const { scheduleReplaySyncOnStartup } = await import("./startupSync");
    const a = scheduleReplaySyncOnStartup();
    const b = scheduleReplaySyncOnStartup();
    expect(a).toBe(b);
    await a;
  });
});
