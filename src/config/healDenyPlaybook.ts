import { heroKey } from "@/lib/scoring/heroMeta";

export type HealTalentPick = {
  /** Level, e.g. "1" / "10" / "20". */
  tier: string;
  /** Default talent to take. */
  take: string;
  /** Plain-English why for the default. */
  why: string;
  /** Situational alternative (optional). */
  alt?: string;
  /** When to take the alt instead of the default. */
  altWhen?: string;
};

export type HealDenyGuide = {
  hero: string;
  /** One-line identity for the deny / enable role. */
  role: string;
  talents: HealTalentPick[];
  /** How to play the mid-fight with this heal locked as deny/comfort. */
  teamfight: string;
};

/**
 * Talent path + fight script when we lock a healer as comfort
 * and/or to keep it off them.
 *
 * IMPORTANT: Talent names must match the current live HotS patch.
 * "Inquisitor's Ordnance" / "High Inquisitor" etc. were removed — do not
 * invent from memory. Prefer Icy Veins / hotspatchnotes / Heroes Profile
 * for the active tree before editing this file.
 */
const GUIDES: HealDenyGuide[] = [
  {
    hero: "Rehgar",
    role: "Dive enabler — Bloodlust after the collapse, not before",
    // Talents verified against Icy Veins Jan 2026 / live tree.
    // Bloodlust is a Level 10 heroic (not 7). Electric Charge is Level 4.
    talents: [
      {
        tier: "1",
        take: "Colossal Totem",
        why: "Bigger / relocatable Earthbind — default for objective zoning and Grounded Totem value.",
        alt: "Stormcaller",
        altWhen: "you are on the Lightning Shield shell (Qhira / Illidan carry)",
      },
      {
        tier: "4",
        take: "Earthliving Enchant",
        why: "Chain Heal double-dips below 50% — best vs poke and long shrine fights.",
        alt: "Healing Totem",
        altWhen: "you need a second heal-to-place while the dive is in",
      },
      {
        tier: "7",
        take: "Grounded Totem",
        why: "Earthbind also cuts Attack Speed and Spell Power — peels their dive / sticks yours.",
        alt: "Purification",
        altWhen: "they have heavy CC and you need Purge to heal / anti-heal",
      },
      {
        tier: "10",
        take: "Bloodlust",
        why: "Dive win condition — Attack Speed + move speed once Qhira is already on their backline.",
        alt: "Ancestral Healing",
        altWhen: "they blow up one person and you need a single big save instead",
      },
      {
        tier: "13",
        take: "Earth Shield",
        why: "Lightning Shield also shields — buffer the dive target (and Ancestral delay).",
        alt: "Tidal Waves",
        altWhen: "you need more Chain Heal uptime vs sustained poke",
      },
      {
        tier: "16",
        take: "Earthgrasp Totem",
        why: "Near-root Slow on totem drop — sticks the dive or peels their collapse.",
        alt: "Rising Storm",
        altWhen: "you took Stormcaller / Electric Charge and Lightning Shield is your damage",
      },
      {
        tier: "20",
        take: "Gladiator's War Shout",
        why: "If you took Bloodlust: double duration / range so the dive stays sticky.",
        alt: "Farseer's Blessing",
        altWhen: "you took Ancestral — second cast + nearby ally heal",
      },
    ],
    teamfight:
      "Put Lightning Shield on the dive (Qhira / assassin), Ancestral the first person they blow up if you took it, then Bloodlust only when your dive is already on their backline. Do not Bloodlust a fair front-to-back — you lose the heal war. Vs Whitemane/Auriel, play short burst windows.",
  },
  {
    hero: "Whitemane",
    role: "Zeal heal — second damage seat that also heals",
    // Talents verified against current live tree (2.55.17 / Icy Veins May–Jul 2026).
    // Inquisitor's Ordnance and High Inquisitor no longer exist.
    talents: [
      {
        tier: "1",
        take: "Pity the Frail",
        why: "More heal on low allies, and Searing Lash shorts Inquisition cooldown — default almost every game.",
        alt: "Righteous Flame",
        altWhen: "you want a heavier Searing Lash / auto-attack damage shell",
      },
      {
        tier: "4",
        take: "Martyrdom",
        why: "Bigger Desperate Plea heals (scales with active Zeals) — keeps people up without needing a target in melee.",
        alt: "Unwavering Faith",
        altWhen: "you are playing the auto-attack / Zeal damage shell (pairs with Righteous Flame)",
      },
      {
        tier: "7",
        take: "Intercession",
        why: "Makes an ally Unstoppable for a second — the anti-dive button.",
        alt: "Saintly Greatstaff",
        altWhen: "they never dive and you can mark + auto for free damage/heal",
      },
      {
        tier: "10",
        take: "Scarlet Aegis",
        why: "Team heal + Armor + spreads Zeal with no Desperation stacks — default heroic.",
        alt: "Divine Reckoning",
        altWhen: "fights are stacked on Punisher/shrine and your team can hold them in the circle",
      },
      {
        tier: "13",
        take: "Subjugation",
        why: "Inquisition cuts the target's damage by half — the deny into dive/assassins.",
        alt: "Lashing Out",
        altWhen: "you are on the Searing Lash shell and can land second strikes for resets",
      },
      {
        tier: "16",
        take: "Shared Punishment",
        why: "Inquisition chains to a second hero and shreds Armor — pairs with Subjugation.",
        alt: "Harsh Discipline",
        altWhen: "your team needs a root setup more than double Inquisition",
      },
      {
        tier: "20",
        take: "Scarlet Crusade",
        why: "If you took Scarlet Aegis: bigger heal and Unstoppable on the team.",
        alt: "Judgment Day",
        altWhen: "you took Divine Reckoning — pull + amp for the stacked fight",
      },
    ],
    teamfight:
      "Whitemane wins long Zeal fights. Stack with the dive, put Desperation on whoever they hit first, then Scarlet Aegis (or Reckoning) when both teams are committed. Do not play her like a poke healer — auto-attack to keep Zeal up. If they dive you, Intercession the carry and keep hitting; dying at 0 Zeal throws the deny.",
  },
  {
    hero: "Anduin",
    role: "Anti-dive savior — Salvation on their commit",
    // Talents verified against Icy Veins / hotspatchnotes Aug 2026 (2.55.17).
    talents: [
      {
        tier: "1",
        take: "Evenhanded Blessings",
        why: "Bigger Divine Star / Flash Heal into the person they dive — default vs burst.",
        alt: "Lightwell",
        altWhen: "fights go long and you need the Well sustain shell",
      },
      {
        tier: "4",
        take: "Piercing Light",
        why: "Chastise pierces — peels multiple divers on the way in.",
        alt: "Moral Compass",
        altWhen: "you want Divine Star damage amp more than multi-Chastise",
      },
      {
        tier: "7",
        take: "Desperate Prayer",
        why: "Instant self/ally save when the dive lands — anti-blow-up button.",
        alt: "Binding Heal",
        altWhen: "damage is spread and you need Flash Heal to splash",
      },
      {
        tier: "10",
        take: "Holy Word: Salvation",
        why: "Default vs dive — team reset when they jump in.",
        alt: "Lightbomb",
        altWhen: "you have a dive carrier and want the stun engage instead",
      },
      {
        tier: "13",
        take: "Speed of the Pious",
        why: "Move speed after heals so you can reposition through the collapse.",
        alt: "Enchant Boots - Lion's Speed",
        altWhen: "you need on-demand mounts more than Divine Star CDR",
      },
      {
        tier: "16",
        take: "Glyph of Faith",
        why: "Second Leap of Faith — pull the dive target twice.",
        alt: "Renew",
        altWhen: "fights are long poke and you need more heal throughput",
      },
      {
        tier: "20",
        take: "Light of Stormwind",
        why: "If you took Salvation: Unstoppable team reset wins the engage.",
        alt: "Censure",
        altWhen: "you took Lightbomb / need harder Chastise CC",
      },
    ],
    teamfight:
      "Pre-shield the person they want, Salvation as the dive lands, then Leap of Faith / Chastise so your dive can counter-collapse. Do not waste Salvation on a poke tick — hold it for their commit.",
  },
  {
    hero: "Brightwing",
    role: "Global save — Phase the dive target, then leave",
    // Talents verified against Icy Veins May 2025 / current live tree.
    talents: [
      {
        tier: "1",
        take: "Hyper Shift",
        why: "Faster Phase rotates to shrine fights.",
        alt: "Pixie Charm",
        altWhen: "camp-heavy maps and you can Bribe safely",
      },
      {
        tier: "4",
        take: "Magic Spit",
        why: "Attack range + Soothing Mist CDR — default sustain shell.",
        alt: "Dream Shot",
        altWhen: "you want Arcane Flare poke / Sticky Flare value",
      },
      {
        tier: "7",
        take: "Critical Mist",
        why: "Soothing Mist heals hard when it cleanses — anti-CC engage.",
        alt: "Peekaboo!",
        altWhen: "you need Phase shields + reveal more than Mist amp",
      },
      {
        tier: "10",
        take: "Emerald Wind",
        why: "Default when they clump for shrine or Punisher.",
        alt: "Blink Heal",
        altWhen: "they are picking people, not stacking",
      },
      {
        tier: "13",
        take: "Safety Dust",
        why: "Pixie Dust lasts longer and amps Mist / Blink Heal.",
        alt: "Pixie Power",
        altWhen: "they are spell-damage heavy and you need Spell Armor",
      },
      {
        tier: "16",
        take: "Critterize",
        why: "Polymorph their assassin mid-combo and shred Armor.",
        alt: "Phase Out",
        altWhen: "you are the dive target and need a personal save",
      },
      {
        tier: "20",
        take: "Invisible Friends",
        why: "If you took Blink Heal: stealth save when they hunt the heal.",
        alt: "Intensive Winds",
        altWhen: "you took Emerald Wind — 5s Wind for stacked objectives",
      },
    ],
    teamfight:
      "Phase the dive target the moment they get touched, Emerald Wind when they clump, Critterize the assassin mid-combo. Soak a lane, Phase in, win the fight, Phase out. Do not stand front line without Phase ready.",
  },
  {
    hero: "Auriel",
    role: "Energy battery — Bestow Hope on your highest damage",
    // Talents verified against Icy Veins Jun 2026. Bursting Light was removed years ago.
    talents: [
      {
        tier: "1",
        take: "Searing Light",
        why: "Ray of Heaven also damages — default energy shell into melee/clumped fights.",
        alt: "Righteous Assault",
        altWhen: "you want Sacred Sweep CDR more than Ray damage",
      },
      {
        tier: "4",
        take: "Repeated Offense",
        why: "Stronger Detainment knockback + quest damage — peels dive into walls.",
        alt: "Heavy Burden",
        altWhen: "you need the longer Slow/Stun more than knockback distance",
      },
      {
        tier: "7",
        take: "Energized Cord",
        why: "More Energy from autos + attack range — fills Hope for fights.",
        alt: "Empathic Link",
        altWhen: "Bestow target eats a ton of damage (you bank Energy off their hits)",
      },
      {
        tier: "10",
        take: "Crystal Aegis",
        why: "Default save into dive or Stitches Gorge.",
        alt: "Resurrect",
        altWhen: "you have Cho'Gall or a carry that dies for free trades",
      },
      {
        tier: "13",
        take: "Blinding Flash",
        why: "Sacred Sweep center Blinds — shuts down AA dive.",
        alt: "Piercing Lash",
        altWhen: "they stack melee and you need multi-hit Detainment",
      },
      {
        tier: "16",
        take: "Reservoir of Hope",
        why: "Max Energy quest — bigger Rays the longer the game goes.",
        alt: "Will of Heaven",
        altWhen: "Bestow is on an AA carry (Qhira / Tychus) and you need the Attack Speed amp",
      },
      {
        tier: "20",
        take: "Shield of Hope",
        why: "Big % Health shield dump when someone is low — default late save.",
        alt: "Diamond Resolve",
        altWhen: "you took Crystal Aegis and need the Armor after Stasis",
      },
    ],
    teamfight:
      "Bestow Hope on your highest damage, Aegis the first dive target, then dump Hope when you win the energy race. Do not take a fair 5v5 before Bestow has stacks. Vs Rehgar, play for the second engage after Ancestral is spent.",
  },
  {
    hero: "Uther",
    role: "Armor + stun savior — not a sustain heal",
    talents: [
      {
        tier: "1",
        take: "Wave of Light",
        why: "Wave clear on shrine maps.",
        alt: "Hammer of the Lightbringer",
        altWhen: "you want armor trades over clear",
      },
      {
        tier: "4",
        take: "Guardian of Ancient Kings",
        why: "Armor path into dive.",
        alt: "Holy Fire",
        altWhen: "you need damage while healing",
      },
      {
        tier: "7",
        take: "Hand of Protection",
        why: "HotP the person they dive.",
        alt: "Cleanse",
        altWhen: "CC chains matter more than physical immunity",
      },
      {
        tier: "10",
        take: "Divine Storm",
        why: "Wombo with your dive engage.",
        alt: "Divine Shield",
        altWhen: "you need a single-target savior instead",
      },
      {
        tier: "13",
        take: "Blessed Champion",
        why: "More armor uptime.",
        alt: "Holy Shock",
        altWhen: "you need burst heal/damage",
      },
      {
        tier: "16",
        take: "Bulwark of Light",
        why: "Bigger Divine Shield.",
        alt: "Well Met",
        altWhen: "you took Storm and want a stronger stun",
      },
      {
        tier: "20",
        take: "Divine Protection",
        why: "Armor ultimate after the save.",
        alt: "Eternal Devotion",
        altWhen: "you need the death cheat",
      },
    ],
    teamfight:
      "Pre-armor the person they want, stun the assassin on contact, Divine Shield/Storm when the blow-up starts. You are a short-window savior so your dive can counter-kill — not a long sustain healer.",
  },
];

export function healDenyGuideFor(hero: string): HealDenyGuide | null {
  const key = heroKey(hero);
  return GUIDES.find((g) => heroKey(g.hero) === key) ?? null;
}

/** Build a short generic shell when we lack a named guide. */
export function fallbackHealDenyGuide(hero: string): HealDenyGuide {
  return {
    hero,
    role: "Comfort / deny heal",
    talents: [
      {
        tier: "7–10",
        take: "Standard sustain + heroic save",
        why: "Hold the heroic for their commit, not a poke tick.",
      },
      {
        tier: "16–20",
        take: "Teamfight amp / second save",
        why: "Spend late tiers on the objective fight.",
      },
    ],
    teamfight: `Play ${hero} as the deny heal: keep your dive alive through the first blow-up, save the heroic for their commit, and win the short fight your comp drafted.`,
  };
}
