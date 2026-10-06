import { describe, expect, it } from "vitest";
import {
  UNSEEN_BAN,
  actionsFromObserved,
  inferFirstPick,
  bannerTurn,
  shownBanSide,
  matchLobbyToRosters,
  sideFromBannerColor,
  heroFromPlateText,
  heroesFromColumn,
  nameFromPlate,
  namesFromOcrLines,
  lobbyNamesFromOcr,
  mapFromTitle,
  namesFromColumn,
  partyNamesFromText,
  nextTurn,
  opponentColumn,
  bansFromStrip,
  borderLooksLocked,
  borderLooksLockedSamples,
  rememberHeroes,
  playerFromSlotText,
  takeNewLocks,
  rosterTagsForLobby,
  rosterTagsPresent,
  snapToRoster,
  screenTooSmallForWatch,
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

describe("watch screen size", () => {
  it("warns only when the drafter screen is smaller than the shared screen", () => {
    expect(screenTooSmallForWatch({ width: 1920, height: 1080 }, { width: 2560, height: 1440 })).toBe(
      true,
    );
    expect(screenTooSmallForWatch({ width: 2560, height: 1440 }, { width: 1920, height: 1080 })).toBe(
      false,
    );
    expect(screenTooSmallForWatch({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(
      false,
    );
    expect(screenTooSmallForWatch({ width: 1910, height: 1070 }, { width: 1920, height: 1080 })).toBe(
      false,
    );
    expect(screenTooSmallForWatch({ width: 1920, height: 1080 }, { width: 0, height: 0 })).toBe(false);
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
});
