import type { ComfortHero, PlayerScout, SourceHeroStat } from "@/lib/scoring/types";

function sourceLabel(
  short: string,
  source: SourceHeroStat | undefined,
): string | null {
  if (!source || source.games <= 0) return null;
  return `${short} ${(source.winRate * 100).toFixed(0)}% (${source.games}g)`;
}

function heroSourceLine(h: ComfortHero): string {
  const parts = [
    sourceLabel("NGS", h.sources.ngsCurrent),
    sourceLabel("SL", h.sources.stormLeague),
  ].filter(Boolean);
  if (parts.length === 0 && h.sources.ngsPrior) {
    parts.push(sourceLabel("NGS prior", h.sources.ngsPrior)!);
  }
  return parts.length > 0 ? parts.join(" · ") : "no sample";
}

export function PlayerCard({ player }: { player: PlayerScout }) {
  return (
    <article className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-[var(--ink)]">{player.battletag}</h4>
          <p className="text-sm text-[var(--muted)]">
            {player.preferredRole ?? "Flex"} · NGS {player.ngsWins}-
            {player.ngsLosses} · {player.confidence} confidence
            {player.returningFromPrior ? " · returning" : ""}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <a
            href={player.ngsProfileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            NGS HP
          </a>
          <a
            href={player.heroesProfileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            SL profile
          </a>
        </div>
      </div>
      <ol className="mt-4 space-y-3">
        {player.topHeroes.length === 0 && (
          <li className="text-sm text-[var(--muted)]">No hero sample yet</li>
        )}
        {player.topHeroes.map((h, i) => (
          <li key={h.hero} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--ink)]">
                <span className="mr-2 text-[var(--muted)]">{i + 1}.</span>
                {h.hero}
              </span>
              <span className="shrink-0 text-[var(--muted)]">
                comfort {(h.comfort * 100).toFixed(0)}
              </span>
            </div>
            <p className="mt-0.5 pl-5 text-xs text-[var(--muted)]">
              {heroSourceLine(h)}
            </p>
          </li>
        ))}
      </ol>
    </article>
  );
}
