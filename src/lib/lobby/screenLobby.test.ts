import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng } from "@/lib/lobby/pngImage";
import {
  NO_BAN,
  UNSEEN_BAN,
  actionsFromObserved,
  watchHistoryNeedsReplace,
  inferFirstPick,
  firstPickFromObservedBoard,
  fitObservedPickOrder,
  isDraftSideKnown,
  pickCountsFit,
  resolveFirstPick,
  pickingFlagsBySlot,
  resolveLiveTurn,
  watchStepIndexForTurn,
  nextOurStepIndex,
  bannerTurn,
  colorfulFraction,
  firstBanSideFromStatus,
  openSeatPlayers,
  reorderOurPicksForDraftZip,
  portraitFilled,
  readSlotPlate,
  readsBySlot,
  sideFromStatus,
  nextBanSide,
  banSideFromSplash,
  acceptLockedPlates,
  acceptPlatePicks,
  banFrameKeepsLockedPicks,
  openingTeamBanCard,
  plateLockPhase,
  shownBanSide,
  matchLobbyToRosters,
  sideFromBannerColor,
  heroFromPlateText,
  heroOnPlate,
  columnShowsPicking,
  firstPickFromPickingSlots,
  locksFromOcrLines,
  pickingPhaseFromColumns,
  heroesFromColumn,
  nameFromPlate,
  namesFromOcrLines,
  draftLobbyLikelyOnFrame,
  liveDraftBoardFull,
  bothSidesPickedFive,
  draftShortOfPicks,
  EMPTY_LIVE_DRAFT,
  draftLobbySeen,
  mapFromTitle,
  menuScreenSeen,
  watchPhase,
  namesFromColumn,
  draftFromPartyQueue,
  isPartyMedalName,
  partyNamesFromText,
  nextTurn,
  opponentColumn,
  bansFromStrip,
  bansFromFilledHexes,
  plateFill,
  banHexFilled,
  bansFromHexFaces,
  faceSignature,
  nearestFace,
  portraitVector,
  matchPortrait,
  acceptPortraitExample,
  portraitScore,
  platesForLines,
  dropShownLocks,
  pruneHoverPicks,
  draftHeroList,
  sideFromTeamSplash,
  borderLooksLocked,
  borderLooksLockedSamples,
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  portraitIsLocked,
  portraitTeamRim,
  rememberHeroes,
  playerFromSlotText,
  takeNewLocks,
  rosterTagsForLobby,
  rosterTagsPresent,
  snapToRoster,
  turnFromOcr,
} from "./screenLobby";

describe("reorderOurPicksForDraftZip", () => {
  it("puts Lunara before Tyrael when the banner lists Tyrael higher", () => {
    const row = reorderOurPicksForDraftZip(
      ["Whitemane", "Falstad", "Tyrael", "Lunara"],
      ["HuckIt", "LiuMei", "Kalel", "Lochen"],
    );
    expect(row.heroes).toEqual(["Whitemane", "Falstad", "Lunara", "Tyrael"]);
  });
});

describe("resolveLiveTurn", () => {
  it("prefers a PICKING column over lock-count draft order", () => {
    expect(
      resolveLiveTurn({
        phase: "pick",
        leftPicking: false,
        rightPicking: true,
        usOnLeft: true,
        bannerSide: null,
        openTurn: null,
        ourOpenPlayers: [],
        theirOpenPlayers: ["Undead"],
      }),
    ).toEqual({ side: "their", kind: "pick" });
  });
});

describe("watchStepIndexForTurn", () => {
  it("steps forward to their last pick when the screen says it is their turn", () => {
    expect(
      watchStepIndexForTurn(14, true, { side: "their", kind: "pick" }),
    ).toBe(15);
  });
});

describe("nextOurStepIndex", () => {
  it("keeps counseling our 5th pick while they are on their last pick", () => {
    expect(nextOurStepIndex(14, true)).toBe(14);
    expect(nextOurStepIndex(15, true)).toBeNull();
  });
});

describe("pickingFlagsBySlot", () => {
  it("marks only the seat whose plate says PICKING", () => {
    expect(
      pickingFlagsBySlot([
        { text: "Chen", top: 10 },
        { text: "PICKING", top: 410 },
        { text: "Anduin", top: 420 },
      ]),
    ).toEqual([false, true, false, false, false]);
  });
});

describe("firstPickFromObservedBoard", () => {
  it("reads Battlefield bans when firstPick was never pinned", () => {
    expect(
      firstPickFromObservedBoard({
        firstPick: null,
        ourBans: [NO_BAN, "Xal'atath", NO_BAN],
        theirBans: ["Qhira", NO_BAN, "Johanna"],
        ourPicks: [],
        theirPicks: [],
        phase: "ban",
        turn: null,
      }),
    ).toBe("us");
  });

  it("resolves Haunted Mines mid-ban from turn when opening bans tie", () => {
    expect(
      resolveFirstPick({
        firstPick: null,
        ourBans: ["Qhira", "Falstad"],
        theirBans: ["Xal'atath", "Kel'Thuzad"],
        ourPicks: [],
        theirPicks: [],
        phase: "ban",
        turn: { side: "our", kind: "ban" },
      }),
    ).toBe("them");
    expect(
      isDraftSideKnown({
        ...EMPTY_LIVE_DRAFT,
        ourBans: ["Qhira", "Falstad"],
        theirBans: ["Xal'atath", "Kel'Thuzad"],
        phase: "ban",
        turn: { side: "our", kind: "ban" },
      }),
    ).toBe(true);
  });

  it("breaks a 5v5 pick tie with draft-order fit", () => {
    expect(
      resolveFirstPick({
        firstPick: null,
        ourBans: ["Cassia", "Chen", "Sylvanas"],
        theirBans: ["Anub'arak", "Chromie", "Tyrande"],
        ourPicks: ["Johanna", "Rexxar", "Tychus", "Junkrat", "Kharazim"],
        theirPicks: [
          "Sgt. Hammer",
          "Lt. Morales",
          "Artanis",
          "Diablo",
          "Zul'jin",
        ],
        phase: "pick",
        turn: null,
      }),
    ).toBe("us");
  });

  it("resolves Cursed Hollow mid-draft from 4v3 pick counts", () => {
    expect(
      resolveFirstPick({
        firstPick: "us",
        ourBans: ["Johanna", "Anduin", "Dehaka"],
        theirBans: ["Qhira", "Xal'atath", "Stitches"],
        ourPicks: ["Rehgar", "Alarak", "Tyrael", "Sylvanas"],
        theirPicks: ["Falstad", "Brightwing", "Greymane"],
        phase: "pick",
        turn: { side: "their", kind: "pick" },
      }),
    ).toBe("them");
  });

  it("infers first pick from uneven pick counts", () => {
    expect(
      resolveFirstPick({
        firstPick: null,
        ourBans: ["Qhira", "Falstad"],
        theirBans: ["Xal'atath", "Kel'Thuzad"],
        ourPicks: ["Johanna", "Hanzo"],
        theirPicks: ["Mal'Ganis", "Auriel", "Dehaka"],
        phase: "pick",
        turn: { side: "our", kind: "pick" },
      }),
    ).toBe("them");
  });

  it("keeps every locked enemy hero when reordering three picks for draft fit", () => {
    const fitted = fitObservedPickOrder(
      {
        weFirst: false,
        firstPick: "them",
        phase: "pick",
        map: "Battlefield of Eternity",
        ourBans: ["Qhira", "Johanna", "Falstad"],
        theirBans: ["Xal'atath", "Abathur", "Artanis"],
        ourPicks: ["Whitemane", "Raynor"],
        theirPicks: ["Mal'Ganis", "Kael'thas", "Brightwing"],
        ourPickPlayers: ["a", "b"],
        theirPickPlayers: ["c", "d", "e"],
      },
      { our: [1, 2], their: [0, 1, 3] },
    );
    expect(fitted.theirPicks.sort()).toEqual(
      ["Brightwing", "Kael'thas", "Mal'Ganis"].sort(),
    );
    expect(fitted.ourPicks).toEqual(["Whitemane", "Raynor"]);
  });

  it("overrides a stale ban-board first pick when pick counts only fit one side", () => {
    expect(
      resolveFirstPick({
        firstPick: "us",
        ourBans: ["Qhira", "Falstad"],
        theirBans: ["Xal'atath", "Kel'Thuzad"],
        ourPicks: ["Johanna", "Hanzo"],
        theirPicks: ["Arthas", "Tassadar", "Tracer"],
        phase: "ban",
        turn: { side: "our", kind: "ban" },
      }),
    ).toBe("them");
  });
});

describe("openSeatPlayers", () => {
  it("keeps every unlocked name and drops a player who already locked", () => {
    expect(
      openSeatPlayers(
        [
          { player: "L337" },
          { player: "Dante" },
          { player: "HuckIt" },
          { player: "hiimrick" },
          { player: "Magic" },
        ],
        [true, false, true, false, true],
      ),
    ).toEqual(["Dante", "hiimrick"]);
  });

  it("drops a name that is already on a locked seat", () => {
    expect(
      openSeatPlayers(
        [{ player: "HuckIt" }, { player: "MoJoE" }, { player: "HuckIt" }],
        [true, false, false],
      ),
    ).toEqual(["MoJoE"]);
  });

  it("drops an OCR slip of a player who already locked", () => {
    expect(
      openSeatPlayers(
        [{ player: "Hucklt" }, { player: "HuckIt" }, { player: "MoJoE" }],
        [true, false, false],
      ),
    ).toEqual(["MoJoE"]);
  });
});

describe("draft nameplates", () => {
  const ours = ["Beachyman", "HuckIt", "MoJoE", "MrHustler", "Topgun707"];

  it("reads a side column and drops short OCR scraps", () => {
    const text = "DueMaMoy\nAghs\nvit\nInhumanoids\nMsBells27\nBog";
    expect(namesFromColumn(text)).toEqual([
      "DueMaMoy",
      "Aghs",
      "Inhumanoids",
      "MsBells27",
    ]);
  });

  it("picks the column that is not our five", () => {
    expect(
      opponentColumn(ours, ["DueMaMoy", "Aghs", "Inhumanoids", "MsBells27"], ours),
    ).toEqual(["DueMaMoy", "Aghs", "Inhumanoids", "MsBells27"]);
  });
});

describe("rosterTagsForLobby", () => {
  it("maps five screen names onto roster battletags", () => {
    const roster = [
      { battletag: "Stark#2324" },
      { battletag: "Shuman#1276" },
      { battletag: "Iron#11195" },
      { battletag: "EkeeB#1696" },
      { battletag: "chesslooter#1392" },
    ];
    expect(
      rosterTagsForLobby(["Stark", "chesslooter", "EkeeB", "Iron", "Shuman"], roster),
    ).toEqual([
      "Stark#2324",
      "chesslooter#1392",
      "EkeeB#1696",
      "Iron#11195",
      "Shuman#1276",
    ]);
  });

  it("leaves the lineup alone when a name is not on the roster", () => {
    expect(rosterTagsForLobby(["Stark", "Nope", "EkeeB", "Iron", "Shuman"], [])).toBeNull();
  });

  it("snaps an i/l misread onto the roster battletag", () => {
    expect(snapToRoster("MsBelis27", ["MsBells27#1234"])).toBe("MsBells27");
    const roster = [
      { battletag: "MsBells27#1234" },
      { battletag: "Aghs#1" },
      { battletag: "Ladro#1" },
      { battletag: "Inheritearth#1" },
      { battletag: "RoseeDai#1" },
    ];
    expect(
      rosterTagsForLobby(["MsBelis27", "Aghs", "Ladro", "Inheritearth", "RoseeDai"], roster),
    ).toEqual(["MsBells27#1234", "Aghs#1", "Ladro#1", "Inheritearth#1", "RoseeDai#1"]);
  });
});

describe("draft locks from the screen", () => {
  it("reads hero labels from the side plates", () => {
    const text = "GARROSH\nBeachyman\nXAL'ATATH\nTopgun707\nTHE LOST VIKINGS\nMarcy";
    expect(heroesFromColumn(text)).toEqual(["Garrosh", "Xal'atath", "The Lost Vikings"]);
    expect(namesFromColumn(text)).toEqual(["Beachyman", "Topgun707", "Marcy"]);
    expect(playerFromSlotText("LI-MING\nThomas")).toBe("Thomas");
    expect(playerFromSlotText("Li-Ming Thomas")).toBe("Thomas");
    expect(heroFromPlateText("MALGANS")).toBe("Mal'Ganis");
    expect(heroFromPlateText("MAL'GANS")).toBe("Mal'Ganis");
    expect(heroFromPlateText("OHIRA")).toBe("Qhira");
    expect(heroFromPlateText("novawolf117")).toBeNull();
    expect(readSlotPlate(["VALLA", "novawolf117"])).toEqual({
      hero: "Valla",
      player: "novawolf117",
    });
    expect(heroFromPlateText("Wizard")).toBeNull();
    expect(heroFromPlateText("LI-MING")).toBe("Li-Ming");
    expect(readSlotPlate(["ARTHAS", "Wizard"])).toEqual({
      hero: "Arthas",
      player: "Wizard",
    });
    expect(nameFromPlate("MALGANS\nPeterWiggin")).toBe("PeterWiggin");
    expect(nameFromPlate("MAL'GANS")).toBeNull();
    expect(nameFromPlate("VALLA\nTopgun707")).toBe("Topgun707");
    expect(nameFromPlate("PICKING\nMrHustler")).toBe("MrHustler");
    expect(
      namesFromOcrLines([
        { text: "TASSADAR", top: 400 },
        { text: "PeterWiggin", top: 20 },
        { text: "Huckit", top: 90 },
        { text: "AcldReign", top: 160 },
      ]),
    ).toEqual(["PeterWiggin", "Huckit", "AcldReign"]);
    expect(snapToRoster("Huckit", ["HuckIt#1686"])).toBe("HuckIt");
    expect(namesFromOcrLines([{ text: "Dex", top: 1 }])).toEqual(["Dex"]);
    expect(nameFromPlate("21222220BudT7312212")).toBeNull();
    expect(
      namesFromOcrLines([
        { text: "ChiptuneScu", top: 10 },
        { text: "trzen", top: 40 },
        { text: "Huckit", top: 70 },
        { text: "H", top: 80 },
        { text: "Stefalthontg", top: 110 },
        { text: "Helms", top: 140 },
        { text: "21222220BudT7312212", top: 200 },
      ]),
    ).toEqual(["ChiptuneScu", "trzen", "Huckit", "Stefalthontg", "Helms"]);
  });

  it("treats a bright rim as locked and a dark rim as still open", () => {
    expect(borderLooksLocked([30, 40, 180, 200, 210, 190, 205, 170, 40, 35])).toBe(true);
    expect(borderLooksLocked([20, 30, 25, 40, 35, 30, 28, 32, 22, 26])).toBe(false);
    expect(
      portraitIsLocked({
        phase: "ban",
        faceFilled: true,
        plate: "locked",
        ally: true,
      }),
    ).toBe(false);
    expect(
      portraitIsLocked({
        phase: "pick",
        faceFilled: true,
        plate: "shown",
        ally: true,
      }),
    ).toBe(false);
    expect(
      portraitIsLocked({
        phase: "pick",
        faceFilled: true,
        plate: "locked",
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "pick",
        faceFilled: false,
        plate: "locked",
        ally: true,
      }),
    ).toBe(false);
    expect(
      portraitIsLocked({
        phase: "pick",
        faceFilled: false,
        ally: false,
        heroOnPlate: true,
      }),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "ban",
        faceFilled: true,
        ally: false,
        heroOnPlate: true,
        plate: "locked",
      }),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "ban",
        faceFilled: true,
        plate: "locked",
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "ban",
        faceFilled: true,
        plate: "shown",
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(false);
  });

  it("leaves the Alterac Tyrande hover unlocked", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "draft lobby alterac 2.png")),
    );
    const pixelAt = (x: number, y: number) => {
      const px = Math.max(0, Math.min(image.width - 1, x));
      const py = Math.max(0, Math.min(image.height - 1, y));
      const i = (py * image.width + px) * 4;
      return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
    };
    const boxRgb = (box: (typeof DRAFT_PLATE_SLOTS.left)[number]) => {
      const x = Math.round(box.x * image.width);
      const y = Math.round(box.y * image.height);
      const w = Math.round(box.w * image.width);
      const h = Math.round(box.h * image.height);
      const pixels = [];
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          pixels.push(pixelAt(x + col, y + row));
        }
      }
      return pixels;
    };
    const locked = (
      portrait: (typeof DRAFT_PLATE_SLOTS.left)[number],
      name: (typeof DRAFT_SLOT_NAMES.left)[number],
      ally: boolean,
      heroOnPlate: boolean,
    ) =>
      portraitIsLocked({
        phase: "pick",
        faceFilled: portraitFilled(boxRgb(portrait)),
        plate: plateFill(boxRgb(name), ally),
        ally,
        heroOnPlate,
      });
    expect(
      DRAFT_PLATE_SLOTS.left.map((box, index) =>
        locked(box, DRAFT_SLOT_NAMES.left[index], true, index !== 1),
      ),
    ).toEqual([true, false, true, true, true]);
    expect(
      DRAFT_PLATE_SLOTS.right.map((box, index) =>
        locked(box, DRAFT_SLOT_NAMES.right[index], false, index !== 1),
      ),
    ).toEqual([true, false, true, true, true]);
  });

  it("keeps the Volskaya highlight unlocked and the colored rims locked", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "draft lobby volskaya.png")),
    );
    const pixelAt = (x: number, y: number) => {
      const px = Math.max(0, Math.min(image.width - 1, x));
      const py = Math.max(0, Math.min(image.height - 1, y));
      const i = (py * image.width + px) * 4;
      return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
    };
    const boxRgb = (box: (typeof DRAFT_PLATE_SLOTS.left)[number]) => {
      const x = Math.round(box.x * image.width);
      const y = Math.round(box.y * image.height);
      const w = Math.round(box.w * image.width);
      const h = Math.round(box.h * image.height);
      const pixels = [];
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) pixels.push(pixelAt(x + col, y + row));
      }
      return pixels;
    };
    const locked = (
      portrait: (typeof DRAFT_PLATE_SLOTS.left)[number],
      name: (typeof DRAFT_SLOT_NAMES.left)[number],
      ally: boolean,
      heroOnPlate: boolean,
    ) =>
      portraitIsLocked({
        phase: "pick",
        faceFilled: portraitFilled(boxRgb(portrait)),
        plate: plateFill(boxRgb(name), ally),
        ally,
        heroOnPlate,
      });
    expect(
      DRAFT_PLATE_SLOTS.left.map((box, index) =>
        locked(box, DRAFT_SLOT_NAMES.left[index], true, index !== 1 && index !== 2 && index !== 3),
      ),
    ).toEqual([true, false, false, false, true]);
    expect(
      DRAFT_PLATE_SLOTS.right.map((box, index) =>
        locked(box, DRAFT_SLOT_NAMES.right[index], false, index !== 2),
      ),
    ).toEqual([true, true, false, true, true]);
  });

  it("treats a blue or red team glow as locked and a dim purple background as open", () => {
    const glow = Array.from({ length: 12 }, () => ({ luma: 120, sat: 0.7 }));
    const dark = Array.from({ length: 12 }, () => ({ luma: 30, sat: 0.8 }));
    expect(borderLooksLockedSamples(glow)).toBe(true);
    expect(borderLooksLockedSamples(dark)).toBe(false);
  });

  it("keeps plate order when the center splash names only one locked hero", () => {
    expect(
      takeNewLocks(
        [],
        [
          { hero: "Sgt. Hammer", player: "TOP" },
          { hero: "Lt. Morales", player: "Prolith" },
          { hero: "Artanis", player: "Rantore" },
        ],
        ["Artanis"],
      ).heroes,
    ).toEqual(["Sgt. Hammer", "Lt. Morales", "Artanis"]);
  });

  it("locks heroes in announcement order instead of portrait order", () => {
    expect(
      takeNewLocks(
        [],
        ["Johanna", "Li-Ming", "Illidan"],
        ["Illidan", "Johanna"],
      ).heroes,
    ).toEqual(["Illidan", "Johanna", "Li-Ming"]);
    expect(
      takeNewLocks(["Illidan"], ["Johanna", "Li-Ming", "Illidan"], ["Illidan", "Johanna"]).heroes,
    ).toEqual(["Illidan", "Johanna", "Li-Ming"]);
    expect(
      takeNewLocks(
        [],
        [
          { hero: "Li-Ming", player: "Thomas" },
          { hero: "Varian", player: "Nubcake" },
        ],
        ["Varian", "Li-Ming"],
      ),
    ).toEqual({
      heroes: ["Varian", "Li-Ming"],
      players: ["Nubcake", "Thomas"],
    });
    expect(
      takeNewLocks(
        ["Anub'arak"],
        [{ hero: "Anub'arak", player: "MaXiMus" }],
        [],
        ["HanFOTS"],
      ).players,
    ).toEqual(["MaXiMus"]);
    expect(
      takeNewLocks(
        ["Whitemane", "Anub'arak"],
        [
          { hero: "Whitemane", player: "HuckIt" },
          { hero: "Anub'arak", player: "MaXiMus" },
        ],
        [],
        ["HuckIt", "HuckIt"],
      ),
    ).toEqual({
      heroes: ["Whitemane", "Anub'arak"],
      players: ["HuckIt", "MaXiMus"],
    });
  });

  it("reads the ban row and leaves locked picks out of it", () => {
    expect(bansFromStrip("JOHANNA\nGENJI\nGarrosh", ["Garrosh"])).toEqual([
      "Johanna",
      "Genji",
    ]);
  });

  it("maps our side onto whoever from the roster is actually in those slots", () => {
    const roster = [
      { battletag: "Beachyman#1" },
      { battletag: "HuckIt#1" },
      { battletag: "MoJoE#1" },
      { battletag: "MrHustler#1" },
      { battletag: "Topgun707#1" },
      { battletag: "PeterWiggin#1" },
    ];
    expect(
      rosterTagsPresent(
        ["PeterWiggin", "Beachyman", "Topgun707", "MoJoE", "Nope"],
        roster,
      ),
    ).toEqual(["PeterWiggin#1", "Beachyman#1", "Topgun707#1", "MoJoE#1"]);
  });

  it("keeps heroes in the order they first lock", () => {
    expect(rememberHeroes(["Garrosh"], ["Leoric", "Garrosh", "Greymane"])).toEqual([
      "Garrosh",
      "Leoric",
      "Greymane",
    ]);
  });

  it("commits a ban when the announced player changes", () => {
    const first = nextTurn(
      null,
      { player: "MsBells27", phase: "ban", hero: "Genji" },
      () => "their",
    );
    const second = nextTurn(
      first.open,
      { player: "Beachyman", phase: "ban", hero: null },
      (player) => (player === "Beachyman" ? "our" : "their"),
    );
    expect(second.ban).toEqual({ side: "their", hero: "Genji" });
  });

  it("commits a ban from the hero name when the player name was missed", () => {
    const first = nextTurn(
      null,
      { player: null, phase: "ban", hero: "Genji" },
      () => null,
      "their",
    );
    const second = nextTurn(
      first.open,
      { player: null, phase: "ban", hero: "Johanna" },
      () => null,
      "our",
    );
    expect(second.ban).toEqual({ side: "their", hero: "Genji" });
  });

  it("reads BAN as the ban phase", () => {
    expect(turnFromOcr("HuckIt\nBAN\nJOHANNA", ["HuckIt"])).toEqual({
      player: "HuckIt",
      phase: "ban",
      hero: "Johanna",
    });
  });

  it("places a locked pick even when the earlier bans were not read", () => {
    const actions = actionsFromObserved({
      weFirst: false,
      firstPick: "them",
      phase: null,
      map: "Battlefield of Eternity",
      ourBans: [],
      theirBans: ["Genji"],
      ourPicks: [],
      theirPicks: ["Deathwing"],
      ourPickPlayers: [],
      theirPickPlayers: ["Nubcake"],
    });
    expect(actions).toEqual([
      { side: "their", kind: "ban", hero: "Genji" },
      { side: "our", kind: "ban", hero: UNSEEN_BAN },
      { side: "their", kind: "ban", hero: UNSEEN_BAN },
      { side: "our", kind: "ban", hero: UNSEEN_BAN },
      { side: "their", kind: "pick", hero: "Deathwing", player: "Nubcake" },
    ]);
  });

  it("treats a column of PICKING slots as the pick phase, and the enemy column as their first pick", () => {
    const lines = [
      { text: "Explanacion" },
      { text: "PICKING" },
      { text: "Frijolito" },
    ];
    expect(columnShowsPicking(lines)).toBe(true);
    expect(columnShowsPicking([{ text: "Beachyman" }])).toBe(false);
    expect(
      pickingPhaseFromColumns({
        leftPicking: false,
        rightPicking: true,
        bannerPhase: null,
      }),
    ).toBe("pick");
    expect(
      pickingPhaseFromColumns({
        leftPicking: true,
        rightPicking: false,
        bannerPhase: "ban",
      }),
    ).toBeNull();
    expect(
      firstPickFromPickingSlots({
        leftPicking: false,
        rightPicking: true,
        usOnLeft: true,
      }),
    ).toBe("them");
  });

  it("skips the opening bans when the banner is already on a pick", () => {
    const actions = actionsFromObserved({
      weFirst: false,
      firstPick: "them",
      phase: "pick",
      map: "Alterac Pass",
      ourBans: [],
      theirBans: [],
      ourPicks: [],
      theirPicks: [],
      ourPickPlayers: [],
      theirPickPlayers: [],
    });
    expect(actions).toEqual([
      { side: "their", kind: "ban", hero: UNSEEN_BAN },
      { side: "our", kind: "ban", hero: UNSEEN_BAN },
      { side: "their", kind: "ban", hero: UNSEEN_BAN },
      { side: "our", kind: "ban", hero: UNSEEN_BAN },
    ]);
  });

  it("waits for a mid-ban hex read when opening bans were already read from the screen", () => {
    const actions = actionsFromObserved({
      weFirst: true,
      firstPick: "us",
      phase: null,
      map: "Battlefield of Eternity",
      ourBans: [NO_BAN, "Xal'atath"],
      theirBans: ["Qhira", NO_BAN],
      ourPicks: ["Whitemane", "Falstad", "Lunara"],
      theirPicks: ["Diablo", "Alarak"],
      ourPickPlayers: [],
      theirPickPlayers: [],
    });
    expect(actions).toHaveLength(9);
    expect(actions.filter((a) => a.hero === UNSEEN_BAN)).toHaveLength(0);
  });

  it("fills the second ban round when the first pick wave is locked and the client is picking", () => {
    const actions = actionsFromObserved({
      weFirst: false,
      firstPick: "them",
      phase: "pick",
      map: "Towers of Doom",
      ourBans: [],
      theirBans: [],
      ourPicks: ["Dehaka", "Arthas"],
      theirPicks: ["Abathur", "Tychus", "Li Li"],
      ourPickPlayers: ["Alejok", "Topgun707"],
      theirPickPlayers: ["Reckles", "ExCalibur", null],
    });
    const bans = actions.filter((action) => action.kind === "ban");
    const picks = actions.filter((action) => action.kind === "pick");
    expect(bans).toHaveLength(6);
    expect(bans.every((action) => action.hero === UNSEEN_BAN)).toBe(true);
    expect(picks.map((action) => action.hero)).toEqual([
      "Abathur",
      "Dehaka",
      "Arthas",
      "Tychus",
      "Li Li",
    ]);
    expect(actions).toHaveLength(11);
  });

  it("stays on the second ban round while the client is still banning", () => {
    const actions = actionsFromObserved({
      weFirst: false,
      firstPick: "them",
      phase: "ban",
      map: "Towers of Doom",
      ourBans: [],
      theirBans: [],
      ourPicks: ["Dehaka", "Arthas"],
      theirPicks: ["Abathur", "Tychus", "Li Li"],
      ourPickPlayers: [],
      theirPickPlayers: [],
    });
    expect(actions.filter((action) => action.kind === "ban")).toHaveLength(4);
    expect(actions.filter((action) => action.kind === "pick")).toHaveLength(5);
  });

  it("infers who picked first from the locks already on screen", () => {
    expect(
      inferFirstPick({ ourPicks: 2, theirPicks: 3, phase: "pick", turnSide: null }),
    ).toBe("them");
    expect(
      inferFirstPick({ ourPicks: 3, theirPicks: 2, phase: "pick", turnSide: null }),
    ).toBe("us");
    expect(
      inferFirstPick({ ourPicks: 2, theirPicks: 2, phase: "pick", turnSide: "our" }),
    ).toBe("us");
    expect(
      inferFirstPick({ ourPicks: 0, theirPicks: 0, phase: "pick", turnSide: "our" }),
    ).toBe(null);
  });

  it("knows when a live draft board is full", () => {
    const full = {
      ...EMPTY_LIVE_DRAFT,
      ourBans: ["A", NO_BAN, "B"],
      theirBans: ["C", "D", "E"],
      ourPicks: ["1", "2", "3", "4", "5"],
      theirPicks: ["6", "7", "8", "9", "0"],
    };
    expect(liveDraftBoardFull(full)).toBe(true);
    expect(
      liveDraftBoardFull({
        ...full,
        ourPicks: ["1", "2", "3", "4", UNSEEN_BAN],
      }),
    ).toBe(false);
    expect(liveDraftBoardFull({ ...EMPTY_LIVE_DRAFT })).toBe(false);
  });

  it("holds a draft that is still missing a pick and grades once both fives are in", () => {
    const short = {
      ...EMPTY_LIVE_DRAFT,
      ourPicks: ["Kel'Thuzad", "Auriel", "Leoric", "Johanna"],
      theirPicks: ["Anduin", "Gul'dan", "Lunara", "Zeratul", "Rehgar"],
    };
    expect(draftShortOfPicks(short)).toBe(true);
    expect(draftShortOfPicks(EMPTY_LIVE_DRAFT)).toBe(false);
    expect(bothSidesPickedFive(short)).toBe(false);
    expect(
      bothSidesPickedFive({
        ...short,
        ourPicks: ["Kel'Thuzad", "Auriel", "Leoric", "Johanna", "Ana"],
      }),
    ).toBe(true);
    expect(
      liveDraftBoardFull({
        ...short,
        ourPicks: ["Kel'Thuzad", "Auriel", "Leoric", "Johanna", "Ana"],
        sealed: true,
      }),
    ).toBe(true);
  });

  it("detects a likely draft lobby from pixels without OCR", () => {
    expect(
      draftLobbyLikelyOnFrame({ titleBrightShare: 0.02, banSlots: [] }),
    ).toBe(false);
    expect(
      draftLobbyLikelyOnFrame({
        titleBrightShare: 0.05,
        banSlots: [],
      }),
    ).toBe(true);
    expect(
      draftLobbyLikelyOnFrame({
        titleBrightShare: 0,
        banSlots: [{ filled: false, passed: true }],
      }),
    ).toBe(true);
  });

  it("waits for a draft and ignores the Storm League menu", () => {
    const menu = "HuckIt\nPlatinum\n7 Wins\nStorm League, 2026 Season 3\nSearching Storm League";
    expect(menuScreenSeen(menu)).toBe(true);
    expect(draftLobbySeen(menu)).toBe(false);
    expect(watchPhase(menu, false)).toBe("menu");
    expect(watchPhase("PLAY COLLECTION LOOT", false)).toBe("menu");
    expect(watchPhase("erhe5ryBal shares Trott", false)).toBe("wait");
    expect(draftLobbySeen("Towers of Doom\nHuckIt\nBanning")).toBe(true);
    expect(watchPhase("RED PICK", false)).toBe("draft");
    expect(watchPhase("Waiting for Enemy Ban...", false)).toBe("draft");
    expect(bannerTurn("Waiting for Teammates...")).toEqual({ phase: "pick", color: null });
    expect(bannerTurn("ILLIDAN\nZZEN")).toEqual({ phase: null, color: null });
    expect(heroOnPlate("VALLA\nCriptoneSoul")).toBe("Valla");
    expect(heroOnPlate("PICKING")).toBe(null);
    expect(heroOnPlate("E.T.C.\nHuckIt")).toBe("E.T.C.");
    expect(
      locksFromOcrLines([
        { text: "Raynor", top: 80 },
        { text: "Chronos", top: 120 },
        { text: "PICKING", top: 300 },
        { text: "Valla", top: 460 },
        { text: "SaltTea", top: 500 },
      ]),
    ).toEqual([
      { hero: "Raynor", player: "Chronos" },
      { hero: "Valla", player: "SaltTea" },
    ]);
    expect(
      locksFromOcrLines([
        { text: "SuperGoBu", top: 80 },
        { text: "Dehaka", top: 120 },
        { text: "PICKING", top: 300 },
        { text: "Frijolito", top: 340 },
      ]),
    ).toEqual([{ hero: "Dehaka", player: "SuperGoBu" }]);
    expect(
      locksFromOcrLines([
        { text: "ARTHAS", top: 80 },
        { text: "Wizard", top: 140 },
      ]),
    ).toEqual([{ hero: "Arthas", player: "Wizard" }]);
    expect(watchPhase("", true)).toBe("draft");
    expect(watchPhase(menu, true)).toBe("menu");
  });

  it("reads the five party names from the party-row crop", () => {
    expect(
      partyNamesFromText("Topgun707 Beachyman HuckIt MoJoE MrHustler"),
    ).toEqual(["Topgun707", "Beachyman", "HuckIt", "MoJoE", "MrHustler"]);
  });

  it("preloads our queue and ignores rank medals as the other team", () => {
    const names = partyNamesFromText(
      "Platinum MsBells27 Diamond DuMaMay Selected HuckIt Beachyman MrHustler Gold",
    );
    expect(names).toEqual([
      "MsBells27",
      "DuMaMay",
      "HuckIt",
      "Beachyman",
      "MrHustler",
    ]);
    expect(isPartyMedalName("Platinum")).toBe(true);
    expect(isPartyMedalName("Beachyman")).toBe(false);
    const draft = draftFromPartyQueue([
      ...names,
      "Platinum",
      "Diamond",
      "Selected",
    ]);
    expect(draft.ourOpenPlayers).toEqual(names);
    expect(draft.theirOpenPlayers).toEqual([]);
    expect(draft.firstPick).toBeNull();
    expect(draft.map).toBeNull();
    expect(draft.ourPicks).toEqual([]);
    expect(draft.theirPicks).toEqual([]);
  });

  it("reads RED PICK as their turn when we are on the left", () => {
    expect(bannerTurn("RED PICK")).toEqual({ phase: "pick", color: "red" });
    expect(bannerTurn("REDPICK")).toEqual({ phase: "pick", color: "red" });
    expect(bannerTurn("Juno\nBanning\nYou pick a hero")).toEqual({
      phase: "ban",
      color: null,
    });
    expect(bannerTurn("Waiting for Enemy Ban...")).toEqual({ phase: "ban", color: null });
    expect(bannerTurn("BRIGHTWING\nWaiting for Enemy...")).toEqual({
      phase: "pick",
      color: null,
    });
    expect(bannerTurn("Waiting for Enemy...")).toEqual({ phase: "pick", color: null });
    expect(bannerTurn("Waiting for Team Ban...")).toEqual({ phase: "ban", color: null });
    expect(bannerTurn("《Waiting for Team Banv")).toEqual({ phase: "ban", color: null });
    expect(firstBanSideFromStatus("Waiting for Enemy Ban...")).toBe("them");
    expect(firstBanSideFromStatus("Waiting for Team Ban...")).toBe("us");
    expect(firstBanSideFromStatus("SKY TEMPLE")).toBe(null);
    expect(sideFromStatus("Waiting for Enemy...")).toBe("their");
    expect(sideFromStatus("Waiting for Team Ban...")).toBe("our");
    expect(banSideFromSplash("TheScrub\nBanning\nWaiting for Enemy Ban...")).toBe("their");
    expect(banSideFromSplash("SYLVANAS\nBanned\nWaiting for Enemy Ban...")).toBe("our");
    expect(acceptPlatePicks({ banPhase: true, picksStarted: false })).toBe(false);
    expect(acceptPlatePicks({ banPhase: false, picksStarted: false })).toBe(false);
    expect(acceptPlatePicks({ banPhase: false, picksStarted: true })).toBe(true);
    expect(
      acceptLockedPlates({ lockedCount: 3, lockPhase: null, keepCommitted: false }),
    ).toBe(true);
    expect(
      acceptLockedPlates({ lockedCount: 0, lockPhase: null, keepCommitted: false }),
    ).toBe(false);
    expect(
      acceptLockedPlates({ lockedCount: 2, lockPhase: "ban", keepCommitted: false }),
    ).toBe(false);
    expect(
      acceptLockedPlates({ lockedCount: 2, lockPhase: "ban", keepCommitted: true }),
    ).toBe(true);
    expect(
      acceptLockedPlates({ lockedCount: 1, lockPhase: "pick", keepCommitted: false }),
    ).toBe(true);
    expect(
      plateLockPhase({
        bannerPhase: "ban",
        picksStarted: true,
        priorLockedPicks: 5,
      }),
    ).toBe("pick");
    expect(
      plateLockPhase({
        bannerPhase: "ban",
        picksStarted: false,
        priorLockedPicks: 0,
      }),
    ).toBe("ban");
    expect(openingTeamBanCard("BLUE BAN\nWaiting for Team Ban...")).toBe(true);
    expect(openingTeamBanCard("SleezyGypsy1\nBanning\nWaiting for Enemy Ban...")).toBe(
      false,
    );
    expect(banFrameKeepsLockedPicks("BLUE BAN\nWaiting for Team Ban...")).toBe(false);
    expect(
      banFrameKeepsLockedPicks("SleezyGypsy1\nBanning\nWaiting for Enemy Ban..."),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "ban",
        keepCommitted: true,
        faceFilled: true,
        plate: "locked",
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(true);
    expect(
      portraitIsLocked({
        phase: "ban",
        keepCommitted: true,
        faceFilled: true,
        plate: "shown",
        ally: true,
        heroOnPlate: true,
      }),
    ).toBe(false);
    expect(nextBanSide(false, 0, 0)).toBe("their");
    expect(nextBanSide(false, 0, 1)).toBe("our");
    expect(nextBanSide(true, 0, 0)).toBe("our");
    expect(
      shownBanSide({
        center: "ALARAK\nBANNED",
        status: "Waiting for Enemy Ban...",
        player: null,
        ourNames: ["HuckIt", "PeterWiggin"],
        theirNames: ["Gonkore"],
      }),
    ).toBe("our");
    expect(
      shownBanSide({
        center: "Juno\nBanning",
        status: "Waiting for Enemy Ban...",
        player: "Juno",
        ourNames: ["HuckIt"],
        theirNames: ["Juno"],
      }),
    ).toBe("their");
    expect(snapToRoster("MrHusti", ["MrHustler#1686"])).toBe("MrHustler");
    expect(snapToRoster("Topguny03", ["Topgun707#1875"])).toBe("Topgun707");
    expect(sideFromBannerColor("red", true)).toBe("their");
    expect(sideFromBannerColor("blue", true)).toBe("our");
  });

  it("matches lobby names to an NGS roster and skips our own team", () => {
    const teams = [
      {
        teamName: "Little Buff Boyz",
        battletags: ["MoJoE#1", "HuckIt#1", "MrHustler#1", "Topgun707#1", "Beachyman#1"],
      },
      {
        teamName: "Bingo night",
        battletags: ["Powerlord#1", "AaronWendor#2", "Donte#3", "Andromeda#4", "Juno#5"],
      },
    ];
    expect(
      matchLobbyToRosters(
        ["Powerlord", "AaronWendor", "Donte", "Andromeda", "Juno"],
        teams,
        "Little Buff Boyz",
      ),
    ).toEqual({
      team: "Bingo night",
      battletags: ["Powerlord#1", "AaronWendor#2", "Donte#3", "Andromeda#4", "Juno#5"],
    });
  });

  it("reads the map title and the banning announcement", () => {
    expect(mapFromTitle("BATTLEFIELD OF ETERNITY")).toBe("Battlefield of Eternity");
    expect(mapFromTitle("HAUNTED MINES")).toBe("Haunted Mines");
    expect(turnFromOcr("MsBelis27\nBanning", ["MsBells27"])).toEqual({
      player: "MsBells27",
      phase: "ban",
      hero: null,
    });
  });

  it("does not call two enemy locks and zero of ours their first pick", () => {
    const illegal = {
      firstPick: "them" as const,
      ourBans: ["Dehaka", "Johanna"],
      theirBans: ["Falstad", "Xal'atath"],
      ourPicks: [] as string[],
      theirPicks: ["Brightwing", "Abathur"],
      phase: "pick" as const,
      turn: { side: "their" as const, kind: "pick" as const },
    };
    expect(pickCountsFit(true, 0, 2)).toBe(false);
    expect(pickCountsFit(false, 0, 2)).toBe(false);
    expect(resolveFirstPick(illegal)).toBeNull();
    expect(
      isDraftSideKnown({
        ...EMPTY_LIVE_DRAFT,
        ...illegal,
      }),
    ).toBe(false);
  });

  it("treats a whitish plate as a lock and a blue plate as shown", () => {
    const white = Array.from({ length: 80 }, () => ({ r: 210, g: 206, b: 198 }));
    const blue = Array.from({ length: 80 }, () => ({ r: 40, g: 90, b: 190 }));
    const dark = Array.from({ length: 80 }, () => ({ r: 8, g: 6, b: 16 }));
    const warmLock = Array.from({ length: 80 }, () => ({ r: 210, g: 150, b: 120 }));
    const enemyOpen = Array.from({ length: 80 }, () => ({ r: 96, g: 24, b: 28 }));
    const enemyLock = Array.from({ length: 80 }, () => ({ r: 228, g: 178, b: 188 }));
    expect(plateFill(white)).toBe("locked");
    expect(plateFill(blue)).toBe("shown");
    expect(plateFill(dark)).toBe("empty");
    expect(plateFill(warmLock)).toBe("locked");
    expect(plateFill([])).toBe("empty");
    expect(plateFill(enemyOpen, false)).toBe("shown");
    expect(plateFill(enemyLock, false)).toBe("locked");
  });

  it("still locks Qhira's light plate when the capture is darker", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "sky temple 2.png")),
    );
    const dim = (index: number) => {
      const box = DRAFT_SLOT_NAMES.left[index];
      const x = Math.round(box.x * image.width);
      const y = Math.round(box.y * image.height);
      const w = Math.round(box.w * image.width);
      const h = Math.round(box.h * image.height);
      const pixels = [];
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = ((y + row) * image.width + (x + col)) * 4;
          pixels.push({
            r: Math.round((image.data[i] ?? 0) * 0.8),
            g: Math.round((image.data[i + 1] ?? 0) * 0.8),
            b: Math.round((image.data[i + 2] ?? 0) * 0.8),
          });
        }
      }
      return plateFill(pixels, true);
    };
    expect(dim(4)).toBe("locked");
    expect(["shown", "empty"]).toContain(dim(0));
  });

  it("counts a ban hex only when a face is in it", () => {
    const face = Array.from({ length: 40 }, () => ({ r: 180, g: 40, b: 36 }));
    const empty = Array.from({ length: 40 }, () => ({ r: 12, g: 8, b: 22 }));
    const glyph = [
      ...Array.from({ length: 27 }, () => ({ r: 180, g: 40, b: 200 })),
      ...Array.from({ length: 73 }, () => ({ r: 12, g: 8, b: 22 })),
    ];
    expect(banHexFilled(face)).toBe(true);
    expect(banHexFilled(empty)).toBe(false);
    expect(colorfulFraction(glyph)).toBeCloseTo(0.27);
    expect(banHexFilled(glyph)).toBe(false);
    expect(portraitFilled(face)).toBe(true);
    expect(portraitFilled(empty)).toBe(false);
  });

  it("reads a slot nameplate and keeps each stacked plate on its own slot", () => {
    expect(readSlotPlate(["ABATHUR", "L337"])).toEqual({ hero: "Abathur", player: "L337" });
    expect(readSlotPlate(["EORIC", "Magic"]).hero).toBe("Leoric");
    expect(readSlotPlate(["ASSIA", "ArcKane"]).hero).toBe("Cassia");
    expect(readSlotPlate(["DBIUS", "Answered"])).toEqual({ hero: null, player: "Answered" });
    expect(readSlotPlate(["hiimrick"])).toEqual({ hero: null, player: "hiimrick" });
    expect(readSlotPlate(["STITCHES", "Silver"])).toEqual({ hero: "Stitches", player: "Silver" });
    expect(readSlotPlate(["TYRANDE", "Level"])).toEqual({ hero: "Tyrande", player: "Level" });
    expect(nameFromPlate("Level")).toBe("Level");
    expect(readSlotPlate(["HanFOTS", "ANUB'ARAK", "MaXiMus"])).toEqual({
      hero: "Anub'arak",
      player: "MaXiMus",
    });
    expect(readSlotPlate(["ANUB'ARAK", "MaXiMus", "HanFOTS"])).toEqual({
      hero: "Anub'arak",
      player: "MaXiMus",
    });
    const slots = readsBySlot(
      [
        { text: "ABATHUR", top: 20 },
        { text: "L337", top: 60 },
        { text: "hiimrick", top: 180 * 3 + 40 },
      ],
      5,
      180,
    );
    expect(slots[0]).toEqual({ hero: "Abathur", player: "L337" });
    expect(slots[3]).toEqual({ hero: null, player: "hiimrick" });
    expect(slots[1]).toEqual({ hero: null, player: null });
  });

  it("names a ban hex from the face and keeps that name when a later frame is blank", () => {
    const paint = (r: number, g: number, b: number) =>
      Array.from({ length: 16 }, () => ({ r, g, b }));
    const valla = faceSignature(paint(200, 30, 40), 4, 4);
    const johanna = faceSignature(paint(40, 80, 200), 4, 4);
    expect(valla).not.toBeNull();
    expect(johanna).not.toBeNull();
    const catalog = [
      { hero: "Valla", sig: valla ?? [] },
      { hero: "Johanna", sig: johanna ?? [] },
    ];
    expect(nearestFace(valla ?? [], catalog)).toBe("Valla");
    expect(nearestFace(johanna ?? [], catalog)).toBe("Johanna");
    expect(
      bansFromHexFaces(["Valla", null, null], [true, true, false], []),
    ).toEqual(["Valla", UNSEEN_BAN]);
    expect(
      bansFromHexFaces([null, null, null], [false, false, false], ["Valla", "Johanna"]),
    ).toEqual(["Valla", "Johanna"]);
    expect(
      bansFromHexFaces(
        [null, "Xal'atath", null],
        [false, true, false],
        [],
        [true, false, false],
      ),
    ).toEqual([NO_BAN, "Xal'atath"]);
    expect(
      bansFromHexFaces(
        ["Qhira", null, null],
        [true, false, false],
        [],
        [false, true, false],
      ),
    ).toEqual(["Qhira", NO_BAN]);
  });

  it("matches a saved portrait and keeps a second view of that hero", () => {
    const face = (shift: number) => {
      const pixels = [];
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          pixels.push({
            r: (x * 12 + shift) % 220,
            g: (y * 8 + 20) % 180,
            b: x < 12 ? 30 : 160,
          });
        }
      }
      return pixels;
    };
    const valla = portraitVector(face(0), 24, 24);
    const vallaAgain = portraitVector(face(4), 24, 24);
    const other = portraitVector(face(140), 24, 24);
    expect(valla).not.toBeNull();
    expect(vallaAgain).not.toBeNull();
    expect(other).not.toBeNull();
    expect(portraitScore(valla ?? [], vallaAgain ?? [])).toBeGreaterThan(0.84);
    expect(matchPortrait(vallaAgain ?? [], [{ hero: "Valla", vector: valla ?? [] }])).toBe("Valla");
    expect(matchPortrait(other ?? [], [{ hero: "Valla", vector: valla ?? [] }])).toBeNull();
    expect(acceptPortraitExample(valla ?? [], "Valla", [])).toBe(true);
    expect(acceptPortraitExample(valla ?? [], "Valla", [{ hero: "Valla", vector: valla ?? [] }])).toBe(
      false,
    );
  });

  it("keeps a registered pick when a later frame reads that plate as a hover", () => {
    expect(
      pruneHoverPicks(
        ["Greymane", "Qhira"],
        ["goz", "HuckIt"],
        ["Greymane", "Alarak"],
      ),
    ).toEqual({
      heroes: ["Greymane", "Qhira"],
      players: ["goz", "HuckIt"],
    });
  });

  it("locks the whitish plate and leaves the blue plate as shown", () => {
    const read = platesForLines(
      [
        { text: "CHEN", top: 20 },
        { text: "STUKOV", top: 200 },
        { text: "ANUB'ARAK", top: 400 },
      ],
      [
        { top: 0, fill: "locked" },
        { top: 200, fill: "locked" },
        { top: 400, fill: "shown" },
      ],
    );
    expect(read.locked.map((lock) => lock.hero)).toEqual(["Chen", "Stukov"]);
    expect(read.shown).toEqual(["Anub'arak"]);
    expect(
      dropShownLocks(
        { heroes: ["Chen", "Anub'arak", "Sylvanas"], players: ["Beachyman", "PeterWiggin", null] },
        read.shown,
      ),
    ).toEqual({
      heroes: ["Chen", "Anub'arak", "Sylvanas"],
      players: ["Beachyman", "PeterWiggin", null],
    });
  });

  it("counts filled ban hexes without inventing a hero name", () => {
    expect(bansFromFilledHexes(3, [])).toEqual([UNSEEN_BAN, UNSEEN_BAN, UNSEEN_BAN]);
    expect(bansFromFilledHexes(1, [])).toEqual([UNSEEN_BAN]);
    expect(bansFromFilledHexes(3, ["Valla"])).toEqual(["Valla", UNSEEN_BAN, UNSEEN_BAN]);
    expect(bansFromFilledHexes(0, [UNSEEN_BAN, UNSEEN_BAN, UNSEEN_BAN])).toEqual([
      UNSEEN_BAN,
      UNSEEN_BAN,
      UNSEEN_BAN,
    ]);
    expect(draftHeroList([UNSEEN_BAN, UNSEEN_BAN, UNSEEN_BAN])).toBe("3 locked");
    expect(draftHeroList(["Valla", UNSEEN_BAN])).toBe("Valla, 1 locked");
  });

  it("replaces a history that puts a ban in the first pick wave", () => {
    const illegal = [
      { side: "our" as const, kind: "ban" as const, hero: "Unseen" },
      { side: "their" as const, kind: "ban" as const, hero: "Xal'atath" },
      { side: "our" as const, kind: "ban" as const, hero: "Unseen" },
      { side: "their" as const, kind: "ban" as const, hero: "The Lost Vikings" },
      { side: "their" as const, kind: "pick" as const, hero: "Nazeebo" },
      { side: "their" as const, kind: "pick" as const, hero: "Johanna" },
      { side: "our" as const, kind: "pick" as const, hero: "Qhira" },
      { side: "their" as const, kind: "ban" as const, hero: "Chromie" },
    ];
    const legal = actionsFromObserved({
      ...EMPTY_LIVE_DRAFT,
      weFirst: true,
      firstPick: "us",
      ourBans: ["__unseen__", "__unseen__"],
      theirBans: ["Xal'atath", "The Lost Vikings", "Chromie"],
      ourPicks: ["Qhira", "Muradin", "Rehgar"],
      theirPicks: ["Nazeebo", "Johanna"],
    });
    expect(watchHistoryNeedsReplace(illegal, legal, true)).toBe(true);
    expect(legal.map((action) => action.kind).slice(0, 9)).toEqual([
      "ban",
      "ban",
      "ban",
      "ban",
      "pick",
      "pick",
      "pick",
      "pick",
      "pick",
    ]);
    const chromie = legal.findIndex((action) => action.hero === "Chromie");
    expect(chromie === -1 || chromie >= 9).toBe(true);
  });

  it("keeps a longer legal history when the screen flickers shorter", () => {
    const history = [
      { side: "our" as const, kind: "ban" as const, hero: "Johanna" },
      { side: "their" as const, kind: "ban" as const, hero: "Qhira" },
    ];
    expect(watchHistoryNeedsReplace(history, history.slice(0, 1), true)).toBe(false);
    expect(
      watchHistoryNeedsReplace(history, [...history, { side: "our", kind: "ban", hero: "Anub'arak" }], true),
    ).toBe(true);
  });

  it("reads whose turn from the team splash without treating it as a ban", () => {
    expect(sideFromTeamSplash("Your Team\nPicking")).toBe("our");
    expect(sideFromTeamSplash("Waiting for Teammates...")).toBe("our");
    expect(sideFromTeamSplash("Enemy Team\nPicking")).toBe("their");
    expect(
      inferFirstPick({ ourPicks: 3, theirPicks: 3, phase: "pick", turnSide: "our" }),
    ).toBe("them");
  });
});
