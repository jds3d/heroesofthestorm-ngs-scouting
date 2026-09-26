/** Hover copy for draft jargon shown in the scout UI. */

export const ARCHETYPE_HINTS: Record<string, string> = {
  dive: "Engage tank + melee follow-up. They win short fights by jumping the backline.",
  "poke/siege":
    "Safe ranged damage and waveclear. They win by whittling and taking structures, not by hard engaging.",
  "hypercarry protect":
    "One late-game carry (Valla, Zul'jin, Greymane, Hammer) with a frontline built to keep them alive.",
  "double support / sustain":
    "Two healers or a healer + utility support. They outlast burst and win long fights.",
  "bruiser frontline":
    "Offlane / bruiser-led frontline that wants to soak and take favorable skirmishes.",
  "assassin-focused":
    "Their drafts are built around Assassin damage, but not a clear dive, poke, or hypercarry shell. Expect kill-focused damage heroes without a single locked-in fight plan.",
  "assassin-heavy roster":
    "Roster comfort skews Assassin. Draft identity is inferred from players, not a thick NGS draft sample.",
  "tank-heavy roster":
    "Roster comfort skews Tank. Draft identity is inferred from players, not a thick NGS draft sample.",
  "flexible / mixed":
    "No single draft identity stood out across the sample.",
  unclear: "Not enough signal to name a draft identity yet.",
  unknown: "No hero data for this draft.",
};

export const DRAFT_TERM_HINTS: Record<string, string> = {
  Archetype:
    "The fight shape they draft most often — dive, poke, hypercarry, double support, and so on.",
  "Games analyzed":
    "How many NGS maps with usable hero drafts fed this read.",
  "First-pick leans":
    "Heroes they take earliest when they have first pick, as a share of analyzed drafts.",
  "Bait certainty":
    "How confident the plan is that they will stay on the predicted heroes if you ban their outs.",
  Identity: "What draft shape we think they are trying to play.",
  "Data quality": "How much we trust the draft sample behind this report.",
  "Strategy groups":
    "How often each fight shape showed up, with the most common five under each shape.",
  "Most common 5-man":
    "The five-hero lineup they run most often inside each strategy group.",
  "First-pick lean":
    "The single hero they open on most when they have first pick.",
  "Hero bans":
    "How often they ban a hero, and how often opponents ban that hero into them.",
  "Soft spot":
    "A role nobody on their roster claims as preferred — force them there and the draft gets awkward.",
  "Map plan":
    "Maps we should ban vs leave up, from our NGS record against theirs.",
  "Maps they ban":
    "Maps this opponent has spent bans on historically — intel only.",
  Expected:
    "Our read — the ban or pick we think they will make based on their history and pool.",
  Adjust:
    "What we change if that step is a different hero than Expected.",
  Read: "What we think they will ban or pick next, based on their history.",
};

/** Turn a raw tag fallback into a readable archetype label. */
export function labelArchetypeTag(tag: string): string {
  switch (tag) {
    case "assassin":
      return "assassin-focused";
    case "dive":
      return "dive";
    case "poke":
    case "siege":
      return "poke/siege";
    case "hypercarry":
      return "hypercarry protect";
    case "solo":
    case "engage":
      return "bruiser frontline";
    case "peel":
      return "peel / protect";
    case "sustain":
      return "sustain / attrition";
    case "global":
      return "global / macro";
    case "safe":
      return "safe / disengage";
    default:
      return tag;
  }
}

export function archetypeHint(archetype: string): string | undefined {
  if (ARCHETYPE_HINTS[archetype]) return ARCHETYPE_HINTS[archetype];
  const key = Object.keys(ARCHETYPE_HINTS).find((k) =>
    archetype.toLowerCase().includes(k.toLowerCase()),
  );
  return key ? ARCHETYPE_HINTS[key] : undefined;
}

/** "a" / "an" for archetype phrases in sentences. */
export function archetypeArticle(archetype: string): "a" | "an" {
  return /^[aeiou]/i.test(archetype.trim()) ? "an" : "a";
}
