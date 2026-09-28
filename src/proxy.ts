import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate public API routes when SCOUT_API_SECRET is set.
 * Browser UI sends the same secret via `x-scout-secret` (see ScoutApp).
 * Health/league/scout all burn HP quota — leave unset only for local-only use.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.SCOUT_API_SECRET?.trim();
  if (!secret) return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (!path.startsWith("/api/")) return NextResponse.next();

  const header =
    request.headers.get("x-scout-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const query = request.nextUrl.searchParams.get("secret") ?? "";
  if (header === secret || query === secret) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Unauthorized — set x-scout-secret or SCOUT_API_SECRET" },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/api/:path*"],
};