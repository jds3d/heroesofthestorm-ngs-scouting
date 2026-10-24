import { NextResponse } from "next/server";
import { readNameColumns, readSlotPlates } from "@/lib/ocr/nameReader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PICTURE = 2_500_000;

function picture(value: unknown): string | null {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length < 32) return null;
  // One oversized crop must not throw away the name columns sent with it.
  if (value.length > MAX_PICTURE) return "";
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) return null;
  return value.replace(/\s/g, "");
}

/** Name columns and the center splash from the shared draft screen. Any one of them is enough. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    left?: unknown;
    right?: unknown;
    picksLeft?: unknown;
    picksRight?: unknown;
    center?: unknown;
    slots?: unknown;
  };
  if (Array.isArray(body.slots) && body.slots.length > 0) {
    const slots: { side: "left" | "right"; index: number; image: string }[] = [];
    for (const slot of body.slots.slice(0, 5)) {
      if (!slot || typeof slot !== "object") continue;
      const row = slot as { side?: unknown; index?: unknown; image?: unknown };
      const image = picture(row.image);
      if (row.side !== "left" && row.side !== "right") continue;
      const index = typeof row.index === "number" ? row.index : -1;
      if (!image || index < 0 || index > 4) continue;
      slots.push({ side: row.side, index, image });
    }
    if (slots.length === 0) {
      return NextResponse.json({ error: "Expected a picture." }, { status: 400 });
    }
    try {
      const read = await readSlotPlates(slots);
      return NextResponse.json({ slots: read });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Name reader failed";
      return NextResponse.json({ error: message }, { status: 503 });
    }
  }
  const left = picture(body.left);
  const right = picture(body.right);
  const center = picture(body.center);
  if (left == null || right == null || center == null) {
    return NextResponse.json({ error: "Expected a picture." }, { status: 400 });
  }
  if (!left && !right && !center) {
    return NextResponse.json({ error: "Expected a picture." }, { status: 400 });
  }
  const picksLeft = picture(body.picksLeft);
  const picksRight = picture(body.picksRight);
  try {
    const names = await readNameColumns(
      left,
      right,
      picksLeft && picksRight ? { left: picksLeft, right: picksRight } : undefined,
      center || undefined,
    );
    return NextResponse.json(names);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Name reader failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
