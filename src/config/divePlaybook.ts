import type { DraftPlanSlot, DraftTreeNode } from "@/lib/scoring/types";

/** NGS A-League primary: heavy dive — mask early, commit mid, flex last. */
export const divePlaybook = {
  title: "Heavy dive decision tree",
  intro:
    "Never show dive assassins (Genji, Greymane, Kerrigan) in phase 1. Secure a flexible tank and a generic enabler first, then check for anti-dive before locking the core. If they have Tyrael, Brightwing, Mighty Gust Falstad, or Johanna, pivot — do not force pure dive.",

  antiDiveHeroes: [
    "Tyrael",
    "Brightwing",
    "Johanna",
    "Falstad",
    "Uther",
    "Anduin",
    "Garrosh",
  ] as const,

  /** Heroes that reveal dive too early — keep off the board in picks 1–2. */
  lateDiveAssassins: [
    "Genji",
    "Greymane",
    "Kerrigan",
    "Zeratul",
    "Illidan",
    "Tracer",
  ] as const,

  phase1Slots: [
    {
      role: "Flexible main tank",
      heroes: ["Anub'arak", "Tyrael", "Diablo", "Mei"],
      why: "Anub Cocoon is the dive gold standard; Tyrael gives Sanctification + MS; Diablo/Mei stay flexible so you do not scream dive on pick 1.",
    },
    {
      role: "Dive enabler",
      heroes: ["Rehgar", "Brightwing", "Hogger", "Yrel"],
      why: "Rehgar Bloodlust + burst, BW global Phase Shift, or offlane disruptors that fit other comps if you pivot.",
    },
  ] satisfies DraftPlanSlot[],

  phase3Slots: [
    {
      role: "Burst initiator",
      heroes: ["Greymane", "Kerrigan"],
      why: "Initial heavy burst once anti-dive is ruled out.",
    },
    {
      role: "Clean-up assassin",
      heroes: ["Genji", "Zeratul"],
      why: "Chase resets and escaping targets after the first blow-up.",
    },
  ] satisfies DraftPlanSlot[],

  phase5Checks: [
    "Waveclear minimum: if the dive core is Genji/Greymane, offlane must hyper-clear (Malthael, Leoric).",
    "Enemy savior: immobile carry (Zul'jin, Valla) + one peel healer → secondary dive threat or Medivh/Abathur to guarantee in-and-out.",
  ],

  pivots: [
    {
      id: "blowup",
      name: "Blow-up / CC chain",
      objective:
        "Lock one target with micro-stun chains and delete them in ~1.5s.",
      heroes: ["Stitches", "Tyrande", "Jaina", "Kerrigan"],
      /** Anti-dive heroes that push us toward this pivot. */
      against: ["Tyrael", "Johanna", "Garrosh", "Uther"],
      whyAgainst:
        "They have a savior tank/peel — you cannot stick a five-man dive, so gorge or Cocoon one target and delete them instead.",
      maps: ["Tomb of the Spider Queen", "Towers of Doom"],
    },
    {
      id: "poke",
      name: "Sustained poke / squeeze",
      objective:
        "Whittle from range and force them off objectives without a hard engage.",
      heroes: ["Hanzo", "Chromie", "Stukov", "Johanna"],
      against: ["Falstad", "Brightwing", "Tyrael", "Johanna", "Anduin"],
      whyAgainst:
        "Gust, Sanctification, or Phase Shift means dive cannot land — win from range and deny clean engages.",
      maps: ["Volskaya Foundry", "Alterac Pass"],
    },
    {
      id: "global",
      name: "Global macro / split-push",
      objective:
        "Avoid fair 5v5s; win XP and structures across the map.",
      heroes: ["Dehaka", "Falstad", "Brightwing", "Abathur"],
      against: ["Anduin", "Uther", "Brightwing", "Falstad", "Johanna"],
      whyAgainst:
        "Their peel stack wins a fair fight — refuse the 5v5 and beat them on soak and structures.",
      maps: ["Cursed Hollow", "Sky Temple"],
    },
  ],
} as const;

export type DivePivot = (typeof divePlaybook.pivots)[number];

