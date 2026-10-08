import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchBanPixels } from "@/lib/lobby/banFace";
import { decodePng } from "@/lib/lobby/pngImage";
import type { Rgb } from "@/lib/lobby/screenLobby";

const LOBBY = path.join(process.cwd(), "examples", "drafts", "draft lobby volskaya.png");

function crop(file: string, x0: number, y0: number, x1: number, y1: number): string | null {
  const image = decodePng(readFileSync(file));
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels: Rgb[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = ((y0 + y) * image.width + (x0 + x)) * 4;
      pixels.push({
        r: image.data[i] ?? 0,
        g: image.data[i + 1] ?? 0,
        b: image.data[i + 2] ?? 0,
      });
    }
  }
  return matchBanPixels(pixels, width, height);
}

describe("ban portraits", () => {
  it("names the Volskaya ban hexes from the hero portraits", () => {
    expect([
      crop(LOBBY, 378, 22, 452, 118),
      crop(LOBBY, 510, 22, 584, 118),
      crop(LOBBY, 642, 22, 716, 118),
      crop(LOBBY, 1840, 22, 1914, 118),
      crop(LOBBY, 1972, 22, 2046, 118),
      crop(LOBBY, 2104, 22, 2178, 118),
    ]).toEqual(["Johanna", "Sgt. Hammer", "Tyrael", "Qhira", "Xal'atath", "E.T.C."]);
  });
});
