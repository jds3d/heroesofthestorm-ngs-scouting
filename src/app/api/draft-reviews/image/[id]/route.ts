import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REVIEW_DIR = path.join(process.cwd(), "examples", "reviews");

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^review-\d{8}T\d{6}(?:\d{3})?Z$/.test(id)) {
    return NextResponse.json({ error: "Unknown review" }, { status: 404 });
  }
  const frame = Number(new URL(request.url).searchParams.get("frame") ?? "1");
  const index = Number.isInteger(frame) && frame > 0 ? frame : 1;
  const files = [
    { name: `${id}-${index}.jpg`, type: "image/jpeg" },
    { name: `${id}-${index}.png`, type: "image/png" },
  ];
  if (index === 1) {
    files.push(
      { name: `${id}.jpg`, type: "image/jpeg" },
      { name: `${id}.png`, type: "image/png" },
    );
  }
  for (const file of files) {
    try {
      const bytes = await readFile(path.join(REVIEW_DIR, file.name));
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "content-type": file.type, "cache-control": "private, max-age=3600" },
      });
    } catch {
      // Try the next name. Older saves used one png with no frame number.
    }
  }
  return NextResponse.json({ error: "Screenshot missing" }, { status: 404 });
}
