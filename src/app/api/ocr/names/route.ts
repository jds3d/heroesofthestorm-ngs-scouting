import { NextResponse } from "next/server";
import { readNameColumns } from "@/lib/ocr/nameReader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PICTURE = 2_500_000;

function picture(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 32 || value.length > MAX_PICTURE) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) return null;
  return value.replace(/\s/g, "");
}

/** Name columns and pick columns from the shared draft screen. */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    left?: unknown;
    right?: unknown;
    picksLeft?: unknown;
    picksRight?: unknown;
    center?: unknown;
  };
  const left = picture(body.left);
  const right = picture(body.right);
  if (!left || !right) {
    return NextResponse.json({ error: "Expected both name columns." }, { status: 400 });
  }
  const picksLeft = picture(body.picksLeft);
  const picksRight = picture(body.picksRight);
  try {
    const names = await readNameColumns(
      left,
      right,
      picksLeft && picksRight ? { left: picksLeft, right: picksRight } : undefined,
      picture(body.center) ?? undefined,
    );
    return NextResponse.json(names);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Name reader failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
