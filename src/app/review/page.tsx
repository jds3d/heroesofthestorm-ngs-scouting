"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PickRead = { hero: string; player: string | null };

type ReviewBoard = {
  map: string | null;
  firstPick: "us" | "them" | null;
  ourBans: string[];
  theirBans: string[];
  ourPicks: PickRead[];
  theirPicks: PickRead[];
};

type ReviewCase = {
  id: string;
  test: string;
  image: string;
  skipped: boolean;
  board: ReviewBoard | null;
  source: string;
};

function scoutHeaders(): HeadersInit {
  const secret = process.env.NEXT_PUBLIC_SCOUT_API_SECRET?.trim();
  return secret ? { "x-scout-secret": secret } : {};
}

function stampLabel(id: string): string {
  const match = id.match(/^review-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return id;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} UTC`;
}

function heroLabel(hero: string): string {
  if (hero === "__no_ban__") return "No ban";
  if (hero === "__unseen__") return "Unseen";
  return hero;
}

function SideList({
  title,
  bans,
  picks,
}: {
  title: string;
  bans: string[];
  picks: PickRead[];
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">{title}</p>
      <p className="text-sm text-[var(--ink)]">
        <span className="text-[var(--muted)]">Bans. </span>
        {bans.length ? bans.map(heroLabel).join(", ") : "none read"}
      </p>
      <ol className="space-y-1 text-sm text-[var(--ink)]">
        {picks.length ? (
          picks.map((pick, index) => (
            <li key={`${pick.hero}-${index}`}>
              {index + 1}. {heroLabel(pick.hero)}
              {pick.player ? <span className="text-[var(--muted)]"> · {pick.player}</span> : null}
            </li>
          ))
        ) : (
          <li className="text-[var(--muted)]">No picks read</li>
        )}
      </ol>
    </div>
  );
}

export default function ReviewPage() {
  const [reviews, setReviews] = useState<ReviewCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/draft-reviews", { headers: scoutHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load reviews");
        return (await res.json()) as { reviews: ReviewCase[] };
      })
      .then((data) => {
        if (cancel) return;
        setReviews(data.reviews);
        setSelectedId(data.reviews[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancel) setError("Could not load the saved drafts.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const selected = reviews?.find((review) => review.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setImageUrl(null);
      return;
    }
    let cancel = false;
    let url: string | null = null;
    fetch(selected.image, { headers: scoutHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error("missing");
        return res.blob();
      })
      .then((blob) => {
        if (cancel) return;
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancel) setImageUrl(null);
      });
    return () => {
      cancel = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected]);

  return (
    <main className="mx-auto flex w-full max-w-none flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <Link href="/" className="text-sm font-semibold text-[var(--accent)]">
          Back to the scout
        </Link>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
          Draft reviews
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Each finished draft keeps the last lobby screenshot, taken before the loading screen, and a skipped test of what was read.
        </p>
      </header>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {reviews && reviews.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No finished drafts saved yet. The lobby frame is saved when a watched draft ends.
        </p>
      ) : null}
      {reviews && reviews.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ul className="space-y-2">
            {reviews.map((review) => (
              <li key={review.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(review.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    review.id === selectedId
                      ? "border-[var(--accent)] bg-[var(--panel)]"
                      : "border-[var(--line)] bg-[var(--panel)]/60"
                  }`}
                >
                  <span className="block font-semibold text-[var(--ink)]">
                    {review.board?.map ?? "Map not read"}
                  </span>
                  <span className="block text-[var(--muted)]">{stampLabel(review.id)}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <figure className="overflow-hidden rounded-md border border-[var(--line)] bg-black">
                {imageUrl ? (
                  // The screenshot is a local draft frame, not a remote optimized asset.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="Lobby screenshot saved before the loading screen" className="h-auto w-full" />
                ) : (
                  <p className="p-4 text-sm text-white">Screenshot is not available.</p>
                )}
              </figure>
              <div className="space-y-4 rounded-md border border-[var(--line)] bg-[var(--panel)] p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                    {selected.skipped ? "Needs review" : "Reviewed"}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink)]">
                    {selected.board?.map ?? "Map not read"}
                    {selected.board?.firstPick
                      ? ` · ${selected.board.firstPick === "us" ? "we" : "they"} picked first`
                      : ""}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">{selected.test}</p>
                </div>
                {selected.board ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SideList title="Us" bans={selected.board.ourBans} picks={selected.board.ourPicks} />
                    <SideList title="Them" bans={selected.board.theirBans} picks={selected.board.theirPicks} />
                  </div>
                ) : null}
                <pre className="max-h-[32rem] overflow-auto rounded-md bg-[#14212b] p-3 text-xs leading-relaxed text-[#e8eef2]">
                  {selected.source}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
