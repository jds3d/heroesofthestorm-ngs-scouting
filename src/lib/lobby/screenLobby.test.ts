import { describe, expect, it } from "vitest";
import {
  UNSEEN_BAN,
  actionsFromObserved,
  inferFirstPick,
  bannerTurn,
  firstBanSideFromStatus,
  nextBanSide,
  banSideFromSplash,
  acceptPlatePicks,
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
  lobbyNamesFromOcr,
  draftLobbySeen,
  mapFromTitle,
  menuScreenSeen,
  watchPhase,
  namesFromColumn,
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
  draftHeroList,
  sideFromTeamSplash,
  borderLooksLocked,
  borderLooksLockedSamples,
  rememberHeroes,
  playerFromSlotText,
  takeNewLocks,
  rosterTagsForLobby,
  rosterTagsPresent,
  snapToRoster,
  turnFromOcr,
} from "./screenLobby";

const OURS = ["Beachyman", "HuckIt", "MoJoE", "MrHustler", "Topgun707"];

describe("lobbyNamesFromOcr", () => {
  it("keeps the five names that are not us, heroes, or lobby chrome", () => {
    const text = `
      STORM LEAGUE
      Beachyman HuckIt MoJoE MrHustler Topgun707
      Stark chesslooter EkeeB Iron Shuman
      BAN PICK Johanna Alterac Pass
    `;
    expect(lobbyNamesFromOcr(text, OURS)).toEqual([
      "Stark",
      "chesslooter",
      "EkeeB",
      "Iron",
      "Shuman",
    ]);
  });

  it("returns a short list when the screen does not show five opponents", () => {
    expect(lobbyNamesFromOcr("BAN PICK Johanna", OURS)).toEqual([]);
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
  it("reads hero labels, including Alarak's Xal'atath title", () => {
    const text = "GARROSH\nBeachyman\nXAL'ATATH\nTopgun707\nTHE LOST VIKINGS\nMarcy";
    expect(heroesFromColumn(text)).toEqual(["Garrosh", "Alarak", "The Lost Vikings"]);
    expect(namesFromColumn(text)).toEqual(["Beachyman", "Topgun707", "Marcy"]);
    expect(playerFromSlotText("LI-MING\nThomas")).toBe("Thomas");
    expect(playerFromSlotText("Li-Ming Thomas")).toBe("Thomas");
    expect(heroFromPlateText("MALGANS")).toBe("Mal'Ganis");
    expect(heroFromPlateText("MAL'GANS")).toBe("Mal'Ganis");
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
  });

  it("treats a blue or red team glow as locked and a dim purple background as open", () => {
    const glow = Array.from({ length: 12 }, () => ({ luma: 120, sat: 0.7 }));
    const dark = Array.from({ length: 12 }, () => ({ luma: 30, sat: 0.8 }));
    expect(borderLooksLockedSamples(glow)).toBe(true);
    expect(borderLooksLockedSamples(dark)).toBe(false);
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
    expect(watchPhase("", true)).toBe("draft");
    expect(watchPhase(menu, true)).toBe("menu");
  });

  it("reads the five party names and ignores the queue menu", () => {
    expect(
      partyNamesFromText(
        "Topgun707 Beachyman HuckIt MoJoE MrHustler\nPlatinum Gold Diamond\nQuick Match Searching",
      ),
    ).toEqual(["Topgun707", "Beachyman", "HuckIt", "MoJoE", "MrHustler"]);
    expect(partyNamesFromText("Quick Match\nQuic Jers")).toEqual([]);
    expect(namesFromColumn("Quic")).toEqual([]);
  });

  it("reads RED PICK as their turn when we are on the left", () => {
    expect(bannerTurn("RED PICK")).toEqual({ phase: "pick", color: "red" });
    expect(bannerTurn("REDPICK")).toEqual({ phase: "pick", color: "red" });
    expect(bannerTurn("Juno\nBanning\nYou pick a hero")).toEqual({
      phase: "ban",
      color: null,
    });
    expect(bannerTurn("Waiting for Enemy Ban...")).toEqual({ phase: "ban", color: null });
    expect(firstBanSideFromStatus("Waiting for Enemy Ban...")).toBe("them");
    expect(firstBanSideFromStatus("SKY TEMPLE")).toBe(null);
    expect(banSideFromSplash("TheScrub\nBanning\nWaiting for Enemy Ban...")).toBe("their");
    expect(banSideFromSplash("SYLVANAS\nBanned\nWaiting for Enemy Ban...")).toBe("our");
    expect(acceptPlatePicks({ banPhase: true, picksStarted: false })).toBe(false);
    expect(acceptPlatePicks({ banPhase: false, picksStarted: false })).toBe(false);
    expect(acceptPlatePicks({ banPhase: false, picksStarted: true })).toBe(true);
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
    expect(turnFromOcr("MsBelis27\nBanning", ["MsBells27"])).toEqual({
      player: "MsBells27",
      phase: "ban",
      hero: null,
    });
  });

  it("treats a whitish plate as a lock and a blue plate as shown", () => {
    const white = Array.from({ length: 80 }, () => ({ r: 210, g: 206, b: 198 }));
    const blue = Array.from({ length: 80 }, () => ({ r: 40, g: 90, b: 190 }));
    const dark = Array.from({ length: 80 }, () => ({ r: 8, g: 6, b: 16 }));
    const warmLock = Array.from({ length: 80 }, () => ({ r: 170, g: 90, b: 40 }));
    expect(plateFill(white)).toBe("locked");
    expect(plateFill(blue)).toBe("shown");
    expect(plateFill(dark)).toBe("empty");
    expect(plateFill(warmLock)).toBe("locked");
    expect(plateFill([])).toBe("empty");
  });

  it("counts a ban hex only when a face is in it", () => {
    const face = Array.from({ length: 40 }, () => ({ r: 180, g: 40, b: 36 }));
    const empty = Array.from({ length: 40 }, () => ({ r: 12, g: 8, b: 22 }));
    expect(banHexFilled(face)).toBe(true);
    expect(banHexFilled(empty)).toBe(false);
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
    ).toEqual({ heroes: ["Chen", "Sylvanas"], players: ["Beachyman", null] });
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

  it("reads whose turn from the team splash without treating it as a ban", () => {
    expect(sideFromTeamSplash("Your Team\nPicking")).toBe("our");
    expect(sideFromTeamSplash("Waiting for Teammates...")).toBe("our");
    expect(sideFromTeamSplash("Enemy Team\nPicking")).toBe("their");
    expect(
      inferFirstPick({ ourPicks: 3, theirPicks: 3, phase: "pick", turnSide: "our" }),
    ).toBe("them");
  });
});
