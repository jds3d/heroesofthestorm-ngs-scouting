import { describe, expect, it } from "vitest";
import { withRolesFactor } from "./InteractiveDraft";
import { checkRequiredRoles } from "@/lib/scoring/roles";

const card = (hero: string) =>
  ({ hero, total: 10, factors: [] }) as unknown as Parameters<typeof withRolesFactor>[0];

describe("Roles factor", () => {
  it("does not penalize holding the offlaner for the last pick", () => {
    const result = withRolesFactor(card("Falstad"), ["Johanna", "Anduin", "Qhira"]);
    const roles = result.factors.find((factor) => factor.id === "roles")!;
    expect(roles.points).toBe(0);
    expect(roles.detail).toContain("Still need offlane · 1 pick left");
    expect(result.total).toBe(10);
  });

  it("penalizes a lock that makes the team impossible to complete", () => {
    const result = withRolesFactor(card("Thrall"), ["Malthael", "Tyrael", "Qhira"]);
    const roles = result.factors.find((factor) => factor.id === "roles")!;
    // healer + ranged damage missing, one pick left.
    expect(roles.points).toBe(-45);
    expect(result.total).toBe(-35);
  });

  it("counts a dual-role hero for only one role", () => {
    const check = checkRequiredRoles(["Blaze", "Whitemane", "Falstad", "Genji", "Valla"]);
    expect(check.missing).toHaveLength(1);
    expect(check.unfillable).toBe(1);
  });

  it("weights every required role the same", () => {
    const noOfflane = checkRequiredRoles(["Tyrael", "Anduin", "Genji", "Valla", "Jaina"]);
    const noRanged = checkRequiredRoles(["Tyrael", "Anduin", "Dehaka", "Illidan", "Zeratul"]);
    expect(noOfflane.points).toBe(noRanged.points);
  });
});
