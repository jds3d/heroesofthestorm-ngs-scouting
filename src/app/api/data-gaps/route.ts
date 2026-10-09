import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import {
  applyAddressedMarks,
  mergeDataGaps,
  renderDataGaps,
  type DataGapDraft,
  type DataGapEntry,
  type DataGapLevel,
} from "@/lib/draft/dataGapLog";

export const dynamic = "force-dynamic";

const DRAFT_DIR = path.join(process.cwd(), "drafts");
const JSON_FILE = path.join(DRAFT_DIR, "data-gaps.json");
const MD_FILE = path.join(DRAFT_DIR, "data-gaps.md");

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asLevel(value: unknown): DataGapLevel | null {
  return value === "warning" || value === "error" ? value : null;
}

function asDraft(value: unknown): DataGapDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const session = asText(row.session);
  const level = asLevel(row.level);
  const hero = asText(row.hero);
  if (!session || !level || !hero) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/.test(session)) return null;
  const missing = Array.isArray(row.missing)
    ? row.missing.filter((item): item is string => typeof item === "string").slice(0, 24)
    : [];
  const source = row.source === "replay" ? "replay" : "live";
  const percent = typeof row.percent === "number" && Number.isFinite(row.percent)
    ? Math.max(0, Math.min(100, Math.round(row.percent)))
    : 0;
  return {
    session,
    level,
    hero,
    pairWith: asText(row.pairWith),
    player: asText(row.player),
    missing,
    percent,
    loading: row.loading === true,
    map: asText(row.map),
    step: asText(row.step),
    source,
  };
}

async function readEntries(): Promise<DataGapEntry[]> {
  try {
    const raw = await readFile(JSON_FILE, "utf8");
    const parsed = JSON.parse(raw) as { entries?: DataGapEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function readMarkdown(): Promise<string> {
  try {
    return await readFile(MD_FILE, "utf8");
  } catch {
    return "";
  }
}

/** Append amber/red suggestion badges from a live draft or a replay. */
export async function POST(request: Request) {
  const body = (await request.json()) as { entries?: unknown };
  const incoming = Array.isArray(body.entries)
    ? body.entries.map(asDraft).filter((row): row is DataGapDraft => row !== null)
    : [];
  if (!incoming.length) {
    return NextResponse.json({ error: "No data gaps" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const existing = applyAddressedMarks(await readEntries(), await readMarkdown());
  const entries = mergeDataGaps(existing, incoming, now);
  await mkdir(DRAFT_DIR, { recursive: true });
  await writeFile(JSON_FILE, JSON.stringify({ entries }, null, 2));
  await writeFile(MD_FILE, renderDataGaps(entries));
  const open = entries.filter((entry) => !entry.addressed).length;
  return NextResponse.json({ ok: true, file: "data-gaps.md", open });
}
