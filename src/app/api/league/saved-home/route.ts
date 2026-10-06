import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import { loadSavedHomeReport } from "@/lib/scout/reportCache";

export const dynamic = "force-dynamic";

/** Cached home-team pools for a live draft, without rebuilding a scout. */
export async function GET() {
  const report = await loadSavedHomeReport(leagueConfig.homeTeam);
  if (!report) {
    return NextResponse.json({ roster: [], ourLikely: [], draftMeta: null });
  }
  const plan = report.adapt.draftPlan;
  return NextResponse.json({
    roster: report.roster ?? [],
    ourLikely: plan?.ourLikely ?? [],
    draftMeta: report.adapt.draftMeta ?? null,
  });
}
