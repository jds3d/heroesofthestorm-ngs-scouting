/**
 * Healer and ranged damage have to fit in the remaining picks.
 * Waveclear is a team total, not a seat: each hero brings an amount, and the
 * five is short when that sum misses the map. A tank does not have to be a
 * tank: two bruisers, a frontline healer, or two bruisers plus a melee
 * assassin cover the front. Who wins the offlane is a matchup, not a class.
 */
import { NGS_MAP_POOL } from "@/config/ngsMaps";
import { heroIsOfflaner, heroIsRangedDamage } from "@/lib/scoring/draftPlan";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";

export const REQUIRED_ROLES = ["tank", "healer", "offlane", "ranged damage"] as const;
export type RequiredRole = (typeof REQUIRED_ROLES)[number];

/** Holes that can cost a flat penalty. Waveclear is a sum, not one of these. */
export const SHAPE_NEEDS = ["healer", "ranged damage", "frontline"] as const;
export type ShapeNeed = (typeof SHAPE_NEEDS)[number];

export const TEAM_SIZE = 5;
/** A healer or ranged hole that can no longer be picked. */
export const ROLE_HOLE_PENALTY = 12;
/** Most clear one hero can bring. A later pick is assumed to add up to this. */
export const WAVECLEAR_PER_PICK = 3;
/** Clear a normal 3-lane map wants from the five. */
export const WAVECLEAR_STANDARD_NEED = 3;
/** Clear a large 3-lane map wants. Rotations are long, so waves matter more. */
export const WAVECLEAR_LARGE_NEED = 4;
/** Full miss on a normal 3-lane map. One point short is a third of this. */
export const WAVECLEAR_STANDARD_MAX_PENALTY = 8;
/** Full miss on a large 3-lane map. */
export const WAVECLEAR_LARGE_MAX_PENALTY = 12;
/** No tank and no substitute frontline, once it can no longer be picked. */
export const FRONTLINE_HOLE_PENALTY = 8;
/** Kept so older formula text still has a name. The live cost is the two above. */
export const UNFILLABLE_ROLE_PENALTY = ROLE_HOLE_PENALTY;

/** A healer who can stand in the front so a main tank is optional. */
const FRONTLINE_HEALERS = new Set(["uther", "rehgar", "kharazim"]);

/** Listed as bruisers but routinely played as the solo tank. */
const FLEX_TANKS = new Set(["varian", "artanis", "dva", "d.va", "chen"]);

/** A real tank, not a bruiser who can cover the role. */
export function isMainTank(hero: string): boolean {
  return heroFillsRole(hero, "tank") && !FLEX_TANKS.has(hero.toLowerCase());
}

