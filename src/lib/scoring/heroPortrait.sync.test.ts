import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncHeroPortraits } from "@/lib/scoring/syncHeroPortraits";

const root = path.resolve(import.meta.dirname, "../../..");

describe("syncHeroPortraits", () => {
  it(
    "downloads HeroesToolChest portraits into public/heroes",
    async () => {
      let result = await syncHeroPortraits(root);
      if (result.failed.length) {
        result = await syncHeroPortraits(root, { concurrency: 2 });
      }
      expect(result.failed, JSON.stringify(result.failed, null, 2)).toEqual([]);
      expect(result.downloaded + result.skipped).toBeGreaterThan(0);
    },
    180_000,
  );
});
