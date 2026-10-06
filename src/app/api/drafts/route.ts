import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DRAFT_DIR = path.join(process.cwd(), "drafts");

type DraftBody = {
  id?: string;
  map?: string | null;
  phase?: "ban" | "pick" | null;
  firstPick?: "us" | "them" | null;
  ourNames?: string[];
  theirNames?: string[];
  ourBans?: string[];
  theirBans?: string[];
  ourPicks?: string[];
  theirPicks?: string[];
  ourPickPlayers?: (string | null)[];
  theirPickPlayers?: (string | null)[];
};

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 16);
}

function asPlayers(value: unknown): (string | null)[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 16)
    .map((item) => (typeof item === "string" ? item : null));
}

/** One JSON file per watched draft, updated as bans and picks lock. */
export async function POST(request: Request) {
  const body = (await request.json()) as DraftBody;
  const id = (body.id ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(id)) {
    return NextResponse.json({ error: "Missing draft id" }, { status: 400 });
  }
  const record = {
    id,
    updatedAt: new Date().toISOString(),
    map: typeof body.map === "string" ? body.map : null,
    phase: body.phase === "ban" || body.phase === "pick" ? body.phase : null,
    firstPick: body.firstPick === "us" || body.firstPick === "them" ? body.firstPick : null,
    ourNames: asList(body.ourNames),
    theirNames: asList(body.theirNames),
    ourBans: asList(body.ourBans),
    theirBans: asList(body.theirBans),
    ourPicks: asList(body.ourPicks),
    theirPicks: asList(body.theirPicks),
    ourPickPlayers: asPlayers(body.ourPickPlayers),
    theirPickPlayers: asPlayers(body.theirPickPlayers),
  };
  await mkdir(DRAFT_DIR, { recursive: true });
  await writeFile(path.join(DRAFT_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return NextResponse.json({ ok: true, file: `${id}.json` });
}
