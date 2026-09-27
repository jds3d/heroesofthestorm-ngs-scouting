import {
  heroHasWaveclear,
  heroIsOfflaner,
  heroIsRangedDamage,
} from "@/lib/scoring/draftPlan";
import {
  heroDraftMeta,
  liveAllySynergies,
  type DraftMetaTable,
} from "@/lib/scoring/draftMeta";
import { heroKey, heroRole } from "@/lib/scoring/heroMeta";
import type { DraftCompPick, PlayerScout } from "@/lib/scoring/types";

export type LetterGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D"
  | "F";

export type SideDraftGrade = {
  label: string;
  grade: LetterGrade;
  /** Absolute quality of the locked five (0–100). */
  quality: number;
  /** Quality of the pre-draft optimal five (0–100). */
  optimalQuality: number;
  /** Closeness to optimal (0–100+) — drives the letter grade. */
  fidelity: number;
  notes: string[];
};

export type DraftReportCard = {
  ours: SideDraftGrade;
  theirs: SideDraftGrade;
  /** Estimated P(we win) from this draft alone (0–100). */
  winPct: number;
  headline: string;
  reasons: string[];
};

type LockedSeat = {
  hero: string;
  player: string | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function comfortOf(
  roster: PlayerScout[],
  player: string | null,
  hero: string,
): number {
  if (!roster.length) return 0;
  const want = player?.split("#")[0]?.trim().toLowerCase() ?? null;
  let best = 0;
  for (const p of roster) {
    const name = p.battletag.split("#")[0]?.trim().toLowerCase() ?? "";
    if (want && name !== want && p.battletag.toLowerCase() !== player?.toLowerCase()) {
      continue;
    }
    const hit = p.topHeroes.find((h) => heroKey(h.hero) === heroKey(hero));
    if (!hit) {
      if (want) return 0;
      continue;
    }
    if (want) return hit.comfort;
    best = Math.max(best, hit.comfort);
  }
  return best;
}

/** Structure completeness: tank / heal / offlane / ranged / waveclear. */
function structureScore(heroes: string[]): {
  points: number;
  holes: string[];
} {
  const roles = heroes.map((h) => heroRole(h));
  const holes: string[] = [];
  let points = 0;
  if (roles.some((r) => r === "Tank")) points += 4;
  else holes.push("no tank");
  if (roles.some((r) => r === "Healer" || r === "Support")) points += 4;
  else holes.push("no healer");
  if (heroes.some((h) => heroIsOfflaner(h))) points += 4;
  else holes.push("no offlane");
  if (heroes.some((h) => heroIsRangedDamage(h))) points += 4;
  else holes.push("no ranged");
  if (heroes.some((h) => heroHasWaveclear(h))) points += 4;
  else holes.push("no waveclear");
  return { points, holes };
}

function comfortScore(
  seats: LockedSeat[],
  roster: PlayerScout[],
): { points: number; avg: number } {
  if (!seats.length) return { points: 0, avg: 0 };
  let sum = 0;
  for (const s of seats) {
    sum += comfortOf(roster, s.player, s.hero);
  }
  const avg = sum / seats.length;
  // Comfort ~0.05–0.25 typical; map into 0–25.
  return { points: clamp(avg * 100, 0, 25), avg };
}

function synergyScore(
  heroes: string[],
  table: DraftMetaTable | null | undefined,
): { points: number; best: string | null } {
  if (heroes.length < 2 || !table) return { points: 10, best: null }; // neutral if no data
  let total = 0;
  let pairs = 0;
  let best: { label: string; wr: number } | null = null;
  for (let i = 0; i < heroes.length; i++) {
    const allies = heroes.filter((_, j) => j !== i);
    const edges = liveAllySynergies(table, heroes[i], allies);
    for (const e of edges) {
      // Count each unordered pair once (i < j via hero key order).
      if (heroKey(heroes[i]) > heroKey(e.hero)) continue;
      total += e.allyWinRate - 50;
      pairs += 1;
      if (!best || e.allyWinRate > best.wr) {
        best = {
          label: `${heroes[i]} + ${e.hero} (${e.allyWinRate}%)`,
          wr: e.allyWinRate,
        };
      }
    }
  }
  if (!pairs) return { points: 10, best: null };
  const avg = total / pairs;
  return {
    points: clamp(10 + avg * 1.2, 0, 20),
    best: best?.label ?? null,
  };
}

/** How this five fares into the enemy five via SL matchup edges. */
function matchupScore(
  ours: string[],
  theirs: string[],
  table: DraftMetaTable | null | undefined,
): { points: number; edgePp: number; detail: string | null } {
  if (!ours.length || !theirs.length || !table) {
    return { points: 12.5, edgePp: 0, detail: null };
  }
  let edge = 0;
  let hits = 0;
  let best: string | null = null;
  let bestAbs = 0;
  for (const hero of ours) {
    const meta = heroDraftMeta(table, hero);
    for (const enemy of theirs) {
      const weBeat = heroDraftMeta(table, enemy).counteredBy.find(
        (c) => heroKey(c.hero) === heroKey(hero),
      );
      const theyBeat = meta.counteredBy.find(
        (c) => heroKey(c.hero) === heroKey(enemy),
      );
      if (weBeat) {
        const d = weBeat.theirWinRate - 50;
        edge += d;
        hits += 1;
        if (Math.abs(d) > bestAbs) {
          bestAbs = Math.abs(d);
          best = `${hero} ${weBeat.theirWinRate}% into ${enemy}`;
        }
      }
      if (theyBeat) {
        const d = theyBeat.theirWinRate - 50;
        edge -= d;
        hits += 1;
        if (Math.abs(d) > bestAbs) {
          bestAbs = Math.abs(d);
          best = `${enemy} ${theyBeat.theirWinRate}% into ${hero}`;
        }
      }
    }
  }
  const avg = hits ? edge / Math.max(5, hits / 2) : 0;
  return {
    points: clamp(12.5 + avg * 0.9, 0, 25),
    edgePp: Math.round(avg * 10) / 10,
    detail: best,
  };
}

/** How many seats land on the pre-draft optimal heroes / roles. */
function planHitScore(
  locked: LockedSeat[],
  optimal: DraftCompPick[],
): { points: number; exact: number; roleHits: number } {
  if (!optimal.length) return { points: 5, exact: 0, roleHits: 0 };
  const optHeroes = new Set(optimal.map((p) => heroKey(p.hero)));
  const optRoles = optimal.map((p) => p.role.toLowerCase());
  let exact = 0;
  let roleHits = 0;
  const usedRoles = new Set<number>();
  for (const s of locked) {
    if (optHeroes.has(heroKey(s.hero))) {
      exact += 1;
      continue;
    }
    const role = heroRole(s.hero).toLowerCase();
    const idx = optRoles.findIndex(
      (r, i) => !usedRoles.has(i) && (r === role || role.includes(r) || r.includes(role)),
    );
    if (idx >= 0) {
      usedRoles.add(idx);
      roleHits += 1;
    }
  }
  // Exact hero = 2 pts, role-only = 1 pt, max 10.
  const points = clamp(exact * 2 + roleHits, 0, 10);
  return { points, exact, roleHits };
}

function scoreFive(args: {
  seats: LockedSeat[];
  enemyHeroes: string[];
  roster: PlayerScout[];
  optimal: DraftCompPick[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
}): {
  quality: number;
  structure: ReturnType<typeof structureScore>;
  comfort: ReturnType<typeof comfortScore>;
  synergy: ReturnType<typeof synergyScore>;
  matchup: ReturnType<typeof matchupScore>;
  plan: ReturnType<typeof planHitScore>;
  mapPts: number;
} {
  const heroes = args.seats.map((s) => s.hero);
  const structure = structureScore(heroes);
  const comfort = comfortScore(args.seats, args.roster);
  const synergy = synergyScore(heroes, args.table);
  const matchup = matchupScore(heroes, args.enemyHeroes, args.table);
  const plan = planHitScore(args.seats, args.optimal);

  let mapPts = 0;
  if (args.map && args.table) {
    for (const h of heroes) {
      const hit = heroDraftMeta(args.table, h).mapStrong.find(
        (m) => m.map.toLowerCase() === args.map!.toLowerCase(),
      );
      if (hit && hit.deltaPp > 0) mapPts += Math.min(2, hit.deltaPp / 3);
    }
  }
  mapPts = clamp(mapPts, 0, 5);

  // Soft-normalize to ~100 (structure 20 + comfort 25 + synergy 20 + matchup 25 + plan 10 + map 5 = 105).
  const raw =
    structure.points +
    comfort.points +
    synergy.points +
    matchup.points +
    plan.points +
    mapPts;
  const quality = clamp(Math.round((raw / 105) * 100), 0, 100);

  return { quality, structure, comfort, synergy, matchup, plan, mapPts };
}

function fidelityToGrade(fidelity: number, quality: number, holes: string[]): LetterGrade {
  // Critical holes cap the letter even if you "followed the plan."
  let capped = fidelity;
  if (holes.includes("no healer") || holes.includes("no tank")) {
    capped = Math.min(capped, 72); // C+ max
  } else if (holes.length >= 2) {
    capped = Math.min(capped, 82); // B max
  }
  // Terrible absolute draft also caps (followed a bad plan ≠ A).
  if (quality < 40) capped = Math.min(capped, 60);
  else if (quality < 50) capped = Math.min(capped, 72);

  if (capped >= 98) return "A+";
  if (capped >= 94) return "A";
  if (capped >= 90) return "A-";
  if (capped >= 86) return "B+";
  if (capped >= 82) return "B";
  if (capped >= 78) return "B-";
  if (capped >= 72) return "C+";
  if (capped >= 66) return "C";
  if (capped >= 60) return "C-";
  if (capped >= 50) return "D";
  return "F";
}

function sideNotes(args: {
  scored: ReturnType<typeof scoreFive>;
  optimalQuality: number;
  fidelity: number;
  label: string;
}): string[] {
  const notes: string[] = [];
  const { scored, optimalQuality, fidelity } = args;
  if (scored.structure.holes.length) {
    notes.push(`Holes: ${scored.structure.holes.join(", ")}.`);
  }
  if (scored.plan.exact > 0 || optimalQuality > 0) {
    notes.push(
      `${scored.plan.exact}/5 exact plan heroes` +
        (scored.plan.roleHits
          ? `, +${scored.plan.roleHits} role fills`
          : "") +
        ".",
    );
  }
  if (scored.synergy.best) {
    notes.push(`Best pair: ${scored.synergy.best}.`);
  }
  if (scored.matchup.detail) {
    const sign = scored.matchup.edgePp >= 0 ? "+" : "";
    notes.push(
      `Matchup ${sign}${scored.matchup.edgePp}pp — ${scored.matchup.detail}.`,
    );
  }
  if (optimalQuality > 0) {
    const delta = scored.quality - optimalQuality;
    if (Math.abs(delta) <= 2 && fidelity >= 94) {
      notes.push("Locked essentially the optimal five.");
    } else if (delta >= 4) {
      notes.push(
        `Beat the pre-draft plan (+${delta} quality) — live board upgrades landed.`,
      );
    } else if (delta <= -6) {
      notes.push(
        `Left ${Math.abs(delta)} quality on the table vs the pre-draft five.`,
      );
    }
  }
  if (!notes.length) {
    notes.push(`${args.label} draft quality ${scored.quality}/100.`);
  }
  return notes.slice(0, 4);
}

function gradeSide(args: {
  label: string;
  locked: LockedSeat[];
  enemyHeroes: string[];
  roster: PlayerScout[];
  optimal: DraftCompPick[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
}): SideDraftGrade {
  const scored = scoreFive({
    seats: args.locked,
    enemyHeroes: args.enemyHeroes,
    roster: args.roster,
    optimal: args.optimal,
    table: args.table,
    map: args.map,
  });

  let optimalQuality = 0;
  if (args.optimal.length >= 3) {
    const optSeats: LockedSeat[] = args.optimal.map((p) => ({
      hero: p.hero,
      player: p.player,
    }));
    optimalQuality = scoreFive({
      seats: optSeats,
      enemyHeroes: args.enemyHeroes,
      roster: args.roster,
      optimal: args.optimal,
      table: args.table,
      map: args.map,
    }).quality;
  }

  // Fidelity: how close to optimal. Beating optimal can push over 100.
  const fidelity =
    optimalQuality > 0
      ? clamp(Math.round((scored.quality / optimalQuality) * 100), 0, 110)
      : scored.quality; // no plan → grade on absolute quality

  const grade = fidelityToGrade(
    fidelity,
    scored.quality,
    scored.structure.holes,
  );

  return {
    label: args.label,
    grade,
    quality: scored.quality,
    optimalQuality,
    fidelity,
    notes: sideNotes({
      scored,
      optimalQuality,
      fidelity,
      label: args.label,
    }),
  };
}

function winPctFromQualities(ourQ: number, theirQ: number, matchupEdgePp: number): number {
  // ~4 quality points ≈ 1% win; matchup pp adds a bit more.
  const delta = ourQ - theirQ + matchupEdgePp * 0.6;
  // Soft sigmoid-ish: tanh-style without importing math libs.
  const x = delta / 28;
  const sigmoid = x / (1 + Math.abs(x)); // ≈ tanh lite, range (-1,1)
  return Math.round(clamp(50 + sigmoid * 38, 12, 88));
}

function headlineFor(winPct: number, ourGrade: LetterGrade, theirGrade: LetterGrade): string {
  const lean =
    winPct >= 62
      ? "Favorable draft"
      : winPct >= 54
        ? "Slight edge"
        : winPct >= 47
          ? "Coin-flip draft"
          : winPct >= 39
            ? "Slight deficit"
            : "Uphill draft";
  return `${lean} — we grade ${ourGrade}, they grade ${theirGrade}.`;
}

/**
 * End-of-draft report card: letter grades (fantasy-football style) for how
 * close each side landed to their optimal five, plus a win likelihood from
 * the locked comps.
 */
export function gradeFinishedDraft(args: {
  ourLocked: LockedSeat[];
  theirLocked: LockedSeat[];
  ourOptimal: DraftCompPick[];
  theirOptimal: DraftCompPick[];
  homeRoster: PlayerScout[];
  theirRoster: PlayerScout[];
  table: DraftMetaTable | null | undefined;
  map: string | null;
  ourLabel?: string;
  theirLabel?: string;
}): DraftReportCard {
  const ourHeroes = args.ourLocked.map((s) => s.hero);
  const theirHeroes = args.theirLocked.map((s) => s.hero);

  const ours = gradeSide({
    label: args.ourLabel ?? "Us",
    locked: args.ourLocked,
    enemyHeroes: theirHeroes,
    roster: args.homeRoster,
    optimal: args.ourOptimal,
    table: args.table,
    map: args.map,
  });
  const theirs = gradeSide({
    label: args.theirLabel ?? "Them",
    locked: args.theirLocked,
    enemyHeroes: ourHeroes,
    roster: args.theirRoster,
    optimal: args.theirOptimal,
    table: args.table,
    map: args.map,
  });

  const matchup = matchupScore(ourHeroes, theirHeroes, args.table);
  const winPct = winPctFromQualities(ours.quality, theirs.quality, matchup.edgePp);

  const reasons: string[] = [];
  reasons.push(
    `Draft quality ${ours.quality} vs ${theirs.quality}` +
      (ours.optimalQuality || theirs.optimalQuality
        ? ` (optimal ${ours.optimalQuality || "—"} / ${theirs.optimalQuality || "—"})`
        : "") +
      ".",
  );
  if (matchup.detail) {
    const sign = matchup.edgePp >= 0 ? "+" : "";
    reasons.push(
      `Live matchup ${sign}${matchup.edgePp}pp — ${matchup.detail}.`,
    );
  }
  if (ours.notes[0]) reasons.push(`${args.ourLabel ?? "Us"}: ${ours.notes[0]}`);
  if (theirs.notes[0]) reasons.push(`${args.theirLabel ?? "Them"}: ${theirs.notes[0]}`);

  return {
    ours,
    theirs,
    winPct,
    headline: headlineFor(winPct, ours.grade, theirs.grade),
    reasons: reasons.slice(0, 4),
  };
}
