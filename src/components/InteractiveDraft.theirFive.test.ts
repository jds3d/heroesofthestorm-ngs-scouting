import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_LIVE_DRAFT } from "@/lib/lobby/screenLobby";
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
    const hovers = html.indexOf("Assume other hovers will be locked");
    expect(tournament).toBeGreaterThan(-1);
    expect(comfort).toBeGreaterThan(tournament);
    expect(hovers).toBeGreaterThan(comfort);
    expect(html.slice(hovers - 180, hovers)).toContain("checked");
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

  const auriel = {
    player: "KnoobKnight",
    hero: "Auriel",
    role: "Healer" as const,
    locked: false,
    sl: 0.5,
    comfort: 0.5,
    games: 20,
    points: 18,
  };

  it("pulses a portrait and shows how much of its Storm League card is in", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        hideRole: true,
        queued: ["Auriel"],
        seat: {
          ...auriel,
          breakdown: {
            total: 18,
            factors: [
              {
                id: "matchup",
                label: "Vs their locked",
                points: 4,
                detail: "",
                lines: [
                  "into Leoric: 54.0% win rate (800g) → +4",
                  "into Garrosh: fetching Storm League… → 0",
                ],
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain("50% loading");
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Auriel data 50% loaded");
    expect(html).toContain("text-amber-200");
    expect(html).toContain("+18");
  });

  it("leaves a portrait unmarked once every duo line has a sample", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        seat: {
          ...auriel,
          breakdown: {
            total: 18,
            factors: [
              {
                id: "matchup",
                label: "Vs their locked",
                points: 4,
                detail: "into Leoric: 54.0% win rate (800g) → +4",
              },
            ],
          },
        },
      }),
    );
    expect(html).not.toContain("% loading");
    expect(html).not.toContain("% sampled");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("+18");
  });

  it("shows a quiet percent when the pull is done and a pairing has no sample", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        seat: {
          ...auriel,
          breakdown: {
            total: 18,
            factors: [
              {
                id: "matchup",
                label: "Vs their locked",
                points: 4,
                detail: "",
                lines: [
                  "into Leoric: 54.0% win rate (800g) → +4",
                  "into Garrosh: no Storm League pairing on record → 0",
                ],
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain("50% sampled");
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("% loading");
  });

  it("marks a failed Storm League pull on the portrait", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "enemy",
        failed: ["Auriel"],
        seat: auriel,
      }),
    );
    expect(html).toContain(">Failed<");
    expect(html).toContain("Auriel Storm League data failed to load");
    expect(html).toContain("ring-red-500");
    expect(html).not.toContain("animate-pulse");
  });

  it("does not say loading when the card already has ally and enemy samples", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        table: { patch: "test", source: "heroesprofile-sl", byHero: {} },
        seat: {
          ...auriel,
          hero: "Rexxar",
          points: 31,
          breakdown: {
            total: 31,
            factors: [
              {
                id: "synergy",
                label: "Ally synergy",
                points: 13,
                detail: "3 duos, net +13",
                lines: [
                  "with Rehgar: 54.8% together (3,756g) → +6",
                  "with Tychus: 54.4% together (3,559g) → +5",
                  "with Medivh: 51.8% together (643g) → +2",
                ],
              },
              {
                id: "matchup",
                label: "Vs their locked",
                points: 1,
                detail: "2 duos, net +1",
                lines: [
                  "into Arthas: 52% win rate (2,794g) → +1",
                  "into Tyrael: 49.1% win rate (2,330g) → 0",
                ],
              },
            ],
          },
        },
      }),
    );
    expect(html).not.toContain("% loading");
    expect(html).not.toContain("animate-pulse");
    expect(html).toContain("+31");
  });

  it("shows 0% while the hero's Storm League bundle is not in the table yet", () => {
    const html = renderToStaticMarkup(
      createElement(LikelyPickProjection, {
        accent: "ally",
        table: { patch: "test", source: "heroesprofile-sl", byHero: {} },
        seat: auriel,
      }),
    );
    expect(html).toContain("0% loading");
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Auriel data 0% loaded");
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

describe("reread a lock from the screen", () => {
  const observed = {
    ...EMPTY_LIVE_DRAFT,
    ourBans: ["Johanna"],
    ourPicks: ["Tyrael"],
    ourPickPlayers: ["Saffiel"],
    firstPick: "us" as const,
    phase: "pick" as const,
  };

  it("makes a locked ban and hero a button while the screen is being watched", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveDraft, {
        tree: { id: "t", title: "t", detail: "" },
        weFirst: true,
        watchOnly: true,
        sideKnown: true,
        observedPicks: observed,
        onRereadLock: () => undefined,
      }),
    );
    expect(html).toContain("Remove Johanna and read it from the screen");
    expect(html).toContain("Remove Tyrael and read it from the screen");
  });

  it("leaves the board as pictures when it is not watching the screen", () => {
    const html = renderToStaticMarkup(
      createElement(InteractiveDraft, {
        tree: { id: "t", title: "t", detail: "" },
        weFirst: true,
        watchOnly: false,
        observedPicks: observed,
        onRereadLock: () => undefined,
      }),
    );
    expect(html).not.toContain("Remove Johanna and read it from the screen");
    expect(html).not.toContain("Remove Tyrael and read it from the screen");
  });
});
