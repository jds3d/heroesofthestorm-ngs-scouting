import type { DraftMetaTable } from "@/lib/scoring/draftMeta";
import { allyDuos, heroDraftMeta } from "@/lib/scoring/draftMeta";
import {
  playerPoolGames,
  poolConfidence,
  stormLeagueScore,
} from "@/lib/scoring/comfort";
import { heroIsOfflaner, heroIsRangedDamage } from "@/lib/scoring/draftPlan";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import {
  heroFillsRole,
  isMainTank,
  REQUIRED_ROLES,
  type RequiredRole,
} from "@/lib/scoring/roles";
import type { PlayerScout } from "@/lib/scoring/types";

export type TheirSeatRole = "Tank" | "Healer" | "Offlane" | "Ranged" | "Flex";

/**
 * `likely` — the other team. A deep pool is what they will play.
 * `should` — our team. The five we ought to draft outweighs the pocket.
 */
export type SuggestionBias = "likely" | "should";

/** One seat in the opponent five, locked or still projected. */
export type TheirRemainingSeat = {
  player: string | null;
  hero: string;
  role: TheirSeatRole;
  locked: boolean;
  /** Storm League score of a projected hero. Locked seats stay 0. */
  sl: number;
  comfort: number;
  games: number;
  /** Visible rank number. Storm League score × 100, or a ban total. */
  points?: number;
  /** Mouseover: why this hero is in the column. */
  why?: string;
};

type HeroOption = {
  hero: string;
  sl: number;
  comfort: number;
  games: number;
};

/**
 * Same seat across a battletag and an OCR slip (HuckIt / Hucklt / HuckIt#1686).
 * Kept local so this module does not import the lobby reader.
 */
