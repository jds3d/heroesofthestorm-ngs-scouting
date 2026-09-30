import { leagueConfig } from "@/config/league";

function playerPath(battletag: string, blizzId?: number | null): string {
  const name = encodeURIComponent(battletag.split("#")[0] ?? battletag);
  const id = blizzId ? String(blizzId) : "";
  return `${name}/${id}/${leagueConfig.region}`;
}

/** Storm League profile: /Player/{name}/{blizzId}/{region}. */
export function heroesProfilePlayerUrl(
  battletag: string,
  blizzId?: number | null,
): string {
  return `https://www.heroesprofile.com/Player/${playerPath(battletag, blizzId)}`;
}

/** NGS profile, same path under /NGS. */
export function ngsHeroesProfileUrl(
  battletag: string,
  blizzId?: number | null,
): string {
  return `https://www.heroesprofile.com/NGS/Player/${playerPath(battletag, blizzId)}`;
}
