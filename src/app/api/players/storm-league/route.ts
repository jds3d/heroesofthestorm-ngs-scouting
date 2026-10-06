import { NextResponse } from "next/server";
import { HeroesProfileError } from "@/lib/heroesprofile/client";
import { loadStormLeaguePlayers } from "@/lib/scout/pipeline";

export const dynamic = "force-dynamic";

/** Storm League hero history for the players on the shared draft screen. */
export async function GET(request: Request) {
  const tags = (new URL(request.url).searchParams.get("tags") ?? "")
    .split("|")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!tags.length) return NextResponse.json({ players: [] });

  try {
    const players = await loadStormLeaguePlayers(tags);
    return NextResponse.json({ players });
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
