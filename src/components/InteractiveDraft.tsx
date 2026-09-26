"use client";

import { useMemo, useState } from "react";
import type {
  DraftCompPick,
  DraftTreeAction,
  DraftTreeNode,
  OurCompBrief,
} from "@/lib/scoring/types";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import {
  earlyPickScore,
  formatCounter,
  heroDraftMeta,
  isFlexibleAnchorRole,
  isMapSpecialist,
  isOfflanePlanRole,
  liveCountersUp,
  type DraftMetaTable,
  type MatchupEdge,
} from "@/lib/scoring/draftMeta";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import { allDraftHeroes } from "@/lib/scoring/heroPortrait";
import { HeroFace } from "@/components/HeroFace";

type BoardAction = DraftTreeAction & { reason?: string };

type Suggestion = {
  hero: string;
  reason: string;
  badge: string;
  planLine: string | null;
  compLine: string | null;
  expectLine: string | null;
  cautionLine: string | null;
};

function heroFromTitle(title: string): string | null {
  const m =
    title.match(/^(?:Expected|Plan):\s*(.+)$/i) ||
    title.match(/:\s*([^:]+)$/) ||
    title.match(/If .+?:\s*(.+)$/i);
  const hero = m?.[1]?.trim();
  if (!hero || hero.startsWith("Flex")) return null;
  return hero;
}

function nodeAction(node: DraftTreeNode): DraftTreeAction | null {
  if (node.action) return node.action;
  const hero = heroFromTitle(node.title);
  if (!hero) return null;
  const side = /their/i.test(node.title)
    ? "their"
    : /our/i.test(node.title)
      ? "our"
      : node.branch
        ? "their"
        : null;
  const kind = /ban/i.test(node.title)
    ? "ban"
    : /pick/i.test(node.title)
      ? "pick"
      : null;
  if (!side || !kind) return null;
  return { side, kind, ordinal: 0, hero, player: null };
}

