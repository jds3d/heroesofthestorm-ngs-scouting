import { readdir, readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { boardFromReviewSource, framesFromReviewSource } from "@/lib/lobby/reviewCase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REVIEW_TEST_DIR = path.join(process.cwd(), "src", "lib", "lobby", "reviews");

export async function GET() {
  let names: string[] = [];
  try {
    names = (await readdir(REVIEW_TEST_DIR)).filter((name) =>
      /^review-\d{8}T\d{6}(?:\d{3})?Z\.test\.ts$/.test(name),
    );
  } catch {
    names = [];
  }
  names.sort().reverse();
  const reviews = [];
  for (const name of names) {
    const id = name.replace(/\.test\.ts$/, "");
    try {
      const source = await readFile(path.join(REVIEW_TEST_DIR, name), "utf8");
      const frames = framesFromReviewSource(source).map((frame, index) => ({
        url: `/api/draft-reviews/image/${id}?frame=${index + 1}`,
        at: frame.at ?? null,
        added: frame.added,
      }));
      reviews.push({
        id,
        test: `src/lib/lobby/reviews/${name}`,
        image: frames[0]?.url ?? `/api/draft-reviews/image/${id}`,
        frames,
        skipped: source.includes("it.skip"),
        board: boardFromReviewSource(source),
        source,
      });
    } catch {
      // A missing test is skipped. The rest of the list still loads.
    }
  }
  return NextResponse.json({ reviews });
}
