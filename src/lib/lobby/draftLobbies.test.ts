import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeNameReader, readNameColumns } from "@/lib/ocr/nameReader";
import {
  DRAFT_BAN_HEXES,
  DRAFT_PLATE_SLOTS,
  DRAFT_SLOT_NAMES,
  DRAFT_STATUS_BOX,
  DRAFT_TITLE_BOX,
  DRAFT_TURN_BOX,
  SLOT_LINE_STRIDE,
  NAMEPLATE_CELL_WIDTH,
  bansFromHexFaces,
  bannerTurn,
  firstBanSideFromStatus,
  mapFromTitle,
  nameplateCell,
  ocrFold,
  plateFill,
  portraitFilled,
  openSeatPlayers,
  portraitIsLocked,
  portraitTeamRim,
  readsBySlot,
  firstPickFromBanBoard,
  resolveFirstPick,
  pickCountsFit,
  inferFirstPick,
  progressFromObserved,
  reorderOurPicksForDraftZip,
  fitObservedPickOrder,
  sideFromStatus,
  banFrameKeepsLockedPicks,
  NO_BAN,
  UNSEEN_BAN,
  type DraftBox,
} from "@/lib/lobby/screenLobby";
import { readThreeBanHexSlots, setBanHexMapContext } from "@/lib/lobby/banFace";
import { heroKey } from "@/lib/scoring/heroMeta";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { nextStepSuggestion } from "@/lib/scoring/pickPairs";
import { decodePng, encodePng, type RgbaImage } from "@/lib/lobby/pngImage";

const DRAFTS = path.join(process.cwd(), "examples", "drafts");

afterAll(() => {
  closeNameReader();
});

function boxOrigin(image: RgbaImage, box: DraftBox): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.round(box.x * image.width));
  const y = Math.max(0, Math.round(box.y * image.height));
  const w = Math.max(1, Math.min(image.width - x, Math.round(box.w * image.width)));
  const h = Math.max(1, Math.min(image.height - y, Math.round(box.h * image.height)));
  return { x, y, w, h };
}

function boxRgb(image: RgbaImage, box: DraftBox): { r: number; g: number; b: number }[] {
  return cropRgb(image, box).pixels;
}

function cropRgb(
  image: RgbaImage,
  box: DraftBox,
): { pixels: { r: number; g: number; b: number }[]; width: number; height: number } {
  const { x, y, w, h } = boxOrigin(image, box);
  const pixels: { r: number; g: number; b: number }[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      pixels.push({
        r: image.data[i] ?? 0,
        g: image.data[i + 1] ?? 0,
        b: image.data[i + 2] ?? 0,
      });
    }
  }
  return { pixels, width: w, height: h };
}

function sample(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const px = Math.max(0, Math.min(image.width - 1, x));
  const py = Math.max(0, Math.min(image.height - 1, y));
  const i = (py * image.width + px) * 4;
  return [
    image.data[i] ?? 0,
    image.data[i + 1] ?? 0,
    image.data[i + 2] ?? 0,
    image.data[i + 3] ?? 255,
  ];
}

function blitScaled(
  src: RgbaImage,
  dest: Uint8Array,
  destWidth: number,
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
) {
  for (let y = 0; y < to.h; y++) {
    const sy = from.y + ((y + 0.5) * from.h) / to.h - 0.5;
    const y0 = Math.floor(sy);
    const y1 = y0 + 1;
    const fy = sy - y0;
    for (let x = 0; x < to.w; x++) {
      const sx = from.x + ((x + 0.5) * from.w) / to.w - 0.5;
      const x0 = Math.floor(sx);
      const x1 = x0 + 1;
      const fx = sx - x0;
      const mix = (a: number, b: number, t: number) => a + (b - a) * t;
      const c00 = sample(src, x0, y0);
      const c10 = sample(src, x1, y0);
      const c01 = sample(src, x0, y1);
      const c11 = sample(src, x1, y1);
      const di = ((to.y + y) * destWidth + (to.x + x)) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top = mix(c00[channel] ?? 0, c10[channel] ?? 0, fx);
        const bottom = mix(c01[channel] ?? 0, c11[channel] ?? 0, fx);
        dest[di + channel] = Math.round(mix(top, bottom, fy));
      }
    }
  }
}

