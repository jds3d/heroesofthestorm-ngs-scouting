import { divePlaybook, chooseDivePivot } from "@/config/divePlaybook";
import { ngsMapByName, type NgsMap } from "@/config/ngsMaps";
import type { DraftPlan, DraftPlaybookPivot } from "@/lib/scoring/types";

function toPivot(
  p: (typeof divePlaybook.pivots)[number],
  why: string,
): DraftPlaybookPivot {
  return {
    id: p.id,
    name: p.name,
    objective: p.objective,
    heroes: [...p.heroes],
    maps: [...p.maps],
    why,
  };
}

/**
 * Prefer a pivot that lists this map when anti-dive already forced a leave-dive.
 * Map alone does not override a clear anti-dive hero read — it breaks ties / nudges.
 */
function pivotForMap(
  antiDiveSeen: string[],
  map: NgsMap,
): { recommended: DraftPlaybookPivot; alternates: DraftPlaybookPivot[] } {
  const base = chooseDivePivot(antiDiveSeen);
  const mapFits = divePlaybook.pivots.filter((p) =>
    (p.maps as readonly string[]).includes(map.name),
  );

  let chosen = base.pivot;
  let why = base.why;

  if (mapFits.length === 1) {
    chosen = mapFits[0];
    why =
      base.pivot.id === chosen.id
        ? `${base.why} ${map.name} also favors this fight.`
        : `${chosen.whyAgainst} On ${map.name}, take this over ${base.pivot.name} — the map wants ${chosen.objective.toLowerCase()}`;
  } else if (mapFits.length > 1) {
    const overlap = mapFits.find((p) => p.id === base.pivot.id) ?? mapFits[0];
    chosen = overlap;
    why =
      overlap.id === base.pivot.id
        ? `${base.why} ${map.name} fits this pivot.`
        : `${overlap.whyAgainst} ${map.name} is built for ${overlap.name}.`;
  } else if (map.size === "large") {
    const global = divePlaybook.pivots.find((p) => p.id === "global")!;
    if (base.matched.length <= 1) {
      chosen = global;
      why = `${global.whyAgainst} ${map.name} is a large map — prefer global/soak over a fair 5v5.`;
    } else {
      why = `${base.why} Still draft a global or high-mobility piece for ${map.name}.`;
    }
  } else {
    why = `${base.why} On ${map.name}, ${map.line}.`;
  }

  return {
    recommended: toPivot(chosen, why),
    alternates: divePlaybook.pivots
      .filter((p) => p.id !== chosen.id)
      .map((p) => toPivot(p, p.whyAgainst)),
  };
}

/** Rewrite plan text / playbook for the selected NGS map. */
export function applyMapToDraftPlan(
  plan: DraftPlan,
  mapName: string | null,
): DraftPlan {
  if (!mapName) return plan;
  const map = ngsMapByName(mapName);
  if (!map) return plan;

  const playbook = plan.playbook
    ? (() => {
        if (!plan.playbook.antiDiveThreat) {
          return {
            ...plan.playbook,
            intro: `${plan.playbook.intro} Playing ${map.name}: ${map.line}.`,
          };
        }
        const next = pivotForMap(plan.playbook.antiDiveHeroesSeen, map);
        return {
          ...plan.playbook,
          intro: `Map locked: ${map.name}. Their pool has anti-dive — leave Genji / Greymane / Kerrigan and take the pivot below.`,
          recommended: next.recommended,
          alternates: next.alternates,
          pivots: [next.recommended, ...next.alternates],
        };
      })()
    : plan.playbook;

  const mapLead = `On ${map.name}, ${map.line}.`;
  const macro =
    map.size === "large"
      ? `${mapLead} Large map: draft one global or high-mobility hero (Dehaka, Falstad, Brightwing) and a wave-clear offlane.`
      : `${mapLead} Point-control map: you can spend the flex slot on fight synergy instead of a pure global.`;

  const patchSide = (side: DraftPlan["sides"]["theyFirst"]) => ({
    ...side,
    summary: `${mapLead} ${side.summary}`,
    ourBrief: {
      ...side.ourBrief,
      mapStrategy: `${mapLead}${
        side.ourBrief.mapStrategy
          ? ` ${side.ourBrief.mapStrategy.replace(/^On [^,]+,?\s*/i, "")}`
          : ""
      }`,
    },
  });

  const rec = playbook?.recommended;
  const summary = rec
    ? `Map: ${map.name}. ${rec.why} Pick ${rec.heroes.slice(0, 3).join(" / ")}.`
    : `Map: ${map.name}. ${plan.summary}`;

  return {
    ...plan,
    summary,
    macro,
    playbook,
    sides: {
      theyFirst: patchSide(plan.sides.theyFirst),
      weFirst: patchSide(plan.sides.weFirst),
    },
    ourBrief: {
      ...plan.ourBrief,
      mapStrategy: mapLead,
    },
  };
}
