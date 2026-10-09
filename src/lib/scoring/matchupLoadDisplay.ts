import { heroKey } from "@/lib/scoring/heroMeta";

export type MatchupLoadMode = "session" | "cache" | "api";

export type HeroMatchupSource = {
  mode: MatchupLoadMode;
  apiCalls: number;
};

export type LiveSuggestionsGate = {
  matchupsLoading: boolean;
  loadMode?: MatchupLoadMode;
  heroes: readonly string[];
  heroApiCalls?: Readonly<Record<string, number>>;
};

export function heroPendingApiCalls(
  hero: string,
  heroApiCalls?: Readonly<Record<string, number>>,
): number {
  if (!heroApiCalls) return 0;
  const key = heroKey(hero);
  const direct = heroApiCalls[key];
  if (direct != null) return direct;
  const loose = heroApiCalls[hero];
  return loose ?? 0;
}

/** How this hero's matchup row will be loaded (per-hero HP calls when known). */
export function perHeroMatchupSource(
  hero: string,
  batchMode: MatchupLoadMode | undefined,
  heroApiCalls?: Readonly<Record<string, number>>,
): HeroMatchupSource {
  if (batchMode === "session") return { mode: "session", apiCalls: 0 };
  const pending = heroPendingApiCalls(hero, heroApiCalls);
  if (heroApiCalls) {
    return pending > 0
      ? { mode: "api", apiCalls: pending }
      : { mode: "cache", apiCalls: 0 };
  }
  if (batchMode === "cache") return { mode: "cache", apiCalls: 0 };
  if (batchMode === "api") return { mode: "api", apiCalls: 1 };
  return { mode: "cache", apiCalls: 0 };
}

export function formatPerHeroMatchupLine(
  hero: string,
  source: HeroMatchupSource,
): string {
  if (source.mode === "session") {
    return `Session cache: ${hero} (no server request)`;
  }
  if (source.mode === "cache") {
    return `Server cache: ${hero} (.cache on disk)`;
  }
  const n = source.apiCalls;
  if (n <= 1) return `API call: ${hero} (1 Heroes Profile request)`;
  return `API call: ${hero} (${n} Heroes Profile requests)`;
}

export function matchupLoadKindLine(
  mode: MatchupLoadMode | undefined,
  pendingCalls?: number,
): string | null {
  if (!mode) return null;
  if (mode === "session") {
    return "Session cache — matchups already in this tab (no server request).";
  }
  if (mode === "cache") {
    return "Server cache — reading .cache on disk (no Heroes Profile API).";
  }
  const n = pendingCalls ?? 0;
  return n > 0
    ? `Heroes Profile API — up to ${n} matchup request(s) in this batch.`
    : "Heroes Profile API — fetching matchup data.";
}

export function matchupHeroLoadLines(
  heroes: readonly string[],
  batchMode: MatchupLoadMode | undefined,
  heroApiCalls?: Readonly<Record<string, number>>,
): string[] {
  return heroes.map((hero) =>
    formatPerHeroMatchupLine(
      hero,
      perHeroMatchupSource(hero, batchMode, heroApiCalls),
    ),
  );
}

/** Heroes Profile `heroes/matchups` query shape (timeframe build resolved server-side). */
export function heroesProfileMatchupParamsLine(hero: string): string {
  return `heroes/matchups · game_type=Storm League · timeframe_type=minor · hero=${hero} · timeframe=<current minor build>`;
}

export type HeroMatchupLoadBarItem = {
  id: string;
  hero: string;
  callIndex: number;
  callTotal: number;
  source: HeroMatchupSource;
  label: string;
  params: string;
};

/** One progress bar per HP HTTP call (multiple when a hero needs stacked sub-patch pulls). */
export function expandHeroMatchupLoadBars(
  heroes: readonly string[],
  batchMode: MatchupLoadMode | undefined,
  heroApiCalls?: Readonly<Record<string, number>>,
): HeroMatchupLoadBarItem[] {
  const items: HeroMatchupLoadBarItem[] = [];
  for (const hero of heroes) {
    const source = perHeroMatchupSource(hero, batchMode, heroApiCalls);
    const callTotal =
      source.mode === "api" ? Math.max(1, source.apiCalls) : 1;
    for (let i = 0; i < callTotal; i++) {
      const callIndex = i + 1;
      const label =
        source.mode === "api" && callTotal > 1
          ? `API call ${callIndex}/${callTotal}: ${hero}`
          : formatPerHeroMatchupLine(hero, source);
      items.push({
        id: `${heroKey(hero)}:${callIndex}:${callTotal}`,
        hero,
        callIndex,
        callTotal,
        source,
        label,
        params: heroesProfileMatchupParamsLine(hero),
      });
    }
  }
  return items;
}

export function expectedMsForMatchupLoadBar(
  source: HeroMatchupSource,
  callIndex: number,
): number {
  if (source.mode === "session") return 2_000;
  if (source.mode === "cache") return 22_000;
  return Math.min(45_000, 12_000 + callIndex * 4_000);
}
