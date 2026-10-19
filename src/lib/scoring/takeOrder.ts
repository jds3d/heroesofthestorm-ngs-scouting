import { resolvePlayerScout } from "@/lib/scoring/comfort";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { heroDraftMeta, type DraftMetaTable } from "@/lib/scoring/draftMeta";
import { heroKey, heroRole, heroTags } from "@/lib/scoring/heroMeta";
import { isDoublePickWindow } from "@/lib/scoring/pickPairs";
import type { PlayerScout } from "@/lib/scoring/types";

/**
 * Lock order for the heroes still open.
 * Earlier factors outrank later ones. Rank 1 is the hero to take first.
 */
export type TakeOrderSeat = {
  hero: string;
  player: string | null;
  role: string;
};

export type TakeOrderFacts = {
  /** Still-available heroes this player is comfortable on. Unknown players stay flexible. */
  legalHeroes: (player: string | null) => number;
  /** High in the other side's Storm League pool. */
  opponentPlays: (hero: string) => boolean;
  /** The other side picks before this side's next lock window is over. */
  opponentActsBeforeNextWindow: boolean;
  /** This side still has a ban after the next pick window. */
  banAfterNextPick: boolean;
  /** Picks the other side has not locked yet. */
  opponentPicksLeft: number;
  /** They still play a hard answer to this hero. */
  counterOpen: (hero: string) => boolean;
  /** This hero is the setup half of a pair that is also still open. */
  setupFor: (hero: string, others: readonly string[]) => boolean;
  /** This hero has a real pair that is also still open. */
  pairedWith: (hero: string, others: readonly string[]) => boolean;
  /** The next window for this side locks two heroes. */
  doubleWindow: boolean;
  /** Strong here because of the map, not because it is strong everywhere. */
  mapOnly: (hero: string) => boolean;
};

type Actor = "our" | "their";

function sideOf(
  step: { side: "fp" | "sp" },
  weFirst: boolean,
): Actor {
  return step.side === "fp" ? (weFirst ? "our" : "their") : weFirst ? "their" : "our";
}

function nextPickIndex(
  stepIndex: number,
  weFirst: boolean,
  actor: Actor,
): number {
  for (let index = Math.max(0, stepIndex); index < DRAFT_ORDER.length; index++) {
    const step = DRAFT_ORDER[index];
    if (step?.kind === "pick" && sideOf(step, weFirst) === actor) return index;
  }
  return -1;
}

/** They can take a shared hero before this side's following window. */
export function opponentActsBeforeNextWindow(
  stepIndex: number,
  weFirst: boolean,
  actor: Actor,
): boolean {
  const first = nextPickIndex(stepIndex, weFirst, actor);
  if (first < 0) return false;
  for (let index = Math.max(0, stepIndex); index < first; index++) {
    const step = DRAFT_ORDER[index];
    if (step?.kind === "pick" && sideOf(step, weFirst) !== actor) return true;
  }
  const windowEnd = isDoublePickWindow(DRAFT_ORDER, first) ? first + 1 : first;
  const later = nextPickIndex(windowEnd + 1, weFirst, actor);
  if (later < 0) return false;
  for (let index = windowEnd + 1; index < later; index++) {
    const step = DRAFT_ORDER[index];
    if (step?.kind === "pick" && sideOf(step, weFirst) !== actor) return true;
  }
  return false;
}

/** A ban is still coming after the next pick, so showing a hero is less costly. */
export function banAfterNextPick(
  stepIndex: number,
  weFirst: boolean,
  actor: Actor,
): boolean {
  const first = nextPickIndex(stepIndex, weFirst, actor);
  if (first < 0) return false;
  const windowEnd = isDoublePickWindow(DRAFT_ORDER, first) ? first + 1 : first;
  for (let index = windowEnd + 1; index < DRAFT_ORDER.length; index++) {
    const step = DRAFT_ORDER[index];
    if (step?.kind === "ban" && sideOf(step, weFirst) === actor) return true;
  }
  return false;
}

