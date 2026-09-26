# NGS Opposition Scout

Local web app for **Little Buff Boyz** to scout NGS A-league opponents. Pulls rosters from [nexusgamingseries.org](https://www.nexusgamingseries.org), scores hero comfort from NGS + Storm League via [HeroesProfile](https://api.heroesprofile.com), and recommends bans/adapts.

## Setup

1. **Node 20+** and npm
2. Copy env and add your HeroesProfile API token:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
HEROESPROFILE_API_TOKEN=your_token_here
```

3. Install and run (dev):

```bash
npm install
npm run dev
```

Or run as a Docker container (recommended for always-on local use):

```bash
docker compose up -d --build
```

Open [http://localhost:3000](http://localhost:3000).

### Auto-start on PC boot

Docker Desktop starts at login. The app and Cloudflare tunnel both use `restart: unless-stopped`.

- Local: [http://localhost:3000](http://localhost:3000)
- Public: [https://ngs-scouting.jstaff.trade](https://ngs-scouting.jstaff.trade)

Useful commands:

```bash
docker compose up -d --build   # build / (re)start app + tunnel
docker compose logs -f         # follow logs
docker compose stop            # stop until next reboot / until you start again
docker compose down            # stop and remove containers
```
## Usage

1. Choose an A-league opponent from the dropdown (home team is excluded).
2. Click **Generate scout report**.
3. Review draft narrative, ban priorities, team threats, and per-player comfort heroes.

First scout for a team can take a while (NGS + HeroesProfile calls). **Past games are forever-cached** under `.cache/` (replay/draft/ban payloads never change). Current-season player/Storm League stats refresh on a ~7 day TTL. Re-scouting reuses forever-cached games and only pulls what's missing.

## Config

Season / division / weights live in [`src/config/league.ts`](src/config/league.ts):

- Home team: `Little Buff Boyz`
- Division: `A` (Season 22)
- Comfort weights: NGS current **0.55**, Storm League **0.30**, prior NGS **0.15**

Seed fallback for the team list: [`src/config/season22-a.json`](src/config/season22-a.json). Live data comes from `GET /api/division/get?division=a` on the NGS site.

## HeroesProfile token

Put your **v1** API key in `.env.local`:

```
HEROESPROFILE_API_TOKEN=your_bearer_token_here
```

Keys come from [www.heroesprofile.com/Api](https://www.heroesprofile.com/Api) (new portal). The app uses:

- Base URL: `https://www.heroesprofile.com/api/external/v1`
- Auth: `Authorization: Bearer <key>`

Verify:

```bash
curl http://localhost:3000/api/health/heroesprofile
```

You want `"ok": true`. If you see `401`, create a new key on the account page (old `api.heroesprofile.com` tokens do not carry over).

Developer billing note: if **Switch** to Developer returns `422`, email Zemill — your key may still work after approval even when the Stripe switch UI fails.

## Refreshing the league list

Team dropdown is loaded from the live NGS API. To force a refresh of **volatile** data (rosters / current-season profiles / SL), delete matching `.cache/` files or wait for TTL. Do **not** delete `hp-v1-ngs-replay-*`, `hp-v1-replay-*`, or `hp-v1-ngs-match-*` — those are finished games and never need re-fetching.

If NGS is down, the API falls back to the season seed JSON.

## HeroesProfile quota notes

| Need | Prefer | Avoid |
|------|--------|-------|
| NGS hero pools | `ngs/player` (1× per player/season) | Replaying every game |
| Draft comps / bans | `replay/{id}/draft`, `replay/{id}/bans` | Full `ngs/replay/{id}` unless needed |
| Past games | Forever cache in `.cache/` | Re-downloading |

## Scripts

| Command                    | Description                    |
|----------------------------|--------------------------------|
| `npm run dev`              | Local Next.js dev server       |
| `npm run build`            | Production build               |
| `npm start`                | Run production build           |
| `docker compose up -d --build` | Build & run container (port 3000) |

## Notes

- The HeroesProfile token stays server-side (API routes only). Pass it via `.env.local` for Docker Compose.
- This setup is meant for local always-on use, not a public Cloudflare/Vercel deploy.
