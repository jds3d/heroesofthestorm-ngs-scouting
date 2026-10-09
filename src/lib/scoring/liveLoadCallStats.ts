export type LiveLoadCallStats = {
  apiCalls: number;
  cacheCalls: number;
};

let stats: LiveLoadCallStats = { apiCalls: 0, cacheCalls: 0 };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function getLiveLoadCallStats(): LiveLoadCallStats {
  return { ...stats };
}

export function resetLiveLoadCallStats(): void {
  stats = { apiCalls: 0, cacheCalls: 0 };
  notify();
}

export function addLiveLoadCallStats(delta: {
  apiCalls?: number;
  cacheCalls?: number;
}): void {
  const api = delta.apiCalls ?? 0;
  const cache = delta.cacheCalls ?? 0;
  if (!api && !cache) return;
  stats = {
    apiCalls: stats.apiCalls + api,
    cacheCalls: stats.cacheCalls + cache,
  };
  notify();
}

/** One matchup batch: session tab, server disk, or Heroes Profile HTTP. */
export function recordMatchupLoadBatch(
  mode: "session" | "cache" | "api",
  pendingCalls?: number,
): void {
  if (mode === "api") {
    addLiveLoadCallStats({ apiCalls: Math.max(1, pendingCalls ?? 1) });
    return;
  }
  addLiveLoadCallStats({ cacheCalls: 1 });
}

export function subscribeLiveLoadCallStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function liveLoadTallyLine(tally: LiveLoadCallStats): string {
  const api = tally.apiCalls;
  const cache = tally.cacheCalls;
  if (!api && !cache) {
    return "No Heroes Profile API or cache loads recorded yet.";
  }
  const apiPart =
    api === 1 ? "1 API call" : `${api} API calls`;
  const cachePart =
    cache === 1 ? "1 cache call" : `${cache} cache calls`;
  return `${apiPart} · ${cachePart} before suggestions were ready`;
}
