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

/**
 * Run `fn` under the sooner of the current scout deadline and `maxMs` from
 * now. The outer deadline is unchanged when `fn` returns, so a slow side
 * task (hero matchups) can yield the response without eating the whole request.
 */
export function withTighterBudget<T>(
  maxMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = budget.getStore();
  const deadline = Math.min(parent?.deadline ?? Infinity, Date.now() + maxMs);
  return budget.run({ deadline }, fn);
}
