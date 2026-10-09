import { stormLeagueScore } from "@/lib/scoring/comfort";
import { heroKey } from "@/lib/scoring/heroMeta";
import {
  assignRequiredRoles,
  heroFillsRole,
  REQUIRED_ROLES,
  type RequiredRole,
} from "@/lib/scoring/roles";
import type { PlayerScout } from "@/lib/scoring/types";

export type TheirSeatRole = "Tank" | "Healer" | "Offlane" | "Ranged" | "Flex";

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
};

type HeroOption = {
  hero: string;
  sl: number;
  comfort: number;
  games: number;
};

function nameKey(name: string | null | undefined): string {
  return (name?.split("#")[0]?.trim() ?? "").toLowerCase();
}

function shownName(name: string | null | undefined): string | null {
  const shown = name?.split("#")[0]?.trim();
  return shown || null;
}

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

  const open = args.openPlayers
    .map((name) => shownName(name))
    .filter((name): name is string => {
      if (!name) return false;
      return !lockedNames.has(name.toLowerCase());
    });

  const rows = open.flatMap((name) => {
    const scout = rosterByName.get(name.toLowerCase());
    if (!scout) return [];
    const options = optionsFor(scout, goneKeys);
    if (!options.length) return [];
    return [{ player: name, options }];
  });

  const taken = new Set<string>();
  const chosen = new Map<string, { option: HeroOption; role: TheirSeatRole }>();
  const lockedHeroes = args.locked.map((lock) => lock.hero).filter(Boolean);
  const lockedRoles = assignRequiredRoles(lockedHeroes);
  const covered = new Set(lockedRoles.values());

  for (const role of REQUIRED_ROLES) {
    if (covered.has(role)) continue;
    let best: { player: string; option: HeroOption } | null = null;
    for (const row of rows) {
      if (chosen.has(row.player.toLowerCase())) continue;
      const option = row.options.find(
        (candidate) =>
          !taken.has(heroKey(candidate.hero)) && heroFillsRole(candidate.hero, role),
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
    chosen.set(best.player.toLowerCase(), { option: best.option, role: roleWord(role) });
    taken.add(heroKey(best.option.hero));
    covered.add(role);
  }

  for (const row of rows) {
    const key = row.player.toLowerCase();
    if (chosen.has(key)) continue;
    const openHero = (option: HeroOption) => !taken.has(heroKey(option.hero));
    const flex = row.options.find(
      (option) => openHero(option) && !fillsCoveredRoleOnly(option.hero, covered),
    );
    const option = flex ?? row.options.find(openHero);
    if (!option) continue;
    const filled = REQUIRED_ROLES.find(
      (role) => !covered.has(role) && heroFillsRole(option.hero, role),
    );
    chosen.set(key, { option, role: roleWord(filled) });
    taken.add(heroKey(option.hero));
    if (filled) covered.add(filled);
  }

  const lockedSeats = args.locked
    .filter((lock) => lock.hero)
    .map((lock, index) => ({
      player: shownName(lock.player),
      hero: lock.hero,
      role: roleWord(lockedRoles.get(index)),
      locked: true,
      sl: 0,
      comfort: 0,
      games: 0,
    }));
  const openSeats = open
    .filter((name) => chosen.has(name.toLowerCase()))
    .map((name) => {
      const pick = chosen.get(name.toLowerCase())!;
      return {
        player: name,
        hero: pick.option.hero,
        role: pick.role,
        locked: false,
        sl: pick.option.sl,
        comfort: pick.option.comfort,
        games: pick.option.games,
      };
    });
  return [...lockedSeats, ...openSeats];
}
