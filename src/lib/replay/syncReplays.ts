import { promises as fs } from "node:fs";
import path from "node:path";
import {
  battletagStorePath,
  replayFolder,
  replaySyncStatePath,
} from "@/lib/replay/paths";
import { parseLocalReplay } from "@/lib/replay/parseLocalReplay";
import {
  applyReplayPlayers,
  emptyStore,
  loadBattletagStore,
  saveBattletagStore,
  type BattletagStore,
} from "@/lib/replay/store";
import { clearReplayBattletagCache } from "@/lib/replay/battletags";

export type ReplaySyncState = {
  replayDir: string;
  files: Record<string, { mtimeMs: number; size: number }>;
};

export type ReplaySyncResult = {
  ok: boolean;
  replayDir: string;
  queued: number;
  processed: number;
  failed: number;
  newNames: string[];
  skipped?: string;
};

let syncInFlight: Promise<ReplaySyncResult> | null = null;

async function loadSyncState(dir: string): Promise<ReplaySyncState> {
  try {
    const raw = await fs.readFile(replaySyncStatePath(), "utf8");
    const parsed = JSON.parse(raw) as ReplaySyncState;
    if (parsed.replayDir === dir && parsed.files) return parsed;
  } catch {
    /* first run */
  }
  return { replayDir: dir, files: {} };
}

async function saveSyncState(state: ReplaySyncState): Promise<void> {
  await fs.mkdir(path.dirname(replaySyncStatePath()), { recursive: true });
  await fs.writeFile(replaySyncStatePath(), JSON.stringify(state, null, 2), "utf8");
}

async function listReplayFiles(dir: string): Promise<
  { name: string; mtimeMs: number; size: number }[]
> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; mtimeMs: number; size: number }[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".stormreplay")) continue;
    const full = path.join(dir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({ name, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  return out;
}

function needsParse(
  file: { name: string; mtimeMs: number; size: number },
  state: ReplaySyncState,
): boolean {
  const seen = state.files[file.name];
  return !seen || seen.mtimeMs !== file.mtimeMs || seen.size !== file.size;
}

/** Seed the sync state from an older bulk index so only newer files are parsed. */
function bootstrapSkip(
  files: { name: string; mtimeMs: number; size: number }[],
  state: ReplaySyncState,
  store: BattletagStore | null,
): { name: string; mtimeMs: number; size: number }[] {
  if (Object.keys(state.files).length > 0 || !store?.generatedAt) return files;
  const cut = Date.parse(store.generatedAt);
  if (!Number.isFinite(cut)) return files;
  const toParse: { name: string; mtimeMs: number; size: number }[] = [];
  for (const file of files) {
    if (file.mtimeMs > cut) toParse.push(file);
    else state.files[file.name] = { mtimeMs: file.mtimeMs, size: file.size };
  }
  return toParse;
}

async function runSync(): Promise<ReplaySyncResult> {
  const replayDir = replayFolder();
  const files = await listReplayFiles(replayDir);
  if (!files.length) {
    return {
      ok: false,
      replayDir,
      queued: 0,
      processed: 0,
      failed: 0,
      newNames: [],
      skipped: "Replay folder missing or empty",
    };
  }

  const state = await loadSyncState(replayDir);
  const existing = loadBattletagStore();
  const store =
    existing && existing.replayRoot
      ? { ...existing, byName: { ...existing.byName } }
      : emptyStore(replayDir);

  store.replayRoot = replayDir;
  store.replays = files.length;

  const beforeKeys = new Set(Object.keys(store.byName));
  let pending = files.filter((file) => needsParse(file, state));
  pending = bootstrapSkip(pending, state, existing);

  pending.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let processed = 0;
  let failed = 0;

  for (const file of pending) {
    const full = path.join(replayDir, file.name);
    const parsed = await parseLocalReplay(full);
    if (!parsed) {
      failed += 1;
      state.files[file.name] = { mtimeMs: file.mtimeMs, size: file.size };
      continue;
    }
    applyReplayPlayers(
      store,
      parsed.players.map((p) => ({ ...p, seen: parsed.seen })),
    );
    processed += 1;
    state.files[file.name] = { mtimeMs: file.mtimeMs, size: file.size };
  }

  store.read = Object.keys(state.files).length;
  store.failed = (store.failed ?? 0) + failed;
  saveBattletagStore(store);
  await saveSyncState(state);
  clearReplayBattletagCache();

  const newNames = Object.keys(store.byName).filter((key) => !beforeKeys.has(key));

  return {
    ok: true,
    replayDir,
    queued: pending.length,
    processed,
    failed,
    newNames,
  };
}

/** Parse any new or changed `.StormReplay` files into `replay-battletags.json`. */
export function syncReplayBattletags(): Promise<ReplaySyncResult> {
  if (!syncInFlight) {
    syncInFlight = runSync().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}