export function heroFillsRole(hero: string, role: RequiredRole | ShapeNeed): boolean {
  switch (role) {
    case "tank":
      return heroRole(hero) === "Tank" || FLEX_TANKS.has(hero.toLowerCase());
    case "healer":
      return heroRole(hero) === "Healer";
    case "offlane":
      return heroIsOfflaner(hero);
    case "ranged damage":
      return heroIsRangedDamage(hero);
    case "frontline":
      return (
        isMainTank(hero) ||
        heroRole(hero) === "Bruiser" ||
        FRONTLINE_HEALERS.has(hero.toLowerCase())
      );
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
  missing: ShapeNeed[];
  /** The holes that remaining picks cannot cover. */
  unfilled: ShapeNeed[];
  picksLeft: number;
  /** Missing holes that can no longer fit in the remaining picks. */
  unfillable: number;
  /** Flat role holes plus the waveclear shortfall. */
  points: number;
  waveclear: number;
  waveclearNeed: number;
  waveclearPoints: number;
  /** Seat each hero (by index into `heroes`) is counted as filling. */
  filledBy: Map<number, RequiredRole>;
  detail: string;
};

function isBruiser(hero: string): boolean {
  return heroRole(hero) === "Bruiser";
}

function isFrontlineHealer(hero: string): boolean {
  return FRONTLINE_HEALERS.has(hero.toLowerCase());
}

/** A main tank, two bruisers, or a frontline healer. Two bruisers plus a melee assassin counts too. */
export function frontlineCovered(heroes: readonly string[]): boolean {
  if (heroes.some((hero) => isMainTank(hero))) return true;
  const bruisers = heroes.filter(isBruiser).length;
  if (bruisers >= 2) return true;
  return heroes.some(isFrontlineHealer);
}

/** Their solo laner, when one is locked. A bruiser list is only the fallback. */
export function opposingSoloLaner(heroes: readonly string[]): string | null {
  const flagged = heroes.filter((hero) => heroIsOfflaner(hero));
  if (flagged.length) return flagged[0];
  const bruisers = heroes.filter(isBruiser);
  return bruisers.length === 1 ? bruisers[0] : null;
}

function shapeHoles(heroes: readonly string[]): ShapeNeed[] {
  const holes: ShapeNeed[] = [];
  if (!heroes.some((hero) => heroFillsRole(hero, "healer"))) holes.push("healer");
  if (!heroes.some((hero) => heroFillsRole(hero, "ranged damage"))) holes.push("ranged damage");
  if (!frontlineCovered(heroes)) holes.push("frontline");
  return holes;
}

/**
 * How fast this hero kills a minion wave, 0–3.
 * 3 deletes a wave or double-soaks. 2 is a real clear plan. 1 helps.
 * 0 cannot clear in any useful time. Chen's keg is 0 on purpose.
 */
const WAVECLEAR_AMOUNT: Record<string, number> = {
  Xul: 3,
  Gazlowe: 3,
  Probius: 3,
  Azmodan: 3,
  Zagara: 3,
  Junkrat: 3,
  Ragnaros: 3,
  Murky: 3,
  TheLostVikings: 3,
  Nazeebo: 3,
  Sylvanas: 3,
  Jaina: 3,
  Kaelthas: 3,
  Guldan: 3,
  Samuro: 3,

  Leoric: 2,
  Sonya: 2,
  Malthael: 2,
  Hogger: 2,
  Dehaka: 2,
  Blaze: 2,
  Greymane: 2,
  Fenix: 2,
  SgtHammer: 2,
  Tassadar: 2,
  Arthas: 2,
  Rexxar: 2,
  Deathwing: 2,
  Mephisto: 2,
  Orphea: 2,
  Rehgar: 2,

  Valla: 1,
  Raynor: 1,
  Falstad: 1,
  Hanzo: 1,
  Tychus: 1,
  Zuljin: 1,
  Cassia: 1,
  "Li-Ming": 1,
  Chromie: 1,
  Thrall: 1,
  Yrel: 1,
  Imperius: 1,
  Johanna: 1,
  Muradin: 1,
  ETC: 1,
  MalGanis: 1,
  Mei: 1,
  Illidan: 1,
  Kerrigan: 1,
  Maiev: 1,
  Alarak: 1,
  Stitches: 1,
  Cho: 1,
  Malfurion: 1,
  Brightwing: 1,
  Deckard: 1,
  Stukov: 1,
  Alexstrasza: 1,
  Kharazim: 1,
  LiLi: 1,
  Tyrande: 1,
  Medivh: 1,
  Zarya: 1,
  Abathur: 1,
  Gall: 1,
};

export function heroWaveclear(hero: string): number {
  const key = heroKey(hero);
  return WAVECLEAR_AMOUNT[key] ?? WAVECLEAR_AMOUNT[hero] ?? 0;
}

export function teamWaveclear(heroes: readonly string[]): number {
  return heroes.reduce((sum, hero) => sum + heroWaveclear(hero), 0);
}

/** Two lanes of minions. Clear is free on these, even when the map is large. */
const TWO_LANE_MAPS = new Set([
  "alterac pass",
  "battlefield of eternity",
  "braxis holdout",
  "hanamura temple",
  "volskaya foundry",
]);

export type WaveclearMapRule = {
  need: number;
  maxPenalty: number;
  /** "two" skips the penalty entirely. */
  lanes: "two" | "three";
};

export function waveclearMapRule(map: string | null | undefined): WaveclearMapRule {
  const name = map?.trim().toLowerCase() ?? "";
  if (name && TWO_LANE_MAPS.has(name)) {
    return { need: 0, maxPenalty: 0, lanes: "two" };
  }
  const known = NGS_MAP_POOL.find((entry) => entry.name.toLowerCase() === name);
  const large = known?.size === "large" || /warhead|blackheart/.test(name);
  if (large) {
    return {
      need: WAVECLEAR_LARGE_NEED,
      maxPenalty: WAVECLEAR_LARGE_MAX_PENALTY,
      lanes: "three",
    };
  }
  return {
    need: WAVECLEAR_STANDARD_NEED,
    maxPenalty: WAVECLEAR_STANDARD_MAX_PENALTY,
    lanes: "three",
  };
}

export type WaveclearCheck = {
  amount: number;
  need: number;
  /** How far the current heroes sit under the map's line. */
  shortfall: number;
  /** Shortfall the remaining picks cannot close, even with a top clearer. */
  stuck: number;
  points: number;
  /** Shown when the sum is short, or when a 2-lane map is waiving a short sum. */
  label: string | null;
};

export function waveclearCheck(
  heroes: readonly string[],
  picksLeft: number,
  map?: string | null,
): WaveclearCheck {
  const rule = waveclearMapRule(map);
  const amount = teamWaveclear(heroes);
  const shortfall = Math.max(0, rule.need - amount);
  const reachable = amount + Math.max(0, picksLeft) * WAVECLEAR_PER_PICK;
  const stuck = Math.max(0, rule.need - reachable);
  const raw =
    rule.need === 0 || stuck === 0
      ? 0
      : Math.round((stuck * rule.maxPenalty) / rule.need);
  const points = raw ? -raw : 0;
  const where = map?.trim() ? ` on ${map.trim()}` : "";
  let label: string | null = null;
  if (rule.need === 0 && amount < WAVECLEAR_STANDARD_NEED) {
    label = `Waveclear ${amount}, not required${where}`;
  } else if (shortfall > 0 && stuck === 0) {
    const pickWord = picksLeft === 1 ? "pick" : "picks";
    label = `Waveclear ${amount}/${rule.need}${where} · ${picksLeft} ${pickWord} left`;
  } else if (stuck > 0) {
    label = `Waveclear ${amount}/${rule.need}${where} (${points})`;
  }
  return { amount, need: rule.need, shortfall, stuck, points, label };
}

function holePenalty(hole: ShapeNeed): number {
  return hole === "frontline" ? FRONTLINE_HOLE_PENALTY : ROLE_HOLE_PENALTY;
}

/** `heroes` = everything this team has locked, including the pick(s) being scored. */
export function checkRequiredRoles(
  heroes: readonly string[],
  map?: string | null,
): RoleCheck {
  const filledBy = assignRequiredRoles(heroes);
  const missing = shapeHoles(heroes);
  const picksLeft = Math.max(0, TEAM_SIZE - heroes.length);
  const unfilled = missing.slice(picksLeft);
  const holes = unfilled.reduce((sum, hole) => sum + holePenalty(hole), 0);
  const wave = waveclearCheck(heroes, picksLeft, map);
  const cost = holes - wave.points;
  const points = cost ? -cost : 0;
  const pickWord = picksLeft === 1 ? "pick" : "picks";
  const roleDetail = !missing.length
    ? "All required roles covered"
    : unfilled.length
      ? `Can't fill ${unfilled.join(", ")} with ${picksLeft} ${pickWord} left`
      : `Still need ${missing.join(", ")} · ${picksLeft} ${pickWord} left`;
  const detail =
    wave.label && (wave.points || !missing.length)
      ? missing.length
        ? `${roleDetail} · ${wave.label}`
        : wave.label
      : roleDetail;
  return {
    missing,
    unfilled,
    picksLeft,
    unfillable: unfilled.length,
    points,
    waveclear: wave.amount,
    waveclearNeed: wave.need,
    waveclearPoints: wave.points,
    filledBy,
    detail,
  };
}
