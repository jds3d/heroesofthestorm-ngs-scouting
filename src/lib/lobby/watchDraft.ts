import { heroKey } from "@/lib/scoring/heroMeta";
import {
  EMPTY_LIVE_DRAFT,
  acceptLockedPlates,
  acceptPlatePicks,
  banFrameKeepsLockedPicks,
  banSideFromSplash,
  bannerTurn,
  bansFromHexFaces,
  draftFromPartyQueue,
  firstBanSideFromStatus,
  firstPickFromBanBoard,
  firstPickFromPickingSlots,
  fitObservedPickOrder,
  guessWeFirst,
  inferFirstPick,
  mapFromTitle,
  matchPortrait,
  nextTurn,
  ocrFold,
  openSeatPlayers,
  partyNamesFromText,
  pickCountsFit,
  pickSlotsFromPlateLocks,
  plateLockPhase,
  dropShownPlates,
  shownHoverLocks,
  portraitIsLocked,
  pruneHoverPicks,
  resolveFirstPick,
  resolveLiveTurn,
  sideFromBannerColor,
  sideFromStatus,
  sideFromTeamSplash,
  playerFold,
  snapToRoster,
  settleSharedPicks,
  takeNewLocks,
  turnFromOcr,
  type LiveDraft,
  type OpenTurn,
  type PlateFill,
} from "@/lib/lobby/screenLobby";

/** One side slot after the watcher has sampled its plate and portrait. */
export type WatchSlot = {
  hero: string;
  player: string | null;
  slot: number;
  plate: PlateFill;
  faceFilled: boolean;
  ally: boolean;
  slotPicking?: boolean;
};

/** What one captured draft frame has already read. The watcher turns this into a board. */
export type WatchFrame = {
  left: string[];
  right: string[];
  leftSlots: WatchSlot[];
  rightSlots: WatchSlot[];
  leftShown: string[];
  rightShown: string[];
  leftReads: { hero: string | null; player: string | null }[];
  rightReads: { hero: string | null; player: string | null }[];
  leftPicking: boolean;
  rightPicking: boolean;
  leftPickingFlags: boolean[];
  rightPickingFlags: boolean[];
};

export type WatchHex = {
  filled: boolean;
  passed: boolean;
  hero: string | null;
  vector: number[] | null;
};

/** State the watcher carries from the previous frame. */
export type WatchMemory = {
  draft: LiveDraft;
  announced: string[];
  picksStarted: boolean;
  openTurn: OpenTurn | null;
  ourColumn: string[];
  theirColumn: string[];
  /** Player name already accepted for each of our five seats. A later misread does not replace it. */
  ourSeatNames: (string | null)[];
  theirSeatNames: (string | null)[];
  ourRoster: string[];
};

export function emptyWatchMemory(): WatchMemory {
  return {
    draft: {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: [],
      theirPicks: [],
      ourBans: [],
      theirBans: [],
    },
    announced: [],
    picksStarted: false,
    openTurn: null,
    ourColumn: [],
    theirColumn: [],
    ourSeatNames: [],
    theirSeatNames: [],
    ourRoster: [],
  };
}

function nameOnRoster(name: string, roster: readonly string[]): boolean {
  const folded = playerFold(name);
  if (!folded) return false;
  return roster.some((tag) => playerFold(tag) === folded);
}

/**
 * Keep the name already read for a seat. A different name replaces it only
 * when the new read is on the roster and the one we had is not.
 */
export function mergeSeatNames(
  previous: readonly (string | null)[],
  reads: readonly { player: string | null }[],
  roster: readonly string[],
): (string | null)[] {
  const count = Math.max(5, previous.length, reads.length);
  const names: (string | null)[] = [];
  for (let index = 0; index < count; index++) {
    const prior = previous[index] ?? null;
    const raw = reads[index]?.player?.trim() || null;
    const next = raw ? snapToRoster(raw, roster) : null;
    if (!next) {
      names.push(prior);
      continue;
    }
    if (!prior || playerFold(prior) === playerFold(next)) {
      names.push(nameOnRoster(next, roster) ? next : (prior ?? next));
      continue;
    }
    const priorOnRoster = nameOnRoster(prior, roster);
    const nextOnRoster = nameOnRoster(next, roster);
    names.push(nextOnRoster && !priorOnRoster ? next : prior);
  }
  return names;
}

