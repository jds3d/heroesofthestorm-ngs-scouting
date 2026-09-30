import { describe, expect, it } from "vitest";
import {
  percentileRank,
  roleMatchedPair,
  roleMatchedSingle,
} from "@/lib/scoring/roleBenchmark";

const solo: Record<string, number> = {
  Tyrael: 29,
  "E.T.C.": 20,
  Whitemane: 26,
  Anduin: 18,
  "Kael'thas": -15,
  Hanzo: 12,
  "Li-Ming": 5,
  Illidan: 30,
};
const pool = Object.keys(solo);
const card = (hero: string) => ({ hero, total: solo[hero] });
const pair = (a: string, b: string) => ({
  hero: a,
  pairWith: b,
  total: solo[a] + solo[b],
});

describe("roleMatchedSingle", () => {
  it("grades an assassin against the best assassin, not a tank", () => {
    const r = roleMatchedSingle({
      best: card("Tyrael"),
      chosen: card("Kael'thas"),
      pool,
      score: card,
      roleBlocked: false,
    });
    expect(r.roleMatched).toBe(true);
    // Hanzo is the best Ranged Assassin; melee Illidan does not count.
    expect(r.benchmark.hero).toBe("Hanzo");
  });

  it("gives full marks when the pick is the best in its role", () => {
    const r = roleMatchedSingle({
      best: card("Tyrael"),
      chosen: card("Hanzo"),
      pool,
      score: card,
      roleBlocked: false,
    });
    expect(r.benchmark.hero).toBe("Hanzo");
  });

  it("keeps the overall best when the role choice breaks the comp", () => {
    const r = roleMatchedSingle({
      best: card("Tyrael"),
      chosen: card("Kael'thas"),
      pool,
      score: card,
      roleBlocked: true,
    });
    // Ranked against every open hero, so Illidan (+30) is the benchmark.
    expect(r.benchmark.hero).toBe("Illidan");
    expect(r.roleMatched).toBe(false);
    expect(percentileRank(-15, r.field)).toBe(0);
  });
});

describe("percentileRank", () => {
  it("ranks from worst (0) to best (100) with ties counted half", () => {
    expect(percentileRank(10, [10, 5, 0, 20, 30])).toBe(50);
    expect(percentileRank(30, [10, 5, 0, 20, 30])).toBe(100);
    expect(percentileRank(0, [10, 5, 0, 20, 30])).toBe(0);
    expect(percentileRank(5, [5, 5, 0])).toBe(75);
    expect(percentileRank(3, [3])).toBe(100);
  });

  it("can rank a negative score well when the field is worse", () => {
    const r = roleMatchedSingle({
      best: card("Tyrael"),
      chosen: card("Li-Ming"),
      pool,
      score: card,
      roleBlocked: false,
    });
    // Ranged field: Hanzo 12, Li-Ming 5, Kael'thas -15.
    expect(r.field.sort((a, b) => a - b)).toEqual([-15, 5, 12]);
    expect(percentileRank(5, r.field)).toBe(50);
  });
});

describe("roleMatchedPair", () => {
  it("compares healer + ranged to the best healer + ranged pair", () => {
    const r = roleMatchedPair({
      best: pair("Tyrael", "Whitemane"),
      chosen: pair("Whitemane", "Kael'thas"),
      pool,
      soloTotal: (h) => solo[h],
      assemble: pair,
      roleBlocked: false,
    });
    expect(r.roleMatched).toBe(true);
    expect([r.benchmark.hero, r.benchmark.pairWith]).toEqual(["Whitemane", "Hanzo"]);
    expect(r.benchmark.total).toBe(38);
  });

  it("uses the overall best pair when roles match", () => {
    const r = roleMatchedPair({
      best: pair("Tyrael", "Whitemane"),
      chosen: pair("E.T.C.", "Anduin"),
      pool,
      soloTotal: (h) => solo[h],
      assemble: pair,
      roleBlocked: false,
    });
    expect(r.roleMatched).toBe(false);
    expect(r.benchmark.hero).toBe("Tyrael");
  });
});
