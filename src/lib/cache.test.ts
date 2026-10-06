import { afterEach, describe, expect, it } from "vitest";
import {
  cacheMemorySize,
  FOREVER,
  getCached,
  invalidateCached,
  readNewestCacheByPrefix,
  setCached,
} from "@/lib/cache";

const prefixes = ["hp-v1-ngs-replay-review-", "scan_", "mem-evict-"];

afterEach(async () => {
  await Promise.all(prefixes.map((prefix) => invalidateCached(prefix)));
});

describe("cache TTL", () => {
  it("expires a replay key when the caller passed a short TTL", async () => {
    await setCached("hp-v1-ngs-replay-review-expired", { ok: 1 }, -1);
    expect(await getCached("hp-v1-ngs-replay-review-expired", FOREVER)).toBeNull();
  });

  it("keeps a replay key for the TTL the caller passed", async () => {
    await setCached("hp-v1-ngs-replay-review-live", { ok: 3 }, 60_000);
    expect(await getCached("hp-v1-ngs-replay-review-live", FOREVER)).toEqual({ ok: 3 });
  });

  it("keeps an explicit forever replay", async () => {
    await setCached("hp-v1-ngs-replay-review-keep", { ok: 2 }, FOREVER);
    expect(await getCached("hp-v1-ngs-replay-review-keep")).toEqual({ ok: 2 });
  });

  it("reports freshness from the file key, not the search prefix", async () => {
    await setCached("scan_new", { n: 2 }, -1);
    const hit = await readNewestCacheByPrefix<{ n: number }>("scan");
    expect(hit?.data).toEqual({ n: 2 });
    expect(hit?.fresh).toBe(false);
  });

  it("drops cold entries from memory and still reads them from disk", async () => {
    for (let i = 0; i < 420; i += 1) {
      await setCached(`mem-evict-${i}`, { i }, FOREVER);
    }
    expect(cacheMemorySize()).toBeLessThanOrEqual(400);
    expect(await getCached("mem-evict-0", FOREVER)).toEqual({ i: 0 });
  });
});