function nameKey(name: string | null | undefined): string {
  const base = name?.split("#")[0]?.trim() ?? "";
  if (!base) return "";
  return base
    .toLowerCase()
    .replace(/[il1|!]/g, "l")
    .replace(/[o0]/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function shownName(name: string | null | undefined): string | null {
  const shown = name?.split("#")[0]?.trim();
  return shown || null;
}

function seatRoleToRequired(role: TheirSeatRole): RequiredRole | undefined {
  switch (role) {
    case "Tank":
      return "tank";
    case "Healer":
      return "healer";
    case "Offlane":
      return "offlane";
    case "Ranged":
      return "ranged damage";
    default:
      return undefined;
  }
}

/** Tooltip lines for the number under a suggestion. */
function roleWord(role: RequiredRole | undefined): TheirSeatRole {
  switch (role) {
    case "tank":
      return "Tank";
    case "healer":
      return "Healer";
    case "offlane":
      return "Offlane";
    case "ranged damage":
      return "Ranged";
    default:
      return "Flex";
  }
}

function optionsFor(player: PlayerScout, gone: ReadonlySet<string>): HeroOption[] {
  return player.topHeroes
    .map((hero) => {
      const source = hero.sources.stormLeague;
      const sl = stormLeagueScore(source);
      return {
        hero: hero.hero,
        sl,
        comfort: sl > 0 ? hero.comfort : 0,
        games: source?.games ?? 0,
      };
    })
    .filter((option) => option.sl > 0 && !gone.has(heroKey(option.hero)))
    .sort((a, b) => b.sl - a.sl || a.hero.localeCompare(b.hero));
}

/** Everyone on their team who has not locked a pick yet (OCR + roster). */
export function collectTheirUnpickedPlayers(args: {
  openPlayers: readonly string[];
  roster: readonly PlayerScout[];
  locked: readonly { player: string | null }[];
}): string[] {
  const lockedNames = new Set(
    args.locked.map((lock) => nameKey(lock.player)).filter(Boolean),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const name = shownName(raw);
    if (!name) return;
    const key = nameKey(name);
    if (lockedNames.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const name of args.openPlayers) push(name);
  for (const player of args.roster) push(player.battletag);
  return out;
}

function faceRole(hero: string): TheirSeatRole {
  const required = REQUIRED_ROLES.find((role) => heroFillsRole(hero, role));
  return roleWord(required);
}

function isAssassin(hero: string): boolean {
  const role = heroRole(hero);
  return role === "Assassin" || role.includes("Assassin");
}

function compHasMainTank(heroes: readonly string[]): boolean {
  return heroes.some((hero) => isMainTank(hero));
}

function isBruiser(hero: string): boolean {
  return heroRole(hero) === "Bruiser";
}

function bruiserCount(heroes: readonly string[]): number {
  return heroes.filter((hero) => isBruiser(hero)).length;
}

function compHasAssassin(heroes: readonly string[]): boolean {
  return heroes.some((hero) => isAssassin(hero));
}

function isPureOfflaner(hero: string): boolean {
  return heroIsOfflaner(hero) && !heroIsRangedDamage(hero);
}

function isPureRanged(hero: string): boolean {
  return heroIsRangedDamage(hero) && !heroIsOfflaner(hero);
}

/** Seat order for one hero. A solo-lane assassin is the assassin while that seat is open. */
function preferredCompRoles(hero: string): RequiredRole[] {
  const roles: RequiredRole[] = [];
  if (isMainTank(hero)) roles.push("tank");
  if (heroRole(hero) === "Healer") roles.push("healer");
  if (isPureRanged(hero)) roles.push("ranged damage");
  if (isPureOfflaner(hero)) roles.push("offlane");
  if (heroIsRangedDamage(hero) && heroIsOfflaner(hero)) {
    roles.push("ranged damage", "offlane");
  }
  if (!isMainTank(hero) && heroFillsRole(hero, "tank")) roles.push("tank");
  return roles;
}

function claimCompRole(hero: string, covered: Set<RequiredRole>, roles: RequiredRole[]): boolean {
  for (const role of roles) {
    if (covered.has(role)) continue;
    covered.add(role);
    return true;
  }
  return false;
}

/**
 * One seat per hero already in the five. Specialists claim first, so Nazeebo
 * does not spend the offlane seat while Leoric or Sonya can still take it.
 */
function compRolesCovered(heroes: readonly string[]): Set<RequiredRole> {
  const covered = new Set<RequiredRole>();
  const later: string[] = [];
  for (const hero of heroes) {
    if (!hero) continue;
    const specialist = preferredCompRoles(hero).filter(
      (role) =>
        (role === "tank" && isMainTank(hero)) ||
        (role === "healer" && heroRole(hero) === "Healer") ||
        (role === "offlane" && isPureOfflaner(hero)) ||
        (role === "ranged damage" && isPureRanged(hero)),
    );
    if (!claimCompRole(hero, covered, specialist)) later.push(hero);
  }
  for (const hero of later) claimCompRole(hero, covered, preferredCompRoles(hero));
  return covered;
}

function fillsCompRole(hero: string, role: RequiredRole, specialistsOnly: boolean): boolean {
  if (specialistsOnly) {
    if (role === "tank") return isMainTank(hero);
    if (role === "healer") return heroRole(hero) === "Healer";
    if (role === "offlane") return isPureOfflaner(hero);
    return isPureRanged(hero);
  }
  return preferredCompRoles(hero).includes(role);
}

/**
 * How this hero finishes a five. Healer and offlane stay firm.
 * A tank is a slight favorite over another bruiser. Two bruisers are still a
 * frontline, and a third bruiser can win when that is what the player plays.
 */
export function compFitPoints(
  hero: string,
  allies: readonly string[],
): { points: number; note: string | null } {
  const covered = compRolesCovered(allies);
  const bruisers = bruiserCount(allies);
  const frontlineThin = !compHasMainTank(allies) && bruisers < 2;
  const firm = (["healer", "offlane"] as const).filter(
    (role) => heroFillsRole(hero, role) && !covered.has(role),
  );
  if (firm.length) {
    return {
      points: 32,
      note: `${firm.map((role) => roleWord(role)).join(", ")} still open`,
    };
  }
  if (frontlineThin && isMainTank(hero)) {
    return { points: 36, note: "frontline still open" };
  }
  if (frontlineThin && isBruiser(hero)) {
    return { points: 32, note: "frontline still open" };
  }
  if (bruisers < 2 && !compHasAssassin(allies) && isAssassin(hero)) {
    return { points: 32, note: "assassin still open" };
  }
  if (isMainTank(hero) && compHasMainTank(allies)) {
    return { points: -48, note: "second tank" };
  }
  if (isMainTank(hero) && bruisers >= 2) {
    return { points: 12, note: "tank optional" };
  }
  if (!isMainTank(hero)) {
    return {
      points: 10,
      note: bruisers >= 2 && isBruiser(hero) ? "bruiser frontline" : "flex seat",
    };
  }
  return { points: 0, note: null };
}

function synergyWithComp(
  hero: string,
  allies: readonly string[],
  table: DraftMetaTable | null | undefined,
): number {
  if (!table || allies.length === 0) return 0;
  let edge = 0;
  for (const duo of allyDuos(table, hero, allies)) edge += duo.edgePp;
  return Math.max(-12, Math.min(12, Math.round(edge * 0.5)));
}

/**
 * One open player's own heroes, highest first.
 * A hero that fills a role the locked comp still needs ranks above a hero
 * whose only roles are already locked. Nothing is hidden because another
 * open player also plays that role.
 */
export function seatSuggestionStack(
  seat: TheirRemainingSeat,
  roster: readonly PlayerScout[],
  gone: ReadonlySet<string>,
  limit = 3,
  extras: readonly string[] = [],
  lockedHeroes: readonly string[] = [],
  options?: {
    bias?: SuggestionBias;
    table?: DraftMetaTable | null;
  },
): TheirRemainingSeat[] {
  const bias = options?.bias ?? "likely";
  const unavailable = new Set([...gone].map((hero) => heroKey(hero)));
  const stack: TheirRemainingSeat[] = [];
  const frontlineThin = !compHasMainTank(lockedHeroes) && bruiserCount(lockedHeroes) < 2;
  const name = nameKey(seat.player);
  const scout = roster.find(
    (player) => Boolean(name) && nameKey(player.battletag) === name,
  );
  const confidence = poolConfidence(scout ? playerPoolGames(scout) : 0);
  const mixMeta = bias === "should" || confidence < 0.45;
  const push = (hero: string, sl = 0, comfort = 0, games = 0) => {
    if (unavailable.has(heroKey(hero))) return;
    if (stack.some((row) => heroKey(row.hero) === heroKey(hero))) return;
    const fit = compFitPoints(hero, lockedHeroes);
    const synergy = synergyWithComp(hero, lockedHeroes, options?.table);
    const slPoints = sl > 0 ? Math.round(sl * 100) : 0;
    const likelihood = Math.round(slPoints * confidence);
    const should = fit.points + synergy;
    const likelyWeight = bias === "should" ? 0.2 : 1;
    const compWeight = bias === "should" ? 1 : 1 - confidence;
    const points = Math.round(likelihood * likelyWeight + should * compWeight);
    const compNote = [
      fit.note,
      synergy !== 0 ? `synergy ${synergy > 0 ? "+" : ""}${synergy}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const sample =
      games > 0 || slPoints !== 0
        ? `Storm League ${slPoints} (${games} games) × ${Math.round(confidence * 100)}% pool = ${likelihood} likely`
        : "No Storm League games";
    const sideLine =
      bias === "should"
        ? "our seat — the comp outweighs the pocket"
        : confidence < 0.45
          ? "their seat — thin sample, so the comp still matters"
          : "their seat — a deep pool sticks to what they play";
    stack.push({
      player: seat.player,
      hero,
      role: faceRole(hero),
      locked: false,
      sl,
      comfort,
      games,
      points,
      why: [
        sample,
        `Comp ${should >= 0 ? "+" : ""}${should}${compNote ? ` (${compNote})` : ""}`,
        `round(${likelihood} × ${likelyWeight} + ${should} × ${compWeight.toFixed(2)}) = ${points}`,
        sideLine,
      ].join("\n"),
    });
  };
  if (scout) {
    for (const option of optionsFor(scout, unavailable)) {
      push(option.hero, option.sl, option.comfort, option.games);
    }
  }
  push(seat.hero, seat.sl, seat.comfort, seat.games);
  if (mixMeta) {
    for (const hero of extras) push(hero);
  } else if (stack.length < limit) {
    for (const hero of extras) {
      if (stack.length >= limit) break;
      push(hero);
    }
  }
  if (frontlineThin) {
    for (const hero of extras) {
      if (isMainTank(hero)) push(hero);
    }
  }
  const influence = (hero: string) =>
    options?.table ? heroDraftMeta(options.table, hero).influence : 0;
  stack.sort(
    (a, b) =>
      (b.points ?? -1) - (a.points ?? -1) ||
      b.sl - a.sl ||
      influence(b.hero) - influence(a.hero) ||
      a.hero.localeCompare(b.hero),
  );
  const shown = stack.slice(0, limit);
  if (frontlineThin && limit >= 2 && !shown.some((row) => isMainTank(row.hero))) {
    const tank = stack.find((row) => isMainTank(row.hero));
    if (tank) shown.splice(limit - 1, 1, tank);
  }
  return shown;
}

const COMP_CANDIDATES = 6;

function roleInComp(hero: string, allies: readonly string[]): TheirSeatRole {
  const covered = compRolesCovered(allies);
  const job = (["healer", "offlane", "tank", "ranged damage"] as const).find(
    (role) => !covered.has(role) && heroFillsRole(hero, role),
  );
  if (job === "tank" && !isMainTank(hero)) return "Flex";
  if (job) return roleWord(job);
  if (bruiserCount(allies) < 2 && !compHasAssassin(allies) && isAssassin(hero)) return "Ranged";
  return "Flex";
}

function ourSeatScore(
  hero: string,
  allies: readonly string[],
  sl: number,
  games: number,
  confidence: number,
  table: DraftMetaTable | null | undefined,
): { points: number; why: string } {
  const fit = compFitPoints(hero, allies);
  const synergy = synergyWithComp(hero, allies, table);
  const slPoints = sl > 0 ? Math.round(sl * 100) : 0;
  const likelihood = Math.round(slPoints * confidence);
  const points = Math.round(fit.points + synergy + likelihood * 0.2);
  const compNote = [
    fit.note,
    synergy !== 0 ? `synergy ${synergy > 0 ? "+" : ""}${synergy}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const sample =
    games > 0 || slPoints !== 0
      ? `Storm League ${slPoints} (${games} games) × ${Math.round(confidence * 100)}% pool = ${likelihood} likely`
      : "No Storm League games";
  return {
    points,
    why: [
      sample,
      `Comp ${fit.points + synergy >= 0 ? "+" : ""}${fit.points + synergy}${compNote ? ` (${compNote})` : ""}`,
      `round(${fit.points + synergy} + ${likelihood} × 0.2) = ${points}`,
    ].join("\n"),
  };
}

function compCandidatesFor(
  seat: TheirRemainingSeat,
  roster: readonly PlayerScout[],
  gone: ReadonlySet<string>,
  extras: readonly string[],
  table: DraftMetaTable | null | undefined,
): { option: HeroOption; confidence: number }[] {
  const name = nameKey(seat.player);
  const scout = roster.find((player) => Boolean(name) && nameKey(player.battletag) === name);
  const confidence = poolConfidence(scout ? playerPoolGames(scout) : 0);
  const played = scout ? optionsFor(scout, gone) : [];
  const own = played.slice(0, COMP_CANDIDATES);
  const chosen = new Set(own.map((option) => heroKey(option.hero)));
  const influence = (hero: string) => (table ? heroDraftMeta(table, hero).influence : 0);
  const add = (hero: string | undefined) => {
    if (!hero || own.length >= COMP_CANDIDATES) return;
    if (gone.has(heroKey(hero)) || chosen.has(heroKey(hero))) return;
    chosen.add(heroKey(hero));
    own.push({ hero, sl: 0, comfort: 0, games: 0 });
  };
  const pickMeta = (match: (hero: string) => boolean) => {
    const pool = extras.filter((hero) => match(hero) && !gone.has(heroKey(hero)) && !chosen.has(heroKey(hero)));
    pool.sort((a, b) => influence(b) - influence(a) || a.localeCompare(b));
    add(pool[0]);
  };
  if (!own.some((option) => isMainTank(option.hero))) {
    const bestTank = played.find((option) => isMainTank(option.hero));
    if (bestTank && !chosen.has(heroKey(bestTank.hero))) {
      if (own.length >= COMP_CANDIDATES) {
        const dropped = own.pop();
        if (dropped) chosen.delete(heroKey(dropped.hero));
      }
      chosen.add(heroKey(bestTank.hero));
      own.push(bestTank);
    }
  }
  for (const role of ["healer", "offlane", "tank", "ranged damage"] as const) {
    const covered =
      role === "tank"
        ? own.some((option) => isMainTank(option.hero))
        : own.some((option) => heroFillsRole(option.hero, role));
    if (covered) continue;
    pickMeta((hero) => (role === "tank" ? isMainTank(hero) : heroFillsRole(hero, role)));
  }
  if (!own.some((option) => isMainTank(option.hero))) {
    const metaTank = extras
      .filter((hero) => isMainTank(hero) && !gone.has(heroKey(hero)) && !chosen.has(heroKey(hero)))
      .sort((a, b) => influence(b) - influence(a) || a.localeCompare(b))[0];
    if (metaTank) {
      if (own.length >= COMP_CANDIDATES) {
        const dropped = own.pop();
        if (dropped) chosen.delete(heroKey(dropped.hero));
      }
      add(metaTank);
    }
  }
  if (!own.some((option) => isBruiser(option.hero))) pickMeta((hero) => isBruiser(hero));
  if (!own.length) pickMeta(() => true);
  return own.map((option) => ({ option, confidence }));
}

/**
 * Our open seats, as rows. Row 0 is the lineup with the highest combined
 * score. The same player can tank in one row and offlane in the next.
 * Returns one column per pick slot, and column[row] is that player's hero
 * in that lineup.
 */
export function ourCompStacksUnderOpenSlots(
  picks: readonly ({ hero: string } | null)[],
  seats: readonly TheirRemainingSeat[],
  roster: readonly PlayerScout[],
  gone: ReadonlySet<string>,
  limit = 3,
  extras: readonly string[] = [],
  table?: DraftMetaTable | null,
): (TheirRemainingSeat[] | null)[] {
  const locked = picks.flatMap((pick) => (pick?.hero ? [pick.hero] : []));
  const unavailable = new Set([...gone, ...locked].map((hero) => heroKey(hero)));
  const projected = likelyPicksUnderOpenSlots(picks, seats);
  const open = projected.filter((seat): seat is TheirRemainingSeat => Boolean(seat));
  if (!open.length) return projected.map(() => null);

  const lists = open.map((seat) => compCandidatesFor(seat, roster, unavailable, extras, table));
  const used = new Set<string>();
  const choice: number[] = [];
  const lineupScores: { picks: number[]; score: number }[] = [];
  const walkScore = (seatIndex: number) => {
    if (seatIndex === lists.length) {
      const heroes = choice.map((pick, index) => (pick < 0 ? null : lists[index][pick]?.option.hero ?? null));
      let score = 0;
      heroes.forEach((hero, index) => {
        if (!hero || choice[index] < 0) return;
        const allies = [
          ...locked,
          ...heroes.filter((other, otherIndex): other is string => Boolean(other) && otherIndex !== index),
        ];
        const cand = lists[index][choice[index]];
        score += ourSeatScore(hero, allies, cand.option.sl, cand.option.games, cand.confidence, table).points;
      });
      lineupScores.push({ picks: choice.slice(), score });
      return;
    }
    const list = lists[seatIndex];
    let placed = false;
    for (let index = 0; index < list.length; index++) {
      const key = heroKey(list[index].option.hero);
      if (used.has(key)) continue;
      used.add(key);
      choice.push(index);
      placed = true;
      walkScore(seatIndex + 1);
      choice.pop();
      used.delete(key);
    }
    if (!placed) {
      choice.push(-1);
      walkScore(seatIndex + 1);
      choice.pop();
    }
  };
  walkScore(0);
  lineupScores.sort((a, b) => b.score - a.score || a.picks.join(",").localeCompare(b.picks.join(",")));
  const best = lineupScores.slice(0, limit);
  if (limit >= 2 && !compHasMainTank(locked)) {
    const heroesOf = (lineup: { picks: number[] }) =>
      lineup.picks.flatMap((choice, index) => {
        if (choice < 0) return [];
        const hero = lists[index][choice]?.option.hero;
        return hero ? [hero] : [];
      });
    const hasTank = (lineup: { picks: number[] }) => heroesOf(lineup).some((hero) => isMainTank(hero));
    if (!best.some(hasTank)) {
      const tankLine = lineupScores.find(hasTank);
      if (tankLine) best.splice(Math.max(0, limit - 1), 1, tankLine);
    }
  }

  const columns = projected.map((seat) => {
    if (!seat) return null;
    const seatIndex = open.indexOf(seat);
    return best.map((lineup, row) => {
      const pick = lineup.picks[seatIndex];
      const cand = pick < 0 ? null : lists[seatIndex][pick];
      const heroes = lineup.picks.map((choiceIndex, index) =>
        choiceIndex < 0 ? null : lists[index][choiceIndex]?.option.hero ?? null,
      );
      const hero = cand?.option.hero ?? seat.hero;
      const allies = [
        ...locked,
        ...heroes.filter((other, index): other is string => Boolean(other) && index !== seatIndex),
      ];
      const scored = ourSeatScore(
        hero,
        allies,
        cand?.option.sl ?? seat.sl,
        cand?.option.games ?? seat.games,
        cand?.confidence ?? 0,
        table,
      );
      return {
        player: seat.player,
        hero,
        role: roleInComp(hero, allies),
        locked: false,
        sl: cand?.option.sl ?? 0,
        comfort: cand?.option.comfort ?? 0,
        games: cand?.option.games ?? 0,
        points: scored.points,
        why: `Lineup ${row + 1} · combined ${lineup.score}\n${scored.why}`,
      };
    });
  });
  return columns;
}

/** Three suggestions under each empty pick, left to right. */
export function likelyPickStacksUnderOpenSlots(
  picks: readonly ({ hero: string } | null)[],
  seats: readonly TheirRemainingSeat[],
  roster: readonly PlayerScout[],
  gone: ReadonlySet<string>,
  limit = 3,
  extras: readonly string[] = [],
  options?: {
    bias?: SuggestionBias;
    table?: DraftMetaTable | null;
  },
): (TheirRemainingSeat[] | null)[] {
  const locked = picks.flatMap((pick) => (pick?.hero ? [pick.hero] : []));
  const projected = likelyPicksUnderOpenSlots(picks, seats);
  return projected.map((seat, index) => {
    if (!seat) return null;
    const others = projected.flatMap((other, otherIndex) =>
      other && otherIndex !== index && other.hero ? [other.hero] : [],
    );
    return seatSuggestionStack(seat, roster, gone, limit, extras, [...locked, ...others], options);
  });
}

/** Map open pick slots (left to right) to projected seats. */
export function likelyPicksUnderOpenSlots(
  picks: readonly ({ hero: string; player?: string | null } | null)[],
  seats: readonly TheirRemainingSeat[],
): (TheirRemainingSeat | null)[] {
  const taken = new Set(
    picks.flatMap((pick) => {
      const key = nameKey(pick?.player);
      return key ? [key] : [];
    }),
  );
  const open = seats.filter(
    (seat) => !seat.locked && !taken.has(nameKey(seat.player)),
  );
  const emptyIndices: number[] = [];
  picks.forEach((pick, index) => {
    if (!pick) emptyIndices.push(index);
  });
  return picks.map((pick, index) => {
    if (pick) return null;
    const order = emptyIndices.indexOf(index);
    if (order < 0) return null;
    return open[order] ?? null;
  });
}

export function metaHeroForOpenRole(
  role: TheirSeatRole,
  gone: ReadonlySet<string>,
  table: DraftMetaTable | null | undefined,
  heroes: readonly string[],
): string {
  const required = seatRoleToRequired(role);
  const candidates = heroes
    .filter((hero) => !gone.has(heroKey(hero)))
    .filter((hero) =>
      required ? heroFillsRole(hero, required) : true,
    )
    .map((hero) => ({
      hero,
      influence: heroDraftMeta(table, hero)?.influence ?? 0,
    }))
    .sort(
      (a, b) =>
        b.influence - a.influence || a.hero.localeCompare(b.hero),
    );
  if (candidates.length) return candidates[0].hero;
  const any = heroes
    .filter((hero) => !gone.has(heroKey(hero)))
    .map((hero) => ({
      hero,
      influence: heroDraftMeta(table, hero)?.influence ?? 0,
    }))
    .sort((a, b) => b.influence - a.influence);
  return any[0]?.hero ?? "Raynor";
}

/** True when every required role this hero can fill is already covered. */
function fillsCoveredRoleOnly(hero: string, covered: ReadonlySet<RequiredRole>): boolean {
  const fills = REQUIRED_ROLES.filter((role) => heroFillsRole(hero, role));
  return fills.length > 0 && fills.every((role) => covered.has(role));
}

/**
 * Their five as of this lock. Locked heroes stay. Banned and picked heroes
 * leave the projection. Each open player gets a hero from their own pool that
 * fills a required role the five still lacks; leftover seats take a flex hero.
 */
export function rebuildTheirRemainingFive(args: {
  locked: readonly { hero: string; player: string | null }[];
  openPlayers: readonly string[];
  roster: readonly PlayerScout[];
  /** Hero keys or display names already banned or picked. */
  gone: ReadonlySet<string>;
  metaTable?: DraftMetaTable | null;
  heroPool?: readonly string[];
}): TheirRemainingSeat[] {
  const goneKeys = new Set([...args.gone].map((hero) => heroKey(hero)));
  for (const lock of args.locked) {
    if (lock.hero) goneKeys.add(heroKey(lock.hero));
  }

  const lockedNames = new Set(
    args.locked.map((lock) => nameKey(lock.player)).filter(Boolean),
  );
  const rosterByName = new Map<string, PlayerScout>();
  for (const player of args.roster) {
    const key = nameKey(player.battletag);
    if (key && !rosterByName.has(key)) rosterByName.set(key, player);
  }

  const open = collectTheirUnpickedPlayers({
    openPlayers: args.openPlayers,
    roster: args.roster,
    locked: args.locked,
  });
  const heroPool = args.heroPool ?? [];

  const rows = open.map((name) => {
    const scout = rosterByName.get(nameKey(name));
    const options = scout ? optionsFor(scout, goneKeys) : [];
    return { player: name, options };
  });

  const taken = new Set<string>();
  const chosen = new Map<string, { option: HeroOption; role: TheirSeatRole }>();
  const lockedHeroes = args.locked.map((lock) => lock.hero).filter(Boolean);
  const covered = compRolesCovered(lockedHeroes);
  const bruiserPlayers = rows.filter((row) =>
    row.options.some((option) => isBruiser(option.hero)),
  ).length;
  const frontlineReady = bruiserCount(lockedHeroes) + bruiserPlayers >= 2;
  const keepsPlayedBruiser = (row: (typeof rows)[number], candidate: HeroOption, role: RequiredRole) => {
    if (!frontlineReady || (role !== "tank" && role !== "ranged damage")) return true;
    if (role === "tank" && !isMainTank(candidate.hero)) return true;
    const bruiser = row.options.find(
      (option) => !taken.has(heroKey(option.hero)) && isBruiser(option.hero),
    );
    if (!bruiser) return true;
    return candidate.sl + 0.08 >= bruiser.sl;
  };

  for (const specialistsOnly of [true, false]) {
    for (const role of REQUIRED_ROLES) {
      if (covered.has(role)) continue;
      let best: { player: string; option: HeroOption } | null = null;
      for (const row of rows) {
        if (chosen.has(nameKey(row.player))) continue;
        const option = row.options.find(
          (candidate) =>
            !taken.has(heroKey(candidate.hero)) &&
            fillsCompRole(candidate.hero, role, specialistsOnly) &&
            keepsPlayedBruiser(row, candidate, role),
        );
        if (!option) continue;
        if (
          !best ||
          option.sl > best.option.sl ||
          (option.sl === best.option.sl && row.player.localeCompare(best.player) < 0)
        ) {
          best = { player: row.player, option };
        }
      }
      if (!best) continue;
      chosen.set(nameKey(best.player), { option: best.option, role: roleWord(role) });
      taken.add(heroKey(best.option.hero));
      covered.add(role);
    }
  }

  for (const row of rows) {
    const key = nameKey(row.player);
    if (chosen.has(key)) continue;
    const scout = rosterByName.get(key);
    const thin = poolConfidence(scout ? playerPoolGames(scout) : 0) < 0.45;
    const openHero = (option: HeroOption) => !taken.has(heroKey(option.hero));
    const flex = row.options.find(
      (option) => openHero(option) && !fillsCoveredRoleOnly(option.hero, covered),
    );
    const fallback = row.options.find(openHero);
    const secondTank =
      thin &&
      fallback &&
      isMainTank(fallback.hero) &&
      compHasMainTank([
        ...lockedHeroes,
        ...[...chosen.values()].map((pick) => pick.option.hero),
      ]);
    const option = flex ?? (secondTank ? undefined : fallback);
    if (!option) continue;
    const filled = REQUIRED_ROLES.find(
      (role) => !covered.has(role) && heroFillsRole(option.hero, role),
    );
    chosen.set(key, { option, role: roleWord(filled) });
    taken.add(heroKey(option.hero));
    if (filled) covered.add(filled);
  }

  const roleOrder: Record<TheirSeatRole, number> = {
    Tank: 0,
    Healer: 1,
    Offlane: 2,
    Ranged: 3,
    Flex: 4,
  };
  for (const name of open) {
    const key = nameKey(name);
    if (chosen.has(key)) continue;
    const committed = [
      ...lockedHeroes,
      ...[...chosen.values()].map((pick) => pick.option.hero),
    ];
    const bruisers = bruiserCount(committed);
    const frontlineThin = !compHasMainTank(committed) && bruisers < 2;
    const missingRole = REQUIRED_ROLES.find((role) => {
      if (covered.has(role)) return false;
      if (role === "tank" && !frontlineThin) return false;
      if (role === "ranged damage" && bruisers >= 2) return false;
      return true;
    });
    const role = missingRole ? roleWord(missingRole) : "Flex";
    const unavailable = new Set([...goneKeys, ...taken]);
    const hero = metaHeroForOpenRole(
      role,
      unavailable,
      args.metaTable,
      heroPool,
    );
    chosen.set(key, {
      option: { hero, sl: 0, comfort: 0, games: 0 },
      role,
    });
    taken.add(heroKey(hero));
    if (missingRole) covered.add(missingRole);
  }

  return open
    .map((name) => {
      const pick = chosen.get(nameKey(name))!;
      return {
        player: name,
        hero: pick.option.hero,
        role: pick.role,
        locked: false,
        sl: pick.option.sl,
        comfort: pick.option.comfort,
        games: pick.option.games,
      };
    })
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
}
