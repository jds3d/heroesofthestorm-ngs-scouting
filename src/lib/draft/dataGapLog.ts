import { heroKey } from "@/lib/scoring/heroMeta";

/** Amber badge: rows still missing. Red badge: the pull failed. */
export type DataGapLevel = "warning" | "error";

export type DataGapDraft = {
  session: string;
  level: DataGapLevel;
  hero: string;
  pairWith: string | null;
  player: string | null;
  missing: string[];
  percent: number;
  loading: boolean;
  map: string | null;
  step: string | null;
  source: "live" | "replay";
};

export type DataGapEntry = DataGapDraft & {
  id: string;
  firstSeen: string;
  lastSeen: string;
  seen: number;
  addressed: boolean;
};

export function dataGapId(draft: Pick<DataGapDraft, "session" | "level" | "hero" | "pairWith">): string {
  const pair = draft.pairWith ? heroKey(draft.pairWith) : "";
  return [draft.session, draft.level, heroKey(draft.hero), pair].join("|");
}

/** One row per hero on this draft. Later pulls update the same row. */
export function mergeDataGaps(
  existing: readonly DataGapEntry[],
  incoming: readonly DataGapDraft[],
  now: string,
): DataGapEntry[] {
  const byId = new Map(existing.map((entry) => [entry.id, { ...entry }]));
  for (const draft of incoming) {
    const id = dataGapId(draft);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, {
        ...draft,
        id,
        firstSeen: now,
        lastSeen: now,
        seen: 1,
        addressed: false,
      });
      continue;
    }
    const changed =
      prev.percent !== draft.percent ||
      prev.loading !== draft.loading ||
      prev.missing.join("\n") !== draft.missing.join("\n");
    byId.set(id, {
      ...prev,
      missing: draft.missing,
      percent: draft.percent,
      loading: draft.loading,
      map: draft.map ?? prev.map,
      step: draft.step ?? prev.step,
      player: draft.player ?? prev.player,
      lastSeen: changed ? now : prev.lastSeen,
      seen: changed ? prev.seen + 1 : prev.seen,
    });
  }
  return [...byId.values()].sort(
    (a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.id.localeCompare(b.id),
  );
}

export function renderDataGaps(entries: readonly DataGapEntry[]): string {
  const lines = [
    "# Data gaps",
    "",
    "Amber badges are warnings. Red badges are errors. A suggested hero should not wear either during a game. Check an item after it is fixed.",
    "",
  ];
  if (!entries.length) {
    lines.push("None yet.");
    lines.push("");
    return lines.join("\n");
  }
  for (const entry of entries) {
    const who = entry.pairWith ? `${entry.hero} + ${entry.pairWith}` : entry.hero;
    const player = entry.player ? ` (${entry.player})` : "";
    const status = entry.level === "error"
      ? "failed"
      : entry.loading
        ? `${entry.percent}% loaded`
        : "missing";
    const where = [entry.step, entry.map, entry.source].filter(Boolean).join(" · ");
    const box = entry.addressed ? "x" : " ";
    lines.push(`- [${box}] ${entry.level} · **${who}**${player} · ${status} · ${where}`);
    for (const missing of entry.missing) lines.push(`  - ${missing}`);
    lines.push(`  - first ${entry.firstSeen} · last ${entry.lastSeen} · seen ${entry.seen}`);
    lines.push(`  <!-- gap:${entry.id} -->`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Ids whose checkbox was marked done in the markdown list. */
export function addressedIdsFromMarkdown(markdown: string): Set<string> {
  const ids = new Set<string>();
  const parts = markdown.split(/\n(?=- \[[ x]\])/);
  for (const part of parts) {
    if (!/^- \[x\]/.test(part.trim())) continue;
    const id = part.match(/<!-- gap:(.+?) -->/);
    if (id) ids.add(id[1]);
  }
  return ids;
}

export function applyAddressedMarks(
  entries: readonly DataGapEntry[],
  markdown: string,
): DataGapEntry[] {
  const checked = addressedIdsFromMarkdown(markdown);
  if (!checked.size) return entries.map((entry) => ({ ...entry }));
  return entries.map((entry) =>
    checked.has(entry.id) ? { ...entry, addressed: true } : { ...entry },
  );
}
