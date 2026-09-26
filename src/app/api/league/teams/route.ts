import { NextResponse } from "next/server";
import { listOpponentTeams, teamProfileUrl, teamSlug } from "@/lib/ngs/client";
import seasonSeed from "@/config/season22-a.json";
import { leagueConfig } from "@/config/league";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const teams = await listOpponentTeams();
    return NextResponse.json({
      source: "live",
      season: leagueConfig.season,
      division: leagueConfig.division,
      homeTeam: leagueConfig.homeTeam,
      teams,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const teams = (seasonSeed.teams as string[])
      .filter((name) => name !== leagueConfig.homeTeam)
      .filter((name) => !name.toLowerCase().includes("withdrawn"))
      .map((name) => ({
        name,
        slug: teamSlug(name),
        profileUrl: teamProfileUrl(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      source: "seed",
      warning: `Live NGS fetch failed (${message}); using season seed.`,
      season: leagueConfig.season,
      division: leagueConfig.division,
      homeTeam: leagueConfig.homeTeam,
      teams,
    });
  }
}
