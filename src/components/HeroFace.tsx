"use client";

import { useState } from "react";
import {
  heroDraftPortraitUrl,
  heroSelectPortraitUrl,
} from "@/lib/scoring/heroPortrait";

type FaceKind = "draft" | "select";

export function HeroFace({
  hero,
  kind = "select",
  size = "md",
  banned = false,
  label,
  title,
}: {
  hero: string;
  kind?: FaceKind;
  size?: "sm" | "md" | "lg";
  banned?: boolean;
  label?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url =
    kind === "draft" ? heroDraftPortraitUrl(hero) : heroSelectPortraitUrl(hero);
  const dims =
    size === "lg"
      ? kind === "draft"
        ? "h-24 w-16"
        : "h-20 w-20"
      : size === "sm"
        ? kind === "draft"
          ? "h-14 w-9"
          : "h-10 w-10"
        : kind === "draft"
          ? "h-20 w-14"
          : "h-14 w-14";

  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <div
        className={`relative overflow-hidden bg-[#1a2430] ${dims} ${
          kind === "select" ? "rounded-full ring-2 ring-[#3d5163]" : "rounded-sm"
        }`}
      >
        {url && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={hero}
            className="h-full w-full object-cover object-top"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-semibold leading-tight text-[#c5d4e0]">
            {hero.slice(0, 3)}
          </span>
        )}
        {banned && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <line
              x1="8"
              y1="92"
              x2="92"
              y2="8"
              stroke="#e11d48"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      {label !== undefined ? (
        <span className="max-w-[4.5rem] truncate text-center text-[10px] font-semibold text-[var(--muted)]">
          {label || hero}
        </span>
      ) : null}
    </div>
  );
}

export function HeroFaceButton({
  hero,
  reason,
  badge,
  selected,
  onClick,
}: {
  hero: string;
  reason: string;
  badge?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex max-w-xs flex-col items-center gap-2 rounded-md border px-3 py-3 text-left transition ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--accent)]"
      }`}
    >
      {badge && (
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            badge.toLowerCase() === "expected"
              ? "bg-[var(--ink)] text-[var(--panel)]"
              : "bg-[var(--accent)] text-[var(--accent-ink)]"
          }`}
        >
          {badge}
        </span>
      )}
      <HeroFace hero={hero} kind="select" size="lg" />
      <span className="text-sm font-semibold text-[var(--ink)]">{hero}</span>
      <span className="text-center text-xs leading-snug text-[var(--muted)]">
        {reason}
      </span>
    </button>
  );
}
