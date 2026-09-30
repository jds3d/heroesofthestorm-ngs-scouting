import { heroKey, heroRole } from "@/lib/scoring/heroMeta";

/**
 * Talents a comp only works with — not full builds. A rule fires only when its
 * conditions hold for the locked five, so most drafts show nothing.
 *
 * IMPORTANT: names and levels must match the live patch (checked against
 * Icy Veins / hotspatchnotes, 2.55.17). Do not add talents from memory.
 */
type CriticalTalentRule = {
  hero: string;
  level: number;
  talent: string;
  /** At least one of these must be on our team. */
  withAny?: readonly string[];
  /** At least one of these must be on their team. */
  vsAny?: readonly string[];
  /** Only when this hero is our only tank. */
  soloTank?: boolean;
  /** `{with}` / `{vs}` are replaced with the matching heroes. */
  why: string;
};

const AOE_FOLLOW_UP = [
  "Kael'thas",
  "Jaina",
  "Xul",
  "Gul'dan",
  "Junkrat",
  "Hanzo",
  "Chromie",
  "Azmodan",
  "Mephisto",
] as const;

const AOE_SETUP = ["E.T.C.", "Zarya"] as const;

const ATTACK_SPEED_CARRIES = [
  "Valla",
  "Raynor",
  "Tychus",
  "Illidan",
  "Zul'jin",
  "Greymane",
  "Lunara",
  "Varian",
  "Qhira",
] as const;

const RULES: CriticalTalentRule[] = [
  {
    hero: "E.T.C.",
    level: 10,
    talent: "Mosh Pit",
    withAny: AOE_FOLLOW_UP,
    why: "the comp's teamfight is Mosh Pit into {with} AoE. Without it there's no setup.",
  },
  {
    hero: "Zarya",
    level: 10,
    talent: "Graviton Surge",
    withAny: AOE_FOLLOW_UP,
    why: "Graviton is the setup for {with} AoE. Expulsion Zone leaves the comp without one.",
  },
  {
    hero: "Xul",
    level: 10,
    talent: "Poison Nova",
    withAny: AOE_SETUP,
    why: "Nova is the damage that makes {with}'s setup lethal.",
  },
  {
    hero: "Jaina",
    level: 10,
    talent: "Ring of Frost",
    withAny: AOE_SETUP,
    why: "Ring onto {with}'s setup is the kill combo.",
  },
  {
    hero: "Hanzo",
    level: 10,
    talent: "Dragonstrike",
    withAny: AOE_SETUP,
    why: "Dragonstrike onto {with}'s setup is the kill combo.",
  },
  {
    hero: "Rehgar",
    level: 10,
    talent: "Bloodlust",
    withAny: ATTACK_SPEED_CARRIES,
    why: "{with} win fights on attack speed; Bloodlust is the power spike the comp was drafted around.",
  },
  {
    hero: "Varian",
    level: 4,
    talent: "Taunt",
    soloTank: true,
    why: "he's the only tank. Any other heroic leaves the team with no frontline.",
  },
];

export type CriticalTalent = {
  hero: string;
  level: number;
  talent: string;
  why: string;
};

function present(team: readonly string[], names: readonly string[]): string[] {
  const keys = new Set(team.map(heroKey));
  return names.filter((n) => keys.has(heroKey(n)));
}

function join(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Must-take talents for `hero` given both locked fives; empty for most heroes. */
export function criticalTalentsFor(
  hero: string,
  ours: readonly string[],
  theirs: readonly string[],
): CriticalTalent[] {
  const key = heroKey(hero);
  const allies = ours.filter((h) => heroKey(h) !== key);
  const out: CriticalTalent[] = [];
  for (const rule of RULES) {
    if (heroKey(rule.hero) !== key) continue;
    const withHit = rule.withAny ? present(allies, rule.withAny) : [];
    const vsHit = rule.vsAny ? present(theirs, rule.vsAny) : [];
    if (rule.withAny && !withHit.length) continue;
    if (rule.vsAny && !vsHit.length) continue;
    if (rule.soloTank && allies.some((h) => heroRole(h) === "Tank")) continue;
    out.push({
      hero,
      level: rule.level,
      talent: rule.talent,
      why: rule.why.replace("{with}", join(withHit)).replace("{vs}", join(vsHit)),
    });
  }
  return out;
}
