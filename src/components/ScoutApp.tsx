"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftMetaTable } from "@/lib/scoring/draftMeta";
import type { PlayerScout, ScoutReport } from "@/lib/scoring/types";
import type { ReviewGame, ReviewGameSummary } from "@/lib/review/replayDraft";
import { DraftTracker, type SlTrackRow } from "@/components/DraftTracker";
import { LobbyScreenWatch } from "@/components/LobbyScreenWatch";
import { ScoutReportView } from "@/components/ScoutReport";
import { InteractiveDraft } from "@/components/InteractiveDraft";
import {
  actionsFromObserved,
  EMPTY_LIVE_DRAFT,
  heroFromPlateText,
  rosterTagsForLobby,
  rosterTagsPresent,
  type LiveDraft,
} from "@/lib/lobby/screenLobby";

type LeagueTeam = {
  name: string;
  slug: string;
  profileUrl: string;
  week?: number | null;
  scheduledAt?: string | null;
  played?: boolean;
  place?: number | null;
  points?: number | null;
  wins?: number | null;
  losses?: number | null;
};

type CallCount = { kind: string; label: string; count: number };
type RosterPlayer = { battletag: string; games: number };

function scoutHeaders(): HeadersInit {
  const secret = process.env.NEXT_PUBLIC_SCOUT_API_SECRET?.trim();
  return secret ? { "x-scout-secret": secret } : {};
}

async function scoutFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...scoutHeaders(), ...init?.headers },
  });
}

type TeamsResponse = {
  teams: LeagueTeam[];
  season: number;
  division: string;
  homeTeam: string;
  source: string;
  warning?: string;
};

function formatMatchDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function formatPlace(place: number | null | undefined): string {
  if (place == null || place <= 0) return "—";
  const mod100 = place % 100;
  const mod10 = place % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : mod10 === 1
        ? "st"
        : mod10 === 2
          ? "nd"
          : mod10 === 3
            ? "rd"
            : "th";
  return `${place}${suffix}`;
}

