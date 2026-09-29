import { NextResponse } from "next/server";
import { listReviewGames } from "@/lib/review/replayLoader";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ games: await listReviewGames() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't list played games" },
      { status: 502 },
    );
  }
}
