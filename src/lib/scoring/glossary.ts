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
  "peel / protect":
    "Frontline and utility built to keep a backline alive rather than start the fight.",
  "sustain / attrition":
    "Long-fight healing and armor. They win by outlasting burst, not by a single engage.",
  "global / macro":
    "Globals and map pressure. They win by soaking and hitting objectives first, not by a fair 5v5.",
  "safe / disengage":
    "Kiting and disengage tools. They decline bad fights and reset rather than force.",
  "flexible / mixed":
    "No single draft identity stood out across the sample.",
  unclear: "Not enough signal to name a draft identity yet.",
  unknown: "No hero data for this draft.",
};

/** Canonical fight shapes to always show in the archetype tooltip. */
export const ARCHETYPE_CATALOG: string[] = [
  "dive",
  "poke/siege",
  "hypercarry protect",
  "double support / sustain",
  "bruiser frontline",
  "assassin-focused",
  "peel / protect",
  "sustain / attrition",
  "global / macro",
  "safe / disengage",
  "flexible / mixed",
];

export type ArchetypeTooltipRow = {
  name: string;
  description: string;
  preferred: boolean;
  pct: number | null;
};

/**
 * Rows for the archetype hover: sample frequency first (high → low), then
 * unused catalog shapes. Preferred (their lean / ties) is marked for bold.
 */
export function leadingArchetypes(
  breakdown: { archetype: string; count: number; pct: number }[] = [],
): { archetype: string; count: number; pct: number }[] {
  if (!breakdown.length) return [];
  const sorted = [...breakdown].sort(
    (a, b) =>
      b.pct - a.pct ||
      b.count - a.count ||
      a.archetype.localeCompare(b.archetype),
  );
  const top = sorted[0];
  return sorted.filter(
    (b) => b.pct === top.pct && Math.abs(b.count - top.count) < 0.05,
  );
}

export function formatArchetypeLeaders(
  breakdown: { archetype: string; count: number; pct: number }[] = [],
  fallback = "flexible / mixed",
): string {
  const leaders = leadingArchetypes(breakdown);
  if (!leaders.length) return fallback;
  return leaders.map((l) => `${l.archetype} (${l.pct}%)`).join(", ");
}

export function archetypeTooltipRows(
  preferred: string | string[],
  breakdown: { archetype: string; count: number; pct: number }[] = [],
): ArchetypeTooltipRow[] {
  const preferredList = (Array.isArray(preferred) ? preferred : [preferred])
    .map((p) => p.trim())
    .filter(Boolean);
  const preferredKeys = new Set(preferredList.map((p) => p.toLowerCase()));
  // Also treat tied leaders from the sample as preferred when preferred is a single stale string.
  for (const l of leadingArchetypes(breakdown)) {
    preferredKeys.add(l.archetype.toLowerCase());
  }
  const byName = new Map(
    breakdown.map((b) => [b.archetype.toLowerCase(), b] as const),
  );
  const seen = new Set<string>();
  const rows: ArchetypeTooltipRow[] = [];

  const isPreferred = (name: string) => {
    const n = name.toLowerCase();
    if (preferredKeys.has(n)) return true;
    for (const p of preferredKeys) {
      if (p.startsWith(n) || n.startsWith(p)) return true;
    }
    return false;
  };

  const push = (name: string, pct: number | null) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      name,
      description:
        archetypeHint(name) ??
        ARCHETYPE_HINTS[name] ??
        "No description yet.",
      preferred: isPreferred(name),
      pct,
    });
  };

  for (const b of [...breakdown].sort(
    (a, b) =>
      b.pct - a.pct ||
      b.count - a.count ||
      a.archetype.localeCompare(b.archetype),
  )) {
    push(b.archetype, b.pct);
  }

  for (const preferredKey of preferredList) {
    const hit = byName.get(preferredKey.toLowerCase());
    push(preferredKey, hit?.pct ?? null);
  }

  for (const name of ARCHETYPE_CATALOG) {
    const hit = byName.get(name.toLowerCase());
    push(name, hit?.pct ?? 0);
  }

  return rows;
}

export const DRAFT_TERM_HINTS: Record<string, string> = {
  Archetype:
    "Hover for every fight shape, ordered by how often they draft it. Tied leads are all listed with %; their leans are bold.",
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
    "Two lists: heroes they spend bans on, and heroes opponents ban into them.",
  "Soft spot":
    "A role nobody on their roster claims as preferred — and the fight shape we should play because of it (e.g. no melee assassin → poke is safer).",
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