function opponentsByWeek(
  teams: LeagueTeam[],
): { week: number | null; label: string; teams: LeagueTeam[] }[] {
  const map = new Map<number | "other", LeagueTeam[]>();
  for (const t of teams) {
    const key = t.week != null && t.week > 0 ? t.week : "other";
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  const weeks = [...map.keys()]
    .filter((k): k is number => k !== "other")
    .sort((a, b) => a - b);
  const groups: { week: number | null; label: string; teams: LeagueTeam[] }[] =
    weeks.map((week) => ({
      week,
      label: `Week ${week}`,
      teams: map.get(week) ?? [],
    }));
  const other = map.get("other");
  if (other?.length) {
    groups.push({ week: null, label: "Unscheduled / other", teams: other });
  }
  return groups;
}

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
  const [loadingProgress, setLoadingProgress] = useState(12);
  const [scoutPass, setScoutPass] = useState(1);
  const [matchupsFilling, setMatchupsFilling] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewGames, setReviewGames] = useState<ReviewGameSummary[] | null>(null);
  const [loadingReviewGames, setLoadingReviewGames] = useState(false);
  const [review, setReview] = useState<ReviewGame | null>(null);
  const [liveDraft, setLiveDraft] = useState<LiveDraft | null>(null);
  const [sharing, setSharing] = useState(false);
  const [lobbyNames, setLobbyNames] = useState<string[]>([]);
  const [screenOurNames, setScreenOurNames] = useState<string[]>([]);
  const [statsNote, setStatsNote] = useState<string | null>(null);
  const [slTrack, setSlTrack] = useState<SlTrackRow[]>([]);
  const [slTrackError, setSlTrackError] = useState<string | null>(null);
  const [stormHome, setStormHome] = useState<PlayerScout[]>([]);
  const [stormTheirs, setStormTheirs] = useState<PlayerScout[]>([]);
  const [watchMeta, setWatchMeta] = useState<DraftMetaTable | null>(null);
  const [tournamentDraft, setTournamentDraft] = useState(false);
  const [watchReset, setWatchReset] = useState(0);
  const [draftSaved, setDraftSaved] = useState<string | null>(null);
  const liveScoutKey = useRef("");
  const ngsScoutKey = useRef("");
  const draftFileId = useRef("");
  const draftSaveBody = useRef<Record<string, unknown>>({});
  const tournamentDraftRef = useRef(false);
  tournamentDraftRef.current = tournamentDraft;

  const homeName = meta?.homeTeam ?? "";
  const screenOurTags = useMemo(
    () => rosterTagsPresent(screenOurNames, ourRoster),
    [screenOurNames, ourRoster],
  );
  const scoutingSelf = selected !== "" && selected === homeName;
  const lineupsReady =
    ourFive.length === 5 && (scoutingSelf || theirFive.length === 5);
  const liveScreen = useMemo(() => {
    if (!liveDraft) return null;
    return actionsFromObserved({
      ...liveDraft,
      weFirst: liveDraft.firstPick === "us",
    });
  }, [liveDraft]);

  const weekGroups = useMemo(() => opponentsByWeek(teams), [teams]);

  const loadingStages = useMemo(() => {
    const stages = [
      { key: "ngs-schedule", label: "NGS schedule" },
      { key: "ngs-team", label: "NGS roster" },
      { key: "hp-storm-league", label: "Storm League" },
      { key: "hp-ngs-player", label: "NGS player profiles" },
      { key: "hp-team-matches", label: "Team match history" },
      { key: "hp-global-heroes", label: "Global hero stats" },
      { key: "hp-hero-matchups", label: "Hero matchups" },
    ] as const;

    return stages
      .map((stage) => ({
        ...stage,
        count:
          predictedCalls?.find((call) => call.kind === stage.key)?.count ?? 0,
      }))
      .filter((stage) => stage.count > 0);
  }, [predictedCalls]);

  useEffect(() => {
    if (!loadingReport) {
      setLoadingProgress(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Hero matchups can take several minutes. Keep the bar moving without
      // claiming the scout is almost finished.
      const crawl = 12 + Math.min(60, (elapsed / 90_000) * 60);
      setLoadingProgress(Math.round(crawl));
    }, 400);

    return () => window.clearInterval(timer);
  }, [loadingReport]);

  const currentProgress = Math.max(0, Math.min(100, loadingProgress));
  const activeStage =
    loadingStages.length > 0
      ? loadingStages[
          Math.min(
            loadingStages.length - 1,
            Math.max(
              0,
              Math.floor((currentProgress / 100) * loadingStages.length),
            ),
          )
        ].label
      : "Generating report";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await scoutFetch("/api/league/teams");
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
    if (!sharing) {
      liveScoutKey.current = "";
      ngsScoutKey.current = "";
      draftFileId.current = "";
      setDraftSaved(null);
      setScreenOurNames([]);
      setStormHome([]);
      setStormTheirs([]);
      setSlTrack([]);
      setSlTrackError(null);
      setTournamentDraft(false);
    }
  }, [sharing]);

  const wasSharing = useRef(false);
  useEffect(() => {
    const started = sharing && !wasSharing.current;
    wasSharing.current = sharing;
    if (!started || !report) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("interactive-draft")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sharing, report]);

  const slNameKey = [
    ...(liveDraft?.ourPickPlayers ?? []),
    ...(liveDraft?.theirPickPlayers ?? []),
    ...screenOurNames,
    ...lobbyNames,
    ...ourRoster.map((player) => player.battletag),
  ].join("|");
  const slLookup = useMemo(() => {
    const unique = (names: (string | null | undefined)[]) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const name of names) {
        const shown = name?.trim();
        if (!shown) continue;
        const key = (shown.split("#")[0] ?? shown).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(shown);
      }
      return out;
    };
    const withHomeTags = (names: (string | null | undefined)[]) =>
      unique(
        names.map((name) => {
          const shown = name?.split("#")[0]?.trim();
          if (!shown) return name;
          return rosterTagsPresent([shown], ourRoster)[0] ?? shown;
        }),
      );
    const playersOnly = (names: (string | null | undefined)[]) =>
      unique(names).filter((name) => !heroFromPlateText(name.split("#")[0] ?? name)).slice(0, 5);
    const ourLookup = playersOnly(
      withHomeTags([
        ...screenOurNames,
        ...(liveDraft?.ourPickPlayers ?? []),
      ]),
    );
    const theirLookup = playersOnly([
      ...lobbyNames,
      ...(liveDraft?.theirPickPlayers ?? []),
    ]);
    return {
      ourLookup,
      theirLookup,
      tags: unique([...theirLookup, ...ourLookup]).slice(0, 10),
    };
  }, [slNameKey]);

  useEffect(() => {
    if (!sharing || watchMeta) return;
    let cancelled = false;
    scoutFetch("/api/meta/heroes")
      .then(async (res) => {
        const data = (await res.json()) as DraftMetaTable & { error?: string };
        if (!res.ok || !data.byHero) return;
        if (!cancelled) setWatchMeta(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sharing, watchMeta]);

  useEffect(() => {
    if (!sharing) return;
    const { ourLookup, theirLookup, tags } = slLookup;
    const display = (tag: string) => tag.split("#")[0]?.trim().toLowerCase() ?? "";
    if (!tags.length) {
      setSlTrack([]);
      setSlTrackError(null);
      return;
    }
    const key = tags.map((tag) => tag.toLowerCase()).sort().join("|");
    if (liveScoutKey.current === `sl:${key}`) return;
    liveScoutKey.current = `sl:${key}`;
    let cancelled = false;
    const ourNames = new Set(ourLookup.map((name) => display(name)));
    const theirNames = new Set(theirLookup.map((name) => display(name)));
    const rows: SlTrackRow[] = tags.map((tag) => ({
      name: tag.split("#")[0]?.trim() || tag,
      side: ourNames.has(display(tag)) ? "us" : "them",
      status: "pulling",
      games: 0,
    }));
    setSlTrack(rows);
    setSlTrackError(null);
    (async () => {
      await Promise.all(
        tags.map(async (tag, index) => {
          if (cancelled) return;
          try {
            const slRes = await scoutFetch(
              `/api/players/storm-league?tags=${encodeURIComponent(tag)}`,
            );
            const slData = (await slRes.json()) as {
              players?: PlayerScout[];
              error?: string;
            };
            if (!slRes.ok) throw new Error(slData.error ?? "Storm League lookup failed");
            if (cancelled) return;
            const player = slData.players?.[0];
            const games = player
              ? player.topHeroes.reduce(
                  (sum, hero) => sum + (hero.sources.stormLeague?.games ?? 0),
                  0,
                )
              : 0;
            if (player) {
              const who = display(player.battletag);
              if (ourNames.has(who)) {
                setStormHome((current) =>
                  current.some((have) => display(have.battletag) === who)
                    ? current
                    : [...current, player],
                );
              } else if (theirNames.has(who)) {
                setStormTheirs((current) =>
                  current.some((have) => display(have.battletag) === who)
                    ? current
                    : [...current, player],
                );
              }
            }
            setSlTrack((current) =>
              current.map((row, rowIndex) =>
                rowIndex === index
                  ? { ...row, status: games > 0 ? "found" : "miss", games }
                  : row,
              ),
            );
          } catch (e) {
            if (cancelled) return;
            setSlTrack((current) =>
              current.map((row, rowIndex) =>
                rowIndex === index ? { ...row, status: "error" } : row,
              ),
            );
            setSlTrackError(e instanceof Error ? e.message : "Could not look up those players.");
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sharing, slLookup]);

  useEffect(() => {
    if (!sharing || !tournamentDraft || lobbyNames.length !== 5 || screenOurTags.length < 4) {
      return;
    }
    const key = `ngs:${[...screenOurTags].sort().join(",")}|${[...lobbyNames].map((name) => name.toLowerCase()).sort().join("|")}`;
    if (ngsScoutKey.current === key) return;
    const previous = ngsScoutKey.current;
    ngsScoutKey.current = key;
    let cancelled = false;
    (async () => {
      const known = rosterTagsForLobby(lobbyNames, theirRoster);
      const opponent = known && selected && selected !== homeName ? selected : null;
      try {
        let team = opponent;
        let tags = known;
        if (!team) {
          setStatsNote("Looking up this lobby on the NGS roster.");
          const res = await scoutFetch(
            `/api/league/lineup?names=${encodeURIComponent(lobbyNames.join("|"))}`,
          );
          const data = (await res.json()) as {
            team?: string | null;
            battletags?: string[];
            error?: string;
          };
          if (!res.ok) throw new Error(data.error ?? "Lineup lookup failed");
          if (data.team && (data.battletags?.length ?? 0) >= 4) {
            team = data.team;
            tags = data.battletags ?? [];
          }
        }
        if (cancelled) return;
        if (team && tags && tags.length >= 4) {
          setSelected(team);
          setTheirFive(tags);
          setStatsNote(`Loading ${team} NGS hero pools.`);
          const ok = await runScout(team, screenOurTags, tags);
          if (!cancelled) {
            setStatsNote(ok ? null : `Could not load ${team} NGS pools.`);
          }
          return;
        }
        if (!cancelled) {
          setStatsNote("These names are not on an NGS roster.");
        }
      } catch (e) {
        if (!cancelled) {
          ngsScoutKey.current = previous;
          setStatsNote(e instanceof Error ? e.message : "Could not look up those players.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sharing, tournamentDraft, lobbyNames, screenOurTags, theirRoster, selected, homeName]);

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
    setReview(null);
    setReviewOpen(false);
    await runScout(selected, ourFive, scoutingSelf ? ourFive : theirFive);
  }

  async function openReview() {
    setReviewOpen((v) => !v);
    if (reviewGames || loadingReviewGames) return;
    setLoadingReviewGames(true);
    try {
      const res = await scoutFetch("/api/review/games");
      const data = (await res.json()) as { games?: ReviewGameSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't load played games");
      setReviewGames(data.games ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load played games");
    } finally {
      setLoadingReviewGames(false);
    }
  }

  async function reviewGame(id: string) {
    setReviewOpen(false);
    setReview(null);
    setReport(null);
    setError(null);
    setLoadingReport(true);
    setLoadingReview(true);
    setLoadingProgress(12);
    try {
      const res = await scoutFetch(`/api/review/game?id=${encodeURIComponent(id)}`);
      const game = (await res.json()) as ReviewGame & { error?: string };
      if (!res.ok) throw new Error(game.error ?? "Couldn't read that replay");
      // Ringers aren't on the NGS roster; fill from the season's most-played.
      const ours = fillLineup(game.ourTags, ourRoster);
      const theirs = fillLineup(game.theirTags, await loadRoster(game.opponent));
      setSelected(game.opponent);
      const ok = await runScout(game.opponent, ours, theirs);
      if (ok) setReview(game);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft review failed");
      setLoadingReport(false);
    } finally {
      setLoadingReview(false);
    }
  }

  async function runScout(
    team: string,
    ours: string[],
    theirs: string[],
  ): Promise<boolean> {
    setLoadingReport(true);
    setLoadingProgress(12);
    setScoutPass(1);
    setMatchupsFilling(false);
    setError(null);
    setReport(null);
    setPredictedCalls(null);
    const teamPath = encodeURIComponent(team.replace(/ /g, "_"));
    const params = new URLSearchParams();
    if (refreshPlayerData) params.set("fresh", "1");
    params.set("ours", ours.join("|"));
    params.set("theirs", theirs.join("|"));
    const fresh = `?${params.toString()}`;
    try {
      const estimateRes = await scoutFetch(
        `/api/scout/${teamPath}/estimate${fresh}`,
      );
      if (estimateRes.ok) {
        const estimate = (await estimateRes.json()) as {
          predicted?: CallCount[];
        };
        setPredictedCalls(estimate.predicted ?? null);
      }
      // Cloudflare closes a single response around 125s with an HTML 524.
      // The server pauses before that and the next pass continues from cache.
      const maxPasses = 8;
      let paused: (ScoutReport & { error?: string }) | null = null;
      for (let pass = 1; pass <= maxPasses; pass++) {
        setScoutPass(pass);
        const res = await scoutFetch(`/api/scout/${teamPath}${fresh}`);
        const raw = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(
            res.ok
              ? "Scout returned a non-JSON response (often a proxy timeout). Try again."
              : `Scout failed (${res.status}): server returned HTML instead of JSON.`,
          );
        }
        if (!res.ok) {
          const errMsg =
            data &&
            typeof data === "object" &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : "Scout failed";
          throw new Error(errMsg);
        }
        const report = data as ScoutReport & { error?: string };
        if (report.teamName) {
          setReport(report);
          setLoadingReport(false);
          setMatchupsFilling(Boolean(report.incomplete));
        }
        if (report.incomplete) {
          paused = report.teamName ? report : paused;
          continue;
        }
        if (!report.teamName) {
          throw new Error(report.error ?? "Scout failed");
        }
        setMatchupsFilling(false);
        setReport(report);
        return true;
      }
      setMatchupsFilling(false);
      if (paused?.teamName) {
        setReport({
          ...paused,
          incomplete: undefined,
          warnings: [
            ...paused.warnings,
            "Scout paused before the connection timed out. Generate again to finish the remaining data.",
          ],
        });
        return true;
      }
      throw new Error(paused?.error ?? "Scout failed");
    } catch (e) {
      setMatchupsFilling(false);
      setError(e instanceof Error ? e.message : "Scout failed");
      return false;
    } finally {
      setLoadingReport(false);
    }
  }

  const homeLabels = useMemo(() => {
    const names = new Set<string>();
    for (const player of ourRoster) {
      const shown = player.battletag.split("#")[0]?.trim().toLowerCase();
      if (shown) names.add(shown);
    }
    return names;
  }, [ourRoster]);
  const opponentStorm = useMemo(
    () =>
      stormTheirs.filter((player) => {
        const shown = player.battletag.split("#")[0]?.trim().toLowerCase() ?? "";
        return shown && !homeLabels.has(shown);
      }),
    [stormTheirs, homeLabels],
  );

  const draftSaveKey = [
    liveDraft?.map ?? "",
    liveDraft?.phase ?? "",
    liveDraft?.firstPick ?? "",
    (liveDraft?.ourBans ?? []).join(","),
    (liveDraft?.theirBans ?? []).join(","),
    (liveDraft?.ourPicks ?? []).join(","),
    (liveDraft?.theirPicks ?? []).join(","),
    (liveDraft?.ourPickPlayers ?? []).join(","),
    (liveDraft?.theirPickPlayers ?? []).join(","),
    screenOurNames.join(","),
    lobbyNames.join(","),
  ].join("|");

  useEffect(() => {
    if (!sharing || !liveDraft) return;
    const locks =
      liveDraft.ourBans.length +
      liveDraft.theirBans.length +
      liveDraft.ourPicks.length +
      liveDraft.theirPicks.length;
    if (!locks && !liveDraft.map && screenOurNames.length + lobbyNames.length < 3) return;
    if (!draftFileId.current) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      draftFileId.current = `draft-${stamp}`;
    }
    draftSaveBody.current = {
      id: draftFileId.current,
      map: liveDraft.map,
      phase: liveDraft.phase,
      firstPick: liveDraft.firstPick,
      ourNames: screenOurNames,
      theirNames: lobbyNames,
      ourBans: liveDraft.ourBans,
      theirBans: liveDraft.theirBans,
      ourPicks: liveDraft.ourPicks,
      theirPicks: liveDraft.theirPicks,
      ourPickPlayers: liveDraft.ourPickPlayers,
      theirPickPlayers: liveDraft.theirPickPlayers,
    };
    const timer = window.setTimeout(() => {
      void scoutFetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftSaveBody.current),
      })
        .then(async (res) => {
          const data = (await res.json()) as { file?: string };
          if (res.ok && data.file) setDraftSaved(data.file);
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [sharing, draftSaveKey]);

  function resetLiveDraft() {
    liveScoutKey.current = "";
    ngsScoutKey.current = "";
    draftFileId.current = "";
    setDraftSaved(null);
    setLobbyNames([]);
    setScreenOurNames([]);
    setStormHome([]);
    setStormTheirs([]);
    setStatsNote(null);
    setSlTrack([]);
    setSlTrackError(null);
    setLiveDraft({ ...EMPTY_LIVE_DRAFT });
    setWatchReset((epoch) => epoch + 1);
  }

  return (
    <div className="flex w-full flex-col">
    <div className="mx-auto flex w-full max-w-none flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      {!sharing && (
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
      )}

      <section className={sharing ? "" : "space-y-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm sm:p-6"}>
        {!sharing && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--ink)]">Scout an opponent</h2>
          <p className="text-sm text-[var(--muted)]">
            Choose a team and both lineups, then build a draft plan for the upcoming match.
            Or share the main screen. Both lineups, bans, and locked picks fill in from the draft.
          </p>
        </div>
        )}
        <LobbyScreenWatch
          ourNames={ourRoster.map((player) => player.battletag.split("#")[0] ?? player.battletag)}
          rosterNames={[...ourRoster, ...theirRoster].map((player) => player.battletag)}
          onLobby={(names) => {
            setLobbyNames(names);
            const tags = rosterTagsForLobby(names, theirRoster);
            if (tags) setTheirFive(tags);
          }}
          onOurSide={setScreenOurNames}
          onDraft={setLiveDraft}
          onWatchingChange={setSharing}
          resetEpoch={watchReset}
        />
        {!sharing && (
        <>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm font-medium text-[var(--muted)]">Team</span>
            <TeamPicker
              homeTeam={meta?.homeTeam ?? null}
              weekGroups={weekGroups}
              selected={selected}
              disabled={loadingTeams || loadingReport}
              loading={loadingTeams}
              onSelect={setSelected}
            />
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={!selected || !lineupsReady || loadingReport || loadingRoster}
            className="h-12 rounded-md bg-[var(--accent)] px-6 text-sm font-semibold uppercase tracking-wide text-[var(--accent-ink)] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingReport && !loadingReview ? "Scouting…" : "Generate scout report"}
          </button>
        </div>
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
        </>
        )}
      </section>

      {!sharing && (
      <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-[var(--ink)]">Review a played game</h2>
            <p className="text-sm text-[var(--muted)]">
              Grades every ban and pick from an NGS replay. The opponent and both lineups
              come from the replay — the team and lineups above aren&apos;t used.
            </p>
          </div>
          <button
            type="button"
            onClick={openReview}
            disabled={loadingReport || !homeName}
            aria-expanded={reviewOpen}
            className="h-12 shrink-0 rounded-md border border-[var(--accent)] px-6 text-sm font-semibold uppercase tracking-wide text-[var(--accent)] transition enabled:hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingReview ? "Loading review…" : reviewOpen ? "Hide games" : "Choose a game"}
          </button>
        </div>
        {reviewOpen && (
          <ReviewGamePicker
            games={reviewGames}
            loading={loadingReviewGames}
            activeId={review?.id ?? null}
            onPick={reviewGame}
          />
        )}
      </section>
      )}

      {!sharing && (
      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={refreshPlayerData}
          disabled={loadingReport}
          onChange={(e) => setRefreshPlayerData(e.target.checked)}
        />
        Refresh hero &amp; player data (applies to scout reports and draft reviews)
      </label>
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
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)] shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-[var(--ink)]">
              {loadingReview
                ? refreshPlayerData
                  ? "Refreshing source data and loading the draft review…"
                  : "Loading the draft review…"
                : refreshPlayerData
                  ? "Refreshing source data and generating the scout report…"
                  : scoutPass > 1
                    ? `Still working (pass ${scoutPass}). The report opens as soon as the roster is ready.`
                    : "Generating the scout report…"}
            </p>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              {Math.round(currentProgress)}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
              style={{ width: `${currentProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
            <span>Current step</span>
            <span>{activeStage}</span>
          </div>
          {predictedCalls && predictedCalls.some((c) => c.count > 0) ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                Planned API calls
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {predictedCalls
                  .filter((c) => c.count > 0)
                  .map((c) => (
                    <li key={c.kind} className="rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--ink)]">
                      {c.label}: {c.count}
                    </li>
                  ))}
              </ul>
            </div>
          ) : predictedCalls ? (
            <p>API queue: no new source pulls expected.</p>
          ) : null}
        </div>
      )}

      {sharing && !report ? (
        <div className="space-y-3">
          <DraftTracker rows={slTrack} error={slTrackError} />
          {draftSaved ? (
            <p className="text-sm text-[var(--muted)]">Saved drafts/{draftSaved}</p>
          ) : null}
          {statsNote ? (
            <p className="text-sm text-[var(--muted)]">{statsNote}</p>
          ) : null}
          <InteractiveDraft
            tree={{ id: "live", title: "Live draft", detail: "Read from the shared screen." }}
            weFirst={liveDraft?.firstPick === "us"}
            sideKnown={liveDraft?.firstPick != null}
            screen={liveScreen}
            observedPicks={liveDraft}
            ourLabel="Us"
            theirLabel="Them"
            allowSeatReshuffle={false}
            homeRoster={stormHome}
            theirRoster={opponentStorm}
            draftMeta={watchMeta}
            onWatchReset={resetLiveDraft}
            ourLikely={[]}
            map={liveDraft?.map}
            watchOnly
            stormLeagueOnly
            tournamentMode={tournamentDraft}
            onTournamentModeChange={setTournamentDraft}
          />
        </div>
      ) : null}

      {matchupsFilling && report && (
        <p className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--muted)]">
          Hero matchups are still loading. This report is ready to use and will
          update as they finish.
        </p>
      )}

      {report && (
        <ScoutReportView
          key={review?.id ?? "live"}
          report={report}
          review={review}
          liveDraft={liveDraft}
        />
      )}
    </div>
    </div>
  );
}

const TEAM_COLS =
  "grid grid-cols-[minmax(10rem,1.6fr)_4.25rem_3.25rem_3.75rem_3.5rem] items-baseline gap-x-3";

function TeamPicker({
  homeTeam,
  weekGroups,
  selected,
  disabled,
  loading,
  onSelect,
}: {
  homeTeam: string | null;
  weekGroups: { week: number | null; label: string; teams: LeagueTeam[] }[];
  selected: string;
  disabled: boolean;
  loading: boolean;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuMaxH, setMenuMaxH] = useState<number | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Use almost all space below the trigger; scroll only if content exceeds that.
      const below = Math.floor(window.innerHeight - rect.bottom - 16);
      setMenuMaxH(Math.max(160, below));
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const selectedTeam =
    selected && homeTeam && selected === homeTeam
      ? null
      : (weekGroups.flatMap((g) => g.teams).find((t) => t.name === selected) ??
        null);

  const triggerLabel = loading
    ? "Loading teams…"
    : !selected
      ? "Select a team"
      : selected === homeTeam
        ? `${homeTeam} (self scout)`
        : selected;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 text-left text-base text-[var(--ink)] outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-50"
      >
        <span className="min-w-0 truncate">
          {selectedTeam ? (
            <TeamRowInline team={selectedTeam} />
          ) : (
            <span
              className={!selected ? "text-[var(--muted)]" : "font-semibold"}
            >
              {triggerLabel}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[var(--muted)]" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={menuMaxH != null ? { maxHeight: menuMaxH } : undefined}
          className="absolute left-0 right-0 z-40 mt-1 overflow-auto rounded-md border border-[var(--line)] bg-[var(--panel)] shadow-lg sm:right-auto sm:min-w-[36rem]"
        >
          <div
            className={`${TEAM_COLS} sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]`}
          >
            <span>Team</span>
            <span className="text-right">Date</span>
            <span className="text-right">Place</span>
            <span className="text-right">Pts</span>
            <span className="text-right">W–L</span>
          </div>

          {homeTeam && (
            <div>
              <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Self scout
              </p>
              <button
                type="button"
                role="option"
                aria-selected={selected === homeTeam}
                onClick={() => {
                  onSelect(homeTeam);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left hover:bg-[var(--line)]/40 ${
                  selected === homeTeam ? "bg-[var(--accent)]/15" : ""
                }`}
              >
                <span className={`${TEAM_COLS} text-sm text-[var(--ink)]`}>
                  <span className="truncate font-semibold">
                    {homeTeam}{" "}
                    <span className="font-normal italic text-[var(--muted)]">
                      (self scout)
                    </span>
                  </span>
                  <span className="text-right text-[var(--muted)]">—</span>
                  <span className="text-right text-[var(--muted)]">—</span>
                  <span className="text-right text-[var(--muted)]">—</span>
                  <span className="text-right text-[var(--muted)]">—</span>
                </span>
              </button>
            </div>
          )}

          {weekGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                {group.label}
              </p>
              {group.teams.map((t) => {
                const active = selected === t.name;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onSelect(t.name);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-[var(--line)]/40 ${
                      active ? "bg-[var(--accent)]/15" : ""
                    }`}
                  >
                    <TeamRow team={t} />
                  </button>
                );
              })}
            </div>
          ))}

          {!homeTeam && weekGroups.length === 0 && (
            <p className="px-3 py-3 text-sm text-[var(--muted)]">
              No teams loaded.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TeamRow({ team }: { team: LeagueTeam }) {
  const date = formatMatchDate(team.scheduledAt);
  const place = formatPlace(team.place);
  const pts = team.points != null ? String(team.points) : "—";
  const record =
    team.wins != null && team.losses != null
      ? `${team.wins}–${team.losses}`
      : "—";
  const played = Boolean(team.played);

  return (
    <span
      className={`relative ${TEAM_COLS} text-sm ${
        played ? "text-[var(--muted)]" : "text-[var(--ink)]"
      }`}
    >
      {played ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-[0.65em] h-px bg-[var(--ink)]/55"
        />
      ) : null}
      <span className={`truncate ${played ? "font-medium" : "font-semibold"}`}>
        {team.name}
      </span>
      <span className="text-right italic tabular-nums text-[var(--muted)]">
        {date ?? "—"}
      </span>
      <span className="text-right font-semibold tabular-nums">{place}</span>
      <span className="text-right tabular-nums">
        {pts}
        {team.points != null ? (
          <span className="font-normal text-[var(--muted)]"> pts</span>
        ) : null}
      </span>
      <span className="text-right tabular-nums">{record}</span>
    </span>
  );
}

/** Compact one-line summary for the closed trigger. */
function TeamRowInline({ team }: { team: LeagueTeam }) {
  const date = formatMatchDate(team.scheduledAt);
  const place = formatPlace(team.place);
  const played = Boolean(team.played);
  return (
    <span
      className={`relative inline-flex min-w-0 max-w-full items-baseline gap-x-2 truncate text-sm ${
        played ? "text-[var(--muted)]" : "text-[var(--ink)]"
      }`}
    >
      {played ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-[0.65em] h-px bg-[var(--ink)]/55"
        />
      ) : null}
      <span className="truncate font-semibold">{team.name}</span>
      {date ? <span className="italic text-[var(--muted)]">{date}</span> : null}
      <span className="font-semibold tabular-nums">{place}</span>
      {team.points != null ? (
        <span className="tabular-nums">
          {team.points}
          <span className="font-normal text-[var(--muted)]"> pts</span>
        </span>
      ) : null}
      {team.wins != null && team.losses != null ? (
        <span className="tabular-nums">
          {team.wins}–{team.losses}
        </span>
      ) : null}
    </span>
  );
}

function ReviewGamePicker({
  games,
  loading,
  activeId,
  onPick,
}: {
  games: ReviewGameSummary[] | null;
  loading: boolean;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-2 border-t border-[var(--line)] pt-4">
      <p className="text-sm font-medium text-[var(--ink)]">Games we&apos;ve played</p>
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading NGS schedule…</p>
      ) : !games?.length ? (
        <p className="text-sm text-[var(--muted)]">No reported games with replays yet.</p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onPick(g.id)}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-[var(--line)]/40 ${
                  g.id === activeId
                    ? "border-[var(--accent)] bg-[var(--accent)]/15"
                    : "border-[var(--line)]"
                }`}
              >
                <span className="min-w-0 truncate text-[var(--ink)]">
                  <span className="font-semibold">Wk {g.round} G{g.game}</span> vs{" "}
                  {g.opponent}
                  <span className="text-[var(--muted)]"> · {g.map ?? "unknown map"}</span>
                </span>
                {g.won != null && (
                  <span
                    className={`shrink-0 text-xs font-bold ${g.won ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {g.won ? "W" : "L"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fillLineup(tags: string[], roster: RosterPlayer[]): string[] {
  const out = [...tags];
  for (const p of roster) {
    if (out.length >= 5) break;
    if (!out.includes(p.battletag)) out.push(p.battletag);
  }
  return out.slice(0, 5);
}

async function loadRoster(team: string): Promise<RosterPlayer[]> {
  const res = await scoutFetch(
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
