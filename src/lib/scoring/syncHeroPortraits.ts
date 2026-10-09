import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HERO_PORTRAIT_CDN,
  HERO_PORTRAIT_RAW,
  heroSelectPortraitSlug,
  uniqueDraftPortraitSlugs,
} from "@/lib/scoring/heroPortrait";

export type PortraitSyncEntry = {
  relPath: string;
  cdnUrl: string;
  /** Select-circle art is missing for a few heroes on the CDN; draft art covers them in UI. */
  optional?: boolean;
};

export function portraitSyncEntries(): PortraitSyncEntry[] {
  const draftSlugs = uniqueDraftPortraitSlugs();
  const byPath = new Map<string, string>();

  for (const slug of draftSlugs) {
    const draftRel = `public/heroes/draft/${slug}.png`;
    const draftCdn = `${HERO_PORTRAIT_RAW}/storm_ui_glues_draft_portrait_${slug}.png`;
    byPath.set(draftRel, draftCdn);

    const selectSlug = heroSelectPortraitSlug(slug);
    const selectRel = `public/heroes/select/${selectSlug}.png`;
    const selectCdn = `${HERO_PORTRAIT_RAW}/storm_ui_ingame_heroselect_btn_${selectSlug}.png`;
    byPath.set(selectRel, selectCdn);
  }

  return [...byPath.entries()]
    .map(([relPath, cdnUrl]) => ({
      relPath,
      cdnUrl,
      optional: relPath.includes("/select/"),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

const FETCH_HEADERS: HeadersInit = {
  "User-Agent": "heroesofthestorm-ngs-scouting/portrait-sync",
};

async function fetchPortrait(
  cdnUrl: string,
  attempts = 5,
): Promise<{ ok: true; body: Buffer } | { ok: false; status: number }> {
  let lastStatus = 0;
  for (let n = 0; n < attempts; n++) {
    const res = await fetch(cdnUrl, { headers: FETCH_HEADERS });
    lastStatus = res.status;
    if (res.ok) {
      return { ok: true, body: Buffer.from(await res.arrayBuffer()) };
    }
    if (res.status === 404) {
      return { ok: false, status: 404 };
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 400 * (n + 1)));
      continue;
    }
    return { ok: false, status: res.status };
  }
  return { ok: false, status: lastStatus };
}

export type SyncHeroPortraitsResult = {
  downloaded: number;
  skipped: number;
  failed: { relPath: string; error: string }[];
};

export async function syncHeroPortraits(
  rootDir: string,
  options?: { force?: boolean; concurrency?: number },
): Promise<SyncHeroPortraitsResult> {
  const force = options?.force ?? false;
  const concurrency = options?.concurrency ?? 3;
  const entries = portraitSyncEntries();
  const result: SyncHeroPortraitsResult = {
    downloaded: 0,
    skipped: 0,
    failed: [],
  };

  let index = 0;
  async function worker() {
    while (index < entries.length) {
      const i = index++;
      const { relPath, cdnUrl, optional } = entries[i];
      const abs = path.join(rootDir, relPath);
      if (!force) {
        try {
          const { access } = await import("node:fs/promises");
          await access(abs);
          result.skipped++;
          continue;
        } catch {
          /* download */
        }
      }

      try {
        const fetched = await fetchPortrait(cdnUrl);
        if (!fetched.ok) {
          if (optional && fetched.status === 404) {
            result.skipped++;
            continue;
          }
          result.failed.push({
            relPath,
            error: `HTTP ${fetched.status}`,
          });
          continue;
        }
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, fetched.body);
        result.downloaded++;
      } catch (e) {
        result.failed.push({
          relPath,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()),
  );

  const manifestPath = path.join(rootDir, "public/heroes/manifest.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        cdn: HERO_PORTRAIT_CDN,
        files: entries.map((e) => e.relPath.replace(/^public\//, "")),
        stats: result,
      },
      null,
      2,
    ),
  );

  return result;
}
