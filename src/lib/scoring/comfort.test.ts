import { describe, expect, it } from "vitest";
import {
  COMFORT_SUGGEST_MIN,
  buildPlayerComfort,
  comfortFromSources,
  fallbackPoolScore,
  filterBanList,
  heroMeetsSuggestBar,
  mergeSourceMaps,
  anySuggestablePair,
  playerComfortOn,
  playersMeetingSuggestBar,
  sourceMapGames,
  stormLeagueGames,
  stormLeagueScore,
  suggestablePairOwners,
} from "@/lib/scoring/comfort";
import type { ComfortHero, PlayerScout, SourceHeroStat } from "@/lib/scoring/types";

function sl(
  wins: number,
  losses: number,
  recent?: [number, number],
  playPct = 0.05,
): SourceHeroStat {
  const games = wins + losses;
  return {
    games,
    wins,
    losses,
    winRate: wins / games,
    playPct,
    recentGames: recent ? recent[0] + recent[1] : undefined,
    recentWins: recent ? recent[0] : undefined,
  };
}

describe("stormLeagueScore", () => {
  it("rewards a long winning history even when it is a small share of games", () => {
    // 89-64 Xul over two years, mostly before the recent window, at 7% of games.
    const deep = stormLeagueScore(sl(89, 64, [5, 3], 0.07));
    expect(deep).toBeGreaterThan(0.25);
  });

  it("keeps a long losing record low", () => {
    // 9-20 Kael'thas, 2-14 of it recent.
    expect(stormLeagueScore(sl(9, 20, [2, 14]))).toBeLessThan(0.1);
  });

  it("does not trust a tiny perfect sample", () => {
    expect(stormLeagueScore(sl(4, 0, [4, 0]))).toBeLessThan(0.08);
  });

  it("counts recent games more than old ones", () => {
    const recent = stormLeagueScore(sl(30, 20, [30, 20]));
    const old = stormLeagueScore(sl(30, 20, [0, 0]));
    expect(recent).toBeGreaterThan(old);
  });
});

describe("comfortFromSources", () => {
  it("lets Storm League history carry a hero with no NGS games", () => {
    const c = comfortFromSources("Xul", undefined, sl(89, 64, [5, 3], 0.07));
    expect(c.comfort).toBeGreaterThan(0.2);
  });
});

describe("suggest bar", () => {
  const hero = (name: string, comfort: number): ComfortHero => ({
    hero: name,
    comfort,
    playPct: 0,
    winRate: 0,
    games: 0,
    sources: {},
  });

  const roster: PlayerScout[] = [
    {
      battletag: "Beachyman#11746",
      topHeroes: [hero("Stitches", 0.22), hero("Garrosh", 0.04)],
    } as PlayerScout,
  ];

  it("uses UI score 15 as the minimum raw comfort", () => {
    expect(COMFORT_SUGGEST_MIN).toBe(0.15);
  });

  it("allows core heroes and blocks off-pool shells", () => {
    expect(
      heroMeetsSuggestBar(roster, "Stitches", "Beachyman"),
    ).toBe(true);
    expect(
      heroMeetsSuggestBar(roster, "Garrosh", "Beachyman"),
    ).toBe(false);
    expect(playerComfortOn(roster, "Stitches", "Beachyman")).toBe(0.22);
  });

  it("will not hand a hero to a player under 15 when someone else clears it", () => {
    const thin = hero("Garrosh", 0.04);
    const deep = hero("Garrosh", 0.22);
    const azmo = hero("Azmodan", 0.18);
    const stitches = hero("Stitches", 0.22);
    const home: PlayerScout[] = [
      { battletag: "Beachyman#1", topHeroes: [thin, stitches] } as PlayerScout,
      { battletag: "MrHustler#1", topHeroes: [deep] } as PlayerScout,
      { battletag: "Topgun707#1", topHeroes: [azmo] } as PlayerScout,
    ];
    const taken = new Set(["mrhustler"]);
    expect(playersMeetingSuggestBar(home, "Garrosh", taken)).toEqual([]);
    expect(playersMeetingSuggestBar(home, "Stitches", taken)[0]?.player).toBe(
      "Beachyman",
    );
    expect(
      suggestablePairOwners(home, "Azmodan", "Garrosh", "Topgun707", "Beachyman", taken),
    ).toBeNull();
    expect(
      suggestablePairOwners(
        home,
        "Azmodan",
        "Stitches",
        "Topgun707",
        "Beachyman",
        taken,
      )?.second.player,
    ).toBe("Beachyman");
    expect(anySuggestablePair(home, ["Azmodan", "Garrosh"], taken)).toBe(false);
    expect(anySuggestablePair(home, ["Azmodan", "Stitches"], taken)).toBe(true);
  });

  it("relaxes when nobody clears 15", () => {
    const home: PlayerScout[] = [
      { battletag: "Beachyman#1", topHeroes: [hero("Garrosh", 0.04)] } as PlayerScout,
    ];
    expect(playersMeetingSuggestBar(home, "Garrosh")).toEqual([]);
    expect(anySuggestablePair(home, ["Garrosh", "Azmodan"])).toBe(false);
  });

  it("filters ban lists to heroes the roster actually plays", () => {
    const bans = filterBanList(
      roster,
      [
        { hero: "Stitches", reason: "core tank" },
        { hero: "Garrosh", reason: "meta shell" },
      ],
      () => "Beachyman",
    );
    expect(bans.map((b) => b.hero)).toEqual(["Stitches"]);
  });
});

