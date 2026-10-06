import { AsyncLocalStorage } from "async_hooks";

/**
 * Cloudflare returns HTML 524 when the origin sends no response within the
 * proxy read timeout (~125s). Each scout HTTP call stays inside this budget
 * and the browser continues the same scout from cached progress.
 */
export const SCOUT_REQUEST_BUDGET_MS = 90_000;

export class ScoutBudgetExceeded extends Error {
  constructor() {
    super("Scout paused before the proxy timeout");
    this.name = "ScoutBudgetExceeded";
  }
}

const budget = new AsyncLocalStorage<{ deadline: number }>();

export function isScoutBudgetExceeded(
  err: unknown,
): err is ScoutBudgetExceeded {
  return err instanceof ScoutBudgetExceeded;
}

/** Throw when this scout request has used its time, including a planned wait. */
export function assertScoutBudget(extraMs = 0): void {
  const store = budget.getStore();
  if (!store) return;
  if (Date.now() + extraMs >= store.deadline) throw new ScoutBudgetExceeded();
}

export function runWithScoutBudget<T>(
  fn: () => Promise<T>,
  budgetMs = SCOUT_REQUEST_BUDGET_MS,
): Promise<T> {
  return budget.run({ deadline: Date.now() + budgetMs }, fn);
}
