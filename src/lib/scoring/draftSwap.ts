import { heroKey } from "@/lib/scoring/heroMeta";
import {
  COMFORT_SUGGEST_MIN,
  comfortMeetsSuggestBar,
} from "@/lib/scoring/comfort";
import type { PlayerScout } from "@/lib/scoring/types";

export type LockedPick = {
  hero: string;
  /** Display name (no battletag). */
  player: string | null;
};

export type DraftSwap = {
  /** Hero the current seat locks now (specialist's needed hero). */
  lockHero: string;
  /** Who clicks lock — flexible player who will end on the early hero. */
  locker: string;
  /** Already-locked hero that moves to the locker after swap. */
  giveHero: string;
  /** Who already has giveHero and receives lockHero. */
  specialist: string;
  reason: string;
  /** Comfort sum after swap minus comfort sum if locker just keeps lockHero. */
  comfortDelta: number;
};

function displayName(tagOrName: string): string {
  return tagOrName.split("#")[0]?.trim() || tagOrName.trim();
}

function playerId(tagOrName: string): string {
  return displayName(tagOrName).toLowerCase();
}

function comfortOf(
  home: PlayerScout[],
  player: string,
  hero: string,
): number {
  const id = playerId(player);
  const p = home.find(
    (row) =>
      playerId(row.battletag) === id ||
      playerId(displayName(row.battletag)) === id,
  );
  if (!p) return 0;
  const hit = p.topHeroes.find((h) => heroKey(h.hero) === heroKey(hero));
  return hit?.comfort ?? 0;
}

/** True if this player is clearly the best (or only real) option for the hero. */
function isSpecialistFor(
  home: PlayerScout[],
  player: string,
  hero: string,
  excludePlayers: Set<string>,
): boolean {
  const theirs = comfortOf(home, player, hero);
  if (theirs <= 0.02) return false;
  let bestOther = 0;
  for (const p of home) {
    const name = displayName(p.battletag);
    if (playerId(name) === playerId(player)) continue;
    if (excludePlayers.has(playerId(name))) continue;
    bestOther = Math.max(bestOther, comfortOf(home, name, hero));
  }
  // Specialist if they beat the field by a clear margin, or nobody else plays it.
  return theirs >= bestOther + 0.04 || (theirs >= 0.08 && bestOther < 0.03);
}

/**
 * When a later pick needs a hero only (or best) played by someone who already
 * locked, have the free player lock it and swap after — e.g. HuckIt locks Hanzo,
 * swaps with MrHustler (Qhira) because HuckIt is fine on Qhira.
 */
export function findPickSwap(args: {
  home: PlayerScout[];
  /** Heroes we already locked on our side, with owners when known. */
  locked: LockedPick[];
  /** Hero under consideration for this pick. */
  neededHero: string;
  /** Player who should take this seat (from plan), if known. */
  seatPlayer: string | null;
}): DraftSwap | null {
  const { home, locked, neededHero, seatPlayer } = args;
  if (!home.length || !locked.length) return null;

  const lockedIds = new Set(
    locked
      .map((l) => (l.player ? playerId(l.player) : null))
      .filter((x): x is string => Boolean(x)),
  );

  // Free players = roster not yet on a locked pick.
  const freePlayers = home
    .map((p) => displayName(p.battletag))
    .filter((n) => !lockedIds.has(playerId(n)));

  const locker =
    (seatPlayer &&
      freePlayers.find((n) => playerId(n) === playerId(seatPlayer))) ||
    freePlayers[0] ||
    null;
  if (!locker) return null;

  let best: DraftSwap | null = null;

  for (const L of locked) {
    if (!L.player) continue;
    const specialist = displayName(L.player);
    if (playerId(specialist) === playerId(locker)) continue;
    if (heroKey(L.hero) === heroKey(neededHero)) continue;

    // Specialist must be the reason we want neededHero on them.
    if (!isSpecialistFor(home, specialist, neededHero, lockedIds)) continue;

    const cSpecNeed = comfortOf(home, specialist, neededHero);
    const cSpecGive = comfortOf(home, specialist, L.hero);
    const cFlexNeed = comfortOf(home, locker, neededHero);
    const cFlexGive = comfortOf(home, locker, L.hero);

    // Flex must be playable on the early hero after swap.
    if (cFlexGive < 0.03 && cFlexNeed >= cFlexGive) continue;
    // Don't swap into a dumpster for the flex.
    if (cFlexGive <= 0 && cSpecNeed < cFlexNeed + 0.1) continue;

    const withoutSwap = cSpecGive + cFlexNeed;
    const withSwap = cSpecNeed + cFlexGive;
    const delta = withSwap - withoutSwap;
    if (delta < 0.03) continue;

    const reason =
      `${locker} locks ${neededHero} now, then swaps with ${specialist}: ` +
      `${specialist} ends on ${neededHero} (their seat), ${locker} ends on ${L.hero} ` +
      `(playable). Net comfort +${delta.toFixed(2)} vs ${locker} just keeping ${neededHero}.`;

    if (!best || delta > best.comfortDelta) {
      best = {
        lockHero: neededHero,
        locker,
        giveHero: L.hero,
        specialist,
        reason,
        comfortDelta: delta,
      };
    }
  }

  return best;
}