/** Five nameplates stacked the same way LobbyScreenWatch sends them to OCR. */
function stackNameplates(image: RgbaImage, boxes: readonly DraftBox[]): RgbaImage {
  const cellW = NAMEPLATE_CELL_WIDTH;
  const height = SLOT_LINE_STRIDE * boxes.length;
  const data = new Uint8Array(cellW * height * 4);
  boxes.forEach((box, index) => {
    const cell = nameplateCell(image.width, image.height, box, index, cellW, SLOT_LINE_STRIDE);
    blitScaled(
      image,
      data,
      cellW,
      { x: cell.sx, y: cell.sy, w: cell.sw, h: cell.sh },
      { x: cell.dx, y: cell.dy, w: cell.dw, h: cell.dh },
    );
  });
  return { width: cellW, height, data };
}

/**
 * Title and status crops, scaled the way straightenedPlate does
 * (`min(4, 1100 / width)`) before the local reader sees them.
 */
function scaledLabel(image: RgbaImage, box: DraftBox): RgbaImage {
  const from = boxOrigin(image, box);
  const scale = Math.min(4, 1100 / from.w);
  const w = Math.max(1, Math.round(from.w * scale));
  const h = Math.max(1, Math.round(from.h * scale));
  const data = new Uint8Array(w * h * 4);
  blitScaled(image, data, w, from, { x: 0, y: 0, w, h });
  return { width: w, height: h, data };
}

function pngBase64(image: RgbaImage): string {
  return encodePng(image).toString("base64");
}

type SlotRead = { hero: string | null; player: string | null };

