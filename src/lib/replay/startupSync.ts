import type { ReplaySyncResult } from "@/lib/replay/syncReplays";

const GLOBAL_KEY = "__ngsReplayStartupSync";

type GlobalWithSync = typeof globalThis & {
  [GLOBAL_KEY]?: Promise<ReplaySyncResult> | null;
};

function logResult(result: ReplaySyncResult): void {
  if (result.processed > 0) {
    console.info(
      `[replay-sync] Indexed ${result.processed} new replay file(s); ${result.newNames.length} new name(s).`,
    );
    return;
  }
  if (!result.ok && result.skipped) {
    console.info(`[replay-sync] ${result.skipped} (${result.replayDir})`);
  }
}

/**
 * Scan the HotS replay folder once per server process (new/changed `.StormReplay` only).
 * Safe to call from layout, instrumentation, or API routes.
 */
export function scheduleReplaySyncOnStartup(): Promise<ReplaySyncResult> | null {
  const g = globalThis as GlobalWithSync;
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];

  g[GLOBAL_KEY] = import("./syncReplays")
    .then(({ syncReplayBattletags }) => syncReplayBattletags())
    .then((result) => {
      logResult(result);
      return result;
    })
    .catch((err) => {
      console.warn("[replay-sync] Startup sync failed:", err);
      g[GLOBAL_KEY] = null;
      throw err;
    });

  return g[GLOBAL_KEY];
}
