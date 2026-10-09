import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { battletagStorePath } from "@/lib/replay/paths";

export type BattletagAlternate = {
  tag: string;
  games: number;
  firstSeen: string;
  lastSeen: string;
};

export type BattletagNameRow = {
  display: string;
  tag: string;
  lastSeen: string;
  games: number;
  alternates: BattletagAlternate[];
};

export type BattletagStore = {
  generatedAt: string;
  replayRoot: string;
  replays: number;
  read: number;
  failed: number;
  names: number;
  choice: string;
  tags: number;
  byName: Record<string, BattletagNameRow>;
};

export function emptyStore(replayRoot: string): BattletagStore {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    replayRoot,
    replays: 0,
    read: 0,
    failed: 0,
    names: 0,
    choice: "most recent game together",
    tags: 0,
    byName: {},
  };
}

export function loadBattletagStore(file = battletagStorePath()): BattletagStore | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as BattletagStore;
    if (!parsed.byName) parsed.byName = {};
    return parsed;
  } catch {
    return null;
  }
}

export function saveBattletagStore(store: BattletagStore, file = battletagStorePath()): void {
  store.generatedAt = new Date().toISOString();
  store.names = Object.keys(store.byName).length;
  store.tags = Object.values(store.byName).reduce(
    (n, row) => n + 1 + row.alternates.length,
    0,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

export type ReplayPlayerTag = { name: string; tag: string; seen: string };

function bumpAlternate(row: BattletagNameRow, tag: string, seen: string): void {
  const hit = row.alternates.find((alt) => alt.tag === tag);
  if (hit) {
    hit.games += 1;
    if (seen > hit.lastSeen) hit.lastSeen = seen;
    if (seen < hit.firstSeen) hit.firstSeen = seen;
    return;
  }
  row.alternates.push({ tag, games: 1, firstSeen: seen, lastSeen: seen });
}

/** Apply one parsed replay to the store (chronological order). */
export function applyReplayPlayers(
  store: BattletagStore,
  players: readonly ReplayPlayerTag[],
): void {
  for (const player of players) {
    const key = player.name.toLowerCase();
    const row = store.byName[key];
    if (!row) {
      store.byName[key] = {
        display: player.name,
        tag: player.tag,
        lastSeen: player.seen,
        games: 1,
        alternates: [],
      };
      continue;
    }
    row.games += 1;
    if (player.seen > row.lastSeen) {
      if (player.tag !== row.tag) {
        bumpAlternate(row, row.tag, row.lastSeen);
        row.tag = player.tag;
        row.display = player.name;
      }
      row.lastSeen = player.seen;
    } else if (player.tag !== row.tag) {
      bumpAlternate(row, player.tag, player.seen);
    }
  }
}