async function loadLobby(file: string) {
  const image = decodePng(readFileSync(file));
  const plates = await readNameColumns(
    pngBase64(stackNameplates(image, DRAFT_SLOT_NAMES.left)),
    pngBase64(stackNameplates(image, DRAFT_SLOT_NAMES.right)),
  );
  const labels = await readNameColumns(
    pngBase64(scaledLabel(image, DRAFT_TITLE_BOX)),
    pngBase64(scaledLabel(image, DRAFT_STATUS_BOX)),
    undefined,
    pngBase64(scaledLabel(image, DRAFT_TURN_BOX)),
  );
  const titleText = labels.left.map((line) => line.text).join(" ");
  const statusText = labels.right.map((line) => line.text).join(" ");
  const centerText = labels.center.map((line) => line.text).join(" ");
  const leftReads = readsBySlot(plates.left);
  const rightReads = readsBySlot(plates.right);
  const locks = (reads: SlotRead[], faces: boolean[]) =>
    reads.flatMap((read, slot) =>
      faces[slot] && read.hero ? [{ hero: read.hero, player: read.player, slot }] : [],
    );
  const leftFaces = DRAFT_PLATE_SLOTS.left.map((box) => portraitFilled(boxRgb(image, box)));
  const rightFaces = DRAFT_PLATE_SLOTS.right.map((box) => portraitFilled(boxRgb(image, box)));
  const bannerText = `${titleText}\n${statusText}`;
  let phase = bannerTurn(bannerText).phase;
  const keepCommitted = banFrameKeepsLockedPicks(`${bannerText}\n${centerText}`);
  const turn = sideFromStatus(bannerText);
  const pixelAt = (x: number, y: number) => {
    const [r, g, b] = sample(image, x, y);
    return { r, g, b };
  };
  const lockedPicks = (
    ally: boolean,
    slots: readonly DraftBox[],
    nameSlots: readonly DraftBox[],
    reads: SlotRead[],
  ) =>
    slots.flatMap((box, slot) => {
      const read = reads[slot];
      const nameBox = nameSlots[slot];
      if (!read?.hero || !nameBox) return [];
      const plate = plateFill(boxRgb(image, nameBox), ally);
      if (
        !portraitIsLocked({
          phase,
          keepCommitted,
          faceFilled: portraitFilled(boxRgb(image, box)),
          plate,
          ally,
          heroOnPlate: true,
        })
      ) {
        return [];
      }
      return [{ hero: read.hero, player: read.player, slot }];
    });
  const seatLocked = (
    ally: boolean,
    slots: readonly DraftBox[],
    nameSlots: readonly DraftBox[],
    reads: SlotRead[],
  ) =>
    slots.map((box, index) => {
      const read = reads[index];
      const nameBox = nameSlots[index];
      const plate = nameBox ? plateFill(boxRgb(image, nameBox), ally) : undefined;
      return portraitIsLocked({
        phase,
        keepCommitted,
        faceFilled: portraitFilled(boxRgb(image, box)),
        plate,
        ally,
        heroOnPlate: Boolean(read?.hero),
      });
    });
  const ourPicks = lockedPicks(true, DRAFT_PLATE_SLOTS.left, DRAFT_SLOT_NAMES.left, leftReads);
  const theirPicks = lockedPicks(
    false,
    DRAFT_PLATE_SLOTS.right,
    DRAFT_SLOT_NAMES.right,
    rightReads,
  );
  const ourOpen = openSeatPlayers(
    leftReads,
    seatLocked(true, DRAFT_PLATE_SLOTS.left, DRAFT_SLOT_NAMES.left, leftReads),
  );
  const theirOpen = openSeatPlayers(
    rightReads,
    seatLocked(false, DRAFT_PLATE_SLOTS.right, DRAFT_SLOT_NAMES.right, rightReads),
  );
  if (!phase && ourPicks.length + theirPicks.length > 0) {
    phase = "pick";
  }
  const map = mapFromTitle(titleText);
  setBanHexMapContext(map);
  const leftBanRead = readBanSide(image, "left");
  const rightBanRead = readBanSide(image, "right");
  setBanHexMapContext(null);
  const ourBans = leftBanRead.chronological;
  const theirBans = rightBanRead.chronological;
  let firstPick =
    (phase === "pick" && ourPicks.length + theirPicks.length === 0
      ? null
      : firstPickFromBanBoard(ourBans, theirBans, { phase })) ??
    firstBanSideFromStatus(statusText) ??
    null;
  const weFirstGuess =
    firstPick === "us" || firstPick === "them"
      ? firstPick === "us"
      : firstPickFromBanBoard(ourBans, theirBans) === "us";
  const fitted = fitObservedPickOrder(
    {
      weFirst: weFirstGuess,
      firstPick,
      phase,
      map,
      ourBans,
      theirBans,
      ourPicks: ourPicks.map((pick) => pick.hero),
      theirPicks: theirPicks.map((pick) => pick.hero),
      ourPickPlayers: ourPicks.map((pick) => pick.player),
      theirPickPlayers: theirPicks.map((pick) => pick.player),
    },
    {
      our: ourPicks.map((pick) => pick.slot),
      their: theirPicks.map((pick) => pick.slot),
    },
  );
  const ourZip = reorderOurPicksForDraftZip(
    fitted.ourPicks,
    fitted.ourPickPlayers,
  );
  const theirZip = {
    heroes: fitted.theirPicks,
    players: fitted.theirPickPlayers,
  };
  const inferredFirst = inferFirstPick({
    ourPicks: ourZip.heroes.length,
    theirPicks: theirZip.heroes.length,
    phase,
    turnSide: turn,
  });
  if (inferredFirst) {
    firstPick = inferredFirst;
  }
  firstPick =
    resolveFirstPick({
      firstPick,
      ourBans,
      theirBans,
      ourPicks: ourZip.heroes,
      theirPicks: theirZip.heroes,
      phase,
      turn: turn && phase ? { side: turn, kind: phase } : null,
      ourPickSlots: ourPicks.map((pick) => pick.slot),
      theirPickSlots: theirPicks.map((pick) => pick.slot),
    }) ?? firstPick;
  const progress =
    firstPick == null
      ? null
      : progressFromObserved({
          weFirst: firstPick === "us",
          firstPick,
          phase,
          map,
          ourBans,
          theirBans,
          ourPicks: ourZip.heroes,
          theirPicks: theirZip.heroes,
          ourPickPlayers: ourZip.players,
          theirPickPlayers: theirZip.players,
        });
  return {
    width: image.width,
    height: image.height,
    map: mapFromTitle(titleText),
    titleText,
    statusText,
    turn: sideFromStatus(statusText),
    banTurn: firstBanSideFromStatus(statusText),
    phase: bannerTurn(bannerText).phase,
    leftBans: leftBanRead.filled,
    rightBans: rightBanRead.filled,
    leftBanHeroes: leftBanRead.slotHeroes,
    rightBanHeroes: rightBanRead.slotHeroes,
    leftFaces,
    rightFaces,
    leftReads,
    rightReads,
    leftLocks: locks(leftReads, leftFaces),
    rightLocks: locks(rightReads, rightFaces),
    firstPick,
    ourPicks,
    theirPicks: theirZip.heroes.map((hero, index) => ({
      hero,
      player: theirZip.players[index] ?? null,
      slot:
        theirPicks.find((pick) => heroKey(pick.hero) === heroKey(hero))?.slot ??
        index,
    })),
    order: progress?.actions ?? [],
    next: progress?.next ?? null,
    ourOpen,
    theirOpen,
  };
}