/**
 * After five are locked, suggest 2-player swaps that raise total comfort.
 * Same idea — overall win rate over sticky first assignments.
 */
export function findEndDraftSwaps(args: {
  home: PlayerScout[];
  locked: LockedPick[];
}): DraftSwap[] {
  const { home, locked } = args;
  if (!home.length || locked.length < 2) return [];

  const owned = locked.filter((l) => l.player);
  const out: DraftSwap[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const a = owned[i];
      const b = owned[j];
      if (!a.player || !b.player) continue;

      const cA_a = comfortOf(home, a.player, a.hero);
      const cA_b = comfortOf(home, a.player, b.hero);
      const cB_b = comfortOf(home, b.player, b.hero);
      const cB_a = comfortOf(home, b.player, a.hero);

      const before = cA_a + cB_b;
      const after = cA_b + cB_a;
      const delta = after - before;
      if (delta < 0.05) continue;

      // Prefer the clearer specialist direction in the copy.
      const aGainsMore = cA_b - cA_a >= cB_a - cB_b;
      const specialist = aGainsMore ? displayName(a.player) : displayName(b.player);
      const locker = aGainsMore ? displayName(b.player) : displayName(a.player);
      const lockHero = aGainsMore ? b.hero : a.hero;
      const giveHero = aGainsMore ? a.hero : b.hero;

      const key = [heroKey(a.hero), heroKey(b.hero)].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        lockHero,
        locker,
        giveHero,
        specialist,
        comfortDelta: delta,
        reason:
          `Swap ${specialist}'s ${giveHero} ↔ ${locker}'s ${lockHero} — ` +
          `both land on higher comfort (net +${delta.toFixed(2)}).`,
      });
    }
  }

  return out.sort((x, y) => y.comfortDelta - x.comfortDelta);
}

/** Best roster owner for a hero among free players (for labeling locks). */
export function bestFreeOwner(
  home: PlayerScout[],
  hero: string,
  lockedPlayers: Set<string>,
): string | null {
  const gated = home.some((p) =>
    comfortMeetsSuggestBar(comfortOf(home, displayName(p.battletag), hero)),
  );
  let best: { name: string; comfort: number } | null = null;
  for (const p of home) {
    const name = displayName(p.battletag);
    if (lockedPlayers.has(playerId(name))) continue;
    const c = comfortOf(home, name, hero);
    if (gated ? c < COMFORT_SUGGEST_MIN : c <= 0) continue;
    if (!best || c > best.comfort) best = { name, comfort: c };
  }
  return best?.name ?? null;
}

/**
 * One player per locked hero. Strongest comfort claims win first, so a later
 * specialist pick (Auriel for Zloth) can steal a player from an earlier flex
 * lock (Varian) and cascade free seats to the next-best owners.
 */
