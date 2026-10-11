import { describe, expect, it } from "vitest";
import {
  computeTheirLikelyBan,
  draftBoardHasStarted,
  livePlayableBanPriority,
  shouldPredictTheirLikelyBan,
  stormLeagueBlocksSuggestion,
} from "@/components/InteractiveDraft";
import type { DraftMetaTable } from "@/lib/scoring/draftMeta";
import type { DraftCompPick, PlayerScout } from "@/lib/scoring/types";

function scout(
  tag: string,
  heroes: { hero: string; comfort: number; games: number }[],
): PlayerScout {
  return {
    battletag: tag,
    preferredRole: null,
    topHeroes: heroes.map((h) => ({
      hero: h.hero,
      comfort: h.comfort,
      games: h.games,
      playPct: 0.2,
      winRate: 52,
      sources: {},
    })),
    ngsWins: 0,
    ngsLosses: 0,
    confidence: "high",
    heroesProfileUrl: "",
    ngsProfileUrl: "",
    returningFromPrior: false,
  };
}

describe("stormLeagueBlocksSuggestion", () => {
  it("allows our ban suggestions once hero meta is ready even with a thin roster", () => {
    expect(
      stormLeagueBlocksSuggestion({
        stormLeagueOnly: true,
        metaReady: true,
        homeRosterCount: 1,
        step: { side: "sp", kind: "ban" },
        weFirst: false,
      }),
    ).toBe(false);
    expect(
      stormLeagueBlocksSuggestion({
        stormLeagueOnly: true,
        metaReady: true,
        homeRosterCount: 1,
        step: { side: "sp", kind: "pick" },
        weFirst: false,
      }),
    ).toBe(true);
  });
});

describe("livePlayableBanPriority", () => {
  it("falls back to global meta influence when no scout ban list exists yet", () => {
    const table: DraftMetaTable = {
      patch: "test",
      source: "heroesprofile-sl",
      byHero: {
        Qhira: {
          hero: "Qhira",
          winRate: 52,
          influence: 280,
          popularity: 80,
          banRate: 10,
          pickRate: 20,
          games: 5000,
          timing: "flex",
          counteredBy: [],
          synergiesWith: [],
          allySamples: [],
          mapStrong: [],
          note: "",
        },
      },
    };
    const bans = livePlayableBanPriority([], [], () => null, table);
    expect(bans[0]?.hero).toBe("Qhira");
  });
});

describe("shouldPredictTheirLikelyBan", () => {
  it("waits until the draft board or OCR shows a ban", () => {
    expect(draftBoardHasStarted(0, null)).toBe(false);
    expect(
      shouldPredictTheirLikelyBan({
        watchOnly: true,
        sideKnown: true,
        historyLength: 0,
        observed: null,
      }),
    ).toBe(false);
    expect(
      shouldPredictTheirLikelyBan({
        watchOnly: true,
        sideKnown: false,
        historyLength: 0,
        observed: null,
      }),
    ).toBe(false);
    expect(
      shouldPredictTheirLikelyBan({
        watchOnly: true,
        sideKnown: true,
        planLoadingLabel: "Reading names",
        historyLength: 0,
        observed: { theirBans: ["Hogger"] },
      }),
    ).toBe(false);
    expect(
      shouldPredictTheirLikelyBan({
        watchOnly: true,
        sideKnown: true,
        historyLength: 0,
        observed: { theirBans: ["Hogger"] },
      }),
    ).toBe(true);
  });
});

describe("computeTheirLikelyBan", () => {
  it("prefers Falstad over Illidan when Falstad is our imminent pick vs peel locks", () => {
    const homeRoster = [
      scout("Goz#1", [{ hero: "Falstad", comfort: 0.92, games: 220 }]),
      scout("Pangit#1", [{ hero: "Illidan", comfort: 0.88, games: 180 }]),
    ];
    const planPicks: DraftCompPick[] = [
      {
        role: "Melee Assassin",
        hero: "Qhira",
        player: "Huckit",
        note: "locked",
      },
      {
        role: "Ranged Assassin",
        hero: "Mephisto",
        player: "Goz",
        note: null,
        alternatives: [{ hero: "Falstad", player: "Goz" }],
      },
      {
        role: "Tank",
        hero: "Tyrael",
        player: "Level",
        note: null,
      },
      {
        role: "Healer",
        hero: "Auriel",
        player: "Whisper",
        note: null,
      },
      {
        role: "Offlane",
        hero: "Leoric",
        player: "Pangit",
        note: null,
      },
    ];
    const field = ["Falstad", "Illidan", "Mephisto", "Tyrael", "Auriel"];
    const result = computeTheirLikelyBan({
      field,
      gone: new Set(["qhira", "brightwing", "abathur"]),
      homeRoster,
      planPicks,
      ourLockedHeroes: ["Qhira"],
      theirLockedHeroes: ["Brightwing", "Abathur"],
      ourHeroPool: ["Falstad", "Illidan", "Mephisto", "Tyrael", "Auriel"],
      scoringMeta: null,
      map: null,
      ourPickCount: 1,
      ourBanPriority: [],
      isLastStep: false,
      ourHeld: new Set(["huckit"]),
      openOurPlayers: ["Goz"],
      archetype: "dive",
    });
    expect(result?.hero).toBe("Falstad");
    expect(result?.imminentPick).toBe(true);
    expect(result?.antiDive).toBe(true);
  });
});
