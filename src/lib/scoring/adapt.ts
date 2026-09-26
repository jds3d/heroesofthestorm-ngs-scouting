import { buildDraftPlan } from "@/lib/scoring/draftPlan";
import {
  banPressure,
  heroComfort,
  metaStrength,
  type GlobalHeroStat,
} from "@/lib/scoring/metaPressure";
import { heroRole, heroTags } from "@/lib/scoring/heroMeta";
import type {
  AdaptPlan,
  AdaptRecommendation,
  DraftInsights,
  PlayerScout,
  TeamThreat,
} from "@/lib/scoring/types";

export function buildAdaptPlan(
  players: PlayerScout[],
  threats: TeamThreat[],
  draft: DraftInsights,
  meta: GlobalHeroStat[] = [],
): AdaptPlan {
  const recommendations: AdaptRecommendation[] = [];
  const banPriority: { hero: string; reason: string }[] = [];
  const firstPickDenies: string[] = [];

  const totalNgsGames = players.reduce(
    (s, p) => s + p.ngsWins + p.ngsLosses,
    0,
  );
  const confidence: AdaptPlan["confidence"] =
    totalNgsGames >= 20 && draft.gamesAnalyzed >= 4
      ? "high"
      : totalNgsGames >= 8
        ? "medium"
        : "low";

  // One-tricks / signature comfort
  for (const p of players) {
    const top = p.topHeroes[0];
    const second = p.topHeroes[1];
    if (
      top &&
      top.comfort >= 0.1 &&
      (!second || top.comfort > second.comfort * 2.2)
    ) {
      banPriority.push({
        hero: top.hero,
        reason: `${p.battletag.split("#")[0]} signature — force off comfort`,
      });
      firstPickDenies.push(top.hero);
      recommendations.push({
        priority: 1,
        title: `Deny ${top.hero}`,
        detail: `${p.battletag.split("#")[0]} spikes hard on ${top.hero}. Ban or first-pick deny; force their 2nd/3rd options.`,
      });
    }
  }

  // Shared threats
  for (const t of threats.slice(0, 4)) {
    if (!banPriority.some((b) => b.hero === t.hero)) {
      banPriority.push({ hero: t.hero, reason: t.reason });
    }
    if (t.playerCount >= 2) firstPickDenies.push(t.hero);
  }

  // Role pool imbalance
  const roleComfort = new Map<string, number>();
  for (const p of players) {
    for (const h of p.topHeroes.slice(0, 4)) {
      const role = heroRole(h.hero);
      roleComfort.set(role, (roleComfort.get(role) ?? 0) + h.comfort);
    }
  }
  const tank = roleComfort.get("Tank") ?? 0;
  const healer = roleComfort.get("Healer") ?? 0;
  if (tank > healer * 1.6 && healer > 0) {
    const bestHealer = findBestInRole(players, "Healer");
    if (bestHealer) {
      banPriority.push({
        hero: bestHealer,
        reason: "Weak healer pool relative to tanks — contest their glue heal",
      });
      recommendations.push({
        priority: 2,
        title: "Contest their healer",
        detail: `Tank pool looks deeper than heals. Ban/contest ${bestHealer}; leave tanks and punish the draft.`,
      });
    }
  }

  // Archetype adapts
  if (draft.archetype.includes("dive")) {
    recommendations.push({
      priority: 2,
      title: "Prep anti-dive",
      detail:
        "Stack peel, soft CC, and wave clear. Avoid fragile hypercarries without peel supports.",
    });
  }
  if (draft.archetype.includes("double support")) {
    const enabler = draft.firstPickHeroes[0]?.hero ?? threats[0]?.hero;
    recommendations.push({
      priority: 2,
      title: "Break the sustain plan",
      detail: `Ban their best double-support enabler${enabler ? ` (look at ${enabler})` : ""} and pick siege or hard engage that forces fights.`,
    });
  }
  if (draft.archetype.includes("poke") || draft.archetype.includes("siege")) {
    recommendations.push({
      priority: 3,
      title: "Close the gap",
      detail:
        "Prioritize engage tanks and dive melee. Don't mirror poke unless you win the waveclear war.",
    });
  }

  // Predictable first pick
  if (draft.firstPickHeroes[0] && draft.firstPickHeroes[0].pct >= 35) {
    const hero = draft.firstPickHeroes[0].hero;
    firstPickDenies.push(hero);
    recommendations.push({
      priority: 1,
      title: `Expect ${hero} early`,
      detail: `They first-lean ${hero} (~${draft.firstPickHeroes[0].pct}%). Counter-pick it or deny it and watch them scramble.`,
    });
  }

  // Map bans
  if (draft.mapBans.length) {
    recommendations.push({
      priority: 3,
      title: "Map ban path",
      detail: `Expect them to ban ${draft.mapBans
        .slice(0, 2)
        .map((m) => m.map)
        .join(" and ")}. Prepare three map plans for what remains.`,
    });
  }

  // What they fear (their bans) — bait / bring
  if (draft.theirBans[0]) {
    recommendations.push({
      priority: 3,
      title: "They fear these",
      detail: `Their common bans (${draft.theirBans
        .slice(0, 3)
        .map((b) => b.hero)
        .join(", ")}) reveal priority threats — bring flex versions or bait the ban.`,
    });
  }

  // SL vs NGS mismatch
  for (const p of players) {
    for (const h of p.topHeroes.slice(0, 3)) {
      const ngs = h.sources.ngsCurrent;
      const sl = h.sources.stormLeague;
      if (sl && sl.games >= 8 && (!ngs || ngs.games < 2) && sl.winRate >= 0.55) {
        recommendations.push({
          priority: 4,
          title: `SL surprise: ${h.hero}`,
          detail: `${p.battletag.split("#")[0]} cooks ${h.hero} in Storm League but rarely shows it in NGS — treat as a blind threat, prefer banning off NGS signals first.`,
        });
      }
    }
  }

  // Flex gods
  for (const p of players) {
    const roles = new Set(
      p.topHeroes.slice(0, 5).map((h) => heroRole(h.hero)),
    );
    if (roles.size >= 3) {
      const glue = p.topHeroes[0]?.hero;
      recommendations.push({
        priority: 2,
        title: `${p.battletag.split("#")[0]} is a flex threat`,
        detail: `Comfort across ${[...roles].join(", ")}. Ban system/glue heroes${glue ? ` like ${glue}` : ""} rather than locking one role.`,
      });
    }
  }

  if (confidence === "low") {
    recommendations.push({
      priority: 1,
      title: "Low sample — lean SL",
      detail:
        "Sparse NGS games this season. Weight Storm League pools and last-season tendencies more, and keep drafts flexible.",
    });
  }

  // Dive tag on threats
  for (const t of threats.slice(0, 3)) {
    if (heroTags(t.hero).includes("dive") || heroTags(t.hero).includes("assassin")) {
      if (!banPriority.some((b) => b.hero === t.hero)) {
        banPriority.push({
          hero: t.hero,
          reason: "High-impact dive/assassin threat",
        });
      }
    }
  }

  const metaBans = metaBanPriority(players, meta);

  for (const ban of metaBans) {
    firstPickDenies.unshift(ban.hero);
    recommendations.push({
      priority: 1,
      title: `Ban ${ban.hero}`,
      detail: ban.reason,
    });
  }

  const uniqBans = dedupeHeroes([
    ...metaBans.map(({ hero, reason }) => ({ hero, reason })),
    ...banPriority,
  ]).slice(0, 6);
  const uniqDenies = [...new Set(firstPickDenies)].slice(0, 5);
  recommendations.sort((a, b) => a.priority - b.priority);

  const uniqRecs = dedupeRecs(recommendations).slice(0, 8);

  return {
    banPriority: uniqBans,
    firstPickDenies: uniqDenies,
    recommendations: uniqRecs,
    confidence,
    draftPlan: buildDraftPlan(players, draft, null, meta),
  };
}

