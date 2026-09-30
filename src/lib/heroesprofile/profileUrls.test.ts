import { describe, expect, it } from "vitest";
import {
  heroesProfilePlayerUrl,
  ngsHeroesProfileUrl,
} from "@/lib/heroesprofile/profileUrls";

describe("profile urls", () => {
  it("builds Storm League and NGS pages with the Blizzard id", () => {
    expect(heroesProfilePlayerUrl("Stark#2324", 612765)).toBe(
      "https://www.heroesprofile.com/Player/Stark/612765/1",
    );
    expect(ngsHeroesProfileUrl("Stark#2324", 612765)).toBe(
      "https://www.heroesprofile.com/NGS/Player/Stark/612765/1",
    );
  });
});
