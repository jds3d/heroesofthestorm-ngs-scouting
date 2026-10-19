import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { rowsFromBanHexExamples } from "@/lib/lobby/banHexCatalog";
import { mismatchCaseSource, type FinalScreenConflict } from "@/lib/lobby/finalScreen";
import { reviewCaseSource, type DraftReviewBoard } from "@/lib/lobby/reviewCase";
import { heroFromPlateText } from "@/lib/lobby/screenLobby";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PORTRAIT_DIR = path.join(process.cwd(), "examples", "draft-portraits");
const BAN_HEX_DIR = path.join(process.cwd(), "examples", "ban-hexes");
const BAN_HEX_MANIFEST = path.join(BAN_HEX_DIR, "manifest.json");
const BAN_HEX_CATALOG = path.join(process.cwd(), "src", "lib", "lobby", "banHexCatalog.json");
const FRAME_DIR = path.join(process.cwd(), "examples", "drafts");
const MISMATCH_DIR = path.join(process.cwd(), "examples", "mismatches");
const MISMATCH_TEST_DIR = path.join(process.cwd(), "src", "lib", "lobby", "mismatches");
const REVIEW_DIR = path.join(process.cwd(), "examples", "reviews");
const REVIEW_TEST_DIR = path.join(process.cwd(), "src", "lib", "lobby", "reviews");
const MANIFEST = path.join(PORTRAIT_DIR, "manifest.json");
const MAX_PER_HERO = 4;
const MAX_FRAMES = 8;

type ManifestRow = { hero: string; file: string };
type BanHexManifestRow = { hero: string; file: string; source?: string };

function asBase64(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "");
  if (cleaned.length < 32 || cleaned.length > max) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  return cleaned;
}

async function readBanHexManifest(): Promise<BanHexManifestRow[]> {
  try {
    const raw = await readFile(BAN_HEX_MANIFEST, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BanHexManifestRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as BanHexManifestRow).hero === "string" &&
        typeof (row as BanHexManifestRow).file === "string" &&
        !path.basename((row as BanHexManifestRow).file).includes(".."),
    );
  } catch {
    return [];
  }
}

async function writeBanHexCatalog(): Promise<void> {
  const rows = rowsFromBanHexExamples();
  await writeFile(BAN_HEX_CATALOG, JSON.stringify(rows, null, 2) + "\n");
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

function heroList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 8) return null;
  const heroes: string[] = [];
  for (const hero of value) {
    if (typeof hero !== "string" || hero.length > 40) return null;
    heroes.push(hero);
  }
  return heroes;
}

function conflictFrom(value: unknown): FinalScreenConflict | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { before?: { our?: unknown; their?: unknown }; screen?: { our?: unknown; their?: unknown } };
  const beforeOur = heroList(row.before?.our);
  const beforeTheir = heroList(row.before?.their);
  const screenOur = heroList(row.screen?.our);
  const screenTheir = heroList(row.screen?.their);
  if (!beforeOur || !beforeTheir || !screenOur || !screenTheir) return null;
  return {
    before: { our: beforeOur, their: beforeTheir },
    screen: { our: screenOur, their: screenTheir },
  };
}

function reviewNames(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const names: string[] = [];
  for (const name of value) {
    if (typeof name !== "string" || name.length > 40) return null;
    names.push(name);
  }
  return names;
}

function reviewPicks(value: unknown): { hero: string; player: string | null }[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const picks: { hero: string; player: string | null }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const hero = (row as { hero?: unknown }).hero;
    const player = (row as { player?: unknown }).player;
    if (typeof hero !== "string" || hero.length > 40) return null;
    if (player != null && (typeof player !== "string" || player.length > 40)) return null;
    picks.push({ hero, player: typeof player === "string" ? player : null });
  }
  return picks;
}

