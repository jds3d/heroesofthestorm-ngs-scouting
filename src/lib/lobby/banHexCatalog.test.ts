import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  banFace,
  banFaceScore,
  catalogRowFromBanHex,
  matchBanPixels,
  matchSavedBanHex,
  readThreeBanHexSlots,
  setBanHexMapContext,
} from "@/lib/lobby/banFace";
import { banHexManifest, rowsFromBanHexExamples } from "@/lib/lobby/banHexCatalog";
import { DRAFT_BAN_HEXES, NO_BAN } from "@/lib/lobby/screenLobby";
import { decodePng, encodePng } from "@/lib/lobby/pngImage";

const HEX_DIR = path.join(process.cwd(), "examples", "ban-hexes");
const CATALOG_JSON = path.join(process.cwd(), "src", "lib", "lobby", "banHexCatalog.json");
const DRAFTS = path.join(process.cwd(), "examples", "drafts");
const ALTERAC = path.join(DRAFTS, "draft lobby alterac 2.png");

type BanCrop = { pixels: { r: number; g: number; b: number }[]; width: number; height: number };

function banSlotHeroes(crops: BanCrop[]): (string | null)[] {
  const { identified, passed } = readThreeBanHexSlots(crops);
  return identified.map((hero, i) => {
    if (hero) return hero;
    if (passed[i]) return NO_BAN;
    return null;
  });
}

function readDraftBanRow(
  image: ReturnType<typeof decodePng>,
  side: "left" | "right",
): (string | null)[] {
  const crops = DRAFT_BAN_HEXES[side].map((box) => cropHex(image, box));
  return banSlotHeroes(crops);
}

/** Same ban-slot expectations as draftLobbies.test.ts (live readThreeBanHexSlots path). */
const DRAFT_BAN_GOLDEN: {
  file: string;
  map: string;
  left: (string | null)[];
  right: (string | null)[];
}[] = [
  {
    file: "draft lobby volskaya.png",
    map: "Volskaya Foundry",
    left: ["Johanna", "Sgt. Hammer", "Tyrael"],
    right: ["Qhira", "Xal'atath", "E.T.C."],
  },
  {
    file: "draft lobby alterac.png",
    map: "Alterac Pass",
    left: ["Johanna", "Zeratul", null],
    right: ["Hogger", "Xal'atath", null],
  },
  {
    file: "draft lobby alterac 2.png",
    map: "Alterac Pass",
    left: ["Johanna", "Zeratul", "Illidan"],
    right: ["Hogger", "Xal'atath", "Whitemane"],
  },
  {
    file: "battlefield.png",
    map: "Battlefield of Eternity",
    left: [NO_BAN, "Xal'atath", null],
    right: ["Qhira", NO_BAN, null],
  },
  {
    file: "braxis 1.png",
    map: "Braxis Holdout",
    left: ["Qhira", "Chen", null],
    right: ["Maiev", "Chromie", null],
  },
  {
    file: "braxis 2.png",
    map: "Braxis Holdout",
    left: ["Qhira", "Chen", "Xal'atath"],
    right: ["Maiev", "Chromie", "Yrel"],
  },
  {
    file: "battlefield 2.png",
    map: "Battlefield of Eternity",
    left: [NO_BAN, "Xal'atath", NO_BAN],
    right: ["Qhira", NO_BAN, "Johanna"],
  },
  {
    file: "battlefield 3.png",
    map: "Battlefield of Eternity",
    left: ["Qhira", "Johanna", "Falstad"],
    right: ["Xal'atath", "Abathur", "Artanis"],
  },
  {
    file: "battlefield 4.png",
    map: "Battlefield of Eternity",
    left: ["Xal'atath", "Qhira", null],
    right: ["Brightwing", "Johanna", null],
  },
  {
    file: "haunted mines 1.png",
    map: "Haunted Mines",
    left: ["Qhira", "Falstad", null],
    right: ["Xal'atath", "Kel'Thuzad", null],
  },
  {
    file: "haunted mines 2.png",
    map: "Haunted Mines",
    left: ["Garrosh", "Qhira", "Anduin"],
    right: ["Xal'atath", "Abathur", "Ragnaros"],
  },
  {
    file: "garden 2.png",
    map: "Garden of Terror",
    left: ["Xal'atath", "Johanna", "Stukov"],
    right: ["Qhira", NO_BAN, "Ana"],
  },
  {
    file: "haunted 3.png",
    map: "Haunted Mines",
    left: ["Xal'atath", "E.T.C.", "Tychus"],
    right: ["Qhira", "Garrosh", "Auriel"],
  },
  {
    file: "cursed hollow.png",
    map: "Cursed Hollow",
    left: ["Johanna", "Anduin", "Dehaka"],
    right: ["Qhira", "Xal'atath", "Stitches"],
  },
  {
    file: "tomb 1.png",
    map: "Tomb of the Spider Queen",
    left: ["Qhira", "Anduin", "Falstad"],
    right: ["Johanna", "Xal'atath", null],
  },
];