function columnFromSeats(names: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!name) continue;
    if (out.some((have) => playerFold(have) === playerFold(name))) continue;
    out.push(name);
  }
  return out;
}

export type WatchedDraft = {
  draft: LiveDraft;
  memory: WatchMemory;
  inParty: boolean;
  leftLocked: { hero: string; player: string | null; slot: number }[];
  rightLocked: { hero: string; player: string | null; slot: number }[];
};

/**
 * The live watcher's draft update. Screenshot tests call this with a still
 * frame so they exercise the same picks, bans, and order as the screen watch.
 */
export function nextWatchedDraft(args: {
  memory: WatchMemory;
  frame: WatchFrame | null;
  titleText: string;
  statusText: string;
  centerText: string;
  leftHexes: readonly WatchHex[];
  rightHexes: readonly WatchHex[];
  roster: readonly string[];
  faces?: readonly { hero: string; vector: number[] }[];
  partyText?: string;
}): WatchedDraft {
  const usOnLeft = true;
  const faces = args.faces ?? [];
  const lobby = args.frame;
  let announced = [...args.memory.announced];
  let picksStarted = args.memory.picksStarted;
  let ourColumn = [...args.memory.ourColumn];
  let theirColumn = [...args.memory.theirColumn];
  let ourSeatNames = [...(args.memory.ourSeatNames ?? [])];
  let theirSeatNames = [...(args.memory.theirSeatNames ?? [])];
  const draft = args.memory.draft;
  const banner = bannerTurn(`${args.centerText}\n${args.statusText}`);
  const centerRead = turnFromOcr(args.centerText, args.roster);
  if (banner.phase) centerRead.phase = banner.phase;
  if ((centerRead.phase ?? banner.phase) === "pick" && centerRead.hero) {
    const last = announced[announced.length - 1];
    if (!last || heroKey(last) !== heroKey(centerRead.hero)) announced.push(centerRead.hero);
  }
  const knownNames = [...(lobby?.left ?? []), ...(lobby?.right ?? []), ...args.roster];
  const snapPlate = (locks: { hero: string; player: string | null; slot: number }[]) =>
    locks.map((lock) => ({
      hero: lock.hero,
      player: lock.player ? snapToRoster(lock.player, knownNames) : null,
      slot: lock.slot,
    }));
  const banPhase = banner.phase === "ban" || centerRead.phase === "ban";
  const bannerPhase = banPhase ? "ban" : (banner.phase ?? centerRead.phase ?? null);
  // "BLUE BAN" is also the second ban round. Once a ban hex is already filled,
  // the side plates are locks, not the opening showcase.
  const bansAlreadyOnBoard = [...args.leftHexes, ...args.rightHexes].some(
    (hex) => hex.filled || Boolean(hex.hero),
  );
  const keepCommitted =
    banPhase &&
    (banFrameKeepsLockedPicks(`${args.centerText}\n${args.statusText}`) ||
      bansAlreadyOnBoard);
  const priorLockedPicks = draft.ourPicks.length + draft.theirPicks.length;
  const lockPhase = plateLockPhase({
    bannerPhase,
    picksStarted,
    priorLockedPicks,
  });
  const platePhase = lockPhase ?? bannerPhase;
  const lockedSlots = (rows: WatchSlot[]) =>
    snapPlate(
      rows.filter((row) =>
        portraitIsLocked({
          phase: platePhase,
          keepCommitted: keepCommitted && platePhase === "ban",
          faceFilled: row.faceFilled,
          plate: row.plate,
          ally: row.ally,
          heroOnPlate: true,
          slotPicking: row.slotPicking,
        }),
      ),
    );
  const leftLocked = lockedSlots(lobby?.leftSlots ?? []);
  const rightLocked = lockedSlots(lobby?.rightSlots ?? []);
  const slotted = acceptLockedPlates({
    lockedCount: leftLocked.length + rightLocked.length,
    lockPhase,
    keepCommitted: keepCommitted && platePhase === "ban",
  });
  if (slotted) picksStarted = true;
  if (!banPhase && banner.phase === "pick") picksStarted = true;
  const allowPicks =
    slotted ||
    acceptPlatePicks({ banPhase, picksStarted }) ||
    (lockPhase === "pick" && picksStarted);
  const ourShown = usOnLeft ? lobby?.leftShown ?? [] : lobby?.rightShown ?? [];
  const theirShown = usOnLeft ? lobby?.rightShown ?? [] : lobby?.leftShown ?? [];
  const ourPruned = pruneHoverPicks(draft.ourPicks, draft.ourPickPlayers, ourShown);
  const theirPruned = pruneHoverPicks(draft.theirPicks, draft.theirPickPlayers, theirShown);
  const ourLocked = allowPicks
    ? takeNewLocks(
        ourPruned.heroes,
        usOnLeft ? leftLocked : rightLocked,
        announced,
        ourPruned.players,
      )
    : null;
  const theirLocked = allowPicks
    ? takeNewLocks(
        theirPruned.heroes,
        usOnLeft ? rightLocked : leftLocked,
        announced,
        theirPruned.players,
      )
    : null;
  let ourPicks = ourLocked ? ourLocked.heroes : [...draft.ourPicks];
  let theirPicks = theirLocked ? theirLocked.heroes : [...draft.theirPicks];
  if (lobby) {
    const ourReadsNow = usOnLeft ? lobby.leftReads : lobby.rightReads;
    const theirReadsNow = usOnLeft ? lobby.rightReads : lobby.leftReads;
    ourSeatNames = mergeSeatNames(ourSeatNames, ourReadsNow, args.roster);
    theirSeatNames = mergeSeatNames(theirSeatNames, theirReadsNow, args.roster);
    const ourListed = columnFromSeats(ourSeatNames);
    const theirListed = columnFromSeats(theirSeatNames);
    if (ourListed.length >= 3) ourColumn = ourListed;
    if (theirListed.length >= 3) theirColumn = theirListed;
  }
  const turn = nextTurn(
    args.memory.openTurn,
    centerRead.phase ? centerRead : { ...centerRead, phase: banner.phase },
    (player) => {
      const fold = ocrFold(player);
      if (fold === ocrFold("HuckIt")) return "our";
      if (ourColumn.some((name) => ocrFold(name) === fold)) return "our";
      if (args.memory.ourRoster.some((name) => ocrFold(name) === fold)) return "our";
      if (theirColumn.some((name) => ocrFold(name) === fold)) return "their";
      return null;
    },
    banner.color
      ? sideFromBannerColor(banner.color, usOnLeft)
      : banSideFromSplash(`${args.centerText}\n${args.statusText}`),
  );
  const namedHexes = (hexes: readonly WatchHex[]) =>
    hexes.map(
      (hex) =>
        hex.hero ?? (hex.vector && faces.length ? matchPortrait(hex.vector, faces) : null),
    );
  const ourHexes = usOnLeft ? args.leftHexes : args.rightHexes;
  const theirHexes = usOnLeft ? args.rightHexes : args.leftHexes;
  const ourBans = bansFromHexFaces(
    namedHexes(ourHexes),
    ourHexes.map((hex) => hex.filled),
    draft.ourBans,
    ourHexes.map((hex) => hex.passed),
  );
  const theirBans = bansFromHexFaces(
    namedHexes(theirHexes),
    theirHexes.map((hex) => hex.filled),
    draft.theirBans,
    theirHexes.map((hex) => hex.passed),
  );
  const phase = banner.phase ?? centerRead.phase ?? (slotted ? "pick" : draft.phase);
  if (
    banPhase &&
    !picksStarted &&
    !slotted &&
    draft.ourPicks.length + draft.theirPicks.length === 0
  ) {
    ourPicks = [];
    theirPicks = [];
  }
  const fromBanBoard = firstPickFromBanBoard(ourBans, theirBans);
  let firstPick = fromBanBoard ?? draft.firstPick;
  if (!firstPick && ourPicks.length + theirPicks.length === 0 && lobby) {
    const fromSlotsSide = firstPickFromPickingSlots({
      leftPicking: lobby.leftPicking,
      rightPicking: lobby.rightPicking,
      usOnLeft,
    });
    if (fromSlotsSide) firstPick = fromSlotsSide;
  }
  if (
    !firstPick &&
    ourBans.length + theirBans.length + ourPicks.length + theirPicks.length === 0
  ) {
    const fromStatus = firstBanSideFromStatus(`${args.statusText}\n${args.centerText}`);
    if (fromStatus) firstPick = fromStatus;
  }
  const turnSide =
    turn.open?.side ??
    (banner.color ? sideFromBannerColor(banner.color, usOnLeft) : null) ??
    sideFromStatus(`${args.statusText}\n${args.centerText}`) ??
    sideFromTeamSplash(`${args.centerText}\n${args.statusText}`);
  if (!firstPick && turn.open?.phase === "ban") {
    firstPick = turn.open.side === "our" ? "us" : "them";
  }
  if (
    !firstPick &&
    banner.color &&
    banner.phase &&
    ourPicks.length + theirPicks.length === 0 &&
    ourBans.length + theirBans.length === 0
  ) {
    const side = sideFromBannerColor(banner.color, usOnLeft);
    firstPick = side === "our" ? "us" : "them";
  }
  if (ourPicks.length + theirPicks.length === 0) {
    if (ourBans.length > 0 && theirBans.length === 0) firstPick = "us";
    else if (theirBans.length > 0 && ourBans.length === 0) firstPick = "them";
  }
  if (firstPick === "them" && theirPicks.length === 0 && ourPicks.length > 0) {
    firstPick = "us";
  }
  if (ourPicks.length + theirPicks.length > 0) {
    const usFits = pickCountsFit(true, ourPicks.length, theirPicks.length);
    const themFits = pickCountsFit(false, ourPicks.length, theirPicks.length);
    if (usFits && !themFits) {
      firstPick = "us";
    } else if (themFits && !usFits) {
      firstPick = "them";
    } else if (!usFits && !themFits) {
      firstPick = null;
    } else {
      const inferred = inferFirstPick({
        ourPicks: ourPicks.length,
        theirPicks: theirPicks.length,
        phase,
        turnSide,
      });
      const currentFits = firstPick
        ? pickCountsFit(firstPick === "us", ourPicks.length, theirPicks.length)
        : false;
      if (inferred && (!firstPick || !currentFits)) firstPick = inferred;
    }
  }
  let map = draft.map;
  if (!map) map = mapFromTitle(args.titleText);
  const ourReads = usOnLeft ? lobby?.leftReads ?? [] : lobby?.rightReads ?? [];
  const theirReads = usOnLeft ? lobby?.rightReads ?? [] : lobby?.leftReads ?? [];
  const lockedFlags = (
    ally: boolean,
    reads: readonly { hero: string | null; player: string | null }[],
    slots: readonly WatchSlot[],
    pickingFlags: readonly boolean[],
  ) =>
    reads.map((read, index) => {
      const row = slots.find((slot) => slot.slot === index);
      return portraitIsLocked({
        phase: platePhase,
        keepCommitted: keepCommitted && platePhase === "ban",
        faceFilled: row?.faceFilled ?? false,
        plate: row?.plate,
        ally,
        heroOnPlate: Boolean(read?.hero),
        slotPicking: pickingFlags[index] ?? row?.slotPicking ?? false,
      });
    });
  const ourOpenPlayers =
    lobby && ourSeatNames.some(Boolean)
      ? openSeatPlayers(
          ourSeatNames.map((player) => ({ player })),
          lockedFlags(
            true,
            ourReads,
            usOnLeft ? lobby.leftSlots : lobby.rightSlots,
            usOnLeft ? lobby.leftPickingFlags : lobby.rightPickingFlags,
          ),
        )
      : draft.ourOpenPlayers ?? [];
  const theirOpenPlayers =
    lobby && theirSeatNames.some(Boolean)
      ? openSeatPlayers(
          theirSeatNames.map((player) => ({ player })),
          lockedFlags(
            false,
            theirReads,
            usOnLeft ? lobby.rightSlots : lobby.leftSlots,
            usOnLeft ? lobby.rightPickingFlags : lobby.leftPickingFlags,
          ),
        )
      : draft.theirOpenPlayers ?? [];
  let ourPickPlayers = ourLocked?.players ?? draft.ourPickPlayers;
  let theirPickPlayers = theirLocked?.players ?? draft.theirPickPlayers;
  const ourHover = dropShownPlates(
    ourPicks,
    ourPickPlayers,
    ourReads,
    usOnLeft ? (lobby?.leftSlots ?? []) : (lobby?.rightSlots ?? []),
  );
  ourPicks = ourHover.heroes;
  ourPickPlayers = ourHover.players;
  const turnPhase =
    phase === "ban" || phase === "pick"
      ? phase
      : platePhase === "ban" || platePhase === "pick"
        ? platePhase
        : null;
  const liveTurn = resolveLiveTurn({
    phase: turnPhase,
    leftPicking: lobby?.leftPicking ?? false,
    rightPicking: lobby?.rightPicking ?? false,
    usOnLeft,
    bannerSide: turnSide,
    openTurn: turn.open,
    ourOpenPlayers,
    theirOpenPlayers,
  });
  const weFirstGuess =
    firstPick === "us" || firstPick === "them"
      ? firstPick === "us"
      : guessWeFirst({
          firstPick,
          ourBans,
          theirBans,
          ourPicks,
          theirPicks,
          ourPickPlayers,
          theirPickPlayers,
          phase,
          turn: liveTurn,
          map,
        });
  const shared = settleSharedPicks({
    ourPicks,
    theirPicks,
    ourPlayers: ourPickPlayers,
    theirPlayers: theirPickPlayers,
    ourReads,
    theirReads,
    ourSlots: usOnLeft ? (lobby?.leftSlots ?? []) : (lobby?.rightSlots ?? []),
    theirSlots: usOnLeft ? (lobby?.rightSlots ?? []) : (lobby?.leftSlots ?? []),
  });
  ourPicks = shared.ourPicks;
  theirPicks = shared.theirPicks;
  ourPickPlayers = shared.ourPlayers;
  theirPickPlayers = shared.theirPlayers;
  const ourLockRows = usOnLeft ? leftLocked : rightLocked;
  const theirLockRows = usOnLeft ? rightLocked : leftLocked;
  const fittedPicks = fitObservedPickOrder(
    {
      weFirst: weFirstGuess,
      firstPick,
      phase,
      map,
      ourBans,
      theirBans,
      ourPicks,
      theirPicks,
      ourPickPlayers,
      theirPickPlayers,
    },
    {
      our: pickSlotsFromPlateLocks(ourPicks, ourLockRows),
      their: pickSlotsFromPlateLocks(theirPicks, theirLockRows),
    },
  );
  ourPicks = fittedPicks.ourPicks;
  theirPicks = fittedPicks.theirPicks;
  ourPickPlayers = fittedPicks.ourPickPlayers;
  theirPickPlayers = fittedPicks.theirPickPlayers;
  const takenHeroes = new Set([...ourPicks, ...theirPicks].map((hero) => heroKey(hero)));
  const takenPlayers = new Set(ourPickPlayers.map((name) => playerFold(name)).filter(Boolean));
  const ourHovers =
    platePhase === "pick" || picksStarted
      ? shownHoverLocks(
          ourReads,
          usOnLeft ? (lobby?.leftSlots ?? []) : (lobby?.rightSlots ?? []),
          [...args.roster, ...ourColumn],
        ).filter((hover) => {
          if (!hover.hero || takenHeroes.has(heroKey(hover.hero))) return false;
          const who = playerFold(hover.player);
          return !who || !takenPlayers.has(who);
        })
      : [];
  const resolvedFirst =
    resolveFirstPick({
      firstPick,
      ourBans,
      theirBans,
      ourPicks,
      theirPicks,
      phase,
      turn: liveTurn,
      ourPickSlots: pickSlotsFromPlateLocks(ourPicks, ourLockRows),
      theirPickSlots: pickSlotsFromPlateLocks(theirPicks, theirLockRows),
    }) ?? firstPick;
  const partyNames = partyNamesFromText(args.partyText ?? "").map((name) =>
    snapToRoster(name, args.roster),
  );
  const inParty =
    partyNames.length >= 3 && ourPicks.length + theirPicks.length === 0 && ourColumn.length < 3;
  if (inParty) {
    ourColumn = [];
    theirColumn = [];
    ourSeatNames = [];
    theirSeatNames = [];
  }
  const nextDraft: LiveDraft = inParty
    ? draftFromPartyQueue(partyNames)
    : {
        ourPicks,
        theirPicks,
        ourPickPlayers,
        theirPickPlayers,
        ourOpenPlayers,
        theirOpenPlayers,
        ourHovers,
        ourBans,
        theirBans,
        firstPick: resolvedFirst,
        phase,
        turn: liveTurn,
        map,
      };
  return {
    draft: nextDraft,
    inParty,
    leftLocked,
    rightLocked,
    memory: {
      draft: nextDraft,
      announced,
      picksStarted,
      openTurn: turn.open,
      ourColumn,
      theirColumn,
      ourSeatNames,
      theirSeatNames,
      ourRoster: [...args.memory.ourRoster],
    },
  };
}
