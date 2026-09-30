/**
 * Grade a pick against the other heroes in the same role, not the best hero
 * overall: a team still has to fill every seat, so a strong tank on the board
 * does not make every assassin pick a mistake.
 */
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";

type Scored = { hero: string; pairWith?: string; total: number };

export type RoleBenchmark<T extends Scored> = {
  benchmark: T;
  /** True when the benchmark is the best same-role option, not the overall top. */
  roleMatched: boolean;
  /** Totals of every option this lock is ranked against, including itself. */
  field: number[];
};

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  const ra = a.map(heroRole).sort();
  const rb = b.map(heroRole).sort();
  return ra.length === rb.length && ra.every((r, i) => r === rb[i]);
}

/** Share of the other options this total beat (ties count half), 0–100. */
export function percentileRank(total: number, field: readonly number[]): number {
  if (field.length <= 1) return 100;
  let below = 0;
  let equal = -1;
  for (const t of field) {
    if (t < total) below += 1;
    else if (t === total) equal += 1;
  }
  const others = field.length - 1;
  return Math.round(((below + 0.5 * Math.max(0, equal)) / others) * 100);
}

/**
 * `byRole: false` (bans) ranks against every open hero. `roleBlocked`: the
 * chosen role leaves a required role unfillable, so the role choice itself was
 * the mistake and the lock is ranked against every open hero.
 */
export function roleMatchedSingle<T extends Scored>(args: {
  best: T;
  chosen: T;
  pool: readonly string[];
  score: (hero: string) => T;
  roleBlocked: boolean;
  byRole?: boolean;
}): RoleBenchmark<T> {
  const { best, chosen } = args;
  const useRole = (args.byRole ?? true) && !args.roleBlocked;
  const role = heroRole(chosen.hero);
  const field = [chosen.total];
  let top = chosen;
  for (const hero of args.pool) {
    if (heroKey(hero) === heroKey(chosen.hero)) continue;
    if (useRole && heroRole(hero) !== role) continue;
    const card = args.score(hero);
    field.push(card.total);
    if (card.total > top.total) top = card;
  }
  const roleMatched = useRole && !sameRoles([best.hero], [chosen.hero]);
  if (!roleMatched && best.total >= top.total) {
    if (best.total > Math.max(...field)) field.push(best.total);
    top = best;
  }
  return { benchmark: top, roleMatched, field };
}

/** Same idea for a double pick: rank against every pair with the same two roles. */
export function roleMatchedPair<T extends Scored>(args: {
  best: T;
  chosen: T & { pairWith: string };
  pool: readonly string[];
  soloTotal: (hero: string) => number;
  assemble: (first: string, second: string) => T;
  roleBlocked: boolean;
  /** Heroes per side of the field when the role choice is blocked. */
  openFieldSize?: number;
}): RoleBenchmark<T> {
  const { best, chosen } = args;
  const useRole = !args.roleBlocked;
  const bySolo = (heroes: readonly string[]) =>
    [...heroes].sort(
      (a, b) => args.soloTotal(b) - args.soloTotal(a) || a.localeCompare(b),
    );
  let firsts: string[];
  let seconds: string[];
  if (useRole) {
    firsts = args.pool.filter((h) => heroRole(h) === heroRole(chosen.hero));
    seconds = args.pool.filter((h) => heroRole(h) === heroRole(chosen.pairWith));
  } else {
    firsts = bySolo(args.pool).slice(0, args.openFieldSize ?? 14);
    seconds = firsts;
  }
  const chosenKey = [heroKey(chosen.hero), heroKey(chosen.pairWith)].sort().join("|");
  const seen = new Set([chosenKey]);
  const field = [chosen.total];
  let top: T = chosen;
  for (const a of firsts) {
    for (const b of seconds) {
      if (heroKey(a) === heroKey(b)) continue;
      const key = [heroKey(a), heroKey(b)].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const card = args.assemble(a, b);
      field.push(card.total);
      if (card.total > top.total) top = card;
    }
  }
  const roleMatched =
    useRole &&
    Boolean(best.pairWith) &&
    !sameRoles([best.hero, best.pairWith ?? best.hero], [chosen.hero, chosen.pairWith]);
  if (!roleMatched && best.total >= top.total) {
    if (best.total > Math.max(...field)) field.push(best.total);
    top = best;
  }
  return { benchmark: top, roleMatched, field };
}
