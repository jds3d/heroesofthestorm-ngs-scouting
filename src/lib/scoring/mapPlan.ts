import { NGS_MAP_POOL } from "@/config/ngsMaps";
import type {
  DraftInsights,
  MapPlan,
  MapPlanGridRow,
  MapPlanPick,
} from "@/lib/scoring/types";

export type MapTendency = DraftInsights["mapTendencies"][number];

function recordLine(m: MapTendency | undefined): string | null {
  if (!m || m.games < 1) return null;
  const wins = Math.round(m.wins);
  const losses = Math.max(0, Math.round(m.games - m.wins));
  return `${wins}-${losses}`;
}

/** Current NGS season W-L; unplayed maps show 0-0. */
function seasonRecordLine(m: MapTendency | undefined): string {
  if (!m) return "0-0";
  if (m.seasonGames != null) {
    if (m.seasonGames < 1) return "0-0";
    const wins = Math.round(m.seasonWins);
    const losses = Math.max(0, Math.round(m.seasonGames - m.seasonWins));
    return `${wins}-${losses}`;
  }
  return recordLine(m) ?? "0-0";
}

/** Shrink win rate toward 50% when the sample is thin. winRate is 0–100. */
function smoothedWr(m: MapTendency | undefined): number {
  if (!m || m.games < 1) return 50;
  const prior = 2;
  return (m.winRate * m.games + 50 * prior) / (m.games + prior);
}

type Scored = {
  map: string;
  edge: number;
  their?: MapTendency;
  our?: MapTendency;
  theirGames: number;
  ourGames: number;
};

/**
 * Suggest maps we should ban (they beat us there) and maps we should leave up
 * / play (we beat them there). Needs our NGS map sample when available.
 */
export function buildMapPlan(
  theirMaps: MapTendency[],
  ourMaps: MapTendency[] | null,
): MapPlan {
  const theirBy = new Map(theirMaps.map((m) => [m.map, m]));
  const ourBy = new Map((ourMaps ?? []).map((m) => [m.map, m]));
  const names = new Set([...theirBy.keys(), ...ourBy.keys()]);
  const haveOurs = (ourMaps?.length ?? 0) > 0;

  const scored: Scored[] = [];
  for (const map of names) {
    const their = theirBy.get(map);
    const our = ourBy.get(map);
    const theirGames = their?.games ?? 0;
    const ourGames = our?.games ?? 0;
    if (theirGames < 1 && ourGames < 1) continue;
    scored.push({
      map,
      edge: smoothedWr(our) - smoothedWr(their),
      their,
      our,
      theirGames,
      ourGames,
    });
  }

  if (scored.length === 0) {
    return {
      ban: [],
      play: [],
      grid: buildGrid(theirBy, ourBy, new Map(), new Map(), new Map()),
      note: "No map sample yet for either side.",
    };
  }

  const banPool = haveOurs
    ? [...scored]
        .filter((s) => s.theirGames >= 1 || s.ourGames >= 1)
        .sort(
          (a, b) =>
            a.edge - b.edge ||
            (b.their?.winRate ?? 0) - (a.their?.winRate ?? 0) ||
            a.map.localeCompare(b.map),
        )
    : [...scored]
        .filter((s) => s.theirGames >= 1)
        .sort(
          (a, b) =>
            (b.their?.winRate ?? 0) - (a.their?.winRate ?? 0) ||
            b.theirGames - a.theirGames ||
            a.map.localeCompare(b.map),
        );

  const playPool = haveOurs
    ? [...scored]
        .filter((s) => s.theirGames >= 1 || s.ourGames >= 1)
        .sort(
          (a, b) =>
            b.edge - a.edge ||
            (a.their?.winRate ?? 100) - (b.their?.winRate ?? 100) ||
            a.map.localeCompare(b.map),
        )
    : [...scored]
        .filter((s) => s.theirGames >= 1)
        .sort(
          (a, b) =>
            (a.their?.winRate ?? 100) - (b.their?.winRate ?? 100) ||
            b.theirGames - a.theirGames ||
            a.map.localeCompare(b.map),
        );

  const used = new Set<string>();
  const ban: MapPlanPick[] = [];
  for (const s of banPool) {
    if (ban.length >= 2) break;
    if (used.has(s.map)) continue;
    // Prefer maps where the edge is actually against us, or they are hot.
    if (haveOurs && s.edge > -3 && (s.their?.winRate ?? 0) < 55) continue;
    if (!haveOurs && (s.their?.winRate ?? 0) < 55 && s.theirGames < 3) continue;
    used.add(s.map);
    ban.push(toPick(s, "ban", haveOurs));
  }
  // If filters were too strict, take the worst edges anyway.
  for (const s of banPool) {
    if (ban.length >= 2) break;
    if (used.has(s.map)) continue;
    used.add(s.map);
    ban.push(toPick(s, "ban", haveOurs));
  }

  const play: MapPlanPick[] = [];
  for (const s of playPool) {
    if (play.length >= 3) break;
    if (used.has(s.map)) continue;
    if (haveOurs && s.edge < 3 && (s.their?.winRate ?? 100) > 45) continue;
    if (!haveOurs && (s.their?.winRate ?? 100) > 45 && s.theirGames < 3) {
      continue;
    }
    used.add(s.map);
    play.push(toPick(s, "play", haveOurs));
  }
  for (const s of playPool) {
    if (play.length >= 3) break;
    if (used.has(s.map)) continue;
    used.add(s.map);
    play.push(toPick(s, "play", haveOurs));
  }

  const banRank = new Map(ban.map((p, i) => [p.map, i + 1]));
  const playRank = new Map(play.map((p, i) => [p.map, i + 1]));
  const edgeByMap = new Map(
    scored.map((s) => [s.map, Math.round(s.edge * 10) / 10]),
  );

  return {
    ban,
    play,
    grid: buildGrid(theirBy, ourBy, banRank, playRank, edgeByMap),
    note: haveOurs
      ? null
      : "Our map sample is missing — ranked from their record only. Scout Little Buff Boyz once to compare.",
  };
}