function reviewBoardFrom(value: unknown): DraftReviewBoard | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    map?: unknown;
    firstPick?: unknown;
    ourBans?: unknown;
    theirBans?: unknown;
    ourPicks?: unknown;
    theirPicks?: unknown;
  };
  const ourBans = reviewNames(row.ourBans, 8);
  const theirBans = reviewNames(row.theirBans, 8);
  const ourPicks = reviewPicks(row.ourPicks);
  const theirPicks = reviewPicks(row.theirPicks);
  if (!ourBans || !theirBans || !ourPicks || !theirPicks) return null;
  if (row.map != null && (typeof row.map !== "string" || row.map.length > 80)) return null;
  if (row.firstPick != null && row.firstPick !== "us" && row.firstPick !== "them") return null;
  return {
    map: typeof row.map === "string" ? row.map : null,
    firstPick: row.firstPick === "us" || row.firstPick === "them" ? row.firstPick : null,
    ourBans,
    theirBans,
    ourPicks,
    theirPicks,
  };
}

/** Save a labeled portrait, or one full draft frame, from the live watch. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind?: unknown;
    hero?: unknown;
    image?: unknown;
    source?: unknown;
    conflict?: unknown;
    board?: unknown;
  };
  if (body.kind === "review") {
    const image = asBase64(body.image, 12_000_000);
    const board = reviewBoardFrom(body.board);
    if (!image || !board) {
      return NextResponse.json({ error: "Expected the lobby screenshot and the read" }, { status: 400 });
    }
    const bytes = Buffer.from(image, "base64");
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      return NextResponse.json({ error: "Expected a png frame" }, { status: 400 });
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const imageName = `review-${stamp}.png`;
    const imagePath = `examples/reviews/${imageName}`;
    await mkdir(REVIEW_DIR, { recursive: true });
    await mkdir(REVIEW_TEST_DIR, { recursive: true });
    await writeFile(path.join(REVIEW_DIR, imageName), bytes);
    const testName = `review-${stamp}.test.ts`;
    await writeFile(
      path.join(REVIEW_TEST_DIR, testName),
      reviewCaseSource(imagePath, board),
    );
    return NextResponse.json({
      ok: true,
      saved: true,
      image: imagePath,
      test: `src/lib/lobby/reviews/${testName}`,
    });
  }
  if (body.kind === "mismatch") {
    const image = asBase64(body.image, 12_000_000);
    const conflict = conflictFrom(body.conflict);
    if (!image || !conflict) {
      return NextResponse.json({ error: "Expected the loading screen and both comps" }, { status: 400 });
    }
    const bytes = Buffer.from(image, "base64");
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      return NextResponse.json({ error: "Expected a png frame" }, { status: 400 });
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const imageName = `mismatch-${stamp}.png`;
    const imagePath = `examples/mismatches/${imageName}`;
    await mkdir(MISMATCH_DIR, { recursive: true });
    await mkdir(MISMATCH_TEST_DIR, { recursive: true });
    await writeFile(path.join(MISMATCH_DIR, imageName), bytes);
    const testName = `mismatch-${stamp}.test.ts`;
    await writeFile(
      path.join(MISMATCH_TEST_DIR, testName),
      mismatchCaseSource(imagePath, conflict),
    );
    return NextResponse.json({ ok: true, saved: true, image: imagePath, test: `src/lib/lobby/mismatches/${testName}` });
  }
  if (body.kind === "ban-hex") {
    const hero = heroFromPlateText(typeof body.hero === "string" ? body.hero : "");
    const image = asBase64(body.image, 500_000);
    if (!hero || !image) return NextResponse.json({ error: "Expected a named ban hex" }, { status: 400 });
    const bytes = Buffer.from(image, "base64");
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      return NextResponse.json({ error: "Expected a png ban hex" }, { status: 400 });
    }
    await mkdir(BAN_HEX_DIR, { recursive: true });
    const manifest = await readBanHexManifest();
    const slug = hero.toLowerCase().replace(/[^a-z0-9]/g, "") || "hero";
    const owned = manifest.filter((row) => row.hero === hero);
    const file = `${slug}-${owned.length + 1}.png`;
    await writeFile(path.join(BAN_HEX_DIR, file), bytes);
    manifest.push({
      hero,
      file,
      source: typeof body.source === "string" ? body.source.slice(0, 120) : undefined,
    });
    await writeFile(BAN_HEX_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    await writeBanHexCatalog();
    return NextResponse.json({ ok: true, saved: true, file, catalog: "banHexCatalog.json" });
  }
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
