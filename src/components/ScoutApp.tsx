"use client";

import { useEffect, useState } from "react";
import type { ScoutReport } from "@/lib/scoring/types";
import { ScoutReportView } from "@/components/ScoutReport";

type LeagueTeam = {
  name: string;
  slug: string;
  profileUrl: string;
};

type CallCount = { kind: string; label: string; count: number };
type RosterPlayer = { battletag: string; games: number };

type TeamsResponse = {
  teams: LeagueTeam[];
  season: number;
  division: string;
  homeTeam: string;
  source: string;
  warning?: string;
};

export function ScoutApp() {
  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [meta, setMeta] = useState<Omit<TeamsResponse, "teams"> | null>(null);
  const [selected, setSelected] = useState("");
  const [report, setReport] = useState<ScoutReport | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictedCalls, setPredictedCalls] = useState<CallCount[] | null>(
    null,
  );
  const [refreshPlayerData, setRefreshPlayerData] = useState(false);
  const [ourRoster, setOurRoster] = useState<RosterPlayer[]>([]);
  const [theirRoster, setTheirRoster] = useState<RosterPlayer[]>([]);
  const [ourFive, setOurFive] = useState<string[]>([]);
  const [theirFive, setTheirFive] = useState<string[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const homeName = meta?.homeTeam ?? "";
  const scoutingSelf = selected !== "" && selected === homeName;
  const lineupsReady =
    ourFive.length === 5 && (scoutingSelf || theirFive.length === 5);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/league/teams");
        const data = (await res.json()) as TeamsResponse;
        if (cancelled) return;
        setTeams(data.teams);
        setMeta({
          season: data.season,
          division: data.division,
          homeTeam: data.homeTeam,
          source: data.source,
          warning: data.warning,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load teams");
        }
      } finally {
        if (!cancelled) setLoadingTeams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!homeName) return;
    let cancelled = false;
    (async () => {
      const players = await loadRoster(homeName);
      if (cancelled) return;
      setOurRoster(players);
      setOurFive(players.slice(0, 5).map((p) => p.battletag));
    })();
    return () => {
      cancelled = true;
    };
  }, [homeName]);

  useEffect(() => {
    if (!selected || selected === homeName) {
      setTheirRoster([]);
      setTheirFive([]);
      return;
    }
    let cancelled = false;
    setLoadingRoster(true);
    (async () => {
      const players = await loadRoster(selected);
      if (cancelled) return;
      setTheirRoster(players);
      setTheirFive(players.slice(0, 5).map((p) => p.battletag));
      setLoadingRoster(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, homeName]);

  async function generate() {
    if (!selected || !lineupsReady) return;
    setLoadingReport(true);
    setError(null);
    setReport(null);
    setPredictedCalls(null);
    const teamPath = encodeURIComponent(selected.replace(/ /g, "_"));
    const params = new URLSearchParams();
    if (refreshPlayerData) params.set("fresh", "1");
    params.set("ours", ourFive.join("|"));
    params.set("theirs", (scoutingSelf ? ourFive : theirFive).join("|"));
    const fresh = `?${params.toString()}`;
    try {
      const estimateRes = await fetch(`/api/scout/${teamPath}/estimate${fresh}`);
      if (estimateRes.ok) {
        const estimate = (await estimateRes.json()) as {
          predicted?: CallCount[];
        };
        setPredictedCalls(estimate.predicted ?? null);
      }
      const res = await fetch(`/api/scout/${teamPath}${fresh}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Scout failed");
      }
      setReport(data as ScoutReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scout failed");
    } finally {
      setLoadingReport(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-none flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--accent)]">
          NGS Season {meta?.season ?? "—"} · {meta?.division ?? "A"} League
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-tight text-[var(--ink)] sm:text-5xl">
          Opposition Scout
        </h1>
        <p className="max-w-2xl text-base text-[var(--muted)] sm:text-lg">
          For{" "}
          <span className="font-semibold text-[var(--ink)]">
            {meta?.homeTeam ?? "Little Buff Boyz"}
          </span>
          . Pick your next A-league opponent to pull comfort pools, draft
          tendencies, and ban priorities.
        </p>
      </header>

      <section className="flex flex-col gap-4 border-t border-[var(--line)] pt-6 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-2">
          <span className="text-sm font-medium text-[var(--muted)]">
            Team
          </span>
          <select
            className="h-12 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 text-base text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2"
            value={selected}
            disabled={loadingTeams || loadingReport}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">
              {loadingTeams ? "Loading teams…" : "Select a team"}
            </option>
            {meta?.homeTeam && (
              <optgroup label="Self scout">
                <option value={meta.homeTeam}>
                  {meta.homeTeam} (self scout)
                </option>
              </optgroup>
            )}
            <optgroup label="Opponents">
              {teams.map((t) => (
                <option key={t.slug} value={t.name}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={!selected || !lineupsReady || loadingReport || loadingRoster}
          className="h-12 rounded-md bg-[var(--accent)] px-6 text-sm font-semibold uppercase tracking-wide text-[var(--accent-ink)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingReport ? "Scouting…" : "Generate scout report"}
        </button>
        <label className="flex h-12 items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={refreshPlayerData}
            disabled={loadingReport}
            onChange={(e) => setRefreshPlayerData(e.target.checked)}
          />
          Refresh hero &amp; player data
        </label>
      </section>

      <LineupPicker
        title={`Our 5 — ${homeName || "Little Buff Boyz"} (${ourFive.length}/5)`}
        hint="Defaults to the five with the most NGS games this season."
        players={ourRoster}
        selected={ourFive}
        disabled={loadingReport}
        onChange={setOurFive}
      />
      {selected && !scoutingSelf && (
        <LineupPicker
          title={`Their 5 — ${selected} (${theirFive.length}/5)`}
          hint={
            loadingRoster
              ? "Loading roster and season games…"
              : "Defaults to the five with the most NGS games this season."
          }
          players={theirRoster}
          selected={theirFive}
          disabled={loadingReport || loadingRoster}
          onChange={setTheirFive}
        />
      )}

      {meta?.warning && (
        <p className="text-sm text-amber-700">{meta.warning}</p>
      )}
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {loadingReport && (
        <div className="space-y-2 text-sm text-[var(--muted)]">
          <p>
            {refreshPlayerData
              ? "Rebuilding the report and re-pulling NGS profiles / Storm League. Past games stay cached."
              : "Rebuilding the report from cached games and player data. Only missing pieces are fetched."}
          </p>
          {predictedCalls && predictedCalls.some((c) => c.count > 0) ? (
            <ul className="space-y-1">
              {predictedCalls
                .filter((c) => c.count > 0)
                .map((c) => (
                  <li key={c.kind}>
                    Predicted {c.label}: {c.count}
                  </li>
                ))}
            </ul>
          ) : predictedCalls ? (
            <p>Predicted API calls: none — this report is already saved.</p>
          ) : null}
        </div>
      )}

      {report && <ScoutReportView report={report} />}
    </div>
  );
}

async function loadRoster(team: string): Promise<RosterPlayer[]> {
  const res = await fetch(
    `/api/league/roster?team=${encodeURIComponent(team)}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { players?: RosterPlayer[] };
  return data.players ?? [];
}

function LineupPicker({
  title,
  hint,
  players,
  selected,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  players: RosterPlayer[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--ink)]">{title}</p>
      <p className="text-sm text-[var(--muted)]">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {players.map((p) => {
          const on = selected.includes(p.battletag);
          const name = p.battletag.split("#")[0];
          return (
            <button
              key={p.battletag}
              type="button"
              aria-pressed={on}
              disabled={disabled || (!on && selected.length >= 5)}
              onClick={() =>
                onChange(
                  on
                    ? selected.filter((t) => t !== p.battletag)
                    : selected.length >= 5
                      ? selected
                      : [...selected, p.battletag],
                )
              }
              className={`rounded-md border px-3 py-2 text-sm ${
                on
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                  : "border-[var(--line)] text-[var(--ink)] disabled:opacity-40"
              }`}
            >
              {name}
              <span className={on ? "opacity-80" : "text-[var(--muted)]"}>
                {" "}
                · {p.games} games
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
