import { timingSafeEqual } from "crypto";

/** Constant-time compare. Different lengths fail closed. */
export function secretMatches(provided: string, secret: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const hits = new Map<string, number[]>();

/** Sliding window per IP. Scout pages stay well under this; tight loops do not. */
export function allowApiRequest(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 1000) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  return true;
}

export function resetApiRateLimitForTests(): void {
  hits.clear();
}
