import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { leagueConfig } from "@/config/league";
import { NGS_MAP_POOL } from "@/config/ngsMaps";
import { FOREVER, cachedFetch } from "@/lib/cache";
import { getHeroAttributeNames } from "@/lib/heroesprofile/client";
import { getTeam, getTeamMatches } from "@/lib/ngs/client";
import type { NgsMatch, NgsReplayEntry } from "@/lib/ngs/types";
import {
  draftActionsFromReplay,
  findOurTeam,
  mapFromReplayFile,
  type ParsedReplayDraft,
  type ReviewGame,
  type ReviewGameSummary,
  type TeamIndex,
} from "@/lib/review/replayDraft";

const REPLAY_BUCKET = "https://ngs-replay-storage.s3.amazonaws.com";

type HotsParser = {
  processReplay: (
    file: string,
    opts: { overrideVerifiedBuild?: boolean; getBMData?: boolean },
  ) => {
    status: number;
    match?: {
      map?: string;
      winner?: number;
      picks?: { 0?: string[]; 1?: string[]; first?: number };
      bans?: { 0?: { hero: string; absolute: number }[]; 1?: { hero: string; absolute: number }[] };
    };
    players?: Record<string, { team: number; hero: string; name: string }>;
  };
};

type ReplayGameRef = ReviewGameSummary & { match: NgsMatch };

function replayEntries(match: NgsMatch): [number, NgsReplayEntry][] {
  return Object.entries(match.replays ?? {})
    .filter((e): e is [string, NgsReplayEntry] => e[0] !== "_id" && typeof e[1] !== "string")
    .map(([k, v]) => [Number(k), v] as [number, NgsReplayEntry])
    .filter(([n, v]) => Number.isFinite(n) && Boolean(v.url))
    .sort((a, b) => a[0] - b[0]);
}

async function listGameRefs(): Promise<ReplayGameRef[]> {
  const home = leagueConfig.homeTeam;
  const matches = await getTeamMatches(home, leagueConfig.season);
  const maps = NGS_MAP_POOL.map((m) => m.name);
  const out: ReplayGameRef[] = [];
  for (const match of matches) {
    if (!match.reported) continue;
    const weAreHome = match.home.teamName === home;
    const opponent = weAreHome ? match.away.teamName : match.home.teamName;
    const results = (match.other ?? {}) as Record<string, { winner?: string } | undefined>;
    for (const [game, entry] of replayEntries(match)) {
      const winner = results[String(game)]?.winner;
      out.push({
        id: entry.url!,
        round: match.round,
        game,
        opponent,
        map: mapFromReplayFile(entry.url!, maps),
        won: winner ? (winner === "home") === weAreHome : null,
        match,
      });
    }
  }
  return out.sort((a, b) => b.round - a.round || a.game - b.game);
}

function summaryOf(ref: ReplayGameRef): ReviewGameSummary {
  const { id, round, game, opponent, map, won } = ref;
  return { id, round, game, opponent, map, won };
}

export async function listReviewGames(): Promise<ReviewGameSummary[]> {
  return (await listGameRefs()).map(summaryOf);
}

function team(n: number | undefined): TeamIndex | null {
  return n === 0 || n === 1 ? n : null;
}

async function parseReplay(file: string): Promise<ParsedReplayDraft> {
  const res = await fetch(`${REPLAY_BUCKET}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`Replay download failed (${res.status}) for ${file}`);
  const tmp = path.join(
    os.tmpdir(),
    `ngs-review-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.StormReplay`,
  );
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  try {
    const mod = (await import("hots-parser")) as unknown as HotsParser & { default?: HotsParser };
    const parser = mod.default ?? mod;
    // Fresh builds aren't on the parser's verified list but decode fine.
    const out = parser.processReplay(tmp, { overrideVerifiedBuild: true, getBMData: false });
    const m = out.match;
    const first = team(m?.picks?.first);
    if (!m || first === null) {
      throw new Error(`Replay ${file} has no draft data (parser status ${out.status})`);
    }
    const bans = (t: 0 | 1) =>
      [...(m.bans?.[t] ?? [])]
        .sort((a, b) => a.absolute - b.absolute)
        .map((b) => b.hero ?? "");
    return {
      map: m.map ?? "",
      firstPickTeam: first,
      winnerTeam: team(m.winner),
      picks: [m.picks?.[0] ?? [], m.picks?.[1] ?? []],
      bans: [bans(0), bans(1)],
      players: Object.values(out.players ?? {})
        .filter((p) => p.team === 0 || p.team === 1)
        .map((p) => ({ team: p.team as TeamIndex, name: p.name, hero: p.hero })),
    };
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

async function banNamer(draft: ParsedReplayDraft): Promise<(code: string) => string | null> {
  const mod = (await import("hots-parser/attr")) as unknown as {
    heroAttribute?: Record<string, string>;
    default?: { heroAttribute?: Record<string, string> };
  };
  const local = mod.heroAttribute ?? mod.default?.heroAttribute ?? {};
  const codes = [...draft.bans[0], ...draft.bans[1]].filter(Boolean);
  const hp = codes.every((c) => local[c])
    ? {}
    : await getHeroAttributeNames().catch(() => ({}) as Record<string, string>);
  return (code) => local[code] ?? hp[code] ?? null;
}

async function memberTags(teamName: string): Promise<string[]> {
  const t = await getTeam(teamName).catch(() => null);
  return (t?.teamMembers ?? []).map((m) => m.displayName).filter(Boolean);
}

function tagsFor(
  draft: ParsedReplayDraft,
  teamIdx: TeamIndex,
  roster: string[],
): string[] {
  const byName = new Map(roster.map((t) => [t.split("#")[0].toLowerCase(), t]));
  return draft.players
    .filter((p) => p.team === teamIdx)
    .map((p) => byName.get(p.name.toLowerCase()))
    .filter((t): t is string => Boolean(t));
}

export async function loadReviewGame(id: string): Promise<ReviewGame> {
  const ref = (await listGameRefs()).find((g) => g.id === id);
  if (!ref) throw new Error(`No reported ${leagueConfig.homeTeam} game with replay ${id}`);

  const draft = await cachedFetch(`ngs-replay-draft-${id}`, () => parseReplay(id), FOREVER);
  const [ourRoster, theirRoster] = await Promise.all([
    memberTags(leagueConfig.homeTeam),
    memberTags(ref.opponent),
  ]);
  const ourTeam = findOurTeam(draft.players, ourRoster);
  if (ourTeam === null) {
    throw new Error(`Couldn't tell which side of ${id} is ${leagueConfig.homeTeam}`);
  }
  const theirTeam: TeamIndex = ourTeam === 0 ? 1 : 0;
  const { weFirst, actions, problems } = draftActionsFromReplay(
    draft,
    ourTeam,
    await banNamer(draft),
  );
  const summary = summaryOf(ref);
  return {
    ...summary,
    map: summary.map ?? (draft.map || null),
    won: summary.won ?? (draft.winnerTeam === null ? null : draft.winnerTeam === ourTeam),
    weFirst,
    actions,
    problems,
    ourTags: tagsFor(draft, ourTeam, ourRoster),
    theirTags: tagsFor(draft, theirTeam, theirRoster),
  };
}
