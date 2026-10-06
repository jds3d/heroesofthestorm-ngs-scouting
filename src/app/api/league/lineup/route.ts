import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import { matchLobbyToRosters } from "@/lib/lobby/screenLobby";
import { getDivision, getTeam } from "@/lib/ngs/client";

export const dynamic = "force-dynamic";

/** Match five lobby names to an NGS roster so a live draft can load their hero pools. */
export async function GET(request: Request) {
  const names = (new URL(request.url).searchParams.get("names") ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length < 4) {
    return NextResponse.json({ team: null, battletags: [] });
  }

  try {
    const division = await getDivision();
    const teamNames = (division.teams ?? []).filter(
      (name) => name && !name.toLowerCase().includes("withdrawn"),
    );
    const teams = await Promise.all(
      teamNames.map(async (teamName) => {
        const team = await getTeam(teamName).catch(() => null);
        return {
          teamName,
          battletags: (team?.teamMembers ?? []).map((member) => member.displayName),
        };
      }),
    );
    const match = matchLobbyToRosters(names, teams, leagueConfig.homeTeam);
    return NextResponse.json({
      team: match?.team ?? null,
      battletags: match?.battletags ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lineup lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
