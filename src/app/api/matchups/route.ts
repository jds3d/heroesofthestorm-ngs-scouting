import { NextResponse } from "next/server";
import {
  getGlobalHeroStats,
  getHeroMatchupsMany,
} from "@/lib/heroesprofile/client";
import { buildDraftMetaTable, MATCHUP_FETCH_BATCH } from "@/lib/scoring/draftMeta";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import { isScoutBudgetExceeded, runWithScoutBudget } from "@/lib/scout/budget";

/** Stay under Cloudflare's ~125s proxy timeout so the browser gets JSON. */
const MATCHUP_REQUEST_BUDGET_MS = 70_000;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Storm League matchup rows for heroes the live draft locked or is scoring,
 * when the scout pool never pulled them. Cached heroes do not hit the network.
 */
export async function GET(request: Request) {
  try {
    return await runWithScoutBudget(
      () => matchupsResponse(request),
      MATCHUP_REQUEST_BUDGET_MS,
    );
  } catch (err) {
    if (isScoutBudgetExceeded(err)) {
      return NextResponse.json({ patch: "", byHero: {}, incomplete: true });
    }
    const message = err instanceof Error ? err.message : "Matchup fetch failed";
    return NextResponse.json({ error: message, byHero: {} }, { status: 502 });
  }
}

async function matchupsResponse(request: Request) {
  const heroes = [
    ...new Set(
      (new URL(request.url).searchParams.get("heroes") ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter((name) => name && heroRole(name) !== "Unknown"),
    ),
  ].slice(0, MATCHUP_FETCH_BATCH);

  if (!heroes.length) {
    return NextResponse.json({ patch: "", byHero: {} });
  }

  const { patch, byHero: bundles, incomplete } = await getHeroMatchupsMany(heroes);
  let global: Awaited<ReturnType<typeof getGlobalHeroStats>> = [];
  try {
    global = await getGlobalHeroStats();
  } catch (err) {
    if (!isScoutBudgetExceeded(err)) throw err;
  }
  const matchups: Record<string, (typeof bundles)[string]["enemies"]> = {};
  const allies: Record<string, (typeof bundles)[string]["allies"]> = {};
  for (const [name, bundle] of Object.entries(bundles)) {
    const key = heroKey(name);
    matchups[key] = bundle.enemies;
    allies[key] = bundle.allies;
  }
  const built = buildDraftMetaTable({
    patch: patch || "live",
    global,
    matchups,
    allies,
  });
  const rows: typeof built.byHero = {};
  for (const name of Object.keys(bundles)) {
    const key = heroKey(name);
    const row = built.byHero[key];
    if (row) rows[key] = row;
  }
  return NextResponse.json({
    patch: built.patch,
    byHero: rows,
    ...(incomplete ? { incomplete: true } : {}),
  });
}
