import { NextResponse } from "next/server";
import { leagueConfig } from "@/config/league";
import {
  getGlobalHeroStats,
  getGlobalHeroStatsByMap,
  getHeroMatchupsMany,
  withProfileLinks,
} from "@/lib/heroesprofile/client";
import { mergeApiCounts, runWithApiUsage } from "@/lib/apiUsage";
import { getTeam } from "@/lib/ngs/client";
import { metaBanPriority } from "@/lib/scoring/adapt";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";
import { buildDraftPlan } from "@/lib/scoring/draftPlan";
import { buildMapPlan } from "@/lib/scoring/mapPlan";
import { heroKey } from "@/lib/scoring/heroMeta";
import { isScoutBudgetExceeded, runWithScoutBudget } from "@/lib/scout/budget";
import { draftHeroPool } from "@/lib/scout/draftHeroPool";
import {
  loadSavedHomeReport,
  loadSavedHomeRoster,
  loadScoutReport,
  reportKey,
} from "@/lib/scout/reportCache";
import { setCached } from "@/lib/cache";

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
  const refreshPlayerData = url.searchParams.get("fresh") === "1";
  const theirs = lineupParam(url, "theirs");
  const ours = lineupParam(url, "ours");

  try {
    return await runWithScoutBudget(async () => {
    const report = await loadScoutReport(teamName, {
      refreshPlayerData,
      starters: theirs,
    });
    if (report.incomplete) return NextResponse.json(report);
    // Our comfort comes from our own scout; build it if it was never saved,
    // or every one of our picks scores zero comfort.
    let homeReport =
      teamName === leagueConfig.homeTeam
        ? report
        : await loadSavedHomeReport(leagueConfig.homeTeam);
    // A paused home scout is not finished data. Rebuild it from the cache.
    if (
      teamName !== leagueConfig.homeTeam &&
      (!homeReport || homeReport.incomplete)
    ) {
      try {
        homeReport = await loadScoutReport(leagueConfig.homeTeam);
      } catch (err) {
        if (isScoutBudgetExceeded(err)) throw err;
        if (homeReport?.incomplete) homeReport = null;
      }
    }
    if (homeReport?.incomplete) {
      report.incomplete = true;
      return NextResponse.json(report);
    }
    let homePool =
      teamName === leagueConfig.homeTeam
        ? report.roster
        : (homeReport?.roster ?? (await loadSavedHomeRoster(leagueConfig.homeTeam)));
    const missingOurs = ours.filter(
      (tag) => !homePool?.some((player) => player.battletag.toLowerCase() === tag.toLowerCase()),
    );
    if (missingOurs.length > 0 && teamName !== leagueConfig.homeTeam) {
      let lined: Awaited<ReturnType<typeof loadScoutReport>> | null = null;
      try {
        lined = await loadScoutReport(leagueConfig.homeTeam, { starters: ours });
      } catch (err) {
        if (isScoutBudgetExceeded(err)) throw err;
      }
      if (lined?.incomplete) {
        report.incomplete = true;
        report.homeRoster = lined.roster;
        return NextResponse.json(report);
      }
      if (lined?.roster?.length) homePool = lined.roster;
    }
    const want = new Set(ours.map((s) => s.toLowerCase()));
    const homeRoster =
      want.size === 0 || !homePool
        ? homePool
        : homePool.filter((p) => want.has(p.battletag.toLowerCase()));
    report.homeRoster = homeRoster;
    report.homeHpMmrAvg =
      homeReport?.hpMmrAvg ??
      (await getTeam(leagueConfig.homeTeam).catch((err) => {
        if (isScoutBudgetExceeded(err)) throw err;
        return null;
      }))?.hpMmrAvg ??
      null;
    report.roster = await withProfileLinks(report.roster);
    if (report.homeRoster?.length) {
      report.homeRoster = await withProfileLinks(report.homeRoster);
    }

    // Matchups + globals for draft meta — count real HP calls in "used".
    const { actual: metaActual } = await runWithApiUsage(async () => {
      const meta = await getGlobalHeroStats().catch((err) => {
        if (isScoutBudgetExceeded(err)) throw err;
        return [];
      });
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
                      ? `Ban ${report.adapt.mapPlan.ban
                          .slice(0, 2)
                          .map((m) => m.map)
                          .join(" and ")}${report.adapt.mapPlan.ban.length > 2 ? " (+ ranked backups in map plan)" : ""}`
                      : null,
                    report.adapt.mapPlan.play.length
                      ? `leave up ${report.adapt.mapPlan.play
                          .slice(0, 3)
                          .map((m) => m.map)
                          .join(", ")}${report.adapt.mapPlan.play.length > 3 ? " (+ ranked backups in map plan)" : ""}`
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
      const {
        patch,
        byHero: matchupBundles,
        incomplete: matchupsIncomplete,
      } = await getHeroMatchupsMany(pool).catch((err) => {
        if (isScoutBudgetExceeded(err)) throw err;
        return {
          patch: "",
          byHero: {} as Record<
            string,
            import("@/lib/heroesprofile/client").HeroMatchupBundle
          >,
          incomplete: false,
        };
      });
      if (matchupsIncomplete) report.incomplete = true;
      let mapStats: Awaited<ReturnType<typeof getGlobalHeroStatsByMap>> = [];
      try {
        mapStats = await getGlobalHeroStatsByMap();
      } catch (err) {
        if (isScoutBudgetExceeded(err)) {
          report.incomplete = true;
        } else {
          const message =
            err instanceof Error ? err.message : "HeroesProfile map stats failed";
          report.warnings = [
            ...(report.warnings ?? []),
            `Map fit data unavailable (${message}). Scores for map specialists are disabled.`,
          ];
        }
      }
      const matchupsByKey: Record<
        string,
        import("@/lib/scoring/draftMeta").MatchupEnemyRow[]
      > = {};
      const alliesByKey: Record<
        string,
        import("@/lib/scoring/draftMeta").MatchupAllyRow[]
      > = {};
      for (const [name, bundle] of Object.entries(matchupBundles)) {
        matchupsByKey[heroKey(name)] = bundle.enemies;
        alliesByKey[heroKey(name)] = bundle.allies;
      }
      report.adapt.draftMeta = buildDraftMetaTable({
        patch: patch || "unknown",
        global: meta,
        matchups: matchupsByKey,
        allies: alliesByKey,
        mapStats,
      });
    });

    // Persist enrichments so fallback / estimate see draftMeta + final plan.
    await setCached(
      reportKey(teamName, theirs.length ? theirs : undefined),
      report,
      leagueConfig.reportTtlMs,
    );

    if (report.apiUsage) {
      report.apiUsage = {
        predicted: report.apiUsage.predicted,
        actual: mergeApiCounts(report.apiUsage.actual, metaActual),
      };
    }

    return NextResponse.json(report);
    });
  } catch (err) {
    if (isScoutBudgetExceeded(err)) {
      return NextResponse.json({
        incomplete: true,
        warnings: [],
        error: "Scout paused before the proxy timeout.",
      });
    }
    const message = err instanceof Error ? err.message : "Scout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
