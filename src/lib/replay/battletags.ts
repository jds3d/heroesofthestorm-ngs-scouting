import { readFileSync } from "node:fs";
import path from "node:path";
import { snapToRoster } from "@/lib/lobby/screenLobby";

export type ReplayName = {
  display: string;
  /** Battletag from the most recent shared game. */
  tag: string;
};

/** The saved `tag` is already the most recent game together. */
export function battletagFromHistory(
  byName: ReadonlyMap<string, ReplayName>,
  name: string,
): string | null {
  const shown = name.split("#")[0]?.trim() ?? "";
  if (!shown) return null;
  const exact = byName.get(shown.toLowerCase());
  if (exact) return exact.tag;
  const snapped = snapToRoster(
    shown,
    [...byName.values()].map((row) => row.display),
  );
  return byName.get(snapped.toLowerCase())?.tag ?? null;
}

let history: Map<string, ReplayName> | null = null;

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

/** Full battletag from local replays, or null when this name has never shared a game. */
export function replayBattletag(name: string): string | null {
  return battletagFromHistory(loadHistory(), name);
}
