import type { HpDraftEntry, HpNgsMatch, HpReplayData } from "@/lib/heroesprofile/types";

/** Draft-only shells expire so the next scout can pull real winners. */
export const DRAFT_SHELL_TTL_MS = 6 * 60 * 60 * 1000;

function heroName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: string }).name;
    if (name) return name;
  }
  return "";
}

function isBanEntry(entry: HpDraftEntry): boolean {
  if (entry.ban === true) return true;
  const kind = String(entry.type ?? entry.pick_type ?? "").toLowerCase();
  return kind.includes("ban");
}

export function isDraftOnlyReplay(
  replay: { players?: { battletag?: string }[] } | null | undefined,
): boolean {
  const players = replay?.players ?? [];
  return (
    players.length > 0 &&
    players.every((player) => (player.battletag ?? "").startsWith("unknown-"))
  );
}

/**
 * Hero list from the cheap draft endpoint. Returns null unless every pick
 * has team 0 or 1 — guessing "first five are team 0" puts heroes on the
 * wrong side when the list is in pick order.
 */
export function buildDraftShell(draft: HpDraftEntry[]): HpReplayData | null {
  const picks = draft.filter((entry) => !isBanEntry(entry) && heroName(entry.hero || entry));
  if (picks.length < 5) return null;

  const players: HpReplayData["players"] = [];
  for (const entry of picks) {
    const hero = heroName(entry.hero || entry);
    const team = entry.team === 0 || entry.team === 1 ? entry.team : null;
    if (!hero || team === null) return null;
    players.push({
      battletag: `unknown-${team}-${hero}`,
      hero,
      team,
      winner: false,
    });
  }

  return { players, winner_team: undefined };
}

/**
 * null means the winner is not in this payload. A draft shell must not be
 * read as a loss.
 */
export function ourSideWon(
  replay: HpReplayData | null,
  ourTeamIndex: number,
): boolean | null {
  if (!replay || isDraftOnlyReplay(replay)) return null;
  if (replay.winner_team === 0 || replay.winner_team === 1) {
    return replay.winner_team === ourTeamIndex;
  }
  if (replay.players.some((player) => player.winner)) {
    return replay.players.some(
      (player) => player.team === ourTeamIndex && player.winner,
    );
  }
  return null;
}

export function matchWinnersKnown(match: HpNgsMatch): boolean {
  const games = Object.values(match.match_data ?? {}).filter(
    (game) => (game.team_heroes?.length ?? 0) > 0,
  );
  if (!games.length) return false;
  return games.every((game) => game.winner === true || game.winner === false);
}

/**
 * Forever-cached rounds are reusable only when winners were actually known.
 * Legacy files with no flag and every game marked a loss are the old draft
 * shells and need a rebuild.
 */
export function cachedMatchTrustworthy(match: HpNgsMatch): boolean {
  const games = Object.values(match.match_data ?? {});
  if (!games.some((game) => (game.team_heroes?.length ?? 0) > 0)) return false;
  if (match.winnersKnown === true) return true;
  if (match.winnersKnown === false) return false;
  return games.some((game) => game.winner === true);
}
