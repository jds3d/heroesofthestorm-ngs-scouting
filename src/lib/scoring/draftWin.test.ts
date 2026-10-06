import { describe, expect, it } from "vitest";
import type { HpNgsMatch } from "@/lib/heroesprofile/types";
import type { NgsMatch } from "@/lib/ngs/types";
import { buildDraftInsights } from "@/lib/scoring/draft";

const ngsMatch = {
  matchId: "1",
  round: 1,
  season: 22,
  divisionConcat: "a",
  reported: true,
  home: { teamName: "Them" },
  away: { teamName: "Us" },
} as NgsMatch;

describe("map results from replays", () => {
  it("leaves an unknown winner out of the map record", () => {
    const hpMatch: HpNgsMatch = {
      season: "22",
      division: "A",
      team: "Them",
      enemy: "Us",
      round: "1",
      total_games: 2,
      team_map_bans: [],
      enemy_map_bans: [],
      winnersKnown: false,
      match_data: {
        "1": {
          map: "Infernal Shrines",
          length: 1000,
          winner: null,
          team_heroes: ["Diablo", "Rehgar", "Valla", "Johanna", "Kael'thas"],
          enemy_heroes: [],
          team_bans: [],
          enemy_bans: [],
        },
        "2": {
          map: "Infernal Shrines",
          length: 1000,
          winner: true,
          team_heroes: ["Diablo", "Rehgar", "Valla", "Johanna", "Kael'thas"],
          enemy_heroes: [],
          team_bans: [],
          enemy_bans: [],
        },
      },
    };

    const insights = buildDraftInsights(
      "Them",
      [{ ngsMatch, hpMatch, weight: 1 }],
      [],
    );
    const shrines = insights.mapTendencies.find((row) => row.map === "Infernal Shrines");
    expect(shrines?.games).toBe(1);
    expect(shrines?.wins).toBe(1);
  });
});
