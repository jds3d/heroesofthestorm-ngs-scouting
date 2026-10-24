import { describe, expect, it } from "vitest";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { heroRole } from "@/lib/scoring/heroMeta";
import { heroFillsRole } from "@/lib/scoring/roles";
import type { DraftCompPick } from "@/lib/scoring/types";
import {
  nextStepSuggestion,
  pairCoversRoles,
  rankDoublePickPairs,
  rolesThisPairMustCover,
} from "@/lib/scoring/pickPairs";

describe("nextStepSuggestion", () => {
  it("names the step the draft order says is next", () => {
    expect(nextStepSuggestion(DRAFT_ORDER, 0)).toEqual({
      side: "fp",
      kind: "ban",
      picks: 1,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 4)).toEqual({
      side: "fp",
      kind: "pick",
      picks: 1,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 5)).toEqual({
      side: "sp",
      kind: "pick",
      picks: 2,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 13)).toEqual({
      side: "fp",
      kind: "pick",
      picks: 2,
      last: true,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 15)).toEqual({
      side: "sp",
      kind: "pick",
      picks: 1,
      last: true,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, DRAFT_ORDER.length)).toBeNull();
  });
});

describe("rolesThisPairMustCover", () => {
  it("requires a healer on the last two picks when the team has none", () => {
    expect(rolesThisPairMustCover(["Arthas", "Qhira", "Valla"], 0)).toEqual([
      "healer",
    ]);
  });

  it("leaves the healer for a later pick when one remains", () => {
    expect(rolesThisPairMustCover(["Arthas", "Qhira", "Valla"], 1)).toEqual([]);
  });

  it("does not ask for a healer once one is locked", () => {
    expect(
      rolesThisPairMustCover(["Arthas", "Brightwing", "Valla"], 0),
    ).toEqual([]);
  });
});

describe("rankDoublePickPairs healer requirement", () => {
  it("keeps a healer in the pair when damage solos score higher", () => {
    const locked = ["Arthas", "Qhira", "Valla"];
    const must = rolesThisPairMustCover(locked, 0);
    const seats = [
      {
        role: "Flex",
        player: "Topgun",
        cands: [
          { hero: "Falstad", role: "Ranged", player: "Topgun", fromAlt: false },
          { hero: "Malthael", role: "Bruiser", player: "Topgun", fromAlt: false },
          { hero: "Brightwing", role: "Healer", player: "Topgun", fromAlt: true },
        ],
      },
      {
        role: "Flex",
        player: "MoloE",
        cands: [
          { hero: "Tychus", role: "Ranged", player: "MoloE", fromAlt: false },
          { hero: "Hogger", role: "Bruiser", player: "MoloE", fromAlt: false },
          { hero: "Samuro", role: "Melee", player: "MoloE", fromAlt: false },
          { hero: "Rehgar", role: "Healer", player: "MoloE", fromAlt: true },
        ],
      },
    ];
    const solos: Record<string, number> = {
      Falstad: 80,
      Malthael: 70,
      Tychus: 90,
      Hogger: 85,
      Samuro: 75,
      Brightwing: 10,
      Rehgar: 12,
    };
    const projectBoth = (first: string, second: string): DraftCompPick[] => [
      ...locked.map((hero) => ({
        hero,
        role: heroRole(hero),
        player: null,
        note: "locked",
      })),
      { hero: first, role: heroRole(first), player: null, note: null },
      { hero: second, role: heroRole(second), player: null, note: null },
    ];
    const protect = (hero: string) =>
      must.some((role) => heroFillsRole(hero, role));
    const requirePair = (first: string, second: string) =>
      pairCoversRoles(locked, first, second, must);
    const trimmedAway = rankDoublePickPairs({
      seats,
      soloScore: (hero) => solos[hero] ?? 0,
      contested: () => false,
      projectBoth,
      table: null,
      maxPerSeat: 2,
      requirePair,
    });
    expect(trimmedAway).toEqual([]);
    const pairs = rankDoublePickPairs({
      seats,
      soloScore: (hero) => solos[hero] ?? 0,
      contested: () => false,
      projectBoth,
      table: null,
      maxPerSeat: 2,
      protect,
      requirePair,
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      const heroes = [pair.first, pair.second];
      expect(heroes.some((hero) => heroFillsRole(hero, "healer"))).toBe(true);
    }
  });
});
