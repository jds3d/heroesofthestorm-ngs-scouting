import { NextResponse } from "next/server";
import { getGlobalHeroStats } from "@/lib/heroesprofile/client";
import { buildDraftMetaTable } from "@/lib/scoring/draftMeta";

export const dynamic = "force-dynamic";

/** Storm League influence for every hero. Comfort stays a separate, personal score. */
export async function GET() {
  try {
    const global = await getGlobalHeroStats();
    const table = buildDraftMetaTable({
      patch: "live",
      global,
      matchups: {},
    });
    return NextResponse.json(table);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hero influence lookup failed";
    return NextResponse.json({ error: message, byHero: {} }, { status: 502 });
  }
}
