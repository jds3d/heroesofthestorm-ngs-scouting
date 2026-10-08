import { crc32, deflateSync, inflateSync } from "node:zlib";

export type RgbaImage = { width: number; height: number; data: Uint8Array };

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distLeft = Math.abs(estimate - left);
  const distUp = Math.abs(estimate - up);
  const distUpLeft = Math.abs(estimate - upLeft);
  if (distLeft <= distUp && distLeft <= distUpLeft) return left;
  if (distUp <= distUpLeft) return up;
  return upLeft;
}

/** 8-bit RGB or RGBA PNG, no interlacing. */
export function decodePng(bytes: Buffer): RgbaImage {
  if (!bytes.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a png");
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }
  if (width === 0 || height === 0) throw new Error("png missing header");
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported png depth ${bitDepth} color ${colorType} interlace ${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++] ?? 0;
    for (let i = 0; i < stride; i++) {
      const sample = raw[src + i] ?? 0;
      const left = i >= channels ? (row[i - channels] ?? 0) : 0;
      const up = prev[i] ?? 0;
      const upLeft = i >= channels ? (prev[i - channels] ?? 0) : 0;
      let value = sample;
      if (filter === 1) value = (sample + left) & 255;
      else if (filter === 2) value = (sample + up) & 255;
      else if (filter === 3) value = (sample + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (sample + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`png filter ${filter}`);
      row[i] = value;
    }
    src += stride;
    prev.set(row);
    const dest = y * width * 4;
    if (channels === 4) {
      out.set(row, dest);
    } else {
      for (let x = 0; x < width; x++) {
        const from = x * 3;
        const to = dest + x * 4;
        out[to] = row[from] ?? 0;
        out[to + 1] = row[from + 1] ?? 0;
        out[to + 2] = row[from + 2] ?? 0;
        out[to + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    const src = y * width * 4;
    Buffer.from(data.buffer, data.byteOffset + src, width * 4).copy(raw, row + 1);
  }
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
