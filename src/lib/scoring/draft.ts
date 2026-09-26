import { leagueConfig } from "@/config/league";
import type { HpMatchGame, HpNgsMatch } from "@/lib/heroesprofile/types";
import type { NgsMatch } from "@/lib/ngs/types";
import { heroRole, heroTags } from "@/lib/scoring/heroMeta";
import type {
  DraftDataQuality,
  DraftInsights,
  DraftSection,
  PlayerScout,
} from "@/lib/scoring/types";

function bump(map: Map<string, number>, key: string, by = 1) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

function topEntries(
  map: Map<string, number>,
  limit = 5,
): { key: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

type PlaySplit = { current: number; prior: number };

function addPlay(map: Map<string, PlaySplit>, key: string, prior: boolean) {
  if (!key) return;
  const cur = map.get(key) ?? { current: 0, prior: 0 };
  if (prior) cur.prior += 1;
  else cur.current += 1;
  map.set(key, cur);
}

const COMP_ROLE_ORDER = [
  "Tank",
  "Bruiser",
  "Melee Assassin",
  "Ranged Assassin",
  "Healer",
  "Support",
];

function compKey(heroes: string[]): string {
  return [...heroes].sort((a, b) => a.localeCompare(b)).join("|");
}

function formatFive(heroes: string[]): string {
  return [...heroes]
    .sort((a, b) => {
      const oa = COMP_ROLE_ORDER.indexOf(heroRole(a));
      const ob = COMP_ROLE_ORDER.indexOf(heroRole(b));
      const ra = oa === -1 ? COMP_ROLE_ORDER.length : oa;
      const rb = ob === -1 ? COMP_ROLE_ORDER.length : ob;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    })
    .join(", ");
}

function countLabel(current: number, prior: number): string {
  const times = (n: number) => (n === 1 ? "1 time" : `${n} times`);
  if (prior <= 0) return times(current);
  if (current <= 0) return `${times(prior)} last season`;
  return `${times(current)} this season, ${times(prior)} last season`;
}

/** Healers + utility supports (Abathur/Medivh/etc.) in one draft. */
function supportCount(heroes: string[]): number {
  return heroes.filter((h) => {
    const role = heroRole(h);
    return role === "Healer" || role === "Support";
  }).length;
}

/** Archetype for a single 5-hero draft — never aggregate across games. */
function detectGameArchetype(heroes: string[]): string {
  if (heroes.length === 0) return "unknown";
  if (supportCount(heroes) >= 2) return "double support / sustain";

  const tagCounts = new Map<string, number>();
  for (const h of heroes) {
    for (const t of heroTags(h)) bump(tagCounts, t);
  }
  const ranked = topEntries(tagCounts, 3).map((e) => e.key);
  if (ranked.includes("dive") && ranked.includes("assassin")) return "dive";
  if (ranked.includes("siege") || ranked.includes("poke")) return "poke/siege";
  if (ranked.includes("hypercarry")) return "hypercarry protect";
  if (ranked.includes("solo") && ranked.includes("engage"))
    return "bruiser frontline";
  if (ranked[0]) return ranked[0];
  return "flexible / mixed";
}

/** Storm League / comfort-led identity when NGS drafts are too thin. */
function detectStormLeagueArchetype(players: PlayerScout[]): {
  archetype: string;
  source: "storm_league" | "roster";
} {
  const heroes: string[] = [];
  let slGames = 0;
  for (const p of players) {
    for (const h of p.topHeroes.slice(0, 3)) {
      heroes.push(h.hero);
      slGames += h.sources.stormLeague?.games ?? 0;
    }
  }
  if (slGames >= leagueConfig.minGames.stormLeague && heroes.length >= 3) {
    return {
      archetype: detectGameArchetype(heroes),
      source: "storm_league",
    };
  }

  const roles = players
    .map((p) => p.preferredRole)
    .filter((r): r is string => Boolean(r));
  if (roles.filter((r) => r.includes("Assassin")).length >= 3) {
    return { archetype: "assassin-heavy roster", source: "roster" };
  }
  if (roles.filter((r) => r === "Tank").length >= 2) {
    return { archetype: "tank-heavy roster", source: "roster" };
  }
  return { archetype: "unclear", source: "roster" };
}

function classifyDraftQuality(
  gamesWithDrafts: number,
  reportedExpected: number,
): DraftDataQuality {
  const min = leagueConfig.minGames.draftSample;
  if (gamesWithDrafts >= min) return "ok";
  // They've played enough games, but we only got a thin draft sample → pull failed.
  if (reportedExpected >= min && gamesWithDrafts < reportedExpected) {
    return "incomplete";
  }
  // Truly early: schedule only has a handful of games so far.
  if (reportedExpected > 0 && reportedExpected < min) return "early_season";
  return "insufficient";
}

function gamesAnalyzedLabel(
  quality: DraftDataQuality,
  gamesWithDrafts: number,
  reportedExpected: number,
): string {
  switch (quality) {
    case "ok":
      return String(Math.round(gamesWithDrafts * 10) / 10);
    case "early_season":
      return `Early season (${Math.round(reportedExpected || gamesWithDrafts)} games)`;
    case "incomplete":
      return "Not enough data";
    case "insufficient":
    default:
      return "Not enough data";
  }
}

export type DraftMatchInput = {
  ngsMatch: NgsMatch;
  hpMatch: HpNgsMatch | null;
  weight: number;
};

export function buildDraftInsights(
  teamName: string,
  inputs: DraftMatchInput[],
  players: PlayerScout[],
): DraftInsights {
  const firstPicks = new Map<string, number>();
  const theirBans = new Map<string, number>();
  const bannedAgainst = new Map<string, number>();
  const mapBanCounts = new Map<string, number>();
  const mapStats = new Map<
    string,
    { games: number; wins: number; current: number; prior: number; currentWins: number; priorWins: number }
  >();
  const archetypeVotes = new Map<string, number>();
  const strategyPlays = new Map<string, PlaySplit>();
  const compPlays = new Map<string, PlaySplit & { heroes: string[] }>();
  let matchesAnalyzed = 0;
  let gamesWithHeroes = 0;
  let reportedGamesExpected = 0;
  let currentMaps = 0;
  let priorMaps = 0;
  let priorWeight = false;

  for (const { ngsMatch, hpMatch, weight } of inputs) {
    if (weight < 1) priorWeight = true;
    const isHome = ngsMatch.home.teamName === teamName;

    if (ngsMatch.mapBans) {
      const bans = isHome
        ? [ngsMatch.mapBans.homeOne, ngsMatch.mapBans.homeTwo]
        : [ngsMatch.mapBans.awayOne, ngsMatch.mapBans.awayTwo];
      for (const m of bans) if (m) bump(mapBanCounts, m, weight);
    }

    // Expected games: prefer HP match list length, else NGS replay count.
    const hpGames = hpMatch?.match_data
      ? Object.keys(hpMatch.match_data).length
      : 0;
    const ngsReplayCount = ngsMatch.replays
      ? Object.keys(ngsMatch.replays).filter((k) => k !== "_id").length
      : 0;
    const expectedHere = Math.max(hpGames, ngsReplayCount, hpGames ? 0 : 1);
    if (ngsMatch.reported) reportedGamesExpected += expectedHere * weight;

    if (!hpMatch?.match_data) continue;
    matchesAnalyzed += weight;

    const games = Object.values(hpMatch.match_data) as HpMatchGame[];
    for (const game of games) {
      const teamHeroes = game.team_heroes ?? [];
      const teamBans = game.team_bans ?? [];
      const enemyBans = game.enemy_bans ?? [];
      const won = Boolean(game.winner);

      if (teamHeroes.length > 0) {
        gamesWithHeroes += weight;
        const priorGame = weight < 1;
        if (priorGame) priorMaps += 1;
        else currentMaps += 1;
        const archetype = detectGameArchetype(teamHeroes);
        bump(archetypeVotes, archetype, weight);
        addPlay(strategyPlays, archetype, priorGame);
        if (teamHeroes.length === 5) {
          const key = compKey(teamHeroes);
          const bucket = compPlays.get(key) ?? {
            heroes: teamHeroes,
            current: 0,
            prior: 0,
          };
          if (priorGame) bucket.prior += 1;
          else bucket.current += 1;
          compPlays.set(key, bucket);
        }
        if (teamHeroes[0]) bump(firstPicks, teamHeroes[0], weight);
      }

      for (const b of teamBans) bump(theirBans, b, weight);
      for (const b of enemyBans) bump(bannedAgainst, b, weight);

      const mapName = game.map;
      if (mapName && teamHeroes.length > 0) {
        const cur = mapStats.get(mapName) ?? {
          games: 0,
          wins: 0,
          current: 0,
          prior: 0,
          currentWins: 0,
          priorWins: 0,
        };
        cur.games += weight;
        if (won) cur.wins += weight;
        if (weight < 1) {
          cur.prior += 1;
          if (won) cur.priorWins += 1;
        } else {
          cur.current += 1;
          if (won) cur.currentWins += 1;
        }
        mapStats.set(mapName, cur);
      }
    }
  }

  const dataQuality = classifyDraftQuality(
    gamesWithHeroes,
    reportedGamesExpected,
  );
  const trustNgsDrafts = dataQuality === "ok";

  let archetype: string;
  let identitySource: DraftInsights["identitySource"];
  if (trustNgsDrafts) {
    archetype = topEntries(archetypeVotes, 1)[0]?.key ?? "flexible / mixed";
    identitySource = "ngs_drafts";
  } else {
    const fb = detectStormLeagueArchetype(players);
    archetype = fb.archetype;
    identitySource = fb.source;
  }

  const firstPickHeroes = trustNgsDrafts
    ? topEntries(firstPicks, 5).map((e) => ({
        hero: e.key,
        count: e.count,
        pct:
          gamesWithHeroes > 0
            ? Math.round((e.count / gamesWithHeroes) * 1000) / 10
            : 0,
      }))
    : [];
  const theirBanList = topEntries(theirBans, 6).map((e) => ({
    hero: e.key,
    count: e.count,
  }));
  const bannedAgainstList = topEntries(bannedAgainst, 6).map((e) => ({
    hero: e.key,
    count: e.count,
  }));
  const mapBans = topEntries(mapBanCounts, 6).map((e) => ({
    map: e.key,
    count: e.count,
  }));
  const mapTendencies = [...mapStats.entries()]
    .map(([map, s]) => ({
      map,
      games: Math.round(s.games * 10) / 10,
      wins: Math.round(s.wins * 10) / 10,
      winRate: s.games > 0 ? Math.round((s.wins / s.games) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.games - a.games);

  const topComfort = players
    .flatMap((p) => p.topHeroes.slice(0, 1))
    .sort((a, b) => b.comfort - a.comfort)[0];
  const topSlComfort = players
    .flatMap((p) =>
      p.topHeroes.filter((h) => (h.sources.stormLeague?.games ?? 0) > 0),
    )
    .sort(
      (a, b) =>
        (b.sources.stormLeague?.games ?? 0) -
        (a.sources.stormLeague?.games ?? 0),
    )[0];

  const fp = firstPickHeroes[0];
  const ban1 = theirBanList[0]?.hero;
  const ban2 = theirBanList[1]?.hero;
  const mapNote = mapTendencies[0];
  const weakRole = findWeakRole(players);
  const sections: DraftSection[] = [];
  const add = (heading: string, body: string | null | undefined) => {
    if (body?.trim()) sections.push({ heading, body: body.trim() });
  };

  if (trustNgsDrafts) {
    add(
      "Identity",
      `${archetype}` +
        (topComfort ? ` — standout comfort threat: ${topComfort.hero}` : ""),
    );
  } else if (dataQuality === "early_season") {
    const n = Math.round(reportedGamesExpected || gamesWithHeroes);
    add(
      "Data quality",
      `Early season — only ${n} NGS game${n === 1 ? "" : "s"} so far. Draft reads are tentative.`,
    );
    add(
      "Identity",
      identitySource === "storm_league"
        ? `${archetype} (from Storm League)` +
            (topSlComfort ? `, led by ${topSlComfort.hero}` : "")
        : topComfort
          ? `${archetype} — highest roster comfort: ${topComfort.hero}`
          : archetype,
    );
  } else if (dataQuality === "incomplete") {
    add(
      "Data quality",
      `Not enough draft data pulled (${Math.round(gamesWithHeroes)} of ~${Math.round(reportedGamesExpected)} reported games).`,
    );
    add(
      "Identity",
      identitySource === "storm_league"
        ? `${archetype} (Storm League fallback)` +
            (topSlComfort ? `, led by ${topSlComfort.hero}` : "")
        : topComfort
          ? `${archetype} — roster comfort: ${topComfort.hero}`
          : archetype,
    );
  } else {
    add("Data quality", "Not enough NGS draft data to call a firm identity.");
    add(
      "Identity",
      identitySource === "storm_league"
        ? `${archetype} (Storm League)` +
            (topSlComfort ? `, led by ${topSlComfort.hero}` : "")
        : topComfort
          ? `${archetype} — roster comfort: ${topComfort.hero}`
          : archetype,
    );
  }

  add("Strategy groups", strategyGroupSentence());
  add("Most common 5-man", mostCommonFiveSentence());

  if (trustNgsDrafts && fp) {
    add("First-pick lean", `${fp.hero} (~${fp.pct}% of analyzed games)`);
  }
  if (ban1) {
    add(
      "Their hero bans",
      ban2 ? `${ban1} and ${ban2}` : ban1,
    );
  }
  if (bannedAgainstList[0]) {
    add(
      "Banned into them",
      bannedAgainstList
        .slice(0, 3)
        .map((b) => b.hero)
        .join(", "),
    );
  }
  if (mapBans[0]) {
    add(
      "Their map bans",
      mapBans
        .slice(0, 3)
        .map((m) => m.map)
        .join(", "),
    );
  }
  if (trustNgsDrafts && mapNote) {
    const raw = mapStats.get(mapNote.map);
    add(
      "Best / most-played map",
      raw && raw.prior > 0
        ? `${mapNote.map}: ${raw.currentWins}-${round1(raw.current - raw.currentWins)} this season (${raw.current} maps); ${raw.priorWins}-${round1(raw.prior - raw.priorWins)} last season (${raw.prior} maps)`
        : `${mapNote.map}: ${mapNote.wins}-${round1(mapNote.games - mapNote.wins)} across ${mapNote.games} maps this season`,
    );
  }
  if (weakRole) {
    add("Soft spot", `Limited flex off ${weakRole}`);
  }

  const notes: string[] = [];
  if (priorWeight) {
    const weighted = round1(currentMaps + priorMaps * 0.25);
    const played = currentMaps + priorMaps;
    notes.push(
      `Last season counts as 1/4 of a map. Totals mix ${currentMaps} this season (each map counts as 1) with ${priorMaps} from last season. ${weighted} is that weighted mix across ${played} maps played.`,
    );
  }
  if (trustNgsDrafts && mapNote) {
    const raw = mapStats.get(mapNote.map);
    if (raw && raw.prior > 0) {
      notes.push(
        `On ${mapNote.map}, the combined record can look like ${mapNote.wins}-${round1(mapNote.games - mapNote.wins)} in ${mapNote.games} because each of last season's ${raw.prior} maps counts as 1/4.`,
      );
    }
  }

  function strategyGroupSentence(): string | null {
    const groups = [...strategyPlays.entries()]
      .map(([label, plays]) => ({
        label,
        ...plays,
        total: plays.current + plays.prior,
      }))
      .filter((g) => g.total > 0)
      .sort(
        (a, b) =>
          b.total - a.total ||
          b.current - a.current ||
          a.label.localeCompare(b.label),
      );
    if (groups.length === 0) return null;
    return groups
      .map((g) => `${g.label} (${countLabel(g.current, g.prior)})`)
      .join("; ");
  }

  function mostCommonFiveSentence(): string | null {
    const rows = [...compPlays.values()]
      .map((c) => ({ ...c, total: c.current + c.prior }))
      .filter((c) => c.total > 0)
      .sort(
        (a, b) =>
          b.total - a.total ||
          b.current - a.current ||
          formatFive(a.heroes).localeCompare(formatFive(b.heroes)),
      );
    if (rows.length === 0) return null;
    const top = rows[0];
    const tied = rows.filter(
      (r) => r.total === top.total && r.current === top.current,
    );
    const label = countLabel(top.current, top.prior);
    if (tied.length === 1) {
      return `${formatFive(top.heroes)} (${label})`;
    }
    const shown = tied.slice(0, 3).map((r) => formatFive(r.heroes));
    const extra = tied.length > 3 ? `; +${tied.length - 3} more` : "";
    return `Tied at ${label}: ${shown.join("; ")}${extra}`;
  }

  return {
    narrative: sections.map((s) => `${s.heading}: ${s.body}`).join(" "),
    sections,
    archetype,
    gamesAnalyzedLabel: gamesAnalyzedLabel(
      dataQuality,
      gamesWithHeroes,
      reportedGamesExpected,
    ),
    dataQuality,
    identitySource,
    firstPickHeroes,
    theirBans: theirBanList,
    bannedAgainstThem: bannedAgainstList,
    mapBans,
    mapTendencies,
    notes,
    gamesAnalyzed: Math.round(gamesWithHeroes * 10) / 10,
    reportedGamesExpected: Math.round(reportedGamesExpected * 10) / 10,
    matchesAnalyzed: Math.round(matchesAnalyzed * 10) / 10,
    priorSeasonWeightApplied: priorWeight,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function findWeakRole(players: PlayerScout[]): string | null {
  const roles = [
    "Tank",
    "Healer",
    "Bruiser",
    "Melee Assassin",
    "Ranged Assassin",
  ];
  const coverage = new Map<string, number>();
  for (const r of roles) coverage.set(r, 0);
  for (const p of players) {
    const role = p.preferredRole;
    if (role && coverage.has(role)) {
      coverage.set(role, (coverage.get(role) ?? 0) + 1);
    }
  }
  const weakest = [...coverage.entries()].sort((a, b) => a[1] - b[1])[0];
  return weakest && weakest[1] === 0 ? weakest[0] : null;
}
