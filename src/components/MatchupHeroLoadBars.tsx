"use client";

import {
  type MatchupLoadMode,
  expandHeroMatchupLoadBars,
  expectedMsForMatchupLoadBar,
  matchupHeroLoadLines,
} from "@/lib/scoring/matchupLoadDisplay";
import { TimeLeftBar } from "@/components/TimeLeftBar";

export function MatchupHeroLoadBars({
  heroes,
  loadMode,
  heroApiCalls,
  tone = "dark",
  resetKeyPrefix = "",
  paramsClassName = "text-[11px] leading-snug text-[#8aa0b2]",
  labelClassName = "text-sm font-semibold text-[#dfeaf4]",
}: {
  heroes: readonly string[];
  loadMode?: MatchupLoadMode;
  heroApiCalls?: Readonly<Record<string, number>>;
  tone?: "light" | "dark";
  resetKeyPrefix?: string;
  paramsClassName?: string;
  labelClassName?: string;
}) {
  const items = expandHeroMatchupLoadBars(heroes, loadMode, heroApiCalls);
  if (!items.length) return null;

  return (
    <ul className="space-y-3" data-testid="matchup-hero-load-bars">
      {items.map((item) => (
        <li key={item.id}>
          <p className={labelClassName}>{item.label}</p>
          <p className={paramsClassName}>{item.params}</p>
          <div className="mt-1.5">
            <TimeLeftBar
              label="In progress"
              expectedMs={expectedMsForMatchupLoadBar(item.source, item.callIndex)}
              resetKey={`${resetKeyPrefix}:${item.id}`}
              tone={tone}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Text-only lines for heroes waiting in a later batch. */
export function MatchupHeroLoadLines({
  heroes,
  loadMode,
  heroApiCalls,
  className = "mt-2 space-y-1 text-sm leading-snug",
  itemClassName = "font-medium text-[#dfeaf4]",
}: {
  heroes: readonly string[];
  loadMode?: MatchupLoadMode;
  heroApiCalls?: Readonly<Record<string, number>>;
  className?: string;
  itemClassName?: string;
}) {
  if (!heroes.length) return null;
  const lines = matchupHeroLoadLines(heroes, loadMode, heroApiCalls);
  return (
    <ul className={className} data-testid="matchup-hero-load-list">
      {lines.map((line, index) => (
        <li key={`${heroes[index] ?? index}-${line}`} className={itemClassName}>
          {line}
        </li>
      ))}
    </ul>
  );
}
