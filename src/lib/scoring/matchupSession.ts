import type { DraftMetaTable } from "@/lib/scoring/draftMeta";

const KEY = "ngs-sl-matchup-patch";

/** Merged Storm League matchup rows from earlier drafts this browser session. */
export function loadSessionMatchups(): DraftMetaTable | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftMetaTable;
    if (!parsed?.byHero || typeof parsed.byHero !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionMatchups(table: DraftMetaTable | null | undefined): void {
  if (typeof sessionStorage === "undefined" || !table?.byHero) return;
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        patch: table.patch,
        source: table.source,
        byHero: table.byHero,
      }),
    );
  } catch {
    /* quota */
  }
}
