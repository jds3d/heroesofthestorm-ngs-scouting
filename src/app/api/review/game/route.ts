import { NextResponse } from "next/server";
import { loadReviewGame } from "@/lib/review/replayLoader";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing ?id= replay file" }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadReviewGame(id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load that replay" },
      { status: 502 },
    );
  }
}
