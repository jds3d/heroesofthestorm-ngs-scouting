import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { allowApiRequest, secretMatches } from "@/lib/apiGate";

/**
 * Gate public API routes when SCOUT_API_SECRET is set.
 * The browser sends the same value in `x-scout-secret`. That value is visible
 * to anyone who can load the page; Cloudflare Access is the real gate.
 * The secret is not accepted in the query string.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!path.startsWith("/api/")) return NextResponse.next();

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  if (!allowApiRequest(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const secret = process.env.SCOUT_API_SECRET?.trim();
  if (!secret) return NextResponse.next();

  const header =
    request.headers.get("x-scout-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (secretMatches(header, secret)) return NextResponse.next();

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};
