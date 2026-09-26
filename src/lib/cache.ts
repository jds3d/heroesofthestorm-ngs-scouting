import fs from "fs/promises";
import path from "path";
import { leagueConfig } from "@/config/league";

type CacheEnvelope<T> = {
  storedAt: number;
  /** null means keep until explicitly invalidated */
  ttlMs: number | null;
  data: T;
};

/** Past games / replays never change — keep forever. */
export const FOREVER = null;

const memory = new Map<string, CacheEnvelope<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const cacheDir = path.join(process.cwd(), ".cache");

/** Keys for immutable past-game payloads (replays, drafts, bans, match shells). */
export function isImmutableGameCacheKey(key: string): boolean {
  return (
    key.startsWith("hp-v1-ngs-replay-") ||
    key.startsWith("hp-v1-replay-draft-") ||
    key.startsWith("hp-v1-replay-ban-") ||
    key.startsWith("hp-v1-ngs-match-") ||
    key.startsWith("hp-v1-game-") ||
    // Prior-season NGS schedule / player snapshots are frozen.
    key.includes(`-s${leagueConfig.priorSeason}-`) ||
    key.includes(`-${leagueConfig.priorSeason}-`)
  );
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function fileFor(key: string): string {
  return path.join(cacheDir, `${safeName(key)}.json`);
}

function isFresh(
  key: string,
  envelope: CacheEnvelope<unknown>,
  now = Date.now(),
): boolean {
  if (isImmutableGameCacheKey(key)) return true;
  if (envelope.ttlMs == null) return true;
  return now - envelope.storedAt <= envelope.ttlMs;
}

async function readDisk<T>(key: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await fs.readFile(fileFor(key), "utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (!envelope || typeof envelope.storedAt !== "number" || !("data" in envelope)) {
      return null;
    }
    return envelope;
  } catch {
    return null;
  }
}

async function writeDisk<T>(key: string, envelope: CacheEnvelope<T>): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const dest = fileFor(key);
  const tmp = `${dest}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope));
  await fs.rename(tmp, dest);
}

export async function readCacheEntry<T>(
  key: string,
): Promise<{ data: T; fresh: boolean } | null> {
  let envelope = memory.get(key) as CacheEnvelope<T> | undefined;
  if (!envelope) {
    const disk = await readDisk<T>(key);
    if (!disk) return null;
    envelope = disk;
    memory.set(key, disk);
  }
  return { data: envelope.data, fresh: isFresh(key, envelope) };
}

/** Newest saved payload whose key starts with `prefix`, including lineup-scoped keys. */
export async function readNewestCacheByPrefix<T>(
  prefix: string,
): Promise<{ data: T; fresh: boolean } | null> {
  // Object wrapper so closure assignments stay visible to TypeScript.
  const state: {
    best: { storedAt: number; data: T; fresh: boolean } | null;
  } = { best: null };
  const consider = (storedAt: number, data: T, fresh: boolean) => {
    if (!state.best || storedAt > state.best.storedAt) {
      state.best = { storedAt, data, fresh };
    }
  };

  for (const [key, envelope] of memory) {
    if (!key.startsWith(prefix)) continue;
    const env = envelope as CacheEnvelope<T>;
    consider(env.storedAt, env.data, isFresh(key, env));
  }

  const filePrefix = safeName(prefix);
  let files: string[] = [];
  try {
    files = await fs.readdir(cacheDir);
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -".json".length);
    if (name !== filePrefix && !name.startsWith(`${filePrefix}_`)) continue;
    try {
      const raw = await fs.readFile(path.join(cacheDir, file), "utf8");
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      if (
        !envelope ||
        typeof envelope.storedAt !== "number" ||
        !("data" in envelope)
      ) {
        continue;
      }
      consider(envelope.storedAt, envelope.data, isFresh(prefix, envelope));
    } catch {
      continue;
    }
  }

  return state.best
    ? { data: state.best.data, fresh: state.best.fresh }
    : null;
}

export async function getCached<T>(
  key: string,
  ttlMs: number | null = leagueConfig.cacheTtlMs,
): Promise<T | null> {
  let envelope = memory.get(key) as CacheEnvelope<T> | undefined;
  if (!envelope) {
    const disk = await readDisk<T>(key);
    if (!disk) return null;
    envelope = disk;
    memory.set(key, disk);
  }
  const effective: CacheEnvelope<T> = {
    ...envelope,
    ttlMs: isImmutableGameCacheKey(key)
      ? FOREVER
      : envelope.ttlMs === undefined
        ? ttlMs
        : envelope.ttlMs,
  };
  if (!isFresh(key, effective)) {
    memory.delete(key);
    await fs.unlink(fileFor(key)).catch(() => undefined);
    return null;
  }
  return effective.data;
}

export async function cacheHas(key: string): Promise<boolean> {
  const hit = await getCached(key, FOREVER);
  return hit !== null;
}

export async function setCached<T>(
  key: string,
  data: T,
  ttlMs: number | null = leagueConfig.cacheTtlMs,
): Promise<void> {
  const envelope: CacheEnvelope<T> = {
    storedAt: Date.now(),
    ttlMs: isImmutableGameCacheKey(key) ? FOREVER : ttlMs,
    data,
  };
  memory.set(key, envelope);
  await writeDisk(key, envelope);
}

export async function invalidateCached(prefix: string): Promise<void> {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  let files: string[] = [];
  try {
    files = await fs.readdir(cacheDir);
  } catch {
    return;
  }
  await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith(".json")) return;
      const name = file.slice(0, -".json".length);
      if (!name.startsWith(safeName(prefix))) return;
      await fs.unlink(path.join(cacheDir, file)).catch(() => undefined);
    }),
  );
}

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number | null = leagueConfig.cacheTtlMs,
): Promise<T> {
  const effectiveTtl = isImmutableGameCacheKey(key) ? FOREVER : ttlMs;
  const hit = await getCached<T>(key, effectiveTtl);
  if (hit !== null) return hit;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const data = await fetcher();
    // Never forever-cache empty / failed payloads — retry later when quota recovers.
    if (data !== null && data !== undefined) {
      await setCached(key, data, effectiveTtl);
    }
    return data;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}
