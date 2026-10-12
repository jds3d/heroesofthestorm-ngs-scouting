import { readFileSync } from "node:fs";
import path from "node:path";
import { ocrFold, snapToRoster } from "@/lib/lobby/screenLobby";
import { loadBattletagStore } from "@/lib/replay/store";
import { replayFolder } from "@/lib/replay/paths";
import type { ReplaySyncResult } from "@/lib/replay/syncReplays";

export type ReplayName = {
  display: string;
  /** Battletag from the most recent shared game. */
  tag: string;
};

export type ReplayBattletagMatch = "exact" | "snapped" | "folded";

/** The saved `tag` is already the most recent game together. */
export function battletagFromHistory(
  byName: ReadonlyMap<string, ReplayName>,
  name: string,
): { tag: string; match: ReplayBattletagMatch } | null {
  const shown = name.split("#")[0]?.trim() ?? "";
  if (!shown) return null;
  const exact = byName.get(shown.toLowerCase());
  if (exact) return { tag: exact.tag, match: "exact" };
  const displays = [...byName.values()].map((row) => row.display);
  const snapped = snapToRoster(shown, displays);
  const snappedRow = byName.get(snapped.toLowerCase());
  if (snappedRow && snapped.toLowerCase() !== shown.toLowerCase()) {
    return { tag: snappedRow.tag, match: "snapped" };
  }
  const folded = ocrFold(shown);
  if (folded) {
    for (const row of byName.values()) {
      if (ocrFold(row.display) === folded) {
        return { tag: row.tag, match: "folded" };
      }
    }
  }
  if (snappedRow) return { tag: snappedRow.tag, match: "exact" };
  return null;
}

let history: Map<string, ReplayName> | null = null;

/** Drop the in-memory map after `replay-battletags.json` is updated on disk. */
export function clearReplayBattletagCache(): void {
  history = null;
}

function loadHistory(): Map<string, ReplayName> {
  if (history) return history;
  history = new Map();
  try {
    const file = path.join(process.cwd(), ".cache", "replay-battletags.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      byName?: Record<string, { display?: string; tag?: string }>;
    };
    for (const [key, row] of Object.entries(parsed.byName ?? {})) {
      if (!row?.tag || !row.display) continue;
      history.set(key.toLowerCase(), { display: row.display, tag: row.tag });
    }
  } catch {
    history = new Map();
  }
  return history;
}

export function resolveReplayBattletag(name: string): {
  tag: string | null;
  match: ReplayBattletagMatch | null;
} {
  const hit = battletagFromHistory(loadHistory(), name);
  return hit ? hit : { tag: null, match: null };
}

/** Full battletag from local replays, or null when this name has never shared a game. */
export function replayBattletag(name: string): string | null {
  return resolveReplayBattletag(name).tag;
}

export function replayIndexHint(sync?: ReplaySyncResult | null): string {
  const store = loadBattletagStore();
  const indexed = store?.names ?? 0;
  const dir = sync?.replayDir ?? store?.replayRoot ?? replayFolder();
  if (sync?.skipped) {
    return `Replay folder not indexed (${sync.skipped}). Path: ${dir}`;
  }
  if (indexed === 0) {
    return `No replays indexed on this server (0 names). The dictionary is built from .StormReplay files on the machine running the app — set HOTS_REPLAY_DIR if needed. Path: ${dir}`;
  }
  if (sync && sync.processed > 0) {
    return `Indexed ${sync.processed} new replay file(s); ${indexed} names in the dictionary (${dir}).`;
  }
  return `${indexed} names in the replay dictionary (${dir}).`;
}

export function missDetailNoReplayTag(
  shown: string,
  sync?: ReplaySyncResult | null,
): string {
  return `No battletag for “${shown}” in the replay dictionary. ${replayIndexHint(sync)}`;
}
