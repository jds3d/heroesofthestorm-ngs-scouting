import { AsyncLocalStorage } from "async_hooks";

export const API_CALL_KINDS = [
  "ngs-schedule",
  "ngs-team",
  "hp-storm-league",
  "hp-ngs-player",
  "hp-team-matches",
  "hp-replay-draft",
  "hp-replay-bans",
  "hp-ngs-replay",
  "hp-global-heroes",
  "hp-hero-matchups",
] as const;

export type ApiCallKind = (typeof API_CALL_KINDS)[number];

export type ApiCallCount = {
  kind: ApiCallKind;
  label: string;
  count: number;
};

const LABELS: Record<ApiCallKind, string> = {
  "ngs-schedule": "NGS schedule",
  "ngs-team": "NGS roster",
  "hp-storm-league": "HeroesProfile Storm League",
  "hp-ngs-player": "HeroesProfile NGS player",
  "hp-team-matches": "HeroesProfile team matches",
  "hp-replay-draft": "HeroesProfile replay draft",
  "hp-replay-bans": "HeroesProfile replay bans",
  "hp-ngs-replay": "HeroesProfile NGS replay",
  "hp-global-heroes": "HeroesProfile global hero stats",
  "hp-hero-matchups": "HeroesProfile hero matchups",
};

type Store = { counts: Map<ApiCallKind, number> };

const usage = new AsyncLocalStorage<Store>();

export function noteApiCall(kind: ApiCallKind): void {
  const store = usage.getStore();
  if (!store) return;
  store.counts.set(kind, (store.counts.get(kind) ?? 0) + 1);
}

export function classifyHeroesProfile(endpoint: string): ApiCallKind | null {
  const path = endpoint.replace(/^\//, "");
  if (path.startsWith("players/heroes")) return "hp-storm-league";
  if (path.startsWith("ngs/player")) return "hp-ngs-player";
  if (path.startsWith("ngs/team/matches")) return "hp-team-matches";
  if (path.endsWith("/draft")) return "hp-replay-draft";
  if (path.endsWith("/bans")) return "hp-replay-bans";
  if (path.startsWith("ngs/replay/")) return "hp-ngs-replay";
  if (path === "patches" || path.startsWith("heroes/stats")) return "hp-global-heroes";
  if (path.startsWith("heroes/matchups")) return "hp-hero-matchups";
  return null;
}

export function classifyNgs(path: string): ApiCallKind | null {
  if (path.includes("/api/schedule/fetch/matches/team")) return "ngs-schedule";
  if (path.includes("/api/team/get")) return "ngs-team";
  return null;
}

export function emptyCounts(): ApiCallCount[] {
  return API_CALL_KINDS.map((kind) => ({
    kind,
    label: LABELS[kind],
    count: 0,
  }));
}

export function countsFromMap(map: Map<ApiCallKind, number>): ApiCallCount[] {
  return API_CALL_KINDS.map((kind) => ({
    kind,
    label: LABELS[kind],
    count: map.get(kind) ?? 0,
  }));
}

/** Add two usage tallies (e.g. scout body + post-plan matchups). */
export function mergeApiCounts(
  a: ApiCallCount[],
  b: ApiCallCount[],
): ApiCallCount[] {
  const map = new Map<ApiCallKind, number>();
  for (const row of [...a, ...b]) {
    map.set(row.kind, (map.get(row.kind) ?? 0) + row.count);
  }
  return countsFromMap(map);
}

export async function runWithApiUsage<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; actual: ApiCallCount[] }> {
  const store: Store = { counts: new Map() };
  const result = await usage.run(store, fn);
  return { result, actual: countsFromMap(store.counts) };
}
