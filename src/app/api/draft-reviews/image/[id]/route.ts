import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REVIEW_DIR = path.join(process.cwd(), "examples", "reviews");

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^review-\d{8}T\d{6}Z$/.test(id)) {
    return NextResponse.json({ error: "Unknown review" }, { status: 404 });
  }
  try {
    const bytes = await readFile(path.join(REVIEW_DIR, `${id}.png`));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ error: "Screenshot missing" }, { status: 404 });
  }
}
