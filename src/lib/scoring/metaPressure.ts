import { heroKey } from "@/lib/scoring/heroMeta";
import type { PlayerScout } from "@/lib/scoring/types";

export type GlobalHeroStat = {
  hero: string;
  influence: number;
  popularity: number;
  banRate: number;
  pickRate: number;
  winRate: number;
  games: number;
};

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * 0–1 from Storm League global stats. Influence already mixes win rate with
 * how often the hero is picked or banned. Popularity (pick + ban) keeps a
 * high win rate on a rarely seen hero from looking like a must-ban.
 * Around 140 influence and 60% popularity is the middle. Qhira-shaped
 * numbers (300 influence, 90% popularity) land near the top.
 */
export function metaStrength(stat: {
  influence: number;
  popularity: number;
}): number {
  const influence = logistic((stat.influence - 140) / 50);
  const popularity = logistic((stat.popularity - 60) / 14);
  return influence * popularity;
}

/** How sure we are they will take it. Zero if they do not play it. Rises fast, then flattens. */
export function playWeight(comfort: number): number {
  if (comfort <= 0) return 0;
  return 1 - Math.exp(-comfort / 0.02);
}

export function banPressure(strength: number, comfort: number): number {
  return strength * playWeight(comfort);
}

export function heroComfort(
  players: PlayerScout[],
  hero: string,
): { name: string; comfort: number } | null {
  let best: { name: string; comfort: number } | null = null;
  for (const p of players) {
    for (const h of p.topHeroes) {
      if (heroKey(h.hero) !== heroKey(hero)) continue;
      if (!best || h.comfort > best.comfort) {
        best = { name: p.battletag.split("#")[0], comfort: h.comfort };
      }
    }
  }
  return best;
}