export function nextWindowIsDouble(
  stepIndex: number,
  weFirst: boolean,
  actor: Actor,
): boolean {
  const first = nextPickIndex(stepIndex, weFirst, actor);
  return first >= 0 && isDoublePickWindow(DRAFT_ORDER, first);
}

function gamesOf(row: { games: number; sources?: { stormLeague?: { games?: number } } }): number {
  return Math.max(row.games, row.sources?.stormLeague?.games ?? 0);
}

function opponentPlaysHero(
  roster: readonly PlayerScout[],
  hero: string,
): boolean {
  const key = heroKey(hero);
  for (const player of roster) {
    const top = [...player.topHeroes]
      .map((row) => ({ hero: row.hero, games: gamesOf(row) }))
      .sort((a, b) => b.games - a.games || a.hero.localeCompare(b.hero))
      .slice(0, 4);
    if (top.some((row) => heroKey(row.hero) === key && row.games >= 8)) return true;
  }
  return false;
}

function legalHeroCount(
  roster: readonly PlayerScout[],
  player: string | null,
  gone: ReadonlySet<string>,
): number {
  const scout = resolvePlayerScout([...roster], player);
  if (!scout) return 4;
  const open = scout.topHeroes.filter(
    (row) => gamesOf(row) > 0 && !gone.has(heroKey(row.hero)),
  );
  return open.length;
}

function reveals(hero: string): boolean {
  return heroTags(hero).some((tag) => tag === "dive" || tag === "global" || tag === "split");
}

function synergyEdge(
  table: DraftMetaTable | null | undefined,
  hero: string,
  other: string,
): number {
  const meta = heroDraftMeta(table, hero);
  const direct = meta.synergiesWith.find((row) => heroKey(row.hero) === heroKey(other));
  if (direct && direct.games > 0) return direct.deltaPp;
  const sample = meta.allySamples.find((row) => heroKey(row.hero) === heroKey(other));
  return sample && sample.games > 0 ? sample.deltaPp : 0;
}

function hasPair(
  table: DraftMetaTable | null | undefined,
  hero: string,
  others: readonly string[],
): boolean {
  return others.some((other) => synergyEdge(table, hero, other) >= 3);
}

function isSetupPiece(
  table: DraftMetaTable | null | undefined,
  hero: string,
  others: readonly string[],
): boolean {
  const role = heroRole(hero);
  const enabler = role === "Tank" || role === "Healer" || role === "Support" || !reveals(hero);
  for (const other of others) {
    if (synergyEdge(table, hero, other) < 3 && synergyEdge(table, other, hero) < 3) continue;
    if (enabler && reveals(other)) return true;
  }
  return false;
}

function counterStillOpen(
  table: DraftMetaTable | null | undefined,
  hero: string,
  opponents: readonly PlayerScout[],
  gone: ReadonlySet<string>,
): boolean {
  const meta = heroDraftMeta(table, hero);
  return meta.counteredBy.some(
    (edge) =>
      edge.deltaPp >= 2 &&
      !gone.has(heroKey(edge.hero)) &&
      opponentPlaysHero(opponents, edge.hero),
  );
}

function mapSpecialist(
  table: DraftMetaTable | null | undefined,
  hero: string,
  map: string | null,
): boolean {
  if (!map) return false;
  const want = map.toLowerCase();
  return heroDraftMeta(table, hero).mapStrong.some(
    (row) => row.map.toLowerCase() === want && row.deltaPp >= 3,
  );
}

export function takeOrderFacts(args: {
  actor: Actor;
  actors: readonly PlayerScout[];
  opponents: readonly PlayerScout[];
  gone: ReadonlySet<string>;
  table?: DraftMetaTable | null;
  map: string | null;
  stepIndex: number;
  weFirst: boolean;
  opponentPicksLeft: number;
}): TakeOrderFacts {
  const table = args.table ?? null;
  return {
    legalHeroes: (player) => legalHeroCount(args.actors, player, args.gone),
    opponentPlays: (hero) => opponentPlaysHero(args.opponents, hero),
    opponentActsBeforeNextWindow: opponentActsBeforeNextWindow(
      args.stepIndex,
      args.weFirst,
      args.actor,
    ),
    banAfterNextPick: banAfterNextPick(args.stepIndex, args.weFirst, args.actor),
    opponentPicksLeft: args.opponentPicksLeft,
    counterOpen: (hero) => counterStillOpen(table, hero, args.opponents, args.gone),
    setupFor: (hero, others) => isSetupPiece(table, hero, others),
    pairedWith: (hero, others) => hasPair(table, hero, others),
    doubleWindow: nextWindowIsDouble(args.stepIndex, args.weFirst, args.actor),
    mapOnly: (hero) => mapSpecialist(table, hero, args.map),
  };
}

