const BASE = "https://www.nexusgamingseries.org/api";
const SEASON = 22;

async function get(path) {
  const r = await fetch(BASE + path, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()).returnObject;
}
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()).returnObject;
}

const divisions = await get("/division/get/all").catch(() => null);
const teams = new Set();
for (const d of divisions ?? []) for (const t of d.teams ?? []) teams.add(t);
console.log("divisions", divisions?.length, "teams", teams.size);

const mmr = new Map();
const games = new Map();
let i = 0;
for (const name of teams) {
  i++;
  try {
    const t = await get(`/team/get?team=${encodeURIComponent(name)}`);
    if (t?.hpMmrAvg) mmr.set(name, t.hpMmrAvg);
    const ms = await post("/schedule/fetch/matches/team", { season: SEASON, team: name });
    for (const m of ms ?? []) {
      if (!m.reported || !m.other) continue;
      for (const [k, v] of Object.entries(m.other)) {
        if (!/^\d+$/.test(k) || !v?.winner) continue;
        games.set(`${m.matchId}-${k}`, { home: m.home.teamName, away: m.away.teamName, homeWon: v.winner === "home" });
      }
    }
  } catch (e) {
    console.log("skip", name, e.message);
  }
}

const rows = [...games.values()]
  .filter((g) => mmr.has(g.home) && mmr.has(g.away))
  .map((g) => ({ d: mmr.get(g.home) - mmr.get(g.away), y: g.homeWon ? 1 : 0 }));
console.log("games with both MMRs", rows.length);

// Logistic fit y ~ sigmoid(b*d), no intercept (home/away is arbitrary in NGS).
let b = 0;
for (let it = 0; it < 200; it++) {
  let g = 0, h = 0;
  for (const { d, y } of rows) {
    const p = 1 / (1 + Math.exp(-b * d));
    g += (y - p) * d;
    h += p * (1 - p) * d * d;
  }
  b += g / h;
}
let h = 0;
for (const { d } of rows) { const p = 1 / (1 + Math.exp(-b * d)); h += p * (1 - p) * d * d; }
const se = 1 / Math.sqrt(h);
const toPct = (bb, gap) => (100 / (1 + Math.exp(-bb * gap))).toFixed(1);
console.log(`b=${b.toExponential(3)} se=${se.toExponential(3)} eloDivisor=${(Math.LN10 / b).toFixed(0)}`);
for (const gap of [75, 100, 200, 300]) console.log(`gap ${gap}: ${toPct(b, gap)}% (95% CI ${toPct(b - 1.96 * se, gap)}–${toPct(b + 1.96 * se, gap)}), elo400 ${toPct(Math.LN10 / 400, gap)}%`);
const buckets = [[0, 100], [100, 250], [250, 10000]];
for (const [lo, hi] of buckets) {
  const sel = rows.map((r) => (r.d < 0 ? { d: -r.d, y: 1 - r.y } : r)).filter((r) => r.d >= lo && r.d < hi);
  console.log(`gap ${lo}-${hi}: n=${sel.length} higher-MMR won ${(100 * sel.reduce((s, r) => s + r.y, 0) / sel.length).toFixed(0)}%`);
}
