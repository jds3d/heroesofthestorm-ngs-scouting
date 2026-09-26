"use client";

import { useState } from "react";
import type {
  DraftCompPick,
  DraftTreeNode,
  OurCompBrief,
  ScoutReport,
} from "@/lib/scoring/types";
import { PlayerCard } from "@/components/PlayerCard";

export function ScoutReportView({ report }: { report: ScoutReport }) {
  const [pickSide, setPickSide] = useState<"theyFirst" | "weFirst">("theyFirst");
  const shown = report;
  const plan = shown.adapt.draftPlan;
  const side = plan?.sides?.[pickSide] ?? null;
  return (
    <div className="flex flex-col gap-10">
      <section className="space-y-3 border-t border-[var(--line)] pt-8">
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
          Generated {new Date(report.generatedAt).toLocaleString()} · Adapt
          confidence: {shown.adapt.confidence}
        </p>
        {report.warnings?.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          Draft strategy
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatBlock
            title="Archetype"
            body={report.draft.archetype}
          />
          <StatBlock
            title="Games analyzed"
            body={
              report.draft.gamesAnalyzedLabel ??
              String(report.draft.gamesAnalyzed)
            }
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
          />
        </div>
        {(report.draft.sections?.length ?? 0) > 0 ? (
          <dl className="max-w-3xl space-y-4">
            {report.draft.sections.map((s) => (
              <div key={s.heading}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {s.heading}
                </dt>
                <dd className="mt-1 text-base leading-snug text-[var(--ink)]">
                  {s.body}
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
      </section>

      {shown.adapt.draftPlan && (
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
            Draft plan
          </h3>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Bait certainty: {shown.adapt.draftPlan.certainty}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PickButton
            active={pickSide === "weFirst"}
            onClick={() => setPickSide("weFirst")}
            label="We pick first"
          />
          <PickButton
            active={pickSide === "theyFirst"}
            onClick={() => setPickSide("theyFirst")}
            label="They pick first"
          />
        </div>
        <p className="max-w-3xl text-base leading-relaxed text-[var(--ink)]">
          {side?.summary ?? shown.adapt.draftPlan.summary}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <CompBoard
            title={
              report.teamName === "Little Buff Boyz"
                ? "Comp opponents should expect"
                : "Their likely comp"
            }
            picks={side?.theirLikely ?? shown.adapt.draftPlan.theirLikely}
          />
          <CompBoard
            title="Our likely comp"
            note={side?.ourCompNote ?? shown.adapt.draftPlan.ourCompNote}
            brief={side?.ourBrief ?? shown.adapt.draftPlan.ourBrief}
            picks={side?.ourLikely ?? shown.adapt.draftPlan.ourLikely}
          />
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Decision tree
          </h4>
          <p className="max-w-3xl text-sm text-[var(--muted)]">
            Two bans each before any picks, alternating, and the first-pick
            side bans first. Each side bans once more after the third pick
            round, with the second-pick side banning first that time. The
            first line of a branch is the draft if they follow the read. The
            line that starts with If is what we change when that ban or pick
            is something else.
          </p>
          <DraftTree node={side?.tree ?? shown.adapt.draftPlan.tree} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <StatBlock
            title="What they end up on"
            body={shown.adapt.draftPlan.theirComp}
          />
          <StatBlock
            title="How we beat that fight"
            body={shown.adapt.draftPlan.counter}
          />
        </div>
        <StatBlock title="Our synergy" body={shown.adapt.draftPlan.fight} />
        <StatBlock title="Maps and macro" body={shown.adapt.draftPlan.macro} />
        {shown.adapt.draftPlan.predictedPicks.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Predicted picks
            </h4>
            <ul className="space-y-1 text-sm text-[var(--ink)]">
              {shown.adapt.draftPlan.predictedPicks.map((p) => (
                <li key={p.hero}>
                  <span className="font-semibold">{p.hero}</span>
                  <span className="text-[var(--muted)]"> — {p.why}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {shown.adapt.draftPlan.baitBans.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Bait bans
            </h4>
            <ul className="space-y-1 text-sm text-[var(--ink)]">
              {shown.adapt.draftPlan.baitBans.map((b) => (
                <li key={b.hero}>
                  <span className="font-semibold">{b.hero}</span>
                  <span className="text-[var(--muted)]"> — {b.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.adapt.draftPlan.slots.map((s) => (
            <StatBlock
              key={s.role}
              title={s.role}
              body={`${s.heroes.join(", ")}. ${s.why}`}
            />
          ))}
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--ink)]">
          {shown.adapt.draftPlan.steps.map((s) => (
            <li key={s.phase}>
              <span className="font-semibold">{s.phase}.</span> {s.action}
            </li>
          ))}
        </ol>
        {shown.adapt.draftPlan.playbook && (
          <div className="space-y-3 border-t border-[var(--line)] pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-[family-name:var(--font-display)] text-xl text-[var(--ink)]">
                {shown.adapt.draftPlan.playbook.title}
              </h4>
              {shown.adapt.draftPlan.playbook.antiDiveThreat && (
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Anti-dive in their pool — pivot path
                </p>
              )}
            </div>
            <p className="max-w-3xl text-sm leading-relaxed text-[var(--ink)]">
              {shown.adapt.draftPlan.playbook.intro}
            </p>
            {shown.adapt.draftPlan.playbook.antiDiveHeroesSeen.length > 0 && (
              <p className="text-sm text-[var(--muted)]">
                Anti-dive comfort seen:{" "}
                {shown.adapt.draftPlan.playbook.antiDiveHeroesSeen.join(", ")}
              </p>
            )}
            <DraftTree node={shown.adapt.draftPlan.playbook.tree} />
            <div className="grid gap-3 sm:grid-cols-3">
              {shown.adapt.draftPlan.playbook.pivots.map((p) => (
                <StatBlock
                  key={p.name}
                  title={p.name}
                  body={`${p.objective} Heroes: ${p.heroes.join(", ")}. Maps: ${p.maps.join(", ")}.`}
                />
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      <section className="space-y-4">
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          Adapt plan
        </h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Ban priority
            </h4>
            <ol className="list-decimal space-y-2 pl-5 text-[var(--ink)]">
              {shown.adapt.banPriority.map((b) => (
                <li key={b.hero}>
                  <span className="font-semibold">{b.hero}</span>
                  <span className="text-[var(--muted)]"> — {b.reason}</span>
                </li>
              ))}
              {shown.adapt.banPriority.length === 0 && (
                <li className="text-[var(--muted)]">No clear bans yet</li>
              )}
            </ol>
            {shown.adapt.firstPickDenies.length > 0 && (
              <p className="text-sm text-[var(--muted)]">
                First-pick denies:{" "}
                {shown.adapt.firstPickDenies.join(", ")}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Recommendations
            </h4>
            <ul className="space-y-3">
              {shown.adapt.recommendations.map((r) => (
                <li key={r.title} className="border-l-2 border-[var(--accent)] pl-3">
                  <p className="font-semibold text-[var(--ink)]">{r.title}</p>
                  <p className="text-sm text-[var(--muted)]">{r.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {shown.threats.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
            Team threats
          </h3>
          <ul className="flex flex-wrap gap-2">
            {shown.threats.map((t) => (
              <li
                key={t.hero}
                className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm"
                title={t.reason}
              >
                <span className="font-semibold text-[var(--ink)]">{t.hero}</span>
                <span className="text-[var(--muted)]">
                  {" "}
                  · {(t.comfort * 100).toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          Roster comfort
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {report.roster.map((p) => (
            <PlayerCard key={p.battletag} player={p} />
          ))}
        </div>
      </section>

      {report.apiUsage && (
        <section className="space-y-3">
          <h3 className="font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
            API calls
          </h3>
          <p className="max-w-3xl text-sm text-[var(--muted)]">
            Predicted is what the scout expects to call. It is higher than
            actual when a token error stops the rest of the pulls. It is lower
            when a draft endpoint fails and we fall back to the full replay, or
            when last season’s drafts only run after we see that 3 or more
            players returned.
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
        </section>
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

function CompBoard({
  title,
  note,
  brief,
  picks,
}: {
  title: string;
  note?: string | null;
  brief?: OurCompBrief | null;
  picks: DraftCompPick[];
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </p>
      {brief && (
        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
          {brief.kind}
        </p>
      )}
      {brief?.noTankReason && (
        <p className="mt-1 text-sm text-[var(--ink)]">{brief.noTankReason}</p>
      )}
      {note && <p className="mt-1 text-sm text-[var(--muted)]">{note}</p>}
      <ol className="mt-2 space-y-2 text-sm text-[var(--ink)]">
        {picks.map((p) => (
          <li key={`${p.role}-${p.hero}`}>
            <span className="font-semibold">{p.hero}</span>
            <span className="text-[var(--muted)]">
              {" "}
              · {p.role}
              {p.player ? ` · ${p.player}` : ""}
              {p.note ? ` · ${p.note}` : ""}
            </span>
            {p.alternatives && p.alternatives.length > 0 && (
              <p className="text-[var(--muted)]">
                Alt:{" "}
                {p.alternatives
                  .map((a) => (a.player ? `${a.hero} (${a.player})` : a.hero))
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
      {brief && (
        <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-3 text-sm">
          <p className="text-[var(--ink)]">{brief.mapStrategy}</p>
          <p className="text-[var(--ink)]">
            <span className="font-semibold">Why it works: </span>
            {brief.whyItWorks}
          </p>
        </div>
      )}
    </div>
  );
}

function DraftTree({ node, indent = false }: { node: DraftTreeNode; indent?: boolean }) {
  const kids = node.children ?? [];
  const branched = kids.length > 1;
  const adjust = node.title.startsWith("If ");
  return (
    <div
      className={
        indent
          ? `ml-4 border-l pl-3 ${adjust ? "border-[var(--accent)]" : "border-[var(--line)]"}`
          : ""
      }
    >
      <p className="font-semibold text-[var(--ink)]">{node.title}</p>
      <p className="text-sm text-[var(--muted)]">{node.detail}</p>
      <div className={branched ? "mt-2 space-y-3" : "mt-2"}>
        {kids.map((child) => (
          <DraftTree key={child.id} node={child} indent={branched} />
        ))}
      </div>
    </div>
  );
}

function StatBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </p>
      <p className="mt-1 text-sm text-[var(--ink)]">{body}</p>
    </div>
  );
}
