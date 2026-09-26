import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import { getNgsPlayerProfile } from "@/lib/heroesprofile/client";
import { getTeam } from "@/lib/ngs/client";

export const dynamic = "force-dynamic";

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
        try {
          const profile = await getNgsPlayerProfile(
            battletag,
            leagueConfig.season,
            leagueConfig.division,
          );
          const games =
            (Number(profile.wins) || 0) + (Number(profile.losses) || 0);
          return { battletag, games };
        } catch {
          return { battletag, games: 0 };
        }
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