describe("thin Storm League fallback", () => {
  function row(games: number, wins: number): SourceHeroStat {
    return {
      games,
      wins,
      losses: games - wins,
      winRate: wins / games,
      playPct: 0.1,
    };
  }

  it("clears the suggest bar on a few NGS games and ignores a single game", () => {
    expect(fallbackPoolScore(row(1, 1))).toBeLessThan(COMFORT_SUGGEST_MIN);
    expect(fallbackPoolScore(row(3, 2))).toBeGreaterThan(COMFORT_SUGGEST_MIN);
    expect(fallbackPoolScore(row(8, 5))).toBeGreaterThan(fallbackPoolScore(row(3, 2)));
  });

  it("reads the hero from NGS history when recent Storm League is thin", () => {
    const player = buildPlayerComfort({
      battletag: "Stark#2324",
      ngsCurrent: new Map([["Kerrigan", row(4, 2)]]),
      stormLeague: new Map(),
      ngsPrior: new Map([
        ["Kerrigan", row(6, 4)],
        ["Falstad", row(5, 3)],
      ]),
      includePrior: true,
      ngsWins: 11,
      ngsLosses: 5,
      heroesProfileUrl: "",
      ngsProfileUrl: "",
    });
    const kerrigan = player.topHeroes.find((h) => h.hero === "Kerrigan");
    expect(kerrigan?.comfort).toBeGreaterThan(COMFORT_SUGGEST_MIN);
    expect(kerrigan?.sources.stormLeague).toBeUndefined();
    expect(kerrigan?.games).toBe(10);
  });

  it("uses Quick Match only for heroes NGS does not cover", () => {
    const player = buildPlayerComfort({
      battletag: "Stark#2324",
      ngsCurrent: new Map([["Kerrigan", row(4, 2)]]),
      stormLeague: new Map(),
      ngsPrior: new Map(),
      includePrior: false,
      quickMatch: new Map([["Xal'atath", row(4, 2)]]),
      ngsWins: 0,
      ngsLosses: 0,
      heroesProfileUrl: "",
      ngsProfileUrl: "",
    });
    expect(player.topHeroes.map((h) => h.hero).sort()).toEqual([
      "Kerrigan",
      "Xal'atath",
    ]);
    const qm = player.topHeroes.find((h) => h.hero === "Xal'atath");
    expect(qm?.sources.quickMatch?.games).toBe(4);
    expect(qm?.comfort).toBeLessThan(
      player.topHeroes.find((h) => h.hero === "Kerrigan")!.comfort,
    );
  });

  it("keeps a deep Storm League pool and leaves Quick Match out", () => {
    const player = buildPlayerComfort({
      battletag: "Beachyman#11746",
      ngsCurrent: new Map(),
      stormLeague: new Map([["Stitches", sl(80, 60, [20, 10])]]),
      ngsPrior: new Map(),
      includePrior: false,
      quickMatch: new Map([["Abathur", row(40, 20)]]),
      ngsWins: 10,
      ngsLosses: 6,
      heroesProfileUrl: "",
      ngsProfileUrl: "",
    });
    expect(player.topHeroes.map((h) => h.hero)).toEqual(["Stitches"]);
    expect(sourceMapGames(mergeSourceMaps([
      new Map([["Falstad", row(3, 2)]]),
      new Map([["Falstad", row(2, 1)]]),
    ]))).toBe(5);
  });
});

describe("stormLeagueGames", () => {
  it("is zero when the saved pool has no Storm League games", () => {
    const player = {
      topHeroes: [
        { sources: { ngsCurrent: sl(3, 1) } },
        { sources: {} },
      ],
    } as PlayerScout;
    expect(stormLeagueGames(player)).toBe(0);
    player.topHeroes[0].sources.stormLeague = sl(2, 2);
    expect(stormLeagueGames(player)).toBe(4);
  });
});