/** Flatten the expected path of the tree into ordered hero suggestions. */
function expectedPath(root: DraftTreeNode): { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[] {
  const out: { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[] = [];
  let node: DraftTreeNode | null = root;
  while (node) {
    const kids: DraftTreeNode[] = node.children ?? [];
    const expected: DraftTreeNode | undefined =
      kids.find((c: DraftTreeNode) => c.branch === "expected") ??
      kids.find((c: DraftTreeNode) => /^(Expected|Plan):/i.test(c.title));
    const adjust: DraftTreeNode | undefined =
      kids.find((c: DraftTreeNode) => c.branch === "adjust") ??
      kids.find((c: DraftTreeNode) => /^If /i.test(c.title));
    if (expected && adjust) {
      const act = nodeAction(expected);
      if (act) out.push({ hero: act.hero, side: act.side, kind: act.kind });
      node = expected.children?.[0] ?? null;
      continue;
    }
    const act = nodeAction(node);
    if (act) out.push({ hero: act.hero, side: act.side, kind: act.kind });
    node = kids[0] ?? null;
  }
  return out;
}

function slotsFor(
  history: BoardAction[],
  side: "our" | "their",
  kind: "ban" | "pick",
  count: number,
): (BoardAction | null)[] {
  const got = history.filter((a) => a.side === side && a.kind === kind);
  return Array.from({ length: count }, (_, i) => got[i] ?? null);
}

function goneKeys(history: BoardAction[]): Set<string> {
  return new Set(history.map((a) => heroKey(a.hero)));
}

function isGone(hero: string, gone: Set<string>): boolean {
  return gone.has(heroKey(hero));
}

function displayPlayer(tag: string | null): string | null {
  if (!tag) return null;
  return tag.split("#")[0]?.trim() || tag.trim() || null;
}

function planLine(picks: DraftCompPick[]): string | null {
  if (!picks.length) return null;
  const lineup = picks
    .map((p) => {
      const who = displayPlayer(p.player);
      return who
        ? `${p.hero} (${who} · ${p.role})`
        : `${p.hero} (${p.role})`;
    })
    .join(" · ");
  return `Our current plan — we can pivot based on what they show: ${lineup}.`;
}

/** Name our shape and how it answers their likely archetype. */
function compMatchupLine(
  brief: OurCompBrief | null,
  theirArchetype: string | null,
  archetypeCounter: string | null,
): string | null {
  if (!brief && !archetypeCounter) return null;
  const our = brief?.kind ?? "Our five";
  const theirRaw = theirArchetype?.trim() ?? "";
  const theirOk =
    theirRaw &&
    theirRaw !== "unclear" &&
    theirRaw !== "unknown" &&
    theirRaw !== "flexible / mixed";
  const their = theirOk ? `their ${theirRaw}` : "their likely shape";
  const head = `${our} into ${their}`;
  if (archetypeCounter) return `${head} — ${archetypeCounter}`;
  if (brief?.whyItWorks) return `${head} — ${brief.whyItWorks}`;
  return `${head}.`;
}

function expectTheirNext(
  planned: { hero: string; side: "our" | "their"; kind: "ban" | "pick" }[],
  historyLen: number,
  gone: Set<string>,
  theirLikely: DraftCompPick[],
): string | null {
  for (let i = historyLen; i < planned.length; i++) {
    const step = planned[i];
    if (step.side !== "their") continue;
    if (isGone(step.hero, gone)) continue;
    const who = theirLikely.find(
      (p) => heroKey(p.hero) === heroKey(step.hero),
    );
    const verb = step.kind === "ban" ? "ban" : "pick";
    return `Expect them to ${verb} ${step.hero} next${who?.player ? ` (${displayPlayer(who.player)})` : ""}.`;
  }
  const nextLikely = theirLikely.find((p) => !isGone(p.hero, gone));
  if (nextLikely) {
    const who = displayPlayer(nextLikely.player);
    return `Expect them toward ${nextLikely.hero}${who ? ` (${who})` : ""} from their likely five.`;
  }
  return null;
}

function boardOffNote(history: BoardAction[]): string | null {
  if (!history.length) return null;
  const names = [...new Set(history.map((a) => a.hero))];
  return `Actually off the board: ${names.join(", ")}.`;
}

/** Later offlane outs if we open a bruiser as flex bait. */
function offlaneFollowUps(
  hero: string,
  planPicks: DraftCompPick[],
  gone: Set<string>,
): string[] {
  const slot = planPicks.find((p) => heroKey(p.hero) === heroKey(hero));
  const fromAlts =
    slot?.alternatives
      ?.map((a) => a.hero)
      .filter((h) => !isGone(h, gone) && heroKey(h) !== heroKey(hero)) ?? [];
  const defaults = ["Sonya", "Dehaka", "Malthael", "Blaze", "Hogger"].filter(
    (h) => !isGone(h, gone) && heroKey(h) !== heroKey(hero),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of [...fromAlts, ...defaults]) {
    const k = heroKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= 3) break;
  }
  return out;
}

function offlaneBaitReason(
  hero: string,
  threats: MatchupEdge[],
  followUps: string[],
): string {
  const later =
    followUps.length > 0
      ? followUps.slice(0, 3).join(" / ")
      : "a real offlaner later";
  const bite =
    threats.length > 0
      ? `If they bite with ${threats
          .slice(0, 2)
          .map((t) => t.hero)
          .join(" / ")}, play ${hero} in the 4-man and take ${later} as the actual offlane — their "counter" is then stuck in a bad lane.`
      : `If they answer offlane into ${hero}, play ${hero} in the 4-man and take ${later} as the actual offlane — punish the lane they just declared.`;
  return (
    `Lock ${hero} as a flex bait — not as our committed offlaner. ` +
    `Offlane is ~half the game; first-picking your real offlane into open answers is how you lose the draft before level 1. ` +
    bite
  );
}

function pickReason(args: {
  table: DraftMetaTable | null | undefined;
  hero: string;
  ourPickCount: number;
  gone: Set<string>;
  map: string | null;
  planPicks: DraftCompPick[];
  expectLine: string | null;
  offBoard: string | null;
  /** True when we are opening offlane as intentional bait, not as the lane lock. */
  offlaneBait?: boolean;
}): { reason: string; cautionLine: string | null } {
  const meta = heroDraftMeta(args.table, args.hero);
  const slot = args.planPicks.find(
    (p) => heroKey(p.hero) === heroKey(args.hero),
  );
  const threats = liveCountersUp(args.table, args.hero, args.gone);
  const mapHit = isMapSpecialist(args.table, args.hero, args.map);
  const parts: string[] = [];
  const opening = args.ourPickCount === 0;
  const offlaneSeat = isOfflanePlanRole(slot?.role);

  if (opening && (args.offlaneBait || offlaneSeat)) {
    parts.push(
      offlaneBaitReason(
        args.hero,
        threats,
        offlaneFollowUps(args.hero, args.planPicks, args.gone),
      ),
    );
  } else if (opening) {
    if (isFlexibleAnchorRole(slot?.role)) {
      parts.push(
        `${args.hero} is a flexible ${slot?.role ?? "anchor"} — safe to show early without locking an offlane matchup (${meta.winRate.toFixed(1)}% WR, ${meta.influence} influence, ${meta.games}g SL).`,
      );
    } else if (meta.timing === "early") {
      parts.push(
        `${args.hero} is a safe early lock by the numbers — ${meta.winRate.toFixed(1)}% WR, ${meta.influence} influence (${meta.games}g SL).`,
      );
    } else if (meta.timing === "late") {
      parts.push(
        `${args.hero} is a weak/situational first pick — ${meta.winRate.toFixed(1)}% WR, ${meta.influence} influence (${meta.games}g SL). Prefer a tank/healer anchor if one is still in plan.`,
      );
    } else {
      parts.push(
        `${args.hero} is a mid-draft piece${slot ? ` for ${slot.role}` : ""} — ${meta.winRate.toFixed(1)}% WR (${meta.games}g SL).`,
      );
    }
  } else if (slot) {
    parts.push(
      `${args.hero} is the next ${slot.role} from our plan still up (${meta.winRate.toFixed(1)}% WR this patch).`,
    );
  } else {
    parts.push(
      `${args.hero} scores best among our planned five still up (${meta.winRate.toFixed(1)}% WR).`,
    );
  }

  if (mapHit) {
    parts.push(
      `Map specialist on ${mapHit.map}: ${mapHit.winRate}% WR (+${mapHit.deltaPp}pp vs baseline, ${mapHit.games}g).`,
    );
  }

  if (args.expectLine) {
    parts.push(args.expectLine);
  }

  if (args.offBoard) {
    parts.push(args.offBoard);
  }

  let caution: string | null = null;
  if (opening && (args.offlaneBait || offlaneSeat)) {
    caution =
      `Do not play ${args.hero} as the offlaner if they take a lane answer — that is the bait working. ` +
      (threats.length
        ? `Open answers still up: ${threats
            .slice(0, 3)
            .map(formatCounter)
            .join(", ")}.`
        : `Hold a real offlaner for after they declare the lane.`);
  } else if (threats.length > 0) {
    caution = `Caution: still loses hard to ${threats
      .slice(0, 3)
      .map(formatCounter)
      .join(", ")} if they take those.`;
  }

  return { reason: parts.join(" "), cautionLine: caution };
}

export function InteractiveDraft({
  tree,
  weFirst,
  banPriority = [],
  ourPickPlan = [],
  ourLikely = [],
  theirLikely = [],
  ourBrief = null,
  theirArchetype = null,
  archetypeCounter = null,
  map = null,
  draftMeta = null,
  ourLabel = "Us",
  theirLabel = "Them",
}: {
  tree: DraftTreeNode;
  weFirst: boolean;
  banPriority?: { hero: string; reason: string }[];
  /** @deprecated prefer ourLikely */
  ourPickPlan?: string[];
  ourLikely?: DraftCompPick[];
  theirLikely?: DraftCompPick[];
  ourBrief?: OurCompBrief | null;
  /** Their draft identity from the scout report. */
  theirArchetype?: string | null;
  /** How our answer-archetype beats theirs (from the playbook counter). */
  archetypeCounter?: string | null;
  map?: string | null;
  draftMeta?: DraftMetaTable | null;
  ourLabel?: string;
  theirLabel?: string;
}) {
  const [history, setHistory] = useState<BoardAction[]>([]);
  const [filter, setFilter] = useState("");
  const allHeroes = useMemo(() => allDraftHeroes(), []);
  const planned = useMemo(() => expectedPath(tree), [tree]);
  const planPicks = useMemo(() => {
    if (ourLikely.length) return ourLikely;
    return ourPickPlan.map((hero) => ({
      hero,
      role: heroRole(hero),
      player: null,
      note: null,
    }));
  }, [ourLikely, ourPickPlan]);

  const stepIndex = history.length;
  const done = stepIndex >= DRAFT_ORDER.length;
  const step = done ? null : DRAFT_ORDER[stepIndex];
  const ours = step ? (step.side === "fp") === weFirst : false;
  const gone = goneKeys(history);

  const ourBanCount = history.filter((a) => a.side === "our" && a.kind === "ban")
    .length;
  const theirBanCount = history.filter(
    (a) => a.side === "their" && a.kind === "ban",
  ).length;
  const ourPickCount = history.filter(
    (a) => a.side === "our" && a.kind === "pick",
  ).length;
  const theirPickCount = history.filter(
    (a) => a.side === "their" && a.kind === "pick",
  ).length;

  const suggestion = useMemo((): Suggestion | null => {
    if (!step) return null;
    const plan = planLine(planPicks);
    const comp = compMatchupLine(ourBrief, theirArchetype, archetypeCounter);
    const expect = expectTheirNext(planned, stepIndex, gone, theirLikely);
    const off = boardOffNote(history);

    if (ours && step.kind === "ban") {
      const next = banPriority.find((b) => !isGone(b.hero, gone));
      const treeBan = planned[stepIndex];
      const hero =
        (treeBan &&
          treeBan.side === "our" &&
          treeBan.kind === "ban" &&
          !isGone(treeBan.hero, gone) &&
          treeBan.hero) ||
        next?.hero;
      if (!hero) return null;
      const banReason =
        banPriority.find((b) => heroKey(b.hero) === heroKey(hero))?.reason ??
        `Ban ${hero} before they can take it.`;
      return {
        hero,
        badge: "Suggested ban",
        planLine: plan,
        compLine: comp,
        expectLine: expect,
        cautionLine: null,
        reason: [banReason, off].filter(Boolean).join(" "),
      };
    }

    if (!ours) {
      const treeStep = planned[stepIndex];
      const hero =
        treeStep &&
        treeStep.side === "their" &&
        !isGone(treeStep.hero, gone)
          ? treeStep.hero
          : theirLikely.find((p) => !isGone(p.hero, gone))?.hero;
      if (!hero) return null;
      const who = theirLikely.find((p) => heroKey(p.hero) === heroKey(hero));
      const whoName = displayPlayer(who?.player ?? null);
      return {
        hero,
        badge: step.kind === "ban" ? "Expected ban" : "Expected pick",
        planLine: plan,
        compLine: comp,
        expectLine: null,
        cautionLine: null,
        reason: [
          `We think they ${step.kind} ${hero}${whoName ? ` (${whoName})` : ""}.`,
          off,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    // Our pick — score plan heroes for early-pick safety, ignore stale tree copy.
    const candidates = planPicks
      .map((p) => p.hero)
      .filter((h) => !isGone(h, gone));
    if (!candidates.length) {
      const fallback = allHeroes.find((h) => !isGone(h, gone));
      if (!fallback) return null;
      return {
        hero: fallback,
        badge: "Suggested pick",
        planLine: plan,
        compLine: comp,
        expectLine: expect,
        cautionLine: null,
        reason: `Plan heroes are gone — ${fallback} is still up. ${off ?? ""}`.trim(),
      };
    }

    const roleOf = (hero: string) =>
      planPicks.find((p) => heroKey(p.hero) === heroKey(hero))?.role ?? null;

    const scoreOf = (hero: string) =>
      earlyPickScore(draftMeta, hero, {
        gone,
        map,
        ourPickCount,
        inPlan: true,
        planRole: roleOf(hero),
      });

    let ranked = [...candidates].sort(
      (a, b) => scoreOf(b) - scoreOf(a) || a.localeCompare(b),
    );

    // Pick 1: never open offlane if a flexible tank/heal anchor is still in plan.
    if (ourPickCount === 0) {
      const anchors = ranked.filter((h) => isFlexibleAnchorRole(roleOf(h)));
      const offlaners = ranked.filter((h) => isOfflanePlanRole(roleOf(h)));
      if (anchors.length && offlaners.includes(ranked[0])) {
        ranked = [...anchors, ...ranked.filter((h) => !anchors.includes(h))];
      }
    }

    const hero = ranked[0];
    const offlaneBait =
      ourPickCount === 0 && isOfflanePlanRole(roleOf(hero));
    const { reason, cautionLine } = pickReason({
      table: draftMeta,
      hero,
      ourPickCount,
      gone,
      map,
      planPicks,
      expectLine: expect,
      offBoard: off,
      offlaneBait,
    });

    const skipped = ranked.find((h) => h !== hero);
    let skipNote: string | null = null;
    if (skipped && ourPickCount === 0) {
      const skipThreats = liveCountersUp(draftMeta, skipped, gone);
      const skipMeta = heroDraftMeta(draftMeta, skipped);
      const skipRole = roleOf(skipped);
      if (offlaneBait && isFlexibleAnchorRole(skipRole)) {
        skipNote = `Holding ${skipped} (${skipRole}) until after they show whether they bite the offlane bait${
          skipThreats.length
            ? ` — still answered by ${skipThreats
                .slice(0, 2)
                .map(formatCounter)
                .join(", ")}`
            : ""
        }.`;
      } else if (isOfflanePlanRole(skipRole)) {
        skipNote = `Holding ${skipped} as the real offlane — do not first-pick the lane into open answers.`;
      } else if (skipMeta.timing === "late" || skipThreats.length > 0) {
        skipNote = `Holding ${skipped} (${skipMeta.winRate.toFixed(1)}% WR${
          skipThreats.length
            ? `; answered by ${skipThreats
                .slice(0, 2)
                .map(formatCounter)
                .join(", ")}`
            : ", situational first pick"
        }).`;
      }
    }

    return {
      hero,
      badge: offlaneBait ? "Suggested pick · offlane bait" : "Suggested pick",
      planLine: plan,
      compLine: comp,
      expectLine: expect,
      cautionLine: [cautionLine, skipNote].filter(Boolean).join(" ") || null,
      reason,
    };
  }, [
    step,
    planned,
    stepIndex,
    gone,
    ours,
    banPriority,
    planPicks,
    theirLikely,
    history,
    map,
    ourPickCount,
    allHeroes,
    ourBrief,
    theirArchetype,
    archetypeCounter,
    draftMeta,
  ]);

  const remainingBans = banPriority.filter((b) => !isGone(b.hero, gone));

  const available = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allHeroes.filter((h) => {
      if (isGone(h, gone)) return false;
      if (!q) return true;
      return h.toLowerCase().includes(q);
    });
  }, [allHeroes, gone, filter]);

  function lock(hero: string, reason?: string) {
    if (!step || isGone(hero, gone)) return;
    const ordinal =
      step.kind === "ban"
        ? (ours ? ourBanCount : theirBanCount) + 1
        : (ours ? ourPickCount : theirPickCount) + 1;
    setHistory((prev) => [
      ...prev,
      {
        side: ours ? "our" : "their",
        kind: step.kind,
        ordinal,
        hero,
        player: null,
        reason,
      },
    ]);
    setFilter("");
  }

  function undo() {
    setHistory((prev) => prev.slice(0, -1));
  }

  function reset() {
    setHistory([]);
    setFilter("");
  }

  const ourBans = slotsFor(history, "our", "ban", 3);
  const theirBans = slotsFor(history, "their", "ban", 3);
  const ourPicks = slotsFor(history, "our", "pick", 5);
  const theirPicks = slotsFor(history, "their", "pick", 5);

  const stepOrdinal =
    step == null
      ? 0
      : (ours
          ? step.kind === "ban"
            ? ourBanCount
            : ourPickCount
          : step.kind === "ban"
            ? theirBanCount
            : theirPickCount) + 1;

  const stepLabel = !step
    ? null
    : `${ours ? "Our" : "Their"} ${stepOrdinal}${
        stepOrdinal === 1 ? "st" : stepOrdinal === 2 ? "nd" : stepOrdinal === 3 ? "rd" : "th"
      } ${step.kind}`;

  return (
    <div className="space-y-4 overflow-hidden rounded-md border border-[#2a3a48] bg-[#0f1821] p-4 text-[#e8eef2]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
          Live draft board
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={history.length === 0}
            className="rounded-md border border-[#e11d48]/60 bg-[#e11d48]/15 px-3 py-1.5 text-sm font-semibold text-[#fecdd3] disabled:opacity-40"
          >
            Undo last
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={history.length === 0}
            className="rounded-md border border-[#3d5163] px-3 py-1.5 text-sm font-semibold text-[#c5d4e0] disabled:opacity-40"
          >
            Reset draft
          </button>
        </div>
      </div>

      <DraftSideRow
        label={theirLabel}
        bans={theirBans}
        picks={theirPicks}
        accent="enemy"
      />
      <DraftSideRow
        label={ourLabel}
        bans={ourBans}
        picks={ourPicks}
        accent="ally"
      />

      {remainingBans.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
            Ban priority still up
          </p>
          <ul className="flex flex-wrap gap-3">
            {remainingBans.map((b, i) => (
              <li key={b.hero} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={done || !step || step.kind !== "ban"}
                  onClick={() => lock(b.hero, b.reason)}
                  className="disabled:cursor-default"
                  title={b.reason}
                >
                  <HeroFace
                    hero={b.hero}
                    kind="select"
                    size="sm"
                    banned
                    label={`${i + 1}. ${b.hero}`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-md border border-[#3d5163] bg-[#162230] px-4 py-4">
        {done ? (
          <p className="text-sm font-semibold text-[#9dceb0]">
            Draft walk complete. Undo if something was logged wrong.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-[#e8eef2]">
                {stepLabel}
                {ours ? " — pick what we lock" : " — tap what they actually did"}
              </p>
              <p className="text-xs text-[#8aa0b2]">
                Step {stepIndex + 1} / {DRAFT_ORDER.length}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="hero-search"
                className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]"
              >
                Search heroes
              </label>
              <input
                id="hero-search"
                type="search"
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const first = available[0];
                  if (first) lock(first);
                }}
                placeholder="Type a name — Enter locks the first match"
                className="h-11 w-full rounded-md border border-[#3d5163] bg-[#0f1821] px-3 text-base text-[#e8eef2] outline-none placeholder:text-[#5a6b78] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>

            {suggestion && (
              <div className="flex flex-wrap items-start gap-4 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 py-3">
                <button
                  type="button"
                  onClick={() => lock(suggestion.hero, suggestion.reason)}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-ink)]">
                    {suggestion.badge}
                  </span>
                  <HeroFace
                    hero={suggestion.hero}
                    kind="select"
                    size="lg"
                    banned={step?.kind === "ban"}
                  />
                  <span className="text-sm font-semibold">{suggestion.hero}</span>
                </button>
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  {suggestion.planLine && (
                    <p className="text-sm font-semibold text-[#e8eef2]">
                      {suggestion.planLine}
                    </p>
                  )}
                  {suggestion.compLine && (
                    <p className="text-sm leading-snug text-[#9dceb0]">
                      {suggestion.compLine}
                    </p>
                  )}
                  {suggestion.expectLine && (
                    <p className="text-sm text-[#8aa0b2]">
                      {suggestion.expectLine}
                    </p>
                  )}
                  <p className="text-sm leading-snug text-[#c5d4e0]">
                    {suggestion.reason}
                  </p>
                  {suggestion.cautionLine && (
                    <p className="text-sm leading-snug text-amber-200/90">
                      {suggestion.cautionLine}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => lock(suggestion.hero, suggestion.reason)}
                    className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
                  >
                    Lock {suggestion.hero}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8aa0b2]">
                All heroes still available
              </p>
              <p className="text-xs text-[#8aa0b2]">
                Only faces missing here were actually banned or picked above —
                not the pre-draft plan.
              </p>
              <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-2 overflow-y-auto pr-1">
                {available.map((hero, i) => {
                  const fromSearch = Boolean(filter.trim()) && i === 0;
                  const fromSuggestion =
                    !filter.trim() &&
                    suggestion &&
                    heroKey(hero) === heroKey(suggestion.hero);
                  const highlighted = fromSearch || fromSuggestion;
                  return (
                    <button
                      key={hero}
                      type="button"
                      onClick={() => lock(hero)}
                      title={hero}
                      className={`rounded-md p-1 transition hover:bg-[#1e3040] ${
                        highlighted ? "ring-2 ring-[var(--accent)]" : ""
                      }`}
                    >
                      <HeroFace
                        hero={hero}
                        kind="select"
                        size="sm"
                        banned={step?.kind === "ban"}
                        label={hero}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftSideRow({
  label,
  bans,
  picks,
  accent,
}: {
  label: string;
  bans: (BoardAction | null)[];
  picks: (BoardAction | null)[];
  accent: "ally" | "enemy";
}) {
  const banRing = accent === "enemy" ? "ring-red-700/80" : "ring-teal-700/80";
  return (
    <div className="space-y-2">
      <p
        className={`text-xs font-bold uppercase tracking-wide ${
          accent === "enemy" ? "text-red-300/90" : "text-teal-300/90"
        }`}
      >
        {label}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-1.5">
          {bans.map((b, i) => (
            <EmptyOrFace
              key={`ban-${i}`}
              action={b}
              banned
              ring={banRing}
              placeholder="Ban"
            />
          ))}
        </div>
        <div className="flex gap-1.5">
          {picks.map((p, i) => (
            <EmptyOrFace
              key={`pick-${i}`}
              action={p}
              ring={
                accent === "enemy" ? "ring-red-500/50" : "ring-teal-500/50"
              }
              placeholder="Pick"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyOrFace({
  action,
  banned,
  ring,
  placeholder,
}: {
  action: BoardAction | null;
  banned?: boolean;
  ring: string;
  placeholder: string;
}) {
  if (!action) {
    return (
      <div
        className={`flex h-20 w-14 items-center justify-center rounded-sm border border-dashed border-[#3d5163] bg-[#162230] text-[10px] uppercase tracking-wide text-[#5a6b78] ring-1 ${ring}`}
      >
        {placeholder}
      </div>
    );
  }
  return (
    <div className={`rounded-sm ring-2 ${ring}`}>
      <HeroFace
        hero={action.hero}
        kind="draft"
        size="md"
        banned={banned}
        label={action.hero}
        title={`${action.kind} · ${action.hero}${action.reason ? ` — ${action.reason}` : ""}`}
      />
    </div>
  );
}
