import { describe, expect, it } from "vitest";
import { heroKey } from "./heroMeta";
import {
  expandHeroMatchupLoadBars,
  formatPerHeroMatchupLine,
  matchupHeroLoadLines,
  perHeroMatchupSource,
} from "./matchupLoadDisplay";

describe("matchupLoadDisplay", () => {
  it("lists one line per hero with API vs cache source", () => {
    const lines = matchupHeroLoadLines(
      ["Qhira", "Johanna"],
      "api",
      { [heroKey("Qhira")]: 1, [heroKey("Johanna")]: 0 },
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^API call: Qhira/);
    expect(lines[1]).toMatch(/^Server cache: Johanna/);
  });

  it("expands to one bar item per Heroes Profile HTTP call", () => {
    const items = expandHeroMatchupLoadBars(
      ["Tyrael"],
      "api",
      { [heroKey("Tyrael")]: 2 },
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.label).toContain("API call 1/2");
    expect(items[0]?.params).toContain("heroes/matchups");
  });

  it("defaults to one API line per hero when counts are unknown", () => {
    const source = perHeroMatchupSource("Valla", "api");
    expect(source.mode).toBe("api");
    expect(formatPerHeroMatchupLine("Valla", source)).toBe(
      "API call: Valla (1 Heroes Profile request)",
    );
  });
});
