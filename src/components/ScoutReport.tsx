"use client";

import { useMemo, useState } from "react";
import type {
  DraftCompPick,
  OurCompBrief,
  ScoutReport,
} from "@/lib/scoring/types";
import {
  archetypeTooltipRows,
  DRAFT_TERM_HINTS,
} from "@/lib/scoring/glossary";
import { extractLaneSplitNote } from "@/lib/scoring/draftPlan";
import type { MapPlan } from "@/lib/scoring/types";
import { applyMapToDraftPlan } from "@/lib/scoring/applyMap";
import {
  explainCompHoles,
  normalizeBruiserLanes,
  planSeatJob,
} from "@/lib/scoring/draftPlan";
import { PlayerCard } from "@/components/PlayerCard";
import { HeroFace } from "@/components/HeroFace";
import { InteractiveDraft } from "@/components/InteractiveDraft";
import { MapPicker } from "@/components/MapPicker";

export function ScoutReportView({ report }: { report: ScoutReport }) {
  const [pickSide, setPickSide] = useState<"theyFirst" | "weFirst" | null>(null);
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const shown = report;
  const plan = useMemo(
    () =>
      shown.adapt.draftPlan
        ? applyMapToDraftPlan(
            shown.adapt.draftPlan,
            selectedMap,
            shown.draft,
          )
        : null,
    [shown.adapt.draftPlan, selectedMap, shown.draft],
  );
  const activeSide = pickSide ?? "theyFirst";
  const side = plan?.sides?.[activeSide] ?? null;
  const theirPicks = side?.theirLikely ?? plan?.theirLikely ?? [];
  const ourPicks = useMemo(() => {
    const raw = side?.ourLikely ?? plan?.ourLikely ?? [];
    return normalizeBruiserLanes(raw);
  }, [side?.ourLikely, plan?.ourLikely]);
  const ourBrief = side?.ourBrief ?? plan?.ourBrief ?? null;
  const setupReady = Boolean(selectedMap && pickSide);
  const toc = [
    { id: "know-them", label: `1. ${report.teamName} Team` },
    { id: "preferred-heroes", label: `2. ${report.teamName} - Individual` },
    { id: "draft", label: "3. Draft" },
  ] as const;

  function scrollToId(id: string) {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function onPickSide(next: "weFirst" | "theyFirst") {
    setPickSide(next);
    if (!selectedMap) scrollToId("draft-map");
    else scrollToId("draft-plan");
  }

  function onSelectMap(map: string | null) {
    setSelectedMap(map);
    if (!map) return;
    if (!pickSide) scrollToId("draft-first-pick");
    else scrollToId("draft-plan");
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="space-y-3 border-t border-[var(--line)] pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-3xl text-[var(--ink)]">
            {report.teamName}{" "}
            <span className="text-lg text-[var(--muted)]">
              ({report.ticker})
            </span>
          </h2>
          <a
            href={report.profileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
          >
            NGS profile ↗
          </a>
        </div>
        <p className="text-[var(--muted)]">
          Captain {report.captain}
          {report.hpMmrAvg != null ? ` · HP MMR ${report.hpMmrAvg}` : ""} ·{" "}
          {report.division} · Season {report.season}
        </p>
        <p className="text-xs text-[var(--muted)]">
          Generated {new Date(report.generatedAt).toLocaleString()} · Confidence:{" "}
          {shown.adapt.confidence}
        </p>
        {report.warnings?.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <nav
          aria-label="Table of contents"
          className="max-w-xl border-y border-[var(--line)] py-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Contents
          </p>
          <ol className="mt-2 list-none space-y-1.5 pl-0">
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="group flex items-baseline gap-2 text-sm text-[var(--ink)] hover:text-[var(--accent)]"
                >
                  <span className="min-w-0 flex-1 border-b border-dotted border-[var(--line)] pb-0.5 group-hover:border-[var(--accent)]">
                    {item.label}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <section id="know-them" className="scroll-mt-16 space-y-4">
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          1. {report.teamName} Team
        </h3>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Who they are and what they want to play. The counter plan below is
          built from this.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <ArchetypeStatBlock
            archetype={report.draft.archetype}
            breakdown={report.draft.archetypeBreakdown ?? []}
          />
          <StatBlock
            title="Games analyzed"
            body={
              report.draft.gamesAnalyzedLabel ??
              String(report.draft.gamesAnalyzed)
            }
            hint={DRAFT_TERM_HINTS["Games analyzed"]}
          />
          <StatBlock
            title="First-pick leans"
            body={
              report.draft.firstPickHeroes.length
                ? report.draft.firstPickHeroes
                    .slice(0, 3)
                    .map((h) => `${h.hero} (${h.pct}%)`)
                    .join(", ")
                : "—"
            }
            hint={DRAFT_TERM_HINTS["First-pick leans"]}
          />
        </div>
        {(report.draft.sections?.length ?? 0) > 0 ? (
          <dl className="max-w-3xl space-y-4">
            {report.draft.sections.map((s) => (
              <div key={s.heading}>
                <dt
                  className={`text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
                    DRAFT_TERM_HINTS[s.heading]
                      ? "cursor-help underline decoration-dotted underline-offset-2"
                      : ""
                  }`}
                  title={DRAFT_TERM_HINTS[s.heading]}
                >
                  {s.heading}
                </dt>
                <dd className="mt-1 space-y-2 text-base leading-snug text-[var(--ink)]">
                  {s.body && <p>{s.body}</p>}
                  {s.bullets && s.bullets.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5">
                      {s.bullets.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {s.groups && s.groups.length > 0 && (
                    <ul className="list-disc space-y-2 pl-5">
                      {s.groups.map((g) => (
                        <li key={g.title}>
                          <span className="font-semibold">{g.title}</span>
                          {g.items && g.items.length > 0 && (
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                              {g.items.map((item) => (
                                <li key={item}>
                                  <span className="text-[var(--ink)]">
                                    {item}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="max-w-3xl text-base leading-relaxed text-[var(--ink)]">
            {report.draft.narrative}
          </p>
        )}
        {(report.draft.notes?.length ?? 0) > 0 && (
          <ul className="max-w-3xl space-y-1 text-sm text-[var(--muted)]">
            {report.draft.notes.map((note) => (
              <li key={note}>Note: {note}</li>
            ))}
          </ul>
        )}
        {shown.adapt.mapPlan &&
          (shown.adapt.mapPlan.ban.length > 0 ||
            shown.adapt.mapPlan.play.length > 0) && (
            <MapPlanBlock plan={shown.adapt.mapPlan} />
          )}
        {shown.threats.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Team threats
            </h4>
            <ul className="flex flex-wrap gap-3">
              {shown.threats.slice(0, 8).map((t) => (
                <li key={t.hero} title={t.reason}>
                  <HeroFace
                    hero={t.hero}
                    kind="select"
                    size="md"
                    label={`${t.hero}`}
                    title={t.reason}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section id="preferred-heroes" className="scroll-mt-16 space-y-4">
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          2. {report.teamName} - Individual
        </h3>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Per-player comfort — NGS is this season&apos;s league games; SL is Storm
          League in the same window. Both win rates shown when we have a sample.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {report.roster.map((p) => (
            <PlayerCard key={p.battletag} player={p} />
          ))}
        </div>
      </section>

      {plan && (
        <section id="draft" className="scroll-mt-16 space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
              3. Draft
            </h3>
            <p
              className="cursor-help text-xs uppercase tracking-wide text-[var(--muted)] underline decoration-dotted underline-offset-2"
              title={DRAFT_TERM_HINTS["Bait certainty"]}
            >
              Certainty: {plan.certainty}
            </p>
          </div>

          <div
            id="draft-first-pick"
            className="scroll-mt-16 space-y-2 rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-4"
          >
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              First pick
            </h4>
            <p className="text-sm text-[var(--muted)]">
              {pickSide
                ? selectedMap
                  ? "Both set — plan below."
                  : "Next: pick the map."
                : "Choose who has first pick."}
            </p>
            <div className="flex flex-wrap gap-2">
              <PickButton
                active={pickSide === "weFirst"}
                onClick={() => onPickSide("weFirst")}
                label="We pick first"
              />
              <PickButton
                active={pickSide === "theyFirst"}
                onClick={() => onPickSide("theyFirst")}
                label="They pick first"
              />
            </div>
          </div>

          <div id="draft-map" className="scroll-mt-16">
            <MapPicker
              value={selectedMap}
              onChange={onSelectMap}
              hint={
                selectedMap
                  ? pickSide
                    ? undefined
                    : "Next: choose who has first pick."
                  : pickSide
                    ? "Choose the map to unlock the draft plan."
                    : "Current NGS pool only. Draft plan updates for the map you pick."
              }
            />
          </div>

          {setupReady ? (
          <div id="draft-plan" className="scroll-mt-16 space-y-6">
          <div className="space-y-4 rounded-md border border-[var(--line)] bg-[var(--panel)] px-5 py-5">
            <h4 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Overall plan
              {selectedMap ? (
                <span className="ml-2 text-base text-[var(--muted)]">
                  · {selectedMap}
                </span>
              ) : null}
            </h4>
            <p className="max-w-3xl text-base leading-relaxed text-[var(--ink)]">
              {side?.summary ?? plan.summary}
            </p>

            <div className="grid gap-6 lg:grid-cols-2">
              <CompFaces
                title={
                  report.teamName === "Little Buff Boyz"
                    ? "What they should expect from us"
                    : "Their likely draft"
                }
                picks={theirPicks}
                tone="enemy"
              />
              <CompFaces
                title="Our counter draft"
                picks={ourPicks}
                tone="ally"
                note={side?.ourCompNote ?? plan.ourCompNote}
                brief={ourBrief}
              />
            </div>

            <div className="space-y-2 border-t border-[var(--line)] pt-4">
              <h5 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                How we beat that five
              </h5>
              <p className="max-w-3xl text-base leading-relaxed text-[var(--ink)]">
                {side?.counterNote ?? plan.counter}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Ban priority
            </h4>
            <ul className="flex flex-wrap gap-4">
              {shown.adapt.banPriority.map((b, i) => (
                <li key={b.hero} className="flex items-start gap-2">
                  <span className="mt-2 text-xs font-bold text-[var(--muted)]">
                    {i + 1}.
                  </span>
                  <div className="flex flex-col items-center gap-1">
                    <HeroFace
                      hero={b.hero}
                      kind="select"
                      size="md"
                      banned
                      label={b.hero}
                      title={b.reason}
                    />
                    <span className="max-w-[7rem] text-center text-[11px] leading-snug text-[var(--muted)]">
                      {b.reason}
                    </span>
                  </div>
                </li>
              ))}
              {shown.adapt.banPriority.length === 0 && (
                <li className="text-sm text-[var(--muted)]">No clear bans yet</li>
              )}
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
              Interactive draft
            </h4>
            <p className="max-w-3xl text-sm text-[var(--muted)]">
              Step through the lobby like HotS draft. Use the suggestion, search
              for a hero, or tap any face. Undo if you mis-click.
            </p>
            <InteractiveDraft
              key={`${pickSide}-${selectedMap ?? "any"}`}
              tree={side?.tree ?? plan.tree}
              weFirst={pickSide === "weFirst"}
              banPriority={shown.adapt.banPriority}
              ourLikely={ourPicks}
              theirLikely={theirPicks}
              ourBrief={ourBrief}
              theirArchetype={report.draft.archetype}
              archetypeCounter={plan.counter}
              leaveDive={Boolean(plan.playbook?.antiDiveThreat)}
              leaveDivePivot={plan.playbook?.recommended?.name ?? null}
              map={selectedMap}
              draftMeta={shown.adapt.draftMeta}
              homeRoster={
                report.homeRoster?.length
                  ? report.homeRoster
                  : report.teamName === "Little Buff Boyz"
                    ? report.roster
                    : []
              }
              theirRoster={
                report.teamName === "Little Buff Boyz" ? [] : report.roster
              }
              ourLabel="Little Buff Boyz"
              theirLabel={report.teamName}
            />
          </div>

          {shown.adapt.recommendations.length > 0 && (
            <details className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
                Extra recommendations
              </summary>
              <ul className="mt-3 space-y-3">
                {shown.adapt.recommendations.map((r) => (
                  <li
                    key={r.title}
                    className="border-l-2 border-[var(--accent)] pl-3"
                  >
                    <p className="font-semibold text-[var(--ink)]">{r.title}</p>
                    <p className="text-sm text-[var(--muted)]">{r.detail}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {plan.playbook && (
            <details className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3" open={plan.playbook.antiDiveThreat}>
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
                {plan.playbook.antiDiveThreat
                  ? "Leave dive — recommended pivot"
                  : "Heavy dive plan (green light until they show anti-dive)"}
              </summary>
              <div className="mt-3 space-y-4">
                <p className="max-w-3xl text-sm leading-relaxed text-[var(--ink)]">
                  {plan.playbook.intro}
                </p>

                {plan.playbook.antiDiveThreat && plan.playbook.recommended ? (
                  <>
                    <p className="text-sm text-[var(--muted)]">
                      Anti-dive in their pool:{" "}
                      <span className="font-semibold text-[var(--ink)]">
                        {plan.playbook.antiDiveHeroesSeen.join(", ")}
                      </span>
                    </p>
                    <div className="rounded-md border-2 border-[var(--accent)] bg-[var(--accent)]/5 px-4 py-3 space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
                        Do this
                      </p>
                      <p className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                        {plan.playbook.recommended.name}
                      </p>
                      <p className="text-sm text-[var(--ink)]">
                        {plan.playbook.recommended.why}
                      </p>
                      <p className="text-sm text-[var(--ink)]">
                        <span className="font-semibold">Pick: </span>
                        {plan.playbook.recommended.heroes.join(" · ")}
                        {" · "}
                        Qhira if open
                      </p>
                      <p className="text-sm text-[var(--muted)]">
                        Keep Qhira — change the tank/heal/range shell around her, do not force Genji/Greymane dive into their anti-dive.
                      </p>
                      <p className="text-sm text-[var(--muted)]">
                        {plan.playbook.recommended.objective}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        Strongest on {plan.playbook.recommended.maps.join(" / ")} — map is a preference, not the reason to pick this pivot.
                      </p>
                    </div>
                    {(plan.playbook.alternates?.length ?? 0) > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold text-[var(--muted)]">
                          Other pivots — only if the map or lobby forces a different fight
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {plan.playbook.alternates.map((p) => (
                            <li
                              key={p.id ?? p.name}
                              className="border-l-2 border-[var(--line)] pl-3"
                            >
                              <p className="font-semibold text-[var(--ink)]">
                                {p.name}
                              </p>
                              <p className="text-[var(--muted)]">{p.why}</p>
                              <p className="text-[var(--muted)]">
                                Pick: {p.heroes.join(" · ")}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted)]">
                    No anti-dive comfort in their top pool yet. Stay on dive until
                    they show Tyrael, Brightwing, Falstad Gust, or Johanna in
                    lobby — then open this section&apos;s pivot logic.
                  </p>
                )}
              </div>
            </details>
          )}
          </div>
          ) : (
            <p className="rounded-md border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--muted)]">
              {!pickSide && !selectedMap
                ? "Pick who has first pick and the map to open the draft plan."
                : !pickSide
                  ? "Choose who has first pick to continue."
                  : "Choose the map to continue."}
            </p>
          )}
        </section>
      )}

      {report.apiUsage && (
        <details className="rounded-md border border-[var(--line)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--muted)]">
            API calls
          </summary>
          <div className="mt-3 space-y-2">
            <p className="max-w-3xl text-sm text-[var(--muted)]">
              Predicted is what the scout expects to call. Actual is lower when
              data is already cached (no network), or when a token error stops
              the rest of the pulls.
            </p>
            <ul className="space-y-1 text-sm text-[var(--ink)]">
              {report.apiUsage.predicted.map((row) => {
                const actual =
                  report.apiUsage?.actual.find((a) => a.kind === row.kind)
                    ?.count ?? 0;
                if (row.count === 0 && actual === 0) return null;
                return (
                  <li key={row.kind}>
                    <span className="font-semibold">{row.label}</span>
                    <span className="text-[var(--muted)]">
                      {" "}
                      — predicted {row.count}, used {actual}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

function MapPlanBlock({ plan }: { plan: MapPlan }) {
  return (
    <div className="space-y-3 rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-4">
      <h4
        className="cursor-help text-sm font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-dotted underline-offset-2"
        title={DRAFT_TERM_HINTS["Map plan"]}
      >
        Map plan
      </h4>
      {plan.note && (
        <p className="text-sm text-amber-900">{plan.note}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800/80">
            We ban
          </p>
          {plan.ban.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No clear ban yet</p>
          ) : (
            <ul className="space-y-2">
              {plan.ban.map((m) => (
                <li key={m.map} className="text-sm text-[var(--ink)]">
                  <span className="font-semibold">{m.map}</span>
                  <span className="text-[var(--muted)]"> — {m.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            We want to play
          </p>
          {plan.play.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No clear play yet</p>
          ) : (
            <ul className="space-y-2">
              {plan.play.map((m) => (
                <li key={m.map} className="text-sm text-[var(--ink)]">
                  <span className="font-semibold">{m.map}</span>
                  <span className="text-[var(--muted)]"> — {m.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CompFaces({
  title,
  picks,
  tone,
  note,
  brief,
}: {
  title: string;
  picks: DraftCompPick[];
  tone: "ally" | "enemy";
  note?: string | null;
  brief?: OurCompBrief | null;
}) {
  const laneNote = extractLaneSplitNote(picks);
  const holes = explainCompHoles(picks);
  return (
    <div className="space-y-3">
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${
          tone === "enemy" ? "text-red-800/80" : "text-[var(--accent)]"
        }`}
      >
        {title}
      </p>
      {brief && (
        <p className="text-sm font-semibold text-[var(--ink)]">{brief.kind}</p>
      )}
      {note && <p className="text-sm text-[var(--muted)]">{note}</p>}
      <ul className="flex flex-wrap gap-3">
        {picks.map((p) => {
          const job = planSeatJob(p);
          return (
            <li key={`${p.role}-${p.hero}`}>
              <HeroFace
                hero={p.hero}
                kind="draft"
                size="md"
                label={p.player ? `${p.hero}` : p.hero}
                title={`${p.hero} · ${job}${p.player ? ` · ${p.player}` : ""}${p.note ? ` · ${p.note}` : ""}`}
              />
              <p className="mt-0.5 max-w-[3.5rem] text-center text-[10px] text-[var(--muted)]">
                {job}
                {p.player ? (
                  <>
                    <br />
                    {p.player.split("#")[0]}
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      {laneNote && (
        <p className="text-sm text-[var(--muted)]">{laneNote}</p>
      )}
      {holes && (
        <p className="text-sm text-amber-800">Hole: {holes}</p>
      )}
      {brief?.mapStrategy && (
        <p className="text-sm text-[var(--muted)]">{brief.mapStrategy}</p>
      )}
      {brief?.whyItWorks && (
        <p className="text-sm text-[var(--muted)]">{brief.whyItWorks}</p>
      )}
    </div>
  );
}

function PickButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 rounded-md px-4 text-sm font-semibold ${
        active
          ? "bg-[var(--accent)] text-[var(--accent-ink)]"
          : "border border-[var(--line)] text-[var(--ink)]"
      }`}
    >
      {label}
    </button>
  );
}

function ArchetypeStatBlock({
  archetype,
  breakdown,
}: {
  archetype: string;
  breakdown: { archetype: string; count: number; pct: number }[];
}) {
  const rows = archetypeTooltipRows(archetype, breakdown);
  return (
    <div className="group relative rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <p className="cursor-help text-xs font-semibold uppercase tracking-wide text-[var(--muted)] underline decoration-dotted underline-offset-2">
        Archetype
      </p>
      <p className="mt-1 cursor-help text-sm text-[var(--ink)]">{archetype}</p>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-left shadow-lg group-hover:block group-focus-within:block"
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Fight shapes · their lean in bold
        </p>
        <ul className="max-h-72 space-y-2 overflow-y-auto text-xs leading-snug text-[var(--ink)]">
          {rows.map((row) => (
            <li
              key={row.name}
              className={row.preferred ? "font-bold" : "font-normal"}
            >
              <span>{row.name}</span>
              {row.pct != null && row.pct > 0 ? (
                <span className="font-normal text-[var(--muted)]">
                  {" "}
                  ({row.pct}%)
                </span>
              ) : null}
              <span className="font-normal text-[var(--muted)]">
                {" "}
                — {row.description}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatBlock({
  title,
  body,
  hint,
}: {
  title: string;
  body: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <p
        className={`text-xs font-semibold uppercase tracking-wide text-[var(--muted)] ${
          hint ? "cursor-help underline decoration-dotted underline-offset-2" : ""
        }`}
        title={hint}
      >
        {title}
      </p>
      <p
        className={`mt-1 text-sm text-[var(--ink)] ${
          hint ? "cursor-help" : ""
        }`}
        title={hint}
      >
        {body}
      </p>
    </div>
  );
}
