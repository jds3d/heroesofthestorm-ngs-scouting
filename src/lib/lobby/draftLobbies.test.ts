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
  SLOT_LINE_STRIDE,
  NAMEPLATE_CELL_WIDTH,
  banHexFilled,
  bannerTurn,
  borderLooksLocked,
  firstBanSideFromStatus,
  inferFirstPick,
  mapFromTitle,
  nameplateCell,
  ocrFold,
  portraitFilled,
  progressFromObserved,
  readsBySlot,
  sideFromStatus,
  type DraftBox,
} from "@/lib/lobby/screenLobby";
import { matchBanPixels } from "@/lib/lobby/banFace";
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

/** Lumas just outside a portrait. A locked pick has a bright rim; a pre-pick does not. */
function rimLumas(image: RgbaImage, box: DraftBox): number[] {
  const { x, y, w, h } = boxOrigin(image, box);
  const at = (px: number, py: number) => {
    const [r, g, b] = sample(image, px, py);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lumas: number[] = [];
  for (let px = x - 6; px < x + w + 6; px++) {
    lumas.push(at(px, y - 4), at(px, y - 3), at(px, y + h + 2), at(px, y + h + 3));
  }
  for (let py = y - 2; py < y + h + 2; py++) {
    lumas.push(at(x - 4, py), at(x - 3, py), at(x + w + 2, py), at(x + w + 3, py));
  }
  return lumas;
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
  );
  const titleText = labels.left.map((line) => line.text).join(" ");
  const statusText = labels.right.map((line) => line.text).join(" ");
  const leftReads = readsBySlot(plates.left);
  const rightReads = readsBySlot(plates.right);
  const locks = (reads: SlotRead[], faces: boolean[]) =>
    reads.flatMap((read, slot) =>
      faces[slot] && read.hero ? [{ hero: read.hero, player: read.player, slot }] : [],
    );
  const leftFaces = DRAFT_PLATE_SLOTS.left.map((box) => portraitFilled(boxRgb(image, box)));
  const rightFaces = DRAFT_PLATE_SLOTS.right.map((box) => portraitFilled(boxRgb(image, box)));
  const phase = bannerTurn(statusText).phase;
  const turn = sideFromStatus(statusText);
  // A bright rim is a lock. A hero only highlighted, and every face during bans, is not a pick yet.
  const lockedPicks = (slots: readonly DraftBox[], reads: SlotRead[]) =>
    phase === "ban"
      ? []
      : slots.flatMap((box, slot) => {
          const read = reads[slot];
          if (!read?.hero || !portraitFilled(boxRgb(image, box))) return [];
          if (!borderLooksLocked(rimLumas(image, box))) return [];
          return [{ hero: read.hero, player: read.player }];
        });
  const ourPicks = lockedPicks(DRAFT_PLATE_SLOTS.left, leftReads);
  const theirPicks = lockedPicks(DRAFT_PLATE_SLOTS.right, rightReads);
  const ourBans = DRAFT_BAN_HEXES.left.flatMap((box) => {
    const crop = cropRgb(image, box);
    if (!banHexFilled(crop.pixels)) return [];
    const hero = matchBanPixels(crop.pixels, crop.width, crop.height);
    return hero ? [hero] : [];
  });
  const theirBans = DRAFT_BAN_HEXES.right.flatMap((box) => {
    const crop = cropRgb(image, box);
    if (!banHexFilled(crop.pixels)) return [];
    const hero = matchBanPixels(crop.pixels, crop.width, crop.height);
    return hero ? [hero] : [];
  });
  const firstPick =
    inferFirstPick({
      ourPicks: ourPicks.length,
      theirPicks: theirPicks.length,
      phase,
      turnSide: turn,
    }) ??
    (ourPicks.length + theirPicks.length === 0 ? firstBanSideFromStatus(statusText) : null);
  const progress =
    firstPick == null
      ? null
      : progressFromObserved({
          weFirst: firstPick === "us",
          firstPick,
          phase,
          map: mapFromTitle(titleText),
          ourBans,
          theirBans,
          ourPicks: ourPicks.map((pick) => pick.hero),
          theirPicks: theirPicks.map((pick) => pick.hero),
          ourPickPlayers: ourPicks.map((pick) => pick.player),
          theirPickPlayers: theirPicks.map((pick) => pick.player),
        });
  return {
    width: image.width,
    height: image.height,
    map: mapFromTitle(titleText),
    titleText,
    statusText,
    turn: sideFromStatus(statusText),
    banTurn: firstBanSideFromStatus(statusText),
    phase: bannerTurn(statusText).phase,
    leftBans: DRAFT_BAN_HEXES.left.map((box) => banHexFilled(boxRgb(image, box))),
    rightBans: DRAFT_BAN_HEXES.right.map((box) => banHexFilled(boxRgb(image, box))),
    leftBanHeroes: DRAFT_BAN_HEXES.left.map((box) => {
      const crop = cropRgb(image, box);
      return banHexFilled(crop.pixels) ? matchBanPixels(crop.pixels, crop.width, crop.height) : null;
    }),
    rightBanHeroes: DRAFT_BAN_HEXES.right.map((box) => {
      const crop = cropRgb(image, box);
      return banHexFilled(crop.pixels) ? matchBanPixels(crop.pixels, crop.width, crop.height) : null;
    }),
    leftFaces,
    rightFaces,
    leftReads,
    rightReads,
    leftLocks: locks(leftReads, leftFaces),
    rightLocks: locks(rightReads, rightFaces),
    firstPick,
    order: progress?.actions ?? [],
    next: progress?.next ?? null,
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
});