export function assignUniqueOwners(args: {
  locked: { hero: string }[];
  roster: PlayerScout[];
  /** Soft preferred owners from the likely five / plan. */
  planHints?: { hero: string; player: string | null }[];
  /** Prefer keeping current labels when comfort ties. */
  previous?: { hero: string; player: string | null }[];
}): LockedPick[] {
  const { locked, roster, planHints = [], previous = [] } = args;
  if (!locked.length) return [];

  const hintByHero = new Map<string, string>();
  for (const h of planHints) {
    const who = h.player ? displayName(h.player) : null;
    if (who) hintByHero.set(heroKey(h.hero), who);
  }
  const prevByHero = new Map<string, string>();
  for (const p of previous) {
    const who = p.player ? displayName(p.player) : null;
    if (who) prevByHero.set(heroKey(p.hero), who);
  }

  type Claim = { heroIdx: number; player: string; score: number };
  const claims: Claim[] = [];

  for (let i = 0; i < locked.length; i++) {
    const hero = locked[i].hero;
    const hk = heroKey(hero);
    const hint = hintByHero.get(hk);
    const prev = prevByHero.get(hk);
    const seenPlayers = new Set<string>();

    if (roster.length) {
      for (const p of roster) {
        const name = displayName(p.battletag);
        const id = playerId(name);
        seenPlayers.add(id);
        const raw = comfortOf(roster, name, hero);
        const gated = roster.some((row) =>
          comfortMeetsSuggestBar(
            comfortOf(roster, displayName(row.battletag), hero),
          ),
        );
        if (gated ? raw < COMFORT_SUGGEST_MIN : raw <= 0) continue;
        let score = raw;
        if (hint && playerId(hint) === id) score += 0.05;
        if (prev && playerId(prev) === id) score += 0.005;
        if (score > 0) claims.push({ heroIdx: i, player: name, score });
      }
    }

    // Plan-only fallback when roster is empty or the hinted player has no pool row.
    if (hint && !seenPlayers.has(playerId(hint))) {
      claims.push({ heroIdx: i, player: hint, score: 0.01 });
    }
  }

  claims.sort((a, b) => b.score - a.score || a.heroIdx - b.heroIdx);

  // Greedy by strongest claim leaves seats empty when the top owner of one
  // hero is the only owner of another (HuckIt: Tyrande .34 / Tyrael .15, with
  // Tyrande also playable by MrHustler). Five seats and a handful of players
  // is small enough to search every assignment: most seats filled, then the
  // highest comfort total.
  const claimsByIdx: Claim[][] = locked.map(() => []);
  for (const c of claims) claimsByIdx[c.heroIdx].push(c);

  let bestOwners: (string | null)[] = locked.map(() => null);
  let bestFilled = -1;
  let bestScore = -Infinity;
  const current: (string | null)[] = locked.map(() => null);
  const used = new Set<string>();

  const search = (idx: number, filled: number, score: number) => {
    if (idx === locked.length) {
      if (
        filled > bestFilled ||
        (filled === bestFilled && score > bestScore)
      ) {
        bestFilled = filled;
        bestScore = score;
        bestOwners = [...current];
      }
      return;
    }
    // Every remaining seat filled could not beat the best found already.
    if (filled + (locked.length - idx) < bestFilled) return;
    for (const c of claimsByIdx[idx]) {
      const id = playerId(c.player);
      if (used.has(id)) continue;
      used.add(id);
      current[idx] = c.player;
      search(idx + 1, filled + 1, score + c.score);
      used.delete(id);
      current[idx] = null;
    }
    search(idx + 1, filled, score);
  };
  search(0, 0, 0);

  return locked.map((L, i) => ({ hero: L.hero, player: bestOwners[i] }));
}

export function lockedPlayerIds(locked: LockedPick[]): Set<string> {
  const s = new Set<string>();
  for (const l of locked) {
    if (l.player) s.add(playerId(l.player));
  }
  return s;
}
