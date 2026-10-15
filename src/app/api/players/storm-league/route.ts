import { NextResponse } from "next/server";
import { HeroesProfileError } from "@/lib/heroesprofile/client";
import { loadStormLeaguePlayers } from "@/lib/scout/pipeline";
import { syncReplayBattletags } from "@/lib/replay/syncReplays";

export const dynamic = "force-dynamic";

/** Storm League hero history for the players on the shared draft screen. */
export async function GET(request: Request) {
  const tags = (new URL(request.url).searchParams.get("tags") ?? "")
    .split("|")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!tags.length) return NextResponse.json({ players: [], lookups: [] });

  try {
    const skipSync = new URL(request.url).searchParams.get("sync") === "0";
    const replaySync = skipSync ? null : await syncReplayBattletags();
    const { players, lookups, apiCalls, cacheCalls } =
      await loadStormLeaguePlayers(tags, replaySync);
    return NextResponse.json({
      players,
      lookups,
      replaySync,
      apiCalls,
      cacheCalls,
    });
  } catch (err) {
    const message =
      err instanceof HeroesProfileError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Storm League lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