function cropHex(
  image: ReturnType<typeof decodePng>,
  box: { x: number; y: number; w: number; h: number },
) {
  const x = Math.max(0, Math.round(box.x * image.width));
  const y = Math.max(0, Math.round(box.y * image.height));
  const w = Math.max(1, Math.min(image.width - x, Math.round(box.w * image.width)));
  const h = Math.max(1, Math.min(image.height - y, Math.round(box.h * image.height)));
  const pixels: { r: number; g: number; b: number }[] = [];
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * image.width + (x + col)) * 4;
      const rgb = { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
      pixels.push(rgb);
      const di = (row * w + col) * 4;
      data[di] = rgb.r;
      data[di + 1] = rgb.g;
      data[di + 2] = rgb.b;
      data[di + 3] = 255;
    }
  }
  return { pixels, width: w, height: h, png: encodePng({ width: w, height: h, data }) };
}

describe("ban hex catalog", () => {
  it("regenerates PNGs and banHexCatalog.json from the manifest sources", () => {
    if (process.env.REGEN_BAN_HEX !== "1") return;
    const manifest = banHexManifest();
    const drafts = path.join(process.cwd(), "examples", "drafts");
    mkdirSync(HEX_DIR, { recursive: true });
    const rows = manifest.map((row) => {
      const source = path.join(drafts, row.source ?? "draft lobby alterac 2.png");
      const image = decodePng(readFileSync(source));
      const side = row.side ?? "right";
      const slot = row.slot ?? 0;
      const box = DRAFT_BAN_HEXES[side][slot];
      if (!box) throw new Error(`no ban box for ${row.hero}`);
      const crop = cropHex(image, box);
      writeFileSync(path.join(HEX_DIR, row.file), crop.png);
      const catalog = catalogRowFromBanHex(
        row.hero,
        crop.pixels,
        crop.width,
        crop.height,
        row.map,
      );
      if (!catalog) throw new Error(`no catalog row for ${row.hero}`);
      return catalog;
    });
    writeFileSync(CATALOG_JSON, JSON.stringify(rows, null, 2) + "\n");
  });

  it("names every manifest hero on its source screenshot crop", () => {
    const manifest = banHexManifest();
    const drafts = DRAFTS;
    for (const row of manifest) {
      if (!row.source) continue;
      if (row.map) setBanHexMapContext(row.map);
      const image = decodePng(readFileSync(path.join(drafts, row.source)));
      const side = row.side ?? "right";
      const slot = row.slot ?? 0;
      const box = DRAFT_BAN_HEXES[side][slot];
      if (!box) throw new Error(`no ban box for ${row.hero}`);
      const crop = cropHex(image, box);
      expect(matchBanPixels(crop.pixels, crop.width, crop.height)).toBe(row.hero);
      setBanHexMapContext(null);
    }
  }, 120_000);

  it("reads draft lobby ban rows via readThreeBanHexSlots", () => {
    for (const row of DRAFT_BAN_GOLDEN) {
      setBanHexMapContext(row.map);
      const image = decodePng(readFileSync(path.join(DRAFTS, row.file)));
      expect(readDraftBanRow(image, "left")).toEqual(row.left);
      expect(readDraftBanRow(image, "right")).toEqual(row.right);
      setBanHexMapContext(null);
    }
  }, 180_000);

  it("scores a saved hex at ~100% against its catalog row", () => {
    const manifest = banHexManifest();
    const rows = rowsFromBanHexExamples();
    expect(rows.length).toBe(manifest.length);
    manifest.forEach((entry, index) => {
      const row = rows[index];
      expect(row?.hero).toBe(entry.hero);
      const file = path.join(HEX_DIR, path.basename(entry.file));
      const image = decodePng(readFileSync(file));
      const pixels = [];
      for (let i = 0; i < image.width * image.height; i++) {
        pixels.push({
          r: image.data[i * 4] ?? 0,
          g: image.data[i * 4 + 1] ?? 0,
          b: image.data[i * 4 + 2] ?? 0,
        });
      }
      const face = banFace(pixels, image.width, image.height);
      expect(face).not.toBeNull();
      expect(banFaceScore(face!, row!)).toBeGreaterThan(0.99);
    });
  });

  it("names Xal'atath on Battlefield (not Sylvanas hex false positive)", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "battlefield.png")),
    );
    const xal = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    expect(matchBanPixels(xal.pixels, xal.width, xal.height)).toBe("Xal'atath");
  });

  it("names Sky Temple 2 bans as Dehaka and Johanna on the left, Falstad and Xal'atath on the right", () => {
    setBanHexMapContext("Sky Temple");
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "sky temple 2.png")),
    );
    expect(readDraftBanRow(image, "left")).toEqual(["Dehaka", "Johanna", null]);
    expect(readDraftBanRow(image, "right")).toEqual(["Falstad", "Xal'atath", null]);
    setBanHexMapContext(null);
  });

  it("names Hogger and Whitemane on Alterac with hex examples in the catalog", () => {
    const image = decodePng(readFileSync(ALTERAC));
    const hogger = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const whitemane = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(hogger.pixels, hogger.width, hogger.height)).toBe("Hogger");
    expect(matchBanPixels(whitemane.pixels, whitemane.width, whitemane.height)).toBe("Whitemane");
  }, 20_000);

  it("names Battlefield 3 six ban hexes", () => {
    setBanHexMapContext("Battlefield of Eternity");
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "battlefield 3.png")),
    );
    const left0 = cropHex(image, DRAFT_BAN_HEXES.left[0]);
    const left1 = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    const left2 = cropHex(image, DRAFT_BAN_HEXES.left[2]);
    const right0 = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const right1 = cropHex(image, DRAFT_BAN_HEXES.right[1]);
    const right2 = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(left0.pixels, left0.width, left0.height)).toBe("Qhira");
    expect(matchBanPixels(left1.pixels, left1.width, left1.height)).toBe("Johanna");
    expect(matchBanPixels(left2.pixels, left2.width, left2.height)).toBe("Falstad");
    expect(matchBanPixels(right0.pixels, right0.width, right0.height)).toBe("Xal'atath");
    expect(matchBanPixels(right1.pixels, right1.width, right1.height)).toBe("Abathur");
    expect(matchBanPixels(right2.pixels, right2.width, right2.height)).toBe("Artanis");
    setBanHexMapContext(null);
  }, 30_000);

  it("names Haunted Mines 1 ban hexes (Qhira, Falstad, Xal'atath, Kel'Thuzad)", () => {
    setBanHexMapContext("Haunted Mines");
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "haunted mines 1.png")),
    );
    const qhira = cropHex(image, DRAFT_BAN_HEXES.left[0]);
    const falstad = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    const xal = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const kel = cropHex(image, DRAFT_BAN_HEXES.right[1]);
    expect(matchBanPixels(qhira.pixels, qhira.width, qhira.height)).toBe("Qhira");
    expect(matchBanPixels(falstad.pixels, falstad.width, falstad.height)).toBe("Falstad");
    expect(matchBanPixels(xal.pixels, xal.width, xal.height)).toBe("Xal'atath");
    expect(matchBanPixels(kel.pixels, kel.width, kel.height)).toBe("Kel'Thuzad");
    setBanHexMapContext(null);
  });

  it("names Haunted Mines 2 ban hexes (Xal'atath, Ragnaros, Anduin on left slot 2)", () => {
    setBanHexMapContext("Haunted Mines");
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "haunted mines 2.png")),
    );
    const garrosh = cropHex(image, DRAFT_BAN_HEXES.left[0]);
    const qhira = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    const anduin = cropHex(image, DRAFT_BAN_HEXES.left[2]);
    const xalatath = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const abathur = cropHex(image, DRAFT_BAN_HEXES.right[1]);
    const ragnaros = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(garrosh.pixels, garrosh.width, garrosh.height)).toBe("Garrosh");
    expect(matchBanPixels(qhira.pixels, qhira.width, qhira.height)).toBe("Qhira");
    expect(matchBanPixels(anduin.pixels, anduin.width, anduin.height)).toBe("Anduin");
    expect(matchBanPixels(xalatath.pixels, xalatath.width, xalatath.height)).toBe("Xal'atath");
    expect(matchBanPixels(abathur.pixels, abathur.width, abathur.height)).toBe("Abathur");
    expect(matchBanPixels(ragnaros.pixels, ragnaros.width, ragnaros.height)).toBe("Ragnaros");
    const row = readThreeBanHexSlots([garrosh, qhira, anduin]);
    expect(row.identified).toEqual(["Garrosh", "Qhira", "Anduin"]);
    const rowR = readThreeBanHexSlots([xalatath, abathur, ragnaros]);
    expect(rowR.identified).toEqual(["Xal'atath", "Abathur", "Ragnaros"]);
    setBanHexMapContext(null);
  }, 60_000);

  it("names Cursed Hollow six ban hexes", () => {
    setBanHexMapContext("Cursed Hollow");
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "examples", "drafts", "cursed hollow.png")),
    );
    const left0 = cropHex(image, DRAFT_BAN_HEXES.left[0]);
    const left1 = cropHex(image, DRAFT_BAN_HEXES.left[1]);
    const left2 = cropHex(image, DRAFT_BAN_HEXES.left[2]);
    const right0 = cropHex(image, DRAFT_BAN_HEXES.right[0]);
    const right1 = cropHex(image, DRAFT_BAN_HEXES.right[1]);
    const right2 = cropHex(image, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(left0.pixels, left0.width, left0.height)).toBe("Johanna");
    expect(matchBanPixels(left1.pixels, left1.width, left1.height)).toBe("Anduin");
    expect(matchBanPixels(left2.pixels, left2.width, left2.height)).toBe("Dehaka");
    expect(matchBanPixels(right0.pixels, right0.width, right0.height)).toBe("Qhira");
    expect(matchBanPixels(right1.pixels, right1.width, right1.height)).toBe("Xal'atath");
    expect(matchBanPixels(right2.pixels, right2.width, right2.height)).toBe("Stitches");
    const leftRow = readThreeBanHexSlots([left0, left1, left2]);
    expect(leftRow.identified).toEqual(["Johanna", "Anduin", "Dehaka"]);
    const rightRow = readThreeBanHexSlots([right0, right1, right2]);
    expect(rightRow.identified).toEqual(["Qhira", "Xal'atath", "Stitches"]);
    setBanHexMapContext(null);
  }, 30_000);

  it("names Braxis ban hexes from the corrected crops", () => {
    const drafts = path.join(process.cwd(), "examples", "drafts");
    const braxis1 = decodePng(readFileSync(path.join(drafts, "braxis 1.png")));
    const braxis2 = decodePng(readFileSync(path.join(drafts, "braxis 2.png")));
    const qhira = cropHex(braxis1, DRAFT_BAN_HEXES.left[0]);
    const maiev = cropHex(braxis1, DRAFT_BAN_HEXES.right[0]);
    expect(matchBanPixels(qhira.pixels, qhira.width, qhira.height)).toBe("Qhira");
    expect(matchBanPixels(maiev.pixels, maiev.width, maiev.height)).toBe("Maiev");
    const chromie = cropHex(braxis1, DRAFT_BAN_HEXES.right[1]);
    expect(matchBanPixels(chromie.pixels, chromie.width, chromie.height)).toBe("Chromie");
    const qhira2 = cropHex(braxis2, DRAFT_BAN_HEXES.left[0]);
    const chen = cropHex(braxis2, DRAFT_BAN_HEXES.left[1]);
    const xalatath = cropHex(braxis2, DRAFT_BAN_HEXES.left[2]);
    const yrel = cropHex(braxis2, DRAFT_BAN_HEXES.right[2]);
    expect(matchBanPixels(chen.pixels, chen.width, chen.height)).toBe("Chen");
    const row = readThreeBanHexSlots([qhira2, chen, xalatath]);
    expect(row.identified).toEqual(["Qhira", "Chen", "Xal'atath"]);
    expect(matchBanPixels(xalatath.pixels, xalatath.width, xalatath.height)).toBe("Xal'atath");
    const rows = rowsFromBanHexExamples();
    const yrelRow = rows.find((row) => row.hero === "Yrel");
    expect(yrelRow).toBeDefined();
    const yrelFace = banFace(yrel.pixels, yrel.width, yrel.height);
    expect(yrelFace).not.toBeNull();
    expect(banFaceScore(yrelFace!, yrelRow!)).toBeGreaterThan(0.99);
    expect(matchBanPixels(yrel.pixels, yrel.width, yrel.height)).toBe("Yrel");
  }, 180_000);

  it("names the Yrel draft portrait Yrel, not Tyrande", () => {
    const image = decodePng(
      readFileSync(path.join(process.cwd(), "public", "heroes", "draft", "yrel.png")),
    );
    const pixels: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < image.width * image.height; i++) {
      pixels.push({
        r: image.data[i * 4] ?? 0,
        g: image.data[i * 4 + 1] ?? 0,
        b: image.data[i * 4 + 2] ?? 0,
      });
    }
    const named = matchBanPixels(pixels, image.width, image.height);
    expect(named).toBe("Yrel");
  });
});
