"use client";

import { useEffect, useState } from "react";

export type TimeLeftEstimate = {
  remainingMs: number;
  /** 0–100. Stays under 100 until the work actually finishes. */
  fill: number;
  overrun: boolean;
};

/**
 * Time still expected. A known fraction of finished work beats the clock.
 * Past the first estimate the bar keeps creeping and the clock adds a shorter tail.
 */
export function timeLeftEstimate(args: {
  elapsedMs: number;
  expectedMs: number;
  progress?: number | null;
}): TimeLeftEstimate {
  const expected = Math.max(1_000, args.expectedMs);
  const elapsed = Math.max(0, args.elapsedMs);
  const progress = args.progress;
  if (progress != null && progress >= 1) {
    return { remainingMs: 0, fill: 100, overrun: false };
  }
  if (progress != null && progress > 0.02) {
    const fill = Math.min(99, progress * 100);
    if (elapsed < 800) {
      return {
        remainingMs: expected * (1 - progress),
        fill,
        overrun: false,
      };
    }
    const total = elapsed / progress;
    const remaining = Math.max(0, total - elapsed);
    return {
      remainingMs: remaining,
      fill,
      overrun: elapsed > expected && remaining > expected * 0.5,
    };
  }
  const remaining = expected - elapsed;
  if (remaining > 0) {
    return {
      remainingMs: remaining,
      fill: Math.min(92, (elapsed / expected) * 92),
      overrun: false,
    };
  }
  const over = elapsed - expected;
  if (over > expected) {
    return { remainingMs: 0, fill: 97, overrun: true };
  }
  const extra = expected * 0.45;
  return {
    remainingMs: Math.max(5_000, extra - over * 0.2),
    fill: Math.min(97, 92 + (over / expected) * 6),
    overrun: true,
  };
}

export function formatTimeLeft(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec <= 3) return "A few seconds left";
  if (sec < 90) return `About ${sec}s left`;
  const min = Math.max(2, Math.round(sec / 60));
  return min === 2 ? "About 2 min left" : `About ${min} min left`;
}

export function timeLeftLabel(estimate: TimeLeftEstimate): string {
  if (estimate.overrun && estimate.remainingMs <= 0) {
    return "Still working — this is taking longer than usual";
  }
  if (estimate.remainingMs <= 0) return "Finishing up";
  const left = formatTimeLeft(estimate.remainingMs);
  return estimate.overrun
    ? `Taking longer than usual · ${left.charAt(0).toLowerCase()}${left.slice(1)}`
    : left;
}

/** How long a scout pass usually takes from the predicted call counts. */
export function scoutExpectedMs(
  stages: readonly { count: number }[],
  pass: number,
): number {
  if (pass > 1) return 90_000;
  const calls = stages.reduce((sum, stage) => sum + stage.count, 0);
  if (!calls) return 25_000;
  return Math.min(180_000, Math.max(35_000, 15_000 + calls * 2_000));
}

export function TimeLeftBar({
  label,
  expectedMs,
  progress = null,
  resetKey = "",
  tone = "light",
  steps,
}: {
  label: string;
  expectedMs: number;
  /** 0–1 when finished work is known. Null lets the clock move the bar. */
  progress?: number | null;
  resetKey?: string | number;
  tone?: "light" | "dark";
  /** Pizza-tracker steps. The active one follows the bar. */
  steps?: readonly { id: string; label: string }[];
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    setElapsedMs(0);
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 500);
    return () => window.clearInterval(id);
  }, [resetKey, expectedMs]);

  const estimate = timeLeftEstimate({ elapsedMs, expectedMs, progress });
  const caption = timeLeftLabel(estimate);
  const dark = tone === "dark";
  const stepCount = steps?.length ?? 0;
  const activeStep =
    stepCount === 0
      ? 0
      : estimate.fill >= 100
        ? stepCount
        : Math.min(
            stepCount - 1,
            Math.floor((estimate.fill / 100) * stepCount),
          );

  return (
    <div className="space-y-3">
      {stepCount > 0 ? (
        <ol
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${stepCount}, minmax(0, 1fr))` }}
        >
          {steps!.map((step, index) => {
            const done = index < activeStep;
            const current = index === activeStep && estimate.fill < 100;
            return (
              <li key={step.id} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                      done
                        ? dark
                          ? "border-[#72d1b1] bg-[#72d1b1] text-[#0f1821]"
                          : "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                        : current
                          ? dark
                            ? "border-[#72d1b1] text-[#72d1b1] ring-4 ring-[#72d1b1]/20 animate-pulse"
                            : "border-[var(--accent)] text-[var(--accent)] ring-4 ring-[var(--accent)]/20 animate-pulse"
                          : dark
                            ? "border-[#3d5163] text-[#5a6b78]"
                            : "border-[var(--line)] text-[var(--muted)]"
                    }`}
                  >
                    {done ? "✓" : index + 1}
                  </span>
                  {index < stepCount - 1 ? (
                    <span
                      className={`h-0.5 flex-1 ${
                        done
                          ? dark
                            ? "bg-[#72d1b1]"
                            : "bg-[var(--accent)]"
                          : dark
                            ? "bg-[#2a3a48]"
                            : "bg-[var(--line)]"
                      }`}
                    />
                  ) : null}
                </div>
                <p
                  className={`mt-1 truncate text-[11px] font-semibold uppercase tracking-wide ${
                    done || current
                      ? dark
                        ? "text-[#dfeaf4]"
                        : "text-[var(--ink)]"
                      : dark
                        ? "text-[#5a6b78]"
                        : "text-[var(--muted)]"
                  }`}
                >
                  {step.label}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`min-w-0 text-sm ${dark ? "text-[#dfeaf4]" : "text-[var(--ink)]"}`}>
            {label}
          </p>
          <p
            className={`shrink-0 text-xs font-semibold tabular-nums ${
              dark ? "text-[#72d1b1]" : "text-[var(--accent)]"
            }`}
          >
            {caption}
          </p>
        </div>
        <div
          className={`h-2 overflow-hidden rounded-full ${dark ? "bg-[#3d5163]" : "bg-[var(--line)]"}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(estimate.fill)}
          aria-label={`${label} ${caption}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${
              dark ? "bg-[#72d1b1]" : "bg-[var(--accent)]"
            }`}
            style={{ width: `${estimate.fill}%` }}
          />
        </div>
      </div>
    </div>
  );
}
