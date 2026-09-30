import { NextResponse } from "next/server";
import {
  getGlobalHeroStats,
  getHeroMatchupsMany,
} from "@/lib/heroesprofile/client";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Storm League matchup rows for heroes the live draft locked or is scoring,
 * when the scout pool never pulled them. Cached heroes do not hit the network.
 */
export async function GET(request: Request) {
  const heroes = [
    ...new Set(
      (new URL(request.url).searchParams.get("heroes") ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter((name) => name && heroRole(name) !== "Unknown"),
    ),
  ].slice(0, 4);

  if (!heroes.length) {
    return NextResponse.json({ patch: "", byHero: {} });
  }

  try {
    const [{ patch, byHero: bundles }, global] = await Promise.all([
      getHeroMatchupsMany(heroes),
      getGlobalHeroStats().catch(() => []),
    ]);
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
    return NextResponse.json({ patch: built.patch, byHero: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Matchup fetch failed";
    return NextResponse.json({ error: message, byHero: {} }, { status: 502 });
  }
}
