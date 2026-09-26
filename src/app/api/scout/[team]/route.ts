import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import { getGlobalHeroStats } from "@/lib/heroesprofile/client";
import { metaBanPriority } from "@/lib/scoring/adapt";
import { buildDraftPlan } from "@/lib/scoring/draftPlan";
import type { ScoutReport } from "@/lib/scoring/types";
import { loadSavedHomeRoster, loadScoutReport } from "@/lib/scout/reportCache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ team: string }>;
};

function lineupParam(url: URL, name: string): string[] {
  return (url.searchParams.get(name) ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: Request, context: RouteContext) {
  const { team: raw } = await context.params;
  const teamName = decodeURIComponent(raw).replace(/_/g, " ");
  const url = new URL(request.url);
  const ignoreCache = url.searchParams.get("fresh") === "1";
  const theirs = lineupParam(url, "theirs");
  const ours = lineupParam(url, "ours");

  try {
    const report = await loadScoutReport(teamName, {
      ignoreCache,
      starters: theirs,
    });
    const homePool =
      teamName === leagueConfig.homeTeam
        ? report.roster
        : await loadSavedHomeRoster(leagueConfig.homeTeam);
    const want = new Set(ours.map((s) => s.toLowerCase()));
    const homeRoster =
      want.size === 0 || !homePool
        ? homePool
        : homePool.filter((p) => want.has(p.battletag.toLowerCase()));
    report.homeRoster = homeRoster;
    const meta = await getGlobalHeroStats().catch(() => []);
    const metaBans = metaBanPriority(report.roster, meta);
    const seen = new Set<string>();
    report.adapt.banPriority = [...metaBans, ...report.adapt.banPriority]
      .filter((b) => {
        if (seen.has(b.hero)) return false;
        seen.add(b.hero);
        return true;
      })
      .slice(0, 6)
      .map(({ hero, reason }) => ({ hero, reason }));
    report.adapt.draftPlan = buildDraftPlan(
      report.roster,
      report.draft,
      homeRoster,
      meta,
    );
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
