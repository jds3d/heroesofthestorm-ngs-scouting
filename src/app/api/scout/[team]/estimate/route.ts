import { NextResponse } from "next/server";
import { predictScoutCalls } from "@/lib/scout/estimateCalls";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ team: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { team: raw } = await context.params;
  const teamName = decodeURIComponent(raw).replace(/_/g, " ");
  const url = new URL(request.url);
  const ignoreCache = url.searchParams.get("fresh") === "1";
  const starters = (url.searchParams.get("theirs") ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const predicted = await predictScoutCalls(teamName, { ignoreCache, starters });
    return NextResponse.json({ predicted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Estimate failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
