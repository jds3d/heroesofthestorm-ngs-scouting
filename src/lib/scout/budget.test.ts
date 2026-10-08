import { describe, expect, it } from "vitest";
import {
  ScoutBudgetExceeded,
  assertScoutBudget,
  isScoutBudgetExceeded,
  runWithScoutBudget,
  withTighterBudget,
} from "@/lib/scout/budget";

describe("scout request budget", () => {
  it("allows work inside the budget", async () => {
    const value = await runWithScoutBudget(async () => {
      assertScoutBudget(1_000);
      return "ok";
    }, 60_000);
    expect(value).toBe("ok");
  });

  it("stops before a wait would run past the budget", async () => {
    await expect(
      runWithScoutBudget(async () => {
        assertScoutBudget(5_000);
      }, 1_000),
    ).rejects.toBeInstanceOf(ScoutBudgetExceeded);
  });

  it("tightens the deadline without shortening the rest of the request", async () => {
    await runWithScoutBudget(async () => {
      await expect(
        withTighterBudget(1_000, async () => {
          assertScoutBudget(5_000);
        }),
      ).rejects.toBeInstanceOf(ScoutBudgetExceeded);
      expect(() => assertScoutBudget(5_000)).not.toThrow();
    }, 60_000);
  });

  it("does nothing outside a scout request", () => {
    expect(() => assertScoutBudget(60_000)).not.toThrow();
    expect(isScoutBudgetExceeded(new ScoutBudgetExceeded())).toBe(true);
    expect(isScoutBudgetExceeded(new Error("no"))).toBe(false);
  });
});
