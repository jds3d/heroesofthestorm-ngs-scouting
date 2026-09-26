import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import {
  getGlobalHeroStats,
  getGlobalHeroStatsByMap,
  getHeroMatchupsMany,
} from "@/lib/heroesprofile/client";
import { metaBanPriority } from "@/lib/scoring/adapt";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";
import { buildDraftPlan } from "@/lib/scoring/draftPlan";
import { buildMapPlan } from "@/lib/scoring/mapPlan";
import { heroKey } from "@/lib/scoring/heroMeta";
import type { ScoutReport } from "@/lib/scoring/types";
import {
  loadSavedHomeReport,
  loadSavedHomeRoster,
  loadScoutReport,
} from "@/lib/scout/reportCache";

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

function draftHeroPool(report: ScoutReport): string[] {
  const names = new Set<string>();
  const add = (h?: string | null) => {
    if (h) names.add(h);
  };
  for (const b of report.adapt.banPriority) add(b.hero);
  const plan = report.adapt.draftPlan;
  if (plan) {
    for (const p of plan.ourLikely) add(p.hero);
    for (const p of plan.theirLikely) add(p.hero);
    for (const side of [plan.sides.weFirst, plan.sides.theyFirst]) {
      for (const p of side.ourLikely) add(p.hero);
      for (const p of side.theirLikely) add(p.hero);
    }
    for (const b of plan.baitBans) add(b.hero);
  }
  // De-dupe by heroKey but keep a display spelling for the API.
  const byKey = new Map<string, string>();
  for (const h of names) {
    const k = heroKey(h);
    if (!byKey.has(k)) byKey.set(k, h);
  }
  return [...byKey.values()];
}

export async function GET(request: Request, context: RouteContext) {
  const { team: raw } = await context.params;
  const teamName = decodeURIComponent(raw).replace(/_/g, " ");
  const url = new URL(request.url);
  const refreshPlayerData = url.searchParams.get("fresh") === "1";
  const theirs = lineupParam(url, "theirs");
  const ours = lineupParam(url, "ours");

  try {
    const report = await loadScoutReport(teamName, {
      refreshPlayerData,
      starters: theirs,
    });
    const homeReport =
      teamName === leagueConfig.homeTeam
        ? report
        : await loadSavedHomeReport(leagueConfig.homeTeam);
    const homePool =
      teamName === leagueConfig.homeTeam
        ? report.roster
        : (homeReport?.roster ?? (await loadSavedHomeRoster(leagueConfig.homeTeam)));
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
    const ourMaps =
      teamName === leagueConfig.homeTeam
        ? report.draft.mapTendencies
        : (homeReport?.draft.mapTendencies ?? null);
    report.adapt.mapPlan = buildMapPlan(report.draft.mapTendencies, ourMaps);
    // Keep the short Map plan recommendation in sync with the full block.
    report.adapt.recommendations = report.adapt.recommendations
      .filter((r) => r.title !== "Map plan" && r.title !== "Map ban path")
      .concat(
        report.adapt.mapPlan.ban.length || report.adapt.mapPlan.play.length
          ? [
              {
                priority: 2,
                title: "Map plan",
                detail: [
                  report.adapt.mapPlan.ban.length
                    ? `Ban ${report.adapt.mapPlan.ban.map((m) => m.map).join(" and ")}`
                    : null,
                  report.adapt.mapPlan.play.length
                    ? `leave up ${report.adapt.mapPlan.play.map((m) => m.map).join(", ")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join("; ") + ".",
              },
            ]
          : [],
      )
      .sort((a, b) => a.priority - b.priority);

    const pool = draftHeroPool(report);
    const { patch, byHero: matchups } = await getHeroMatchupsMany(pool).catch(
      () => ({
        patch: "",
        byHero: {} as Record<string, never>,
      }),
    );
    // Separate from matchups so a map-stats 429 does not block counters.
    const mapStats = await getGlobalHeroStatsByMap().catch(() => []);
    const matchupsByKey: Record<
      string,
      import("@/lib/scoring/draftMeta").MatchupEnemyRow[]
    > = {};
    for (const [name, rows] of Object.entries(matchups)) {
      matchupsByKey[heroKey(name)] = rows;
    }
    report.adapt.draftMeta = buildDraftMetaTable({
      patch: patch || "unknown",
      global: meta,
      matchups: matchupsByKey,
      mapStats,
    });

    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
