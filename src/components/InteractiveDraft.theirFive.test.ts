import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InteractiveDraft,
  LikelyPickProjection,
  MatchupTracker,
  MissingDataBadge,
  SuggestionStack,
  observedDraftSlots,
} from "./InteractiveDraft";

describe("draft board options", () => {
  it("puts Ignore comfort next to tournament draft mode", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveDraft, {
        tree: { id: "t", title: "t", detail: "" },
        weFirst: true,
      }),
    );
    const tournament = html.indexOf("Tournament draft mode");
    const comfort = html.indexOf("Ignore comfort");
    expect(tournament).toBeGreaterThan(-1);
    expect(comfort).toBeGreaterThan(tournament);
  });
});

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

  it("puts the take order in the corner of the portrait", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        hideRole: true,
        seat: {
          player: "Huckit",
          hero: "Qhira",
          role: "Flex",
          locked: false,
          sl: 0.4,
          comfort: 0.4,
          games: 20,
          order: 1,
        },
      }),
    );
    expect(html).toContain('aria-label="Take 1"');
    expect(html).toContain("absolute left-0 top-0");
  });

  it("keeps the factor scorecard when the face also has a short why", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        hideRole: true,
        seat: {
          player: "Beachyman",
          hero: "Johanna",
          role: "Tank",
          locked: false,
          sl: 0.4,
          comfort: 0.4,
          games: 20,
          points: 25,
          why: "Beachyman · seat comfort 40",
          breakdown: {
            total: 25,
            factors: [
              {
                id: "comfort",
                label: "Player comfort",
                points: 25,
                detail: "Beachyman · seat comfort 40",
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain("Johanna score breakdown, total 25");
    expect(html).not.toContain('title="Beachyman · seat comfort 40"');
  });

  it("stacks three faces under an open slot", () => {
    const seat = {
      player: "EKevin",
      hero: "Nazeebo",
      role: "Ranged" as const,
      locked: false,
      sl: 1,
      comfort: 1,
      games: 10,
    };
    const html = renderToStaticMarkup(
      createElement(SuggestionStack, {
        accent: "enemy",
        seats: [
          seat,
          { ...seat, hero: "Jaina" },
          { ...seat, hero: "Valla" },
        ],
      }),
    );
    expect(html).toContain("Nazeebo");
    expect(html).toContain("Jaina");
    expect(html).toContain("Valla");
    expect(html).toContain("EKevin");
    expect(html).not.toContain("Pick one for EKevin");
    expect(html).toContain("Assassin");
    expect(html).toContain("Nazeebo");
    expect(html).toContain("Jaina");
    expect(html).toContain("Valla");
  });

  it("shows each lineup's job under that face when the rows are full comps", () => {
    const html = renderToStaticMarkup(
      createElement(SuggestionStack, {
        accent: "ally",
        compRows: true,
        seats: [
          {
            player: "SKilleen",
            hero: "Johanna",
            role: "Tank",
            locked: false,
            sl: 0.3,
            comfort: 0.3,
            games: 40,
            points: 40,
            why: "Lineup 2 · combined 22\nStorm League 32 (97 games) × 100% pool = 32 likely",
            breakdown: {
              total: 40,
              factors: [
                {
                  id: "comfort",
                  label: "Player comfort",
                  points: 40,
                  detail: "SKilleen · seat comfort 30",
                },
              ],
            },
          },
          {
            player: "SKilleen",
            hero: "Sonya",
            role: "Offlane",
            locked: false,
            sl: 0.2,
            comfort: 0.2,
            games: 16,
            points: 30,
          },
        ],
      }),
    );
    expect(html).toContain("Tank");
    expect(html).toContain("Offlane");
    expect(html).toContain("Johanna");
    expect(html).toContain("Sonya");
    expect(html).toContain("Johanna score breakdown, total 40");
    expect(html).not.toContain("Lineup 2");
  });

  it("labels our ban stack and waits in a yellow box while comfort is loading", () => {
    const ready = renderToStaticMarkup(
      createElement(SuggestionStack, {
        accent: "ally",
        caption: "Our suggested ban",
        wide: true,
        showPlayer: true,
        seats: [
          {
            player: "Tenshi",
            hero: "Johanna",
            role: "Tank",
            locked: false,
            sl: 0.4,
            comfort: 0.4,
            games: 80,
            points: 28,
          },
        ],
      }),
    );
    expect(ready).toContain("Our suggested ban");
    expect(ready).toContain("Tenshi");
    const waiting = renderToStaticMarkup(
      createElement(SuggestionStack, {
        accent: "ally",
        pending: true,
        pendingDetail:
          "Suggested bans for Blood, Stux. Storm League games are loading from Heroes Profile, one request per player. The list ranks heroes they actually play, so it stays blank until the first pool with games comes back.",
        seats: [],
      }),
    );
    expect(waiting).toContain("Suggested bans for Blood, Stux");
    expect(waiting).toContain("Heroes Profile");
    expect(waiting).toContain("one request per player");
    expect(waiting).toContain("border-amber-400/70");
  });
});

describe("observed draft slots", () => {
  it("shows every screen lock, including a hero the turn order has not reached", () => {
    const picks = observedDraftSlots(
      ["Johanna", "Nazeebo", "Falstad", "Leoric"],
      ["Crogunt", "EKevin", null, "Hecarimj"],
      "their",
      "pick",
      5,
    );
    expect(picks.map((slot) => slot?.hero ?? null)).toEqual([
      "Johanna",
      "Nazeebo",
      "Falstad",
      "Leoric",
      null,
    ]);
    const bans = observedDraftSlots(
      ["Xal'atath", "The Lost Vikings", "Chromie"],
      [],
      "their",
      "ban",
      3,
    );
    expect(bans.map((slot) => slot?.hero)).toEqual([
      "Xal'atath",
      "The Lost Vikings",
      "Chromie",
    ]);
    expect(bans.every((slot) => slot?.kind === "ban")).toBe(true);
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
