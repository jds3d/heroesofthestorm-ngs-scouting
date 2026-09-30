import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import { getCached } from "@/lib/cache";
import { getNgsPlayerProfile } from "@/lib/heroesprofile/client";
import type { NgsPlayerProfile } from "@/lib/heroesprofile/types";
import { getTeam } from "@/lib/ngs/client";

export const dynamic = "force-dynamic";

/**
 * Roster for lineup pickers — NGS members only.
 * Games come from HP NGS profiles. Uncached members are fetched (one call each)
 * — otherwise a never-scouted player reads 0 games, is left out of the default
 * five, and so is never fetched by a scout either.
 */
export async function GET(request: Request) {
  const teamName = new URL(request.url).searchParams.get("team")?.trim();
  if (!teamName) {
    return NextResponse.json({ error: "team is required" }, { status: 400 });
  }

  try {
    const team = await getTeam(teamName);
    const names = (team.teamMembers ?? []).map((m) => m.displayName);
    const players = await Promise.all(
      names.map(async (battletag) => {
        const key = `hp-v1-ngs-profile-${battletag}-s${leagueConfig.season}-${leagueConfig.division}`;
        const profile =
          (await getCached<NgsPlayerProfile>(key)) ??
          (await getNgsPlayerProfile(
            battletag,
            leagueConfig.season,
            leagueConfig.division,
          ).catch(() => null));
        const games = profile
          ? (Number(profile.wins) || 0) + (Number(profile.losses) || 0)
          : 0;
        return { battletag, games };
      }),
    );
    players.sort(
      (a, b) => b.games - a.games || a.battletag.localeCompare(b.battletag),
    );
    return NextResponse.json({ team: team.teamName, players });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Roster failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
