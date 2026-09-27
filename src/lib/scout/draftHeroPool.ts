import { heroKey } from "@/lib/scoring/heroMeta";
import type { ScoutReport } from "@/lib/scoring/types";

/** Heroes the scout will pull SL matchups for (bans + both sides' likely fives). */
export function draftHeroPool(report: ScoutReport): string[] {
  const names = new Set<string>();
  const add = (h?: string | null) => {
    if (h) names.add(h);
  };
  for (const b of report.adapt.banPriority) add(b.hero);
  for (const t of report.threats) add(t.hero);
  for (const p of report.roster) {
    for (const h of p.topHeroes.slice(0, 3)) add(h.hero);
  }
  for (const p of report.homeRoster ?? []) {
    for (const h of p.topHeroes.slice(0, 3)) add(h.hero);
  }
  const plan = report.adapt.draftPlan;
  if (plan) {
    for (const p of plan.ourLikely) add(p.hero);
    for (const p of plan.theirLikely) add(p.hero);
    for (const side of [plan.sides.weFirst, plan.sides.theyFirst]) {
      for (const p of side.ourLikely) add(p.hero);
      for (const p of side.theirLikely) add(p.hero);
    }
    for (const b of plan.baitBans) add(b.hero);
  }
  const byKey = new Map<string, string>();
  for (const h of names) {
    const k = heroKey(h);
    if (!byKey.has(k)) byKey.set(k, h);
  }
  return [...byKey.values()];
}
