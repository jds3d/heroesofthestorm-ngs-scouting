/**
 * Required-role check: tank, healer, offlane, ranged damage. Only a lock that
 * leaves more roles missing than picks remaining costs points — a tight fit
 * (e.g. holding the offlaner for last pick) is fine.
 */
import { heroIsOfflaner, heroIsRangedDamage } from "@/lib/scoring/draftPlan";
import { heroRole } from "@/lib/scoring/heroMeta";

export const REQUIRED_ROLES = ["tank", "healer", "offlane", "ranged damage"] as const;
export type RequiredRole = (typeof REQUIRED_ROLES)[number];

export const TEAM_SIZE = 5;
export const UNFILLABLE_ROLE_PENALTY = 45;

/** Listed as bruisers but routinely played as the solo tank. */
const FLEX_TANKS = new Set(["varian", "artanis", "dva", "d.va", "chen"]);

export function heroFillsRole(hero: string, role: RequiredRole): boolean {
  switch (role) {
    case "tank":
      return heroRole(hero) === "Tank" || FLEX_TANKS.has(hero.toLowerCase());
    case "healer":
      return heroRole(hero) === "Healer";
    case "offlane":
      return heroIsOfflaner(hero);
    case "ranged damage":
      return heroIsRangedDamage(hero);
  }
}

/**
 * Max matching of heroes to required roles — each hero fills at most one
 * role, so Blaze covers tank or offlane, not both.
 */
export function assignRequiredRoles(heroes: readonly string[]): Map<number, RequiredRole> {
  const roleOwner = new Map<RequiredRole, number>();
  const tryAssign = (index: number, seen: Set<RequiredRole>): boolean => {
    for (const role of REQUIRED_ROLES) {
      if (seen.has(role) || !heroFillsRole(heroes[index], role)) continue;
      seen.add(role);
      const owner = roleOwner.get(role);
      if (owner === undefined || tryAssign(owner, seen)) {
        roleOwner.set(role, index);
        return true;
      }
    }
    return false;
  };
  heroes.forEach((_, index) => tryAssign(index, new Set()));
  const byHero = new Map<number, RequiredRole>();
  for (const [role, index] of roleOwner) byHero.set(index, role);
  return byHero;
}

export type RoleCheck = {
  missing: RequiredRole[];
  picksLeft: number;
  /** Missing roles that can no longer fit in the remaining picks. */
  unfillable: number;
  points: number;
  /** Role each hero (by index into `heroes`) is counted as filling. */
  filledBy: Map<number, RequiredRole>;
  detail: string;
};

/** `heroes` = everything this team has locked, including the pick(s) being scored. */
export function checkRequiredRoles(heroes: readonly string[]): RoleCheck {
  const filledBy = assignRequiredRoles(heroes);
  const covered = new Set(filledBy.values());
  const missing = REQUIRED_ROLES.filter((role) => !covered.has(role));
  const picksLeft = Math.max(0, TEAM_SIZE - heroes.length);
  const unfillable = Math.max(0, missing.length - picksLeft);
  const points = unfillable ? -UNFILLABLE_ROLE_PENALTY * unfillable : 0;
  const pickWord = picksLeft === 1 ? "pick" : "picks";
  const detail = !missing.length
    ? "All required roles covered"
    : unfillable
      ? `Can't fill ${missing.join(", ")} with ${picksLeft} ${pickWord} left`
      : `Still need ${missing.join(", ")} · ${picksLeft} ${pickWord} left`;
  return { missing, picksLeft, unfillable, points, filledBy, detail };
}
