import { describe, expect, it } from "vitest";
import { comfortFromSources, stormLeagueScore } from "@/lib/scoring/comfort";
import type { SourceHeroStat } from "@/lib/scoring/types";

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
