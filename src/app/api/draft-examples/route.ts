import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { heroFromPlateText } from "@/lib/lobby/screenLobby";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PORTRAIT_DIR = path.join(process.cwd(), "examples", "draft-portraits");
const FRAME_DIR = path.join(process.cwd(), "examples", "drafts");
const MANIFEST = path.join(PORTRAIT_DIR, "manifest.json");
const MAX_PER_HERO = 4;
const MAX_FRAMES = 8;

type ManifestRow = { hero: string; file: string };

function asBase64(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "");
  if (cleaned.length < 32 || cleaned.length > max) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  return cleaned;
}

async function readManifest(): Promise<ManifestRow[]> {
  try {
    const raw = await readFile(MANIFEST, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is ManifestRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as ManifestRow).hero === "string" &&
        typeof (row as ManifestRow).file === "string" &&
        !path.basename((row as ManifestRow).file).includes(".."),
    );
  } catch {
    return [];
  }
}

/** Few-shot draft portraits saved from watched games. */
export async function GET() {
  const manifest = await readManifest();
  const examples = [];
  for (const row of manifest) {
    try {
      const bytes = await readFile(path.join(PORTRAIT_DIR, path.basename(row.file)));
      examples.push({ hero: row.hero, image: bytes.toString("base64") });
    } catch {
      // A missing file is skipped. The rest of the set still loads.
    }
  }
  return NextResponse.json({ examples });
}

/** Save a labeled portrait, or one full draft frame, from the live watch. */
export async function POST(request: Request) {
  const body = (await request.json()) as { kind?: unknown; hero?: unknown; image?: unknown };
  if (body.kind === "frame") {
    const image = asBase64(body.image, 8_000_000);
    if (!image) return NextResponse.json({ error: "Expected a frame" }, { status: 400 });
    const bytes = Buffer.from(image, "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return NextResponse.json({ error: "Expected a jpeg frame" }, { status: 400 });
    }
    await mkdir(FRAME_DIR, { recursive: true });
    const existing = (await readdir(FRAME_DIR)).filter((name) => name.endsWith(".jpg"));
    if (existing.length >= MAX_FRAMES) return NextResponse.json({ ok: true, saved: false });
    const file = `watch-${Date.now()}.jpg`;
    await writeFile(path.join(FRAME_DIR, file), bytes);
    return NextResponse.json({ ok: true, saved: true, file });
  }

  const hero = heroFromPlateText(typeof body.hero === "string" ? body.hero : "");
  const image = asBase64(body.image, 500_000);
  if (!hero || !image) return NextResponse.json({ error: "Expected a named portrait" }, { status: 400 });
  const bytes = Buffer.from(image, "base64");
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    return NextResponse.json({ error: "Expected a png portrait" }, { status: 400 });
  }
  await mkdir(PORTRAIT_DIR, { recursive: true });
  const manifest = await readManifest();
  const slug = hero.toLowerCase().replace(/[^a-z0-9]/g, "") || "hero";
  const owned = manifest.filter((row) => row.hero === hero);
  if (owned.length >= MAX_PER_HERO) return NextResponse.json({ ok: true, saved: false });
  const file = `${slug}-${owned.length + 1}.png`;
  await writeFile(path.join(PORTRAIT_DIR, file), bytes);
  manifest.push({ hero, file });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  return NextResponse.json({ ok: true, saved: true, file });
}