export function metaBanPriority(
  players: PlayerScout[],
  meta: GlobalHeroStat[],
): { hero: string; pressure: number; reason: string }[] {
  return meta
    .map((stat) => {
      const who = heroComfort(players, stat.hero);
      if (!who) return null;
      const pressure = banPressure(metaStrength(stat), who.comfort);
      if (pressure < 0.2) return null;
      return {
        hero: stat.hero,
        pressure,
        reason: `${who.name} plays ${stat.hero}. Storm League influence ${Math.round(stat.influence)}, popularity ${stat.popularity.toFixed(0)}%. That is a first ban even when it is not their only hero.`,
      };
    })
    .filter((b): b is { hero: string; pressure: number; reason: string } => b != null)
    .sort((a, b) => b.pressure - a.pressure);
}

function findBestInRole(players: PlayerScout[], role: string): string | null {
  let best: { hero: string; comfort: number } | null = null;
  for (const p of players) {
    for (const h of p.topHeroes) {
      if (heroRole(h.hero) !== role) continue;
      if (!best || h.comfort > best.comfort) best = h;
    }
  }
  return best?.hero ?? null;
}

function dedupeHeroes(
  items: { hero: string; reason: string }[],
): { hero: string; reason: string }[] {
  const seen = new Set<string>();
  const out: { hero: string; reason: string }[] = [];
  for (const item of items) {
    if (seen.has(item.hero)) continue;
    seen.add(item.hero);
    out.push(item);
  }
  return out;
}

function dedupeRecs(items: AdaptRecommendation[]): AdaptRecommendation[] {
  const seen = new Set<string>();
  const out: AdaptRecommendation[] = [];
  for (const item of items) {
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    out.push(item);
  }
  return out;
}