function urgency(
  seat: TakeOrderSeat,
  seats: readonly TakeOrderSeat[],
  facts: TakeOrderFacts,
): number {
  const others = seats
    .filter((other) => heroKey(other.hero) !== heroKey(seat.hero))
    .map((other) => other.hero);
  let score = 0;
  const legal = facts.legalHeroes(seat.player);
  if (legal <= 1) score += 100;
  else if (legal >= 5) score -= 15;

  if (facts.opponentPlays(seat.hero) && facts.opponentActsBeforeNextWindow) score += 80;

  const required =
    seat.role === "Tank" ||
    seat.role === "Healer" ||
    seat.role === "Offlane" ||
    seat.role === "Ranged";
  const sameRole = seats.filter((other) => other.role === seat.role).length;
  if (required && sameRole === 1 && facts.opponentActsBeforeNextWindow) score += 50;

  if (reveals(seat.hero)) {
    if (facts.counterOpen(seat.hero) && !facts.banAfterNextPick) score -= 70;
    else if (facts.banAfterNextPick) score -= 10;
  }

  if (facts.counterOpen(seat.hero) && facts.opponentPicksLeft > 0) score -= 40;

  const paired = facts.pairedWith(seat.hero, others);
  const setup = facts.setupFor(seat.hero, others);
  if (paired && facts.doubleWindow) score += setup ? 55 : 40;
  else if (setup) score -= 45;

  if (!reveals(seat.hero) && !facts.counterOpen(seat.hero)) score += 15;
  if (seat.role === "Flex") score -= 20;

  if (facts.mapOnly(seat.hero) && facts.opponentPlays(seat.hero)) score += 35;
  else if (facts.mapOnly(seat.hero)) score -= 10;

  return score;
}

/** Ranks stay on the input seats. 1 is first to lock. */
export function rankTakeOrder<T extends TakeOrderSeat>(
  seats: readonly T[],
  facts: TakeOrderFacts,
): (T & { order: number })[] {
  const scored = seats.map((seat) => ({ seat, score: urgency(seat, seats, facts) }));
  const placed = [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      a.seat.hero.localeCompare(b.seat.hero) ||
      (a.seat.player ?? "").localeCompare(b.seat.player ?? ""),
  );
  const orderOf = new Map(placed.map((row, index) => [row.seat, index + 1]));
  return seats.map((seat) => ({ ...seat, order: orderOf.get(seat) ?? seats.length }));
}

/**
 * Number a suggestion grid.
 * `eachRow` ranks every lineup on its own. Otherwise only the first face of each column is the hero they still have to take.
 */
export function orderSuggestedColumns<T extends TakeOrderSeat>(
  columns: readonly (readonly T[] | null)[],
  facts: TakeOrderFacts,
  eachRow: boolean,
): (Array<T & { order?: number }> | null)[] {
  const stamped: (Array<T & { order?: number }> | null)[] = columns.map((column) =>
    column ? column.map((seat) => ({ ...seat })) : null,
  );
  const rows = eachRow ? Math.max(0, ...stamped.map((column) => column?.length ?? 0)) : 1;
  for (let row = 0; row < rows; row++) {
    const picked = stamped.flatMap((column) => {
      const seat = column?.[row];
      return seat ? [seat] : [];
    });
    if (picked.length < 2 && !eachRow) {
      if (picked[0]) picked[0].order = 1;
      continue;
    }
    const ranked = rankTakeOrder(picked, facts);
    ranked.forEach((seat, index) => {
      const target = picked[index];
      if (target) target.order = seat.order;
    });
  }
  return stamped;
}
