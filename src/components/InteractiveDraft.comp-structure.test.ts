import { describe, expect, it } from "vitest";
import { buildPickScorecard, withRolesFactor } from "./InteractiveDraft";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";
import { checkRequiredRoles, heroWaveclear } from "@/lib/scoring/roles";

const card = (hero: string) =>
  ({ hero, total: 10, factors: [] }) as unknown as Parameters<typeof withRolesFactor>[0];

describe("Roles factor", () => {
  it("does not penalize holding the offlaner for the last pick", () => {
    const result = withRolesFactor(card("Falstad"), ["Johanna", "Anduin", "Qhira"]);
    const roles = result.factors.find((factor) => factor.id === "roles")!;
    expect(roles.points).toBe(0);
    expect(roles.detail).toContain("Waveclear 2/3 · 1 pick left");
    expect(result.total).toBe(10);
  });

  it("counts Zagara as the offlaner on an otherwise normal five", () => {
    const roles = checkRequiredRoles([
      "Arthas",
      "Brightwing",
      "Zagara",
      "Raynor",
      "Nova",
    ]);
    expect(roles.missing).not.toContain("offlane");
    expect(roles.missing).toEqual([]);
  });

  it("does not require a bruiser offlaner when waveclear and the front are covered", () => {
    const roles = checkRequiredRoles([
      "Lucio",
      "Stitches",
      "Abathur",
      "Qhira",
      "Kael'thas",
    ]);
    expect(roles.missing).not.toContain("offlane");
    expect(roles.points).toBe(0);
  });

  it("penalizes a lock that makes the team impossible to complete", () => {
    const result = withRolesFactor(card("Thrall"), ["Malthael", "Tyrael", "Qhira"]);
    const roles = result.factors.find((factor) => factor.id === "roles")!;
    // healer and ranged are both open, and one pick is left, so one of them is stuck.
    expect(roles.points).toBe(-12);
    expect(result.total).toBe(-2);
  });

  it("lets Blaze cover the tank and the waveclear on the same five", () => {
    const check = checkRequiredRoles(["Blaze", "Whitemane", "Falstad", "Genji", "Valla"]);
    expect(check.missing).toEqual([]);
    expect(check.points).toBe(0);
  });

  it("charges the same amount for a missing healer and missing ranged damage", () => {
    const noHealer = checkRequiredRoles(["Tyrael", "Dehaka", "Jaina", "Valla", "Raynor"]);
    const noRanged = checkRequiredRoles(["Tyrael", "Anduin", "Dehaka", "Illidan", "Zeratul"]);
    expect(noHealer.points).toBe(-12);
    expect(noRanged.points).toBe(noHealer.points);
  });

  it("does not charge Chen for failing a bruiser-offlane seat", () => {
    const chen = checkRequiredRoles(["Johanna", "Anduin", "Jaina", "Valla", "Chen"]);
    const hogger = checkRequiredRoles(["Johanna", "Anduin", "Jaina", "Valla", "Hogger"]);
    expect(chen.points).toBe(0);
    expect(hogger.points).toBe(0);
    expect(chen.missing).toEqual([]);
  });

  it("accepts Uther or two bruisers in place of a tank", () => {
    const uther = checkRequiredRoles(["Uther", "Falstad", "Jaina", "Raynor", "Thrall"]);
    const bruisers = checkRequiredRoles(["Anduin", "Valla", "Jaina", "Hogger", "Chen"]);
    expect(uther.missing).not.toContain("frontline");
    expect(bruisers.missing).not.toContain("frontline");
    expect(uther.points).toBe(0);
    expect(bruisers.points).toBe(0);
  });

  it("scores Falstad's lane into Leoric without asking him to be a bruiser", () => {
    const table = buildDraftMetaTable({
      patch: "test",
      global: [
        { hero: "Falstad", winRate: 50, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 1000 },
        { hero: "Leoric", winRate: 50, influence: 10, popularity: 20, banRate: 0, pickRate: 0, games: 1000 },
      ],
      matchups: {
        Falstad: [{ hero: "Leoric", wins: 60, losses: 40, games: 100, enemyWinRate: 40 }],
      },
    });
    const card = buildPickScorecard({
      hero: "Falstad",
      table,
      gone: new Set<string>(),
      map: null,
      ourPickCount: 1,
      inPlan: false,
      fromAlt: false,
      planRole: null,
      lockedAllies: ["Johanna"],
      theirLocked: ["Leoric"],
      theirLikely: [],
      banPriority: [],
      comfort: 0,
      swapDelta: 0,
      takeAndRebuild: false,
      kind: "pick",
    });
    const scored = withRolesFactor(card, ["Johanna"]);
    const lane = scored.factors.find((factor) => factor.id === "lane");
    const roles = scored.factors.find((factor) => factor.id === "roles");
    expect(lane?.detail).toContain("Leoric");
    expect(lane?.detail).toContain("60%");
    expect(lane?.points).toBeGreaterThan(0);
    expect(roles?.points).not.toBe(-45);
    expect(roles?.detail ?? "").not.toContain("offlane");
  });

  it("adds each hero's waveclear and slides the penalty with the shortfall", () => {
    expect(heroWaveclear("Chen")).toBe(0);
    expect(heroWaveclear("Hogger")).toBe(2);
    expect(heroWaveclear("Jaina")).toBe(3);
    expect(heroWaveclear("Xul")).toBe(3);

    const none = ["Diablo", "Anduin", "Nova", "Genji", "Tracer"];
    const one = ["Johanna", "Anduin", "Nova", "Genji", "Tracer"];
    const two = ["Johanna", "Muradin", "Anduin", "Nova", "Genji"];
    const three = ["Johanna", "Muradin", "ETC", "Anduin", "Nova"];
    const four = ["Johanna", "Muradin", "Falstad", "Valla", "Anduin"];

    expect(checkRequiredRoles(none, "Cursed Hollow").points).toBe(-12);
    expect(checkRequiredRoles(one, "Cursed Hollow").points).toBe(-9);
    expect(checkRequiredRoles(two, "Cursed Hollow").points).toBe(-6);
    expect(checkRequiredRoles(three, "Cursed Hollow").points).toBe(-3);
    expect(checkRequiredRoles(four, "Cursed Hollow").points).toBe(0);
    expect(checkRequiredRoles(three, "Cursed Hollow").detail).toContain(
      "Waveclear 3/4 on Cursed Hollow (-3)",
    );

    expect(checkRequiredRoles(none, "Dragon Shire").points).toBe(-8);
    expect(checkRequiredRoles(two, "Dragon Shire").points).toBe(-3);
    expect(checkRequiredRoles(three, "Dragon Shire").points).toBe(0);

    const braxis = checkRequiredRoles(none, "Braxis Holdout");
    expect(braxis.points).toBe(0);
    expect(braxis.detail).toContain("not required on Braxis Holdout");

    const alterac = checkRequiredRoles(none, "Alterac Pass");
    expect(alterac.points).toBe(0);
    expect(alterac.waveclearNeed).toBe(0);

    const open = checkRequiredRoles(
      ["Johanna", "Anduin", "Valla"],
      "Cursed Hollow",
    );
    expect(open.points).toBe(0);
    expect(open.detail).toContain("Waveclear 2/4 on Cursed Hollow · 2 picks left");
  });
});
