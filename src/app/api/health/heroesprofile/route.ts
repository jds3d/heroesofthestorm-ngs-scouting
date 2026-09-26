import { NextResponse } from "next/server";
import { checkHeroesProfileAuth } from "@/lib/heroesprofile/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkHeroesProfileAuth();
  return NextResponse.json(result, { status: result.ok ? 200 : 401 });
}