/** Pick one pivot from the anti-dive heroes already in their pool. */
export function chooseDivePivot(
  antiDiveSeen: string[],
  mapName?: string | null,
): {
  pivot: DivePivot;
  matched: string[];
  why: string;
} {
  const seen = new Set(antiDiveSeen);
  const scored = divePlaybook.pivots.map((pivot) => {
    const matched = pivot.against.filter((h) => seen.has(h));
    const mapBonus =
      mapName && (pivot.maps as readonly string[]).includes(mapName) ? 1.5 : 0;
    return { pivot, matched, score: matched.length + mapBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  // Prefer poke when Gust/BW show up even on ties — those hard-counter stick dive.
  const gustOrBw = seen.has("Falstad") || seen.has("Brightwing");
  const best =
    (gustOrBw &&
      !mapName &&
      scored.find((s) => s.pivot.id === "poke" && s.matched.length > 0)) ||
    scored[0] ||
    { pivot: divePlaybook.pivots[1], matched: [] as string[], score: 0 };

  const matched = best.matched;
  let why =
    matched.length > 0
      ? `${best.pivot.whyAgainst} Triggered by: ${matched.join(", ")}.`
      : best.pivot.whyAgainst;
  if (mapName && (best.pivot.maps as readonly string[]).includes(mapName)) {
    why += ` ${mapName} favors this fight.`;
  }

  return { pivot: best.pivot, matched, why };
}

/** Static decision tree shown under Draft plan (our playbook, not the pick-by-pick walk). */
export function divePlaybookTree(): DraftTreeNode {
  return {
    id: "dive-root",
    title: "Phase 1 — Anchor & enabler (picks 1–2)",
    detail: divePlaybook.intro,
    children: [
      {
        id: "p1-tank",
        title: "Flexible main tank",
        detail: `${divePlaybook.phase1Slots[0].heroes.join(" / ")}. ${divePlaybook.phase1Slots[0].why}`,
      },
      {
        id: "p1-enabler",
        title: "Dive enabler",
        detail: `${divePlaybook.phase1Slots[1].heroes.join(" / ")}. ${divePlaybook.phase1Slots[1].why}`,
        children: [
          {
            id: "p2-check",
            title: "Phase 2 — Mid-draft pivot check",
            detail:
              "After their first three picks: did they take heavy anti-dive / disengage (Tyrael, Brightwing, Falstad Gust, Johanna)?",
            children: [
              {
                id: "p2-yes",
                title: "Yes → Countered path",
                detail:
                  "Pivot immediately. Split/isolate (Stitches Gorge, Anub Cocoon) or high-waveclear macro poke. Do not force pure dive into Sanctification or Mighty Gust.",
                children: divePlaybook.pivots.map((p) => ({
                  id: `pivot-${p.id}`,
                  title: p.name,
                  detail: `${p.objective} Key heroes: ${p.heroes.join(", ")}. Ideal maps: ${p.maps.join(", ")}.`,
                })),
              },
              {
                id: "p2-no",
                title: "No → Green light",
                detail:
                  "Commit to dive. Lock burst initiator + clean-up (Greymane/Kerrigan with Genji/Zeratul).",
                children: [
                  {
                    id: "p3-core",
                    title: "Phase 3 — Core divers",
                    detail: `${divePlaybook.phase3Slots.map((s) => `${s.role}: ${s.heroes.join(" / ")}`).join(". ")}.`,
                    children: [
                      {
                        id: "p5-flex",
                        title: "Phase 5 — Flex cap",
                        detail: divePlaybook.phase5Checks.join(" "),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Default slots when we are running the heavy-dive plan (green light). */
export function diveGreenLightSlots(): DraftPlanSlot[] {
  return [
    divePlaybook.phase1Slots[0],
    divePlaybook.phase1Slots[1],
    {
      role: "Offlane / clear",
      heroes: ["Malthael", "Leoric", "Hogger", "Yrel"],
      why: "Hyper-clear so Genji/Greymane dive does not lose the map.",
    },
    divePlaybook.phase3Slots[0],
    divePlaybook.phase3Slots[1],
  ];
}