function buildGrid(
  theirBy: Map<string, MapTendency>,
  ourBy: Map<string, MapTendency>,
  banRank: Map<string, number>,
  playRank: Map<string, number>,
  edgeByMap: Map<string, number>,
): MapPlanGridRow[] {
  return NGS_MAP_POOL.map(({ name }) => ({
    map: name,
    ourRecord: seasonRecordLine(ourBy.get(name)),
    theirRecord: seasonRecordLine(theirBy.get(name)),
    banRank: banRank.get(name) ?? null,
    playRank: playRank.get(name) ?? null,
    edge: edgeByMap.get(name) ?? null,
  }));
}

function toPick(
  s: Scored,
  kind: "ban" | "play",
  haveOurs: boolean,
): MapPlanPick {
  const theirRec = recordLine(s.their);
  const ourRec = recordLine(s.our);
  const edgeRounded = Math.round(s.edge * 10) / 10;
  let reason: string;
  if (haveOurs) {
    if (kind === "ban") {
      reason =
        edgeRounded < 0
          ? `They are ${Math.abs(edgeRounded).toFixed(0)} pts hotter than us here${theirRec ? ` (${theirRec})` : ""}${ourRec ? `; we are ${ourRec}` : ""}.`
          : `Their best map in the sample${theirRec ? ` (${theirRec})` : ""}${ourRec ? `; we are ${ourRec}` : ""}.`;
    } else {
      reason =
        edgeRounded > 0
          ? `We are ${edgeRounded.toFixed(0)} pts hotter than them here${ourRec ? ` (${ourRec})` : ""}${theirRec ? `; they are ${theirRec}` : ""}.`
          : `Their softest map in the sample${theirRec ? ` (${theirRec})` : ""}${ourRec ? `; we are ${ourRec}` : ""}.`;
    }
  } else if (kind === "ban") {
    reason = `Their strong map${theirRec ? ` (${theirRec})` : ""} — deny it until we have our own sample.`;
  } else {
    reason = `Their soft map${theirRec ? ` (${theirRec})` : ""} — leave it up.`;
  }

  return {
    map: s.map,
    reason,
    ourRecord: ourRec,
    theirRecord: theirRec,
    edge: edgeRounded,
  };
}
