import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LikelyPickProjection,
  MatchupTracker,
  MissingDataBadge,
} from "./InteractiveDraft";

describe("Likely pick projection", () => {
  it("labels ranged damage as assassin", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "enemy",
        seat: {
          player: "Cinema",
          hero: "Valla",
          role: "Ranged",
          locked: false,
          sl: 1,
          comfort: 1,
          games: 12,
        },
      }),
    );
    expect(html).toContain("Assassin");
    expect(html).toContain("Valla");
    expect(html).toContain("Cinema");
    expect(html).toContain("ring-dashed");
  });
});

describe("matchup tracker", () => {
  it("names the heroes on the pulling step", () => {
    const html = renderToStaticMarkup(
      createElement(MatchupTracker, {
        track: { stage: "pulling", heroes: ["Tyrael", "Valla"] },
        error: null,
        onDismiss: () => undefined,
      }),
    );
    expect(html).toContain("Matchup tracker");
    expect(html).toContain("Pulling");
    expect(html).toContain("Tyrael");
    expect(html).toContain("Valla");
    expect(html).toContain("Spotted");
    expect(html).toContain("Cached");
    expect(html).toContain("Scored");
  });
});

describe("missing data badge", () => {
  it("is amber and names the gap plus the loaded percent while a pull is running", () => {
    const html = renderToStaticMarkup(
      createElement(MissingDataBadge, {
        gap: {
          missing: ["into Garrosh: fetching Storm League…"],
          percent: 50,
          loading: true,
          failed: false,
        },
      }),
    );
    expect(html).toContain("bg-amber-400");
    expect(html).toContain(">50%<");
    expect(html).toContain("Missing data");
    expect(html).toContain("into Garrosh: fetching Storm League…");
    expect(html).toContain("50% loaded");
  });

  it("is red when the pull failed", () => {
    const html = renderToStaticMarkup(
      createElement(MissingDataBadge, {
        gap: {
          missing: ["Storm League matchups for Valla"],
          percent: 0,
          loading: false,
          failed: true,
        },
      }),
    );
    expect(html).toContain("bg-red-600");
    expect(html).toContain(">Failed<");
    expect(html).toContain("Failed to load");
    expect(html).toContain("Storm League matchups for Valla");
    expect(html).not.toContain("% loaded");
  });
});
