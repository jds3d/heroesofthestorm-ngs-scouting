import { comfortMeetsSuggestBar } from "@/lib/scoring/comfort";
import { buildMapPlan } from "@/lib/scoring/mapPlan";
import { rosterWeakRole } from "@/lib/scoring/draft";
import {
  banPressure,
  heroComfort,
  metaStrength,
  type GlobalHeroStat,
} from "@/lib/scoring/metaPressure";
import { heroKey, heroRole, heroTags } from "@/lib/scoring/heroMeta";
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
  ourMaps: DraftInsights["mapTendencies"] | null = null,
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

  const mapPlan = buildMapPlan(draft.mapTendencies, ourMaps);

  // One-tricks / signature comfort
  for (const p of players) {
    const top = p.topHeroes[0];
    const second = p.topHeroes[1];
    if (
      top &&
      comfortMeetsSuggestBar(top.comfort) &&
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

  // Roster soft spot — turn diagnosis into a fight-shape / ban bias
  const weakRole = rosterWeakRole(players);
  if (weakRole === "Melee Assassin") {
    const bestRanged = findBestInRole(players, "Ranged Assassin");
    recommendations.push({
      priority: 2,
      title: "Exploit thin melee assassin",
      detail:
        "No preferred Melee Assassin on their roster — poke / siege and spaced setups are safer; they lack a dedicated dive tip-in to punish. " +
        (bestRanged
          ? `Ban or deny ${bestRanged} so the fifth seat cannot hide as a mage, and do not over-peel for a dive they cannot comfortably run.`
          : "Do not over-draft peel for a dive tip-in they cannot comfortably run."),
    });
    if (bestRanged && !banPriority.some((b) => b.hero === bestRanged)) {
      banPriority.push({
        hero: bestRanged,
        reason:
          "No melee-assassin main — deny ranged so the flex fifth stays awkward",
      });
    }
  } else if (weakRole === "Ranged Assassin") {
    recommendations.push({
      priority: 2,
      title: "Exploit thin ranged",
      detail:
        "No preferred Ranged Assassin — dive and blow-up are freer. Contest their bruiser/melee comfort and play for a short fight.",
    });
  } else if (weakRole === "Bruiser") {
    recommendations.push({
      priority: 2,
      title: "Exploit thin offlane",
      detail:
        "No preferred Bruiser — force a real solo lane and punish soak. Take waveclear offlane yourself; their solo will be a tank or assassin parked off-role.",
    });
  } else if (weakRole === "Tank") {
    recommendations.push({
      priority: 2,
      title: "Exploit thin tank",
      detail:
        "No preferred Tank — engage and pick tanks punish a fake frontline. Ban their best Bruiser so they cannot paper over the seat.",
    });
  } else if (weakRole === "Healer") {
    const bestHeal = findBestInRole(players, "Healer");
    recommendations.push({
      priority: 2,
      title: "Exploit thin healer",
      detail: bestHeal
        ? `No preferred Healer main — deny ${bestHeal} early and draft damage that wins before a flex support stabilizes.`
        : "No preferred Healer main — deny their best heal pocket and end fights early.",
    });
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

  // Map plan — what we ban / what we want to play
  if (mapPlan.ban.length || mapPlan.play.length) {
    const banBit = mapPlan.ban.length
      ? `Ban ${mapPlan.ban
          .slice(0, 2)
          .map((m) => m.map)
          .join(" and ")}${mapPlan.ban.length > 2 ? " (+ ranked backups in map plan)" : ""}`
      : null;
    const playBit = mapPlan.play.length
      ? `leave up ${mapPlan.play
          .slice(0, 3)
          .map((m) => m.map)
          .join(", ")}${mapPlan.play.length > 3 ? " (+ ranked backups in map plan)" : ""}`
      : null;
    recommendations.push({
      priority: 2,
      title: "Map plan",
      detail: [banBit, playBit].filter(Boolean).join("; ") + ".",
    });
  }

  // What they fear (their bans) — concrete pick / ban / strategy if they spend it
  if (draft.theirBans[0]) {
    const feared = draft.theirBans.slice(0, 3);
    const lines = feared.map((b) => fearBanAdvice(b.hero));
    recommendations.push({
      priority: 2,
      title: "If they ban what they fear",
      detail: lines.join(" "),
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
  ])
    .filter((b) => heroOnRoster(players, b.hero))
    .slice(0, 6);
  const uniqDenies = [...new Set(firstPickDenies)].slice(0, 5);
  recommendations.sort((a, b) => a.priority - b.priority);

  const uniqRecs = dedupeRecs(recommendations).slice(0, 8);

  return {
    banPriority: uniqBans,
    firstPickDenies: uniqDenies,
    recommendations: uniqRecs,
    confidence,
    // Built once in the scout route with homeRoster + live meta (avoid double plan).
    draftPlan: null,
    mapPlan,
  };
}

export function metaBanPriority(
  players: PlayerScout[],
  meta: GlobalHeroStat[],
): { hero: string; pressure: number; reason: string }[] {
  return meta
    .map((stat) => {
      const who = heroComfort(players, stat.hero);
      if (!who || !comfortMeetsSuggestBar(who.comfort)) return null;
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

function heroOnRoster(players: PlayerScout[], hero: string): boolean {
  for (const p of players) {
    for (const h of p.topHeroes) {
      if (heroKey(h.hero) !== heroKey(hero)) continue;
      if (comfortMeetsSuggestBar(h.comfort)) return true;
    }
  }
  return false;
}

function findBestInRole(players: PlayerScout[], role: string): string | null {
  let best: { hero: string; comfort: number } | null = null;
  for (const p of players) {
    for (const h of p.topHeroes) {
      if (heroRole(h.hero) !== role) continue;
      if (!comfortMeetsSuggestBar(h.comfort)) continue;
      if (!best || h.comfort > best.comfort) best = h;
    }
  }
  return best?.hero ?? null;
}

/**
 * Concrete response when opponents spend a ban on a hero they commonly fear.
 * Tell us what to pick, what to ban next, or which fight shape to divert to.
 */
function fearBanAdvice(hero: string): string {
  const role = heroRole(hero);
  const tags = heroTags(hero);

  if (role === "Bruiser" || tags.includes("solo")) {
    return `${hero}: they are denying offlane sustain — lock a flexible tank/healer first, then take offlane after they declare the lane. If you open Leoric / Sonya / Dehaka early, it is as flex bait only: play them in the 4-man if they counter-pick the lane, and take the real offlaner later. Never first-pick your committed offlaner into live hard counters — offlane is ~half the game.`;
  }
  if (
    (role === "Melee Assassin" || role === "Ranged Assassin") &&
    (tags.includes("dive") || tags.includes("assassin") || tags.includes("pick"))
  ) {
    return `${hero}: they are scared of dive/pick — either first-pick ${hero} when they leave it, or drop pure dive and pivot to poke (Hanzo / Jaina / Chromie) or blow-up (Stitches / Kerrigan). Next, ban their best peel (Tyrael, Brightwing, or Johanna) so they cannot punish the divert.`;
  }
  if (role === "Tank" || tags.includes("frontline") || tags.includes("peel")) {
    return `${hero}: they are denying a tank shell — if the ban lands, lock Diablo, Anub'arak, or Johanna next and keep our healer flexible (Rehgar / Brightwing). If they leave ${hero} up, first-pick them and force them onto a worse tank.`;
  }
  if (role === "Healer" || tags.includes("heal")) {
    return `${hero}: they are denying our heal — first-pick Rehgar, Anduin, or Brightwing immediately, or leave ${hero} up and take them. Ban their best engage tank next so they cannot run at a backup healer.`;
  }
  if (tags.includes("poke") || tags.includes("siege") || tags.includes("hypercarry")) {
    return `${hero}: they are denying ranged threat — if banned, divert to dive (Genji / Greymane / Kerrigan behind Anub/Tyrael) or global macro (Dehaka / Falstad). If left up, first-pick ${hero} and ban their best gap-closer.`;
  }
  if (tags.includes("global") || tags.includes("split")) {
    return `${hero}: they are denying map pressure — if banned, take Dehaka, Falstad, or Brightwing as the global instead, and play for soak + objective timers rather than a fair 5v5.`;
  }
  return `${hero}: treat the ban as a free tell — either first-pick ${hero} when available, or fill that same role with a flex (same role: ${role === "Unknown" ? "whatever they just denied" : role}) and ban the hero that answers our divert.`;
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
