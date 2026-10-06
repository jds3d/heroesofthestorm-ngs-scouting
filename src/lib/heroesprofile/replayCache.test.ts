import { describe, expect, it } from "vitest";
import type { HpNgsMatch, HpReplayData } from "@/lib/heroesprofile/types";
import {
  buildDraftShell,
  cachedMatchTrustworthy,
  isDraftOnlyReplay,
  ourSideWon,
} from "@/lib/heroesprofile/replayCache";

function match(winner: boolean | null, winnersKnown?: boolean): HpNgsMatch {
  return {
    season: "22",
    division: "A",
    team: "Them",
    enemy: "Us",
    round: "1",
    total_games: 1,
    team_map_bans: [],
    enemy_map_bans: [],
    winnersKnown,
    match_data: {
      "1": {
        map: "Infernal Shrines",
        length: 1,
        winner,
        team_heroes: ["Diablo"],
        enemy_heroes: ["Malthael"],
        team_bans: [],
        enemy_bans: [],
      },
    },
  };
}

describe("draft replay shells", () => {
  it("refuses a draft list that has no team numbers", () => {
    expect(
      buildDraftShell([
        { hero: "Diablo" },
        { hero: "Rehgar" },
        { hero: "Valla" },
        { hero: "Johanna" },
        { hero: "Kael'thas" },
      ]),
    ).toBeNull();
  });

  it("keeps team ids and does not invent a winner", () => {
    const shell = buildDraftShell([
      { hero: "Diablo", team: 0 },
      { hero: "Rehgar", team: 0 },
      { hero: "Valla", team: 0 },
      { hero: "Johanna", team: 1 },
      { hero: "Kael'thas", team: 1 },
    ]);
    expect(shell?.players.map((player) => player.team)).toEqual([0, 0, 0, 1, 1]);
    expect(isDraftOnlyReplay(shell)).toBe(true);
    expect(ourSideWon(shell, 0)).toBeNull();
  });

  it("reads a real replay winner from winner_team", () => {
    const replay: HpReplayData = {
      winner_team: 1,
      players: [
        { battletag: "a#1", hero: "Diablo", team: 0, winner: false },
        { battletag: "b#1", hero: "Malthael", team: 1, winner: true },
      ],
    };
    expect(ourSideWon(replay, 1)).toBe(true);
    expect(ourSideWon(replay, 0)).toBe(false);
  });

  it("does not trust a legacy all-loss round", () => {
    expect(cachedMatchTrustworthy(match(false))).toBe(false);
    expect(cachedMatchTrustworthy(match(true))).toBe(true);
    expect(cachedMatchTrustworthy(match(null, false))).toBe(false);
    expect(cachedMatchTrustworthy(match(true, true))).toBe(true);
  });
});
