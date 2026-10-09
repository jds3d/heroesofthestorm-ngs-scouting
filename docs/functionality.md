# Functionality

What the app does today. When a feature ships, add it here and check it off in [todo.md](todo.md) if it was on that list.

Home team is Little Buff Boyz. The public site is `ngs-scouting.jstaff.trade`. Local Docker on port 3000 serves the last built image until it is rebuilt.

## Scout an opponent

- Load the A-league team list from NGS. If NGS is down, fall back to the season seed.
- Pick an opponent. The home team is left out of the list.
- Pick both lineups. Each side defaults to the five players with the most NGS games this season.
- Generate a scout report from NGS rosters and HeroesProfile (NGS games plus Storm League).
- Finished replays stay cached. Draft-only shells expire. "Refresh hero & player data" re-pulls profiles and Storm League stats.
- The report has three parts:
  - Who they are: team shape, threats, and what they want to play.
  - Each player: comfort from this NGS season, earlier NGS seasons, and Storm League.
  - Draft: who has first pick, the map, a ban and pick plan, and an interactive board.
- Comfort weights in the league config are NGS current 0.35, Storm League 0.55, prior NGS 0.10. The player cards on the report use a separate mix: 50% this NGS season, 20% earlier NGS, 30% Storm League.
- Map tendencies, signature bans, role holes, and bait bans (the heroes they pivot to) are part of the pre-draft plan.
- Matchup and ally-duo stats load for the heroes in the plan. A hero with no played matchup rows stays on the fetch queue. The board suggests with the rows it already has, and the suggestion updates as more rows arrive. While that pull runs, the draft board shows a matchup tracker (spotted, pulling, cached, scored) naming the heroes being loaded. A suggested hero that is still missing rows shows an amber badge; the tooltip names the missing rows and, while the pull is running, the percent already loaded. A hero whose pull failed shows a red badge. A thin sample can still look like a normal score.
- API routes require the scout secret header. HeroesProfile health is `GET /api/health/heroesprofile`.

## Interactive draft

- Storm League / NGS mid-ban order: four opening bans, one first-pick, two doubles, two mid bans, two doubles, one last pick.
- Click through bans and picks. Double-pick steps can be suggested and graded as a pair.
- Score a choice against comfort, role, synergy, and counters. A structural miss is graded as a miss.
- Swap a specialist onto the hero they play when someone else locked it.
- Choose first pick and the map on the report, then the plan follows that side.
- Tournament mode and Storm League mode are both on the board. Storm League does not reshuffle seats after a lock.

## Live screen draft

- Share the Heroes draft screen. Capture asks for 2560×1440 and keeps frames only when the height is at least 1440.
- Read the map title, the status pill ("Waiting for Team Ban" / "Waiting for Enemy"), and whose turn that is.
- Read the ten player names with local OCR. Rank words and UI collisions such as Silver or Level count as a player on that plate when OCR reads them as the battletag.
- Name filled ban hexes by comparing them to the official target portraits, plus saved ban-hex crops in `examples/ban-hexes/`. Each saved hex is turned into the same color + edge fingerprint the matcher already uses, so a live read of that hex scores ~100% against it. The hex is also slid across each square target portrait when the crop is tight (hood, bull). A ban is named only when one portrait leads the roster. Unclear hexes stay unnamed. POST `kind: "ban-hex"` to `/api/draft-examples` (or run the `regenerates` test with `REGEN_BAN_HEX=1`) to add a crop and refresh `banHexCatalog.json`.
- Read side portraits with the same lock rule as the lobby screenshots. A face during a ban is not a pick. A face during picks counts only when the rim glows blue or red. A white hover, such as Tyrande on the Alterac Pass lobby, stays off the board.
- A still of an unfinished lobby can be turned into the ban and pick sequence up to the current step (`progressFromObserved`). The two saved lobbies assert that sequence. The live board lists that sequence under the seats, and marks the step that is still open. A ban the screen has already moved past is shown as unseen.
- Infernal Shrines (`examples/drafts/draft lobby shrines.png`): our first ban, nothing locked, next step is our ban.
- Volskaya Foundry (`examples/drafts/draft lobby volskaya.png`): our first pick, through their fourth pick, next step is our closing double. Highlighted Falstad is left out of that sequence. Inside a double, the two heroes are listed from the top seat down.
- Names on the screen get a Storm League lookup. The stage bar is Names, Storm League, Suggestions.
- New `.StormReplay` files under your HotS Multiplayer folder are indexed into `.cache/replay-battletags.json` when screen share starts, when a draft lobby appears, and when you return to the menu after a game (`POST /api/replays/sync`). Set `HOTS_REPLAY_DIR` if replays live somewhere else.
- While the watch is running, the draft board fills from the screen: map, first pick, bans, and locks. The suggestion is for the next draft-order step. Each player whose portrait is still open gets one hero from that player's Storm League pool. A player who already locked is left out. On Volskaya that is Dante and hiimrick for us, and SKilleen for them.
- A double-pick window is one pair, not a hero for every open seat. The pair is the role split those two locks fill (Tank, Healer, Offlane, Ranged, or Flex). On our double the suggestion names the two heroes and which open player locks each. On their double it names the role split.
- Their remaining five is rebuilt after every lock. Banned and picked heroes drop out. Each open seat is filled with a hero from that player's pool that covers a role the five still lacks. On the Volskaya locks (Thrall, Brightwing, Nazeebo, Stitches) the open seat still needs offlane.
- An amber or red badge on a suggested hero during a live draft or a replay is written to `drafts/data-gaps.md`. Amber is a warning, red is an error. Check the item off after it is fixed. The same hero updates one row as the pull moves.
- A native 1440p frame can save new portrait examples for later matching.

## Replay review

- Pick a played NGS game. The opponent and both lineups come from the replay, not from the lineup pickers.
- Lay bans and picks onto the same draft order and grade each step. An amber or red badge on a suggestion is logged with the live drafts in `drafts/data-gaps.md`.
- A skipped or unknown ban stops the replay at that step so the board does not drift.
