import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { allDraftHeroes, heroDraftSlug } from "@/lib/scoring/heroPortrait";

export type TeamIndex = 0 | 1;

/** Draft as read from a .StormReplay (team-indexed, before we know who is who). */
export type ParsedReplayDraft = {
  map: string;
  firstPickTeam: TeamIndex;
  winnerTeam: TeamIndex | null;
  /** Hero names per team in the order that team picked them. */
  picks: [string[], string[]];
  /** Ban slots 1–3 per team as replay attribute ids ("Crus"); "" when skipped. */
  bans: [string[], string[]];
  players: { team: TeamIndex; name: string; hero: string }[];
};

export type ReplayAction = {
  side: "our" | "their";
  kind: "ban" | "pick";
  hero: string;
  /** Battletag name (no #) of who played the pick. */
  player?: string | null;
};

export type ReviewGameSummary = {
  /** NGS replay filename — stable id for the game. */
  id: string;
  round: number;
  game: number;
  opponent: string;
  map: string | null;
  won: boolean | null;
};

export type ReviewGame = ReviewGameSummary & {
  weFirst: boolean;
  /** Bans and picks in DRAFT_ORDER; shorter than 16 when the replay has a gap. */
  actions: ReplayAction[];
  problems: string[];
  ourTags: string[];
  theirTags: string[];
};

let canonBySlug: Map<string, string> | null = null;

/** Replay/HP spelling → the display name the draft board uses. */
export function canonicalDraftHero(name: string): string {
  if (!canonBySlug) {
    canonBySlug = new Map();
    for (const hero of allDraftHeroes()) {
      const slug = heroDraftSlug(hero);
      if (slug) canonBySlug.set(slug, hero);
    }
  }
  const slug = heroDraftSlug(name);
  return (slug && canonBySlug.get(slug)) || name;
}

/** Which replay team is ours: the one with more roster names on it. */
export function findOurTeam(
  players: ParsedReplayDraft["players"],
  rosterTags: readonly string[],
): TeamIndex | null {
  const names = new Set(rosterTags.map((t) => t.split("#")[0].toLowerCase()));
  const hits = [0, 0];
  for (const p of players) {
    if (names.has(p.name.toLowerCase())) hits[p.team] += 1;
  }
  if (hits[0] === hits[1]) return null;
  return hits[0] > hits[1] ? 0 : 1;
}

/**
 * Replay bans/picks laid onto DRAFT_ORDER from our perspective. Stops at the
 * first step the replay can't fill (e.g. a skipped ban) so the board never
 * desyncs from the real lobby.
 */
export function draftActionsFromReplay(
  draft: ParsedReplayDraft,
  ourTeam: TeamIndex,
  banName: (code: string) => string | null,
): { weFirst: boolean; actions: ReplayAction[]; problems: string[] } {
  const fp = draft.firstPickTeam;
  const next = { ban: [0, 0], pick: [0, 0] };
  const actions: ReplayAction[] = [];
  const problems: string[] = [];

  for (const [i, step] of DRAFT_ORDER.entries()) {
    const team: TeamIndex = step.side === "fp" ? fp : fp === 0 ? 1 : 0;
    const slot = next[step.kind][team]++;
    const side = team === ourTeam ? "our" : "their";
    const raw =
      step.kind === "ban"
        ? (draft.bans[team][slot] ?? "")
        : (draft.picks[team][slot] ?? "");
    const hero = step.kind === "ban" ? (raw ? banName(raw) : null) : raw || null;
    if (!hero) {
      const who = side === "our" ? "Our" : "Their";
      problems.push(
        step.kind === "ban" && !raw
          ? `${who} ban ${slot + 1} was skipped, so the replay stops at step ${i + 1}.`
          : step.kind === "ban"
            ? `Unknown ban id "${raw}" at step ${i + 1}.`
            : `${who} pick ${slot + 1} is missing from the replay.`,
      );
      break;
    }
    const action: ReplayAction = { side, kind: step.kind, hero: canonicalDraftHero(hero) };
    if (step.kind === "pick") {
      action.player =
        draft.players.find((p) => p.team === team && p.hero === raw)?.name ?? null;
    }
    actions.push(action);
  }

  return { weFirst: fp === ourTeam, actions, problems };
}

/** Map from an NGS replay filename like `…_vs_Team_Infernal_Shrines.stormReplay`. */
export function mapFromReplayFile(
  file: string,
  maps: readonly string[],
): string | null {
  const stem = file.replace(/\.stormreplay$/i, "").toLowerCase();
  let best: string | null = null;
  for (const map of maps) {
    const tail = `_${map.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    if (stem.endsWith(tail) && (!best || map.length > best.length)) best = map;
  }
  return best;
}