function folded(name: string | null): string {
  return ocrFold(name ?? "");
}

function listed(
  actions: { side: string; kind: string; hero: string; player?: string | null }[],
): [string, string, string, string][] {
  return actions.map((action) => [
    action.side,
    action.kind,
    action.hero,
    folded(action.player ?? null),
  ]);
}

function readBanSide(image: RgbaImage, side: "left" | "right") {
  const crops = DRAFT_BAN_HEXES[side].map((box) => cropRgb(image, box));
  const { identified, filled, passed } = readThreeBanHexSlots(crops);
  const slotHeroes = identified.map((hero, i) => {
    if (hero) return hero;
    if (passed[i]) return NO_BAN;
    return null;
  });
  return {
    slotHeroes,
    chronological: bansFromHexFaces(identified, filled, [], passed),
    filled,
    passed,
  };
}

describe("draft lobby screenshots", () => {
  it(
    "loads the Infernal Shrines ban lobby",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "draft lobby shrines.png"));
      expect(draft.width).toBe(2560);
      expect(draft.height).toBe(1440);
      expect(draft.map).toBe("Infernal Shrines");
      expect(draft.turn).toBe("our");
      expect(draft.banTurn).toBe("us");
      expect(draft.phase).toBe("ban");
      expect(draft.leftBans).toEqual([false, false, false]);
      expect(draft.rightBans).toEqual([false, false, false]);
      expect(draft.leftBanHeroes).toEqual([null, null, null]);
      expect(draft.rightBanHeroes).toEqual([null, null, null]);
      expect(draft.leftFaces).toEqual([false, true, false, true, false]);
      expect(draft.rightFaces).toEqual([false, false, false, false, false]);
      expect(draft.leftLocks.map((lock) => [lock.slot, lock.hero])).toEqual([
        [1, "Probius"],
        [3, "Cassia"],
      ]);
      expect(draft.leftReads.map((read) => folded(read.player))).toEqual([
        ocrFold("BurnBlade"),
        ocrFold("Answered"),
        ocrFold("HuckIt"),
        ocrFold("ArcKane"),
        ocrFold("Gatcan"),
      ]);
      expect(draft.rightReads.map((read) => folded(read.player))).toEqual([
        "",
        ocrFold("Trinity"),
        ocrFold("STigma"),
        ocrFold("AzureWhale"),
        ocrFold("sofresh"),
      ]);
      expect(draft.rightLocks).toEqual([]);
      expect(draft.firstPick).toBe("us");
      expect(listed(draft.order)).toEqual([]);
      expect(draft.next).toEqual({ side: "our", kind: "ban" });
      expect(draft.ourOpen.map(folded)).toEqual([
        ocrFold("BurnBlade"),
        ocrFold("Answered"),
        ocrFold("HuckIt"),
        ocrFold("ArcKane"),
        ocrFold("Gatcan"),
      ]);
      expect(draft.theirOpen.map(folded)).toEqual([
        ocrFold("Trinity"),
        ocrFold("STigma"),
        ocrFold("AzureWhale"),
        ocrFold("sofresh"),
      ]);
      expect(nextStepSuggestion(DRAFT_ORDER, draft.order.length)).toEqual({
        side: "fp",
        kind: "ban",
        picks: 1,
        last: false,
      });
    },
    180_000,
  );

  it(
    "loads the Volskaya Foundry pick lobby",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "draft lobby volskaya.png"));
      expect(draft.width).toBe(2560);
      expect(draft.height).toBe(1440);
      expect(draft.map).toBe("Volskaya Foundry");
      expect(draft.turn).toBe("their");
      expect(draft.phase).toBeNull();
      expect(draft.leftBans).toEqual([true, true, true]);
      expect(draft.rightBans).toEqual([true, true, true]);
      expect(draft.leftBanHeroes).toEqual(["Johanna", "Sgt. Hammer", "Tyrael"]);
      expect(draft.rightBanHeroes).toEqual(["Qhira", "Xal'atath", "E.T.C."]);
      expect(draft.leftFaces).toEqual([true, true, true, false, true]);
      expect(draft.rightFaces).toEqual([true, true, false, true, true]);
      expect(draft.leftLocks.map((lock) => [lock.slot, lock.hero])).toEqual([
        [0, "Abathur"],
        [1, "Falstad"],
        [2, "Tyrande"],
        [4, "Leoric"],
      ]);
      expect(draft.rightLocks.map((lock) => [lock.slot, lock.hero])).toEqual([
        [0, "Thrall"],
        [1, "Brightwing"],
        [3, "Nazeebo"],
        [4, "Stitches"],
      ]);
      expect(draft.leftReads.map((read) => folded(read.player))).toEqual([
        ocrFold("L337"),
        ocrFold("Dante"),
        ocrFold("HuckIt"),
        ocrFold("hiimrick"),
        ocrFold("Magic"),
      ]);
      expect(draft.rightReads.map((read) => folded(read.player))).toEqual([
        ocrFold("dgcy023"),
        ocrFold("Hoss"),
        ocrFold("SKilleen"),
        ocrFold("Cinema"),
        ocrFold("Silver"),
      ]);
      expect(draft.firstPick).toBe("us");
      expect(draft.next).toEqual({ side: "our", kind: "pick" });
      expect(draft.ourOpen.map(folded)).toEqual([
        ocrFold("Dante"),
        ocrFold("hiimrick"),
      ]);
      expect(draft.theirOpen.map(folded)).toEqual([ocrFold("SKilleen")]);
      expect(nextStepSuggestion(DRAFT_ORDER, draft.order.length)).toEqual({
        side: "fp",
        kind: "pick",
        picks: 2,
        last: true,
      });
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Johanna", ""],
        ["their", "ban", "Qhira", ""],
        ["our", "ban", "Sgt. Hammer", ""],
        ["their", "ban", "Xal'atath", ""],
        ["our", "pick", "Abathur", ocrFold("L337")],
        ["their", "pick", "Thrall", ocrFold("dgcy023")],
        ["their", "pick", "Brightwing", ocrFold("Hoss")],
        ["our", "pick", "Tyrande", ocrFold("HuckIt")],
        ["our", "pick", "Leoric", ocrFold("Magic")],
        ["their", "ban", "E.T.C.", ""],
        ["our", "ban", "Tyrael", ""],
        ["their", "pick", "Nazeebo", ocrFold("Cinema")],
        ["their", "pick", "Stitches", ocrFold("Silver")],
      ]);
    },
    180_000,
  );

  it(
    "loads the Alterac Pass pick lobby without counting hovers as locks",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "draft lobby alterac.png"));
      expect(draft.map).toBe("Alterac Pass");
      expect(draft.turn).toBe("our");
      expect(draft.firstPick).toBe("us");
      expect(draft.next).toEqual({ side: "our", kind: "pick" });
      expect(draft.leftBanHeroes).toEqual(["Johanna", "Zeratul", null]);
      expect(draft.rightBanHeroes).toEqual(["Hogger", "Xal'atath", null]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual(["Qhira"]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Brightwing",
        "Abathur",
      ]);
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Johanna", ""],
        ["their", "ban", "Hogger", ""],
        ["our", "ban", "Zeratul", ""],
        ["their", "ban", "Xal'atath", ""],
        ["our", "pick", "Qhira", ocrFold("HuckIt")],
        ["their", "pick", "Brightwing", ocrFold("AmateurDead")],
        ["their", "pick", "Abathur", ocrFold("vsierra01")],
      ]);
    },
    180_000,
  );

  it(
    "loads Alterac Pass second ban with our first-pick locks",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "alterac 1.png"));
      expect(draft.map).toBe("Alterac Pass");
      expect(draft.phase).toBe("ban");
      expect(draft.turn).toBe("their");
      expect(draft.firstPick).toBe("us");
      expect(draft.leftBanHeroes).toEqual(["Zeratul", "Johanna", null]);
      expect(draft.rightBanHeroes).toEqual(["Falstad", "Xal'atath", null]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Qhira",
        "Rehgar",
        "Tyrael",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual(["Genji", "Hogger"]);
      expect(draft.ourPicks.map((pick) => folded(pick.player))).toEqual([
        ocrFold("Huckit"),
        ocrFold("Wiimote"),
        ocrFold("Saffiel"),
      ]);
      expect(draft.theirPicks.map((pick) => folded(pick.player))).toEqual([
        ocrFold("XalaThot"),
        ocrFold("Diesel17"),
      ]);
      expect(draft.next).toEqual({ side: "their", kind: "ban" });
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Zeratul", ""],
        ["their", "ban", "Falstad", ""],
        ["our", "ban", "Johanna", ""],
        ["their", "ban", "Xal'atath", ""],
        ["our", "pick", "Qhira", ocrFold("Huckit")],
        ["their", "pick", "Genji", ocrFold("XalaThot")],
        ["their", "pick", "Hogger", ocrFold("Diesel17")],
        ["our", "pick", "Rehgar", ocrFold("Wiimote")],
        ["our", "pick", "Tyrael", ocrFold("Saffiel")],
      ]);
    },
    180_000,
  );

  it(
    "loads Alterac Pass late draft with full ban order and hover-safe locks",
    async () => {
      const draft = await loadLobby(
        path.join(DRAFTS, "draft lobby alterac 2.png"),
      );
      expect(draft.map).toBe("Alterac Pass");
      expect(draft.turn).toBe("our");
      expect(draft.phase).toBe("pick");
      expect(draft.firstPick).toBe("us");
      expect(draft.next).toEqual({ side: "our", kind: "pick" });
      expect(draft.leftBanHeroes).toEqual(["Johanna", "Zeratul", "Illidan"]);
      expect(draft.rightBanHeroes).toEqual(["Hogger", "Xal'atath", "Whitemane"]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Muradin",
        "Zagara",
        "Qhira",
        "Ragnaros",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Brightwing",
        "Abathur",
        "Malthael",
        "Sylvanas",
      ]);
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Johanna", ""],
        ["their", "ban", "Hogger", ""],
        ["our", "ban", "Zeratul", ""],
        ["their", "ban", "Xal'atath", ""],
        ["our", "pick", "Muradin", ocrFold("goz")],
        ["their", "pick", "Brightwing", ocrFold("AmateurDead")],
        ["their", "pick", "Abathur", ocrFold("vsierra01")],
        ["our", "pick", "Zagara", ocrFold("WhisperWin")],
        ["our", "pick", "Qhira", ocrFold("Huckit")],
        ["their", "ban", "Whitemane", ""],
        ["our", "ban", "Illidan", ""],
        ["their", "pick", "Malthael", ocrFold("SirWatsonll")],
        ["their", "pick", "Sylvanas", ocrFold("pokes")],
        ["our", "pick", "Ragnaros", ocrFold("PangitMoDiba")],
      ]);
    },
    180_000,
  );

  it(
    "loads Battlefield of Eternity mid-draft before our first pick",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "battlefield.png"));
      expect(draft.map).toBe("Battlefield of Eternity");
      expect(draft.turn).toBe("their");
      expect(draft.firstPick).toBe("them");
      expect(draft.next).toEqual({ side: "our", kind: "pick" });
      expect(draft.leftBanHeroes).toEqual([NO_BAN, "Xal'atath", null]);
      expect(draft.rightBanHeroes).toEqual(["Qhira", NO_BAN, null]);
      expect(draft.ourPicks).toEqual([]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual(["Diablo"]);
      expect(listed(draft.order)).toEqual([
        ["their", "ban", "Qhira", ""],
        ["our", "ban", NO_BAN, ""],
        ["their", "ban", NO_BAN, ""],
        ["our", "ban", "Xal'atath", ""],
        ["their", "pick", "Diablo", ocrFold("DrDoomYo")],
      ]);
      expect(nextStepSuggestion(DRAFT_ORDER, draft.order.length)).toEqual({
        side: "sp",
        kind: "pick",
        picks: 2,
        last: false,
      });
    },
    180_000,
  );

  it(
    "loads Braxis Holdout mid-draft without counting ally hovers as locks",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "braxis 1.png"));
      expect(draft.map).toBe("Braxis Holdout");
      expect(draft.phase).toBe("pick");
      expect(draft.firstPick).toBe("us");
      expect(draft.leftBanHeroes).toEqual(["Qhira", null, null]);
      expect(draft.rightBanHeroes).toEqual(["Maiev", "Chromie", null]);
      expect(draft.ourPicks).toEqual([]);
      expect(draft.theirPicks).toEqual([]);
      expect(draft.leftReads[0]?.hero).toBe("Johanna");
      expect(folded(draft.leftReads[0]?.player ?? null)).toBe(ocrFold("Bunny"));
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Qhira", ""],
        ["their", "ban", "Maiev", ""],
        ["our", "ban", UNSEEN_BAN, ""],
        ["their", "ban", "Chromie", ""],
      ]);
      expect(draft.next).toEqual({ side: "our", kind: "pick" });
    },
    180_000,
  );

  it(
    "loads Braxis Holdout finished draft with mid bans and full pick order",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "braxis 2.png"));
      expect(draft.map).toBe("Braxis Holdout");
      expect(draft.firstPick).toBe("us");
      expect(draft.leftBanHeroes).toEqual(["Qhira", "Chen", "Xal'atath"]);
      expect(draft.rightBanHeroes).toEqual(["Maiev", "Chromie", "Yrel"]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Johanna",
        "Rexxar",
        "Tychus",
        "Junkrat",
        "Kharazim",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Sgt. Hammer",
        "Lt. Morales",
        "Artanis",
        "Diablo",
        "Zul'jin",
      ]);
      expect(listed(draft.order)).toEqual([
        ["our", "ban", "Qhira", ""],
        ["their", "ban", "Maiev", ""],
        ["our", "ban", "Chen", ""],
        ["their", "ban", "Chromie", ""],
        ["our", "pick", "Johanna", ocrFold("Bunny")],
        ["their", "pick", "Sgt. Hammer", ocrFold("TOP")],
        ["their", "pick", "Lt. Morales", ocrFold("Prolith")],
        ["our", "pick", "Rexxar", ocrFold("CEOMEGALUL")],
        ["our", "pick", "Tychus", ocrFold("DeadEyeDan")],
        ["their", "ban", "Yrel", ""],
        ["our", "ban", "Xal'atath", ""],
        ["their", "pick", "Artanis", ocrFold("Rantore")],
        ["their", "pick", "Diablo", ocrFold("eklml3laco")],
        ["our", "pick", "Junkrat", ocrFold("dlrtyymlke")],
        ["our", "pick", "Kharazim", ocrFold("HuckIt")],
        ["their", "pick", "Zul'jin", ocrFold("agarrlne")],
      ]);
      expect(draft.next).toBeNull();
    },
    180_000,
  );

  it(
    "loads Battlefield of Eternity double-pick window with unseen ban slots",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "battlefield 2.png"));
      expect(draft.map).toBe("Battlefield of Eternity");
      expect(draft.firstPick).toBe("them");
      expect(draft.leftBanHeroes).toEqual([NO_BAN, "Xal'atath", NO_BAN]);
      expect(draft.rightBanHeroes).toEqual(["Qhira", NO_BAN, "Johanna"]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Whitemane",
        "Falstad",
        "Tyrael",
        "Lunara",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Chen",
        "Greymane",
        "Diablo",
        "Alarak",
      ]);
      expect(draft.ourPicks.map((pick) => folded(pick.player))).toEqual([
        ocrFold("Huckit"),
        ocrFold("LiuMei"),
        ocrFold("Kalel"),
        ocrFold("Lochen"),
      ]);
      expect(draft.theirPicks.map((pick) => folded(pick.player))).toEqual([
        ocrFold("barberousse"),
        ocrFold("Miclen"),
        ocrFold("DrDoomYo"),
        ocrFold("mFreePoints"),
      ]);
      expect(draft.next?.kind).toBe("pick");
      expect(draft.order.length).toBeGreaterThanOrEqual(10);
      expect(nextStepSuggestion(DRAFT_ORDER, draft.order.length)).toEqual({
        side: "fp",
        kind: "pick",
        picks: 1,
        last: true,
      });
    },
    180_000,
  );

  it(
    "loads Battlefield of Eternity mid-pick with six bans and five locks",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "battlefield 3.png"));
      expect(draft.map).toBe("Battlefield of Eternity");
      expect(draft.leftBanHeroes).toEqual(["Qhira", "Johanna", "Falstad"]);
      expect(draft.rightBanHeroes).toEqual(["Xal'atath", "Abathur", "Artanis"]);
      expect(draft.ourPicks.map((pick) => pick.hero).sort()).toEqual([
        "Raynor",
        "Whitemane",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero).sort()).toEqual([
        "Brightwing",
        "Kael'thas",
        "Mal'Ganis",
      ]);
      // Pick chronology needs live announcements — a still only proves who locked.
      expect(draft.firstPick).toBe("them");
    },
    180_000,
  );

  it(
    "loads Haunted Mines blue ban with ally locks ignored and ban order intact",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "haunted mines 1.png"));
      expect(draft.map).toBe("Haunted Mines");
      expect(draft.phase).toBe("ban");
      expect(draft.firstPick).toBe("them");
      expect(draft.next).toEqual({ side: "their", kind: "pick" });
      expect(draft.leftBanHeroes[0]).toBe("Qhira");
      expect(draft.leftBanHeroes[1]).toBe("Falstad");
      expect(draft.leftBanHeroes[2]).toBeNull();
      expect(draft.rightBanHeroes[0]).toBe("Xal'atath");
      expect(draft.rightBanHeroes[1]).toBe("Kel'Thuzad");
      expect(draft.rightBanHeroes[2]).toBeNull();
      expect(draft.ourPicks).toEqual([]);
      expect(draft.theirPicks).toEqual([]);
      expect(draft.leftReads.map((read) => read.hero)).toEqual([
        "Sylvanas",
        "Alarak",
        "Brightwing",
        "Varian",
        "Thrall",
      ]);
      expect(draft.leftFaces.filter(Boolean).length).toBeGreaterThanOrEqual(4);
      expect(listed(draft.order).slice(0, 4)).toEqual([
        ["their", "ban", "Xal'atath", ""],
        ["our", "ban", "Qhira", ""],
        ["their", "ban", "Kel'Thuzad", ""],
        ["our", "ban", "Falstad", ""],
      ]);
    },
    180_000,
  );

  it(
    "loads Cursed Hollow with our ban hexes and ban order",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "cursed hollow.png"));
      expect(draft.map).toBe("Cursed Hollow");
      expect(draft.leftBanHeroes).toEqual(["Johanna", "Anduin", "Dehaka"]);
      expect(draft.rightBanHeroes).toEqual(["Qhira", "Xal'atath", "Stitches"]);
      expect(draft.ourPicks.length).toBe(4);
      expect(draft.theirPicks.length).toBe(3);
      expect(pickCountsFit(false, draft.ourPicks.length, draft.theirPicks.length)).toBe(
        true,
      );
      expect(pickCountsFit(true, draft.ourPicks.length, draft.theirPicks.length)).toBe(
        false,
      );
      expect(draft.firstPick).toBe("them");
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Rehgar",
        "Alarak",
        "Tyrael",
        "Sylvanas",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Greymane",
        "Brightwing",
        "Falstad",
      ]);
    },
    180_000,
  );

  it(
    "loads Haunted Mines enemy fifth pick with bans and locked picks",
    async () => {
      const draft = await loadLobby(path.join(DRAFTS, "haunted mines 2.png"));
      expect(draft.map).toBe("Haunted Mines");
      expect(draft.turn).toBe("their");
      expect(draft.firstPick).toBe("them");
      expect(draft.next).toEqual({ side: "their", kind: "pick" });
      expect(draft.leftBanHeroes).toEqual(["Garrosh", "Qhira", "Anduin"]);
      expect(draft.rightBanHeroes).toEqual(["Xal'atath", "Abathur", "Ragnaros"]);
      expect(draft.ourPicks.map((pick) => pick.hero)).toEqual([
        "Johanna",
        "Hanzo",
        "Tyrande",
        "Thrall",
      ]);
      expect(draft.theirPicks.map((pick) => pick.hero)).toEqual([
        "Stitches",
        "Kharazim",
        "Tracer",
        "Valeera",
      ]);
      expect(draft.leftReads[2]?.hero).toBeNull();
      expect(folded(draft.ourOpen[0])).toBe(ocrFold("DivineAlign"));
      expect(folded(draft.theirOpen[0])).toBe(ocrFold("RoyalVizier"));
      expect(listed(draft.order)).toEqual([
        ["their", "ban", "Xal'atath", ""],
        ["our", "ban", "Garrosh", ""],
        ["their", "ban", "Abathur", ""],
        ["our", "ban", "Qhira", ""],
        ["their", "pick", "Stitches", ocrFold("VickAgain")],
        ["our", "pick", "Johanna", ocrFold("SportySpice")],
        ["our", "pick", "Hanzo", ocrFold("Slumpinator")],
        ["their", "pick", "Kharazim", ocrFold("BenDoverman")],
        ["their", "pick", "Tracer", ocrFold("Viccuri")],
        ["our", "ban", "Anduin", ""],
        ["their", "ban", "Ragnaros", ""],
        ["our", "pick", "Tyrande", ocrFold("CruelAlloy")],
        ["our", "pick", "Thrall", ocrFold("Huckit")],
        ["their", "pick", "Valeera", ocrFold("EKevin")],
      ]);
      expect(nextStepSuggestion(DRAFT_ORDER, draft.order.length)).toEqual({
        side: "fp",
        kind: "pick",
        picks: 1,
        last: true,
      });
    },
    180_000,
  );
});
