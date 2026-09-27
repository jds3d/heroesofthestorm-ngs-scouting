import {
  diveGreenLightSlots,
  divePlaybook,
  divePlaybookTree,
  chooseDivePivot,
  pivotPlanSlots,
} from "@/config/divePlaybook";
import { heroKey, heroRole, heroSpellings, heroTags } from "@/lib/scoring/heroMeta";
import {
  banPressure,
  heroComfort,
  metaStrength,
  type GlobalHeroStat,
} from "@/lib/scoring/metaPressure";
import type {
  CompAlternative,
  DraftCompPick,
  DraftInsights,
  DraftPlan,
  DraftPlanSlot,
  DraftPlaybook,
  DraftSide,
  DraftTreeNode,
  OurCompBrief,
  PlayerScout,
} from "@/lib/scoring/types";

const LARGE_MAPS = new Set([
  "Warhead Junction",
  "Cursed Hollow",
  "Garden of Terror",
  "Sky Temple",
  "Alterac Pass",
  "Towers of Doom",
  "Volskaya Foundry",
  "Infernal Shrines",
]);

/** How to play a map, used to explain our comp's macro. */
const MAP_MACRO: Record<string, { size: "large" | "point"; line: string }> = {
  "Cursed Hollow": {
    size: "large",
    line: "take the tribute that spawns on your half and give the one that forces a full rotation",
  },
  "Warhead Junction": {
    size: "large",
    line: "pair the two nukes you can reach and turn them on a fort instead of fighting the far camp",
  },
  "Garden of Terror": {
    size: "large",
    line: "plant the terror on the side you already pushed, and skip a night that starts on their half",
  },
  "Sky Temple": {
    size: "large",
    line: "hold the two temples that spawn together and leave the solo temple if the rotation is late",
  },
  "Alterac Pass": {
    size: "large",
    line: "push the lane the cavalry will ride before it spawns, then fight on that objective",
  },
  "Volskaya Foundry": {
    size: "large",
    line: "win the protector pit, then ride it down the lane you cleared first",
  },
  "Blackheart's Bay": {
    size: "large",
    line: "turn coins in as a group and let the cannon do the siege",
  },
  "Towers of Doom": {
    size: "point",
    line: "win the altar fight — shots are the only core damage that matters",
  },
  "Infernal Shrines": {
    size: "point",
    line: "push the lane that feeds the shrine before it pops, then fight on the Punisher while that wave arrives",
  },
  "Braxis Holdout": {
    size: "point",
    line: "win the beacon that feeds your zerg wave, then stand in front of that wave",
  },
  "Battlefield of Eternity": {
    size: "point",
    line: "race the immortal, then fight in the lane it is walking",
  },
  "Hanamura Temple": {
    size: "point",
    line: "escort the payload that is ahead instead of splitting onto a second cart",
  },
  "Dragon Shire": {
    size: "point",
    line: "hold both shrines, then turn the dragon onto a keep",
  },
  "Tomb of the Spider Queen": {
    size: "point",
    line: "turn gems in as four and only fight when the turn-in is up",
  },
};

/** Tags the base meta doesn't carry, used only for draft shape. */
const EXTRA_TAGS: Record<string, string[]> = {
  Leoric: ["waveclear", "tankbuster"],
  Sonya: ["waveclear"],
  Dehaka: ["waveclear", "mobile"],
  Xul: ["waveclear"],
  Blaze: ["waveclear"],
  Ragnaros: ["waveclear"],
  Hogger: ["waveclear", "mobile"],
  Gazlowe: ["waveclear"],
  Malthael: ["waveclear", "tankbuster"],
  "Gul'dan": ["waveclear"],
  Guldan: ["waveclear"],
  Jaina: ["waveclear"],
  "Kael'thas": ["waveclear"],
  Kaelthas: ["waveclear"],
  Junkrat: ["waveclear"],
  Azmodan: ["waveclear"],
  Zagara: ["waveclear"],
  Sylvanas: ["waveclear"],
  Nazeebo: ["waveclear"],
  Greymane: ["waveclear"],
  Falstad: ["mobile"],
  Brightwing: ["mobile"],
  Illidan: ["mobile"],
  Tracer: ["mobile"],
  "Lúcio": ["mobile"],
  Lucio: ["mobile"],
  Muradin: ["mobile"],
  Tyrael: ["mobile"],
  Hanzo: ["mobile"],
  Medivh: ["mobile"],
  Abathur: ["mobile"],
  Johanna: ["peel"],
  Garrosh: ["peel"],
  Arthas: ["peel"],
  Uther: ["peel"],
  Anduin: ["peel"],
  Ana: ["peel"],
  Tychus: ["tankbuster"],
};

type Answer = {
  theirComp: string;
  fight: string;
  counter: string;
  /** Tags on their hero pool that let them escape this shape. Ban those. */
  outTags: string[];
  slots: DraftPlanSlot[];
};

const ANSWERS: Record<string, Answer> = {
  dive: {
    theirComp:
      "A dive core: engage tank, melee follow-up, and a healer who goes in with them.",
    fight:
      "Peel tank plus a point-and-click stun healer, so the backline lives the first engage. Damage is burst that cashes the CC, not a second dive.",
    counter:
      "They want to pick a target and delete it. Chain CC and save cooldowns punish the engage, then you win the fight they started.",
    outTags: ["safe", "peel", "poke"],
    slots: [
      {
        role: "Tank",
        heroes: ["Johanna", "Garrosh", "Arthas"],
        why: "Peel and bodyblock. Do not mirror their dive tank.",
      },
      {
        role: "Healer",
        heroes: ["Uther", "Anduin", "Brightwing"],
        why: "Point-and-click save. Brightwing also covers large-map rotations.",
      },
      {
        role: "Offlane",
        heroes: ["Leoric", "Blaze", "Dehaka"],
        why: "Wave clear so their dive doesn't get free structures while you group.",
      },
      {
        role: "Ranged",
        heroes: ["Jaina", "Kael'thas", "Gul'dan"],
        why: "AoE that lands after the peel stun. This is the team-fight payoff.",
      },
      {
        role: "Flex",
        heroes: ["Deckard", "Mei", "Medivh"],
        why: "Second layer of setup or a save. Confirms the wombo instead of adding another squishy.",
      },
    ],
  },
  "poke/siege": {
    theirComp:
      "A poke or siege shell: safe ranged damage, a frontline that doesn't have to engage, and wave clear of their own.",
    fight:
      "Heavy dive: flexible tank + enabler first, then burst + clean-up once anti-dive is ruled out. Mask Genji/Greymane/Kerrigan until mid-draft.",
    counter:
      "They win if the fight never starts. Close the gap with Anub/Tyrael/Diablo engage and delete a carry — do not trade poke.",
    outTags: ["dive", "engage", "assassin"],
    slots: diveGreenLightSlots(),
  },
  "double support": {
    theirComp:
      "Double support or an enabler (Abathur, Medivh, Zarya, Auriel) glued to one carry.",
    fight:
      "Percent damage and sustained siege, with enough engage to start fights before level 20.",
    counter:
      "They outlast a short burst. Bait them into staying double support, then draft damage that doesn't care about armor and a way to end the game early.",
    outTags: ["assassin", "hypercarry", "dive"],
    slots: [
      {
        role: "Tank",
        heroes: ["Diablo", "Garrosh", "Anub'arak"],
        why: "Pick one person so the second support can't save everyone.",
      },
      {
        role: "Healer",
        heroes: ["Alexstrasza", "Stukov", "Malfurion"],
        why: "Sustain of your own so you aren't the one who runs out of mana.",
      },
      {
        role: "Percent",
        heroes: ["Tychus", "Malthael", "Leoric"],
        why: "Cuts through the extra health and shields the second support provides.",
      },
      {
        role: "Siege",
        heroes: ["Greymane", "Sylvanas", "Gul'dan"],
        why: "Turn a won fight into structures before their late-game scaling.",
      },
      {
        role: "Offlane",
        heroes: ["Dehaka", "Xul", "Blaze"],
        why: "Clear and a global so you can start the fight while a lane is held.",
      },
    ],
  },
  hypercarry: {
    theirComp:
      "One hypercarry (Valla, Zul'jin, Greymane, Hammer) with a frontline built to protect them.",
    fight:
      "Heavy dive playbook: tank + enabler early, core divers only on the green light. The carry is the only target.",
    counter:
      "Leave the carry up and ban the peel that makes them unkillable. Kill the carry in the first two seconds or the draft failed.",
    outTags: ["peel", "safe", "shield"],
    slots: diveGreenLightSlots(),
  },
  default: {
    theirComp:
      "No single shape we can force. Treat their comfort bans as denies, not as a bait.",
    fight:
      "A standard synergistic five: engage or peel tank, a healer that matches that tank, wave-clear offlane, and two damage heroes who want the same fight.",
    counter:
      "Counter their highest-comfort hero's job (dive, poke, or protect) without drafting five heroes who don't play together.",
    outTags: [],
    slots: [
      {
        role: "Tank",
        heroes: ["Johanna", "Diablo", "Garrosh"],
        why: "Pick the tank for the fight you want, then build everyone else around it.",
      },
      {
        role: "Healer",
        heroes: ["Anduin", "Rehgar", "Stukov"],
        why: "Anduin with peel, Rehgar with engage, Stukov if you need zone control.",
      },
      {
        role: "Offlane",
        heroes: ["Leoric", "Dehaka", "Blaze"],
        why: "Wave clear is not optional. Dehaka when the map is large.",
      },
      {
        role: "Ranged",
        heroes: ["Valla", "Greymane", "Jaina", "Qhira"],
        why: "One main damage hero the tank is drafted to enable.",
      },
      {
        role: "Flex",
        heroes: ["Imperius", "Maiev", "Qhira", "Tychus"],
        why: "The piece that completes the wombo or answers their frontline.",
      },
    ],
  },
};

function tagsOf(hero: string): string[] {
  return [...heroTags(hero), ...(EXTRA_TAGS[hero] ?? [])];
}

function answerFor(archetype: string): { key: string; answer: Answer } {
  if (archetype.includes("dive")) return { key: "dive", answer: ANSWERS.dive };
  if (archetype.includes("double support"))
    return { key: "double support", answer: ANSWERS["double support"] };
  if (archetype.includes("poke") || archetype.includes("siege"))
    return { key: "poke/siege", answer: ANSWERS["poke/siege"] };
  if (archetype.includes("hypercarry"))
    return { key: "hypercarry", answer: ANSWERS.hypercarry };
  return { key: "default", answer: ANSWERS.default };
}

function playerName(tag: string): string {
  return tag.split("#")[0]?.trim() || tag.trim();
}

/** One player identity across battletag / display name / casing. */
function playerId(tagOrName: string): string {
  return playerName(tagOrName).toLowerCase();
}

function setHasPlayer(used: Set<string>, tagOrName: string | null | undefined): boolean {
  if (!tagOrName) return false;
  const id = playerId(tagOrName);
  if (used.has(id)) return true;
  for (const u of used) {
    if (playerId(u) === id) return true;
  }
  return false;
}

function markPlayer(used: Set<string>, tagOrName: string | null | undefined) {
  if (!tagOrName) return;
  used.add(playerId(tagOrName));
}

/** Support fills the healer slot in a five. */
function roleBucket(role: string): string {
  const r = role.toLowerCase();
  if (r === "healer" || r === "support") return "healer";
  if (r === "tank") return "tank";
  if (r === "bruiser") return "bruiser";
  if (r.includes("ranged")) return "ranged";
  if (r.includes("melee")) return "melee";
  return r || "flex";
}

function roleCap(bucket: string, allowDoubleHealer: boolean): number {
  if (bucket === "healer") return allowDoubleHealer ? 2 : 1;
  if (bucket === "tank" || bucket === "bruiser") return 1;
  if (bucket === "ranged" || bucket === "melee") return 2;
  return 2;
}

export function buildDraftPlan(
  players: PlayerScout[],
  draft: DraftInsights,
  home: PlayerScout[] | null = null,
  meta: GlobalHeroStat[] = [],
): DraftPlan {
  const { key, answer } = answerFor(draft.archetype);
  const trustDrafts = draft.dataQuality === "ok";

  const predicted: DraftPlan["predictedPicks"] = [];
  const predictedHeroes = new Set<string>();
  const predictedPlayers = new Set<string>();

  const ownerId = (hero: string): string | null => {
    let best: { id: string; comfort: number } | null = null;
    for (const p of players) {
      for (const h of p.topHeroes) {
        if (heroKey(h.hero) !== heroKey(hero)) continue;
        const id = playerId(p.battletag);
        if (!best || h.comfort > best.comfort) {
          best = { id, comfort: h.comfort };
        }
      }
    }
    return best?.id ?? null;
  };

  const tryPredict = (hero: string, why: string) => {
    if (predictedHeroes.has(hero)) return;
    const oid = ownerId(hero);
    // One player cannot be "expected early" on two heroes.
    if (oid && predictedPlayers.has(oid)) return;
    predicted.push({ hero, why });
    predictedHeroes.add(hero);
    if (oid) predictedPlayers.add(oid);
  };

  const first = draft.firstPickHeroes[0];
  if (trustDrafts && first && first.pct >= 35) {
    tryPredict(first.hero, `First-lean in ${first.pct}% of drafted games.`);
  }

  for (const p of players) {
    const top = p.topHeroes[0];
    const second = p.topHeroes[1];
    if (
      top &&
      top.comfort >= 0.1 &&
      (!second || top.comfort > second.comfort * 2.2)
    ) {
      tryPredict(
        top.hero,
        `${playerName(p.battletag)} plays this far more than anything else.`,
      );
    }
  }

  for (const role of ["Tank", "Healer"] as const) {
    const pool: { hero: string; comfort: number; who: string }[] = [];
    for (const p of players) {
      for (const h of p.topHeroes.slice(0, 4)) {
        if (heroRole(h.hero) !== role) continue;
        pool.push({
          hero: h.hero,
          comfort: h.comfort,
          who: playerName(p.battletag),
        });
      }
    }
    pool.sort((a, b) => b.comfort - a.comfort);
    const best = pool[0];
    const rest = pool.slice(1).reduce((s, h) => s + h.comfort, 0);
    if (best && best.comfort >= 0.08 && best.comfort > rest) {
      tryPredict(
        best.hero,
        `Only real ${role.toLowerCase()} comfort (${best.who}).`,
      );
    }
  }

  const baitBans: DraftPlan["baitBans"] = [];
  if (key !== "default") {
    const outs: { hero: string; comfort: number; who: string }[] = [];
    for (const p of players) {
      for (const h of p.topHeroes.slice(0, 5)) {
        if (predictedHeroes.has(h.hero)) continue;
        if (!tagsOf(h.hero).some((t) => answer.outTags.includes(t))) continue;
        outs.push({
          hero: h.hero,
          comfort: h.comfort,
          who: playerName(p.battletag),
        });
      }
    }
    outs.sort((a, b) => b.comfort - a.comfort);
    const seen = new Set<string>();
    for (const o of outs) {
      if (seen.has(o.hero)) continue;
      seen.add(o.hero);
      baitBans.push({
        hero: o.hero,
        reason: `${o.who}'s way out of the ${key} comp. Ban it and leave the predicted picks up.`,
      });
      if (baitBans.length >= 3) break;
    }
  }

  const certainty: DraftPlan["certainty"] =
    predicted.length >= 2 && (trustDrafts || predicted.length >= 3)
      ? "high"
      : predicted.length >= 1
        ? "medium"
        : "low";

  const largeMaps = draft.mapTendencies
    .filter((m) => LARGE_MAPS.has(m.map) && m.games >= 1)
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((m) => m.map);

  const macro = largeMaps.length
    ? `Large maps in their pool (${largeMaps.join(", ")}): one global or high-mobility hero (Dehaka, Falstad, Brightwing) and a wave-clear offlane. Fight synergy does not matter if you lose two lanes to get there.`
    : "On Warhead, Cursed, Garden, Sky Temple, and Alterac, draft one global or high-mobility hero and a wave-clear offlane. On two-lane maps you can spend that slot on more fight synergy.";

  const canBait = certainty !== "low" && key !== "default" && baitBans.length > 0;
  const runHeavyDive = key === "poke/siege" || key === "hypercarry";

  const antiDiveHeroesSeen = [
    ...predicted.map((p) => p.hero),
    ...players.flatMap((p) => p.topHeroes.slice(0, 3).map((h) => h.hero)),
  ].filter((h, i, arr) =>
    (divePlaybook.antiDiveHeroes as readonly string[]).includes(h) &&
    arr.indexOf(h) === i,
  );
  const antiDiveThreat = antiDiveHeroesSeen.length > 0;
  const chosen = antiDiveThreat ? chooseDivePivot(antiDiveHeroesSeen) : null;
  // When anti-dive is already in their pool, the *plan five* must follow the
  // pivot — not keep drafting Anub/Rehgar dive while the playbook says leave.
  const leaveDive = Boolean(antiDiveThreat && chosen);
  const planSlots = leaveDive && chosen ? pivotPlanSlots(chosen.pivot) : answer.slots;
  const planKey =
    leaveDive && chosen ? (`pivot:${chosen.pivot.id}` as string) : key;
  const toPivot = (p: (typeof divePlaybook.pivots)[number], why: string) => ({
    id: p.id,
    name: p.name,
    objective: p.objective,
    heroes: [...p.heroes],
    maps: [...p.maps],
    why,
  });

  const playbook: DraftPlaybook = {
    title: divePlaybook.title,
    intro: antiDiveThreat
      ? `Their pool already has anti-dive. Leave Genji / Greymane / Kerrigan — keep Qhira if open and rebuild into the pivot below (not a pure dive shell).`
      : `Open flexible tank + enabler. Hold Genji / Greymane / Kerrigan until mid-draft. Take Qhira immediately if open. If they show Tyrael, Brightwing, Falstad Gust, or Johanna — leave dive and take a pivot (still keep Qhira).`,
    antiDiveThreat,
    antiDiveHeroesSeen,
    recommended: chosen
      ? toPivot(chosen.pivot, chosen.why)
      : null,
    alternates: divePlaybook.pivots
      .filter((p) => p.id !== chosen?.pivot.id)
      .map((p) => toPivot(p, p.whyAgainst)),
    tree: divePlaybookTree(),
    pivots: divePlaybook.pivots.map((p) => toPivot(p, p.whyAgainst)),
  };

  const summary = runHeavyDive
    ? antiDiveThreat && chosen
      ? `Primary plan was heavy dive, but their pool shows anti-dive (${antiDiveHeroesSeen.join(", ")}). Pivot to ${chosen.pivot.name}: ${chosen.pivot.heroes.join(" / ")}. Keep Qhira if she is open — change the shell, not the pocket.`
      : `Primary plan is heavy dive: Anub/Tyrael/Diablo/Mei + Rehgar/BW/Hogger/Yrel first. Hold Genji/Greymane/Kerrigan until mid-draft clears anti-dive. Take Qhira immediately if open.`
    : canBait
      ? `Ban ${baitBans.map((b) => b.hero).join(" and ")} so they stay on ${[...predictedHeroes].slice(0, 3).join(", ")}. Then draft the counter as one fight, not five counters.`
      : certainty === "low"
        ? "Not enough of a tell to bait a comp. Default to the heavy dive playbook (tank + enabler first) unless they show anti-dive."
        : `They lean ${draft.archetype}. ${key === "dive" ? "Mirror dive is wrong — peel and punish." : "Use the heavy dive playbook unless their anti-dive forces a pivot."}`;

  const diveSteps = antiDiveThreat && chosen
    ? [
        {
          phase: "Phase 1 — Keep the pocket",
          action: `If Qhira is open, take her. Do not first-pick ${divePlaybook.lateDiveAssassins.slice(0, 3).join(" / ")}.`,
        },
        {
          phase: "Phase 2 — Pivot the shell",
          action: `Leave pure dive. Take ${chosen.pivot.name} because ${chosen.why}`,
        },
        {
          phase: "Phase 3 — Commit the pivot",
          action: `Build ${chosen.pivot.heroes.join(" / ")} around Qhira (or the flex threat). ${chosen.pivot.objective}`,
        },
      ]
    : [
        {
          phase: "Phase 1 — Anchor & enabler",
          action: `Flexible tank: ${divePlaybook.phase1Slots[0].heroes.join(" / ")}. Enabler: ${divePlaybook.phase1Slots[1].heroes.join(" / ")}. Mask dive assassins — except take Qhira immediately if open.`,
        },
        {
          phase: "Phase 2 — Pivot check",
          action:
            "If they take Tyrael, Brightwing, Falstad Gust, or Johanna → leave dive (see pivot section). Keep Qhira; change the tank/heal/range around her.",
        },
        {
          phase: "Phase 3 — Core divers",
          action: `Burst: ${divePlaybook.phase3Slots[0].heroes.join(" / ")}. Clean-up: ${divePlaybook.phase3Slots[1].heroes.join(" / ")}.`,
        },
        {
          phase: "Phase 5 — Flex cap",
          action: divePlaybook.phase5Checks.join(" "),
        },
      ];

  const steps = runHeavyDive
    ? diveSteps
    : canBait
      ? [
          {
            phase: "Bans",
            action: `Bait bans: ${baitBans.map((b) => b.hero).join(", ")}. Do not ban ${[...predictedHeroes].slice(0, 3).join(", ")} — those are the heroes you want them on.`,
          },
          {
            phase: "Their early picks",
            action: `Expect ${predicted.map((p) => p.hero).join(", ")}. If they take that core, commit. If they dodge it, drop the bait and ban the new comfort.`,
          },
          {
            phase: "Our early picks",
            action: `Lock ${answer.slots[0].role.toLowerCase()} (${answer.slots[0].heroes.slice(0, 2).join(" / ")}) and offlane clear before you show the follow-up damage.`,
          },
          {
            phase: "Last picks",
            action: `Finish with the synergy piece (${answer.slots[3].heroes[0]} / ${answer.slots[4].heroes[0]}) once their comp is confirmed. That hero should want the same fight as the tank.`,
          },
        ]
      : key === "dive"
        ? [
            {
              phase: "Bans",
              action: canBait
                ? `Bait bans: ${baitBans.map((b) => b.hero).join(", ")}.`
                : "Ban dive comfort / peel-breakers they need.",
            },
            {
              phase: "Our shape",
              action: answer.fight,
            },
            {
              phase: "Macro check",
              action: macro,
            },
          ]
        : diveSteps;

  const contested = contestedHero(players, predicted.map((p) => p.hero), meta);
  const wePlayContested = home ? whoPlays(home, contested) : null;
  const allowDoubleHealer = draft.archetype.toLowerCase().includes("double support");
  const theirLikely = fillLikelyComp(
    players,
    [...(contested ? [contested] : []), ...predicted.map((p) => p.hero)],
    undefined,
    allowDoubleHealer,
  );
  const base = ourLikelyComp(home, planSlots, planKey, leaveDive);
  const ourVsTheirHeroes = dropClaimedHeroes(
    base.picks,
    claimKeys(theirLikely.map((p) => p.hero)),
    planSlots,
    home,
  );
  const ours = finishOurComp(
    ourVsTheirHeroes,
    planSlots,
    home,
    draft,
    base.note,
  );
  const ourIfWeTakePicks = wePlayContested
    ? forceFirstPick(base.picks, contested, wePlayContested, home, planSlots)
    : base.picks;
  const ourClaim = claimKeys(ourIfWeTakePicks.map((p) => p.hero));
  const ourIfWeTake = finishOurComp(
    ourIfWeTakePicks,
    planSlots,
    home,
    draft,
    base.note,
  );
  // If contested is not in our pool we tell the coach to ban it — their
  // "likely five" should be the post-ban read (full five), not Johanna + 3.
  const banContestedAway = Boolean(contested && !wePlayContested);
  const theirWeFirstGone = new Set(ourClaim);
  if (banContestedAway && contested) {
    theirWeFirstGone.add(heroKey(contested));
  }
  const theirIfWeTake = fillLikelyComp(
    players,
    predicted
      .map((p) => p.hero)
      .filter((h) => !theirWeFirstGone.has(heroKey(h))),
    theirWeFirstGone,
    allowDoubleHealer,
  );

  const theyFirst = makeSide({
    label: "They pick first",
    summary: sideSummary({
      firstPick: "them",
      contested,
      wePlayContested,
      theirLikely,
      ourLikely: ours.picks,
      baitBans,
      predicted: predicted.map((p) => p.hero),
    }),
    counterNote: sideCounterNote({
      theirLikely,
      ourLikely: ours.picks,
      ourBrief: ours.brief,
      answerKey: key,
      answerCounter: answer.counter,
    }),
    theirLikely,
    ourLikely: ours.picks,
    ourCompNote: ours.note,
    ourBrief: ours.brief,
    tree: buildTree({
      firstPick: "them",
      contested,
      wePlayContested: Boolean(wePlayContested),
      players,
      home,
      theirBans: draft.theirBans.map((b) => b.hero),
      predicted: predicted.map((p) => p.hero),
      baitBans: baitBans.map((b) => b.hero),
      ourPlan: ours.picks,
    }),
  });
  const weFirst = makeSide({
    label: "We pick first",
    summary: sideSummary({
      firstPick: "us",
      contested,
      wePlayContested,
      theirLikely: theirIfWeTake,
      ourLikely: ourIfWeTake.picks,
      baitBans,
      predicted: predicted.map((p) => p.hero),
    }),
    counterNote: sideCounterNote({
      theirLikely: theirIfWeTake,
      ourLikely: ourIfWeTake.picks,
      ourBrief: ourIfWeTake.brief,
      answerKey: key,
      answerCounter: answer.counter,
    }),
    theirLikely: theirIfWeTake,
    ourLikely: ourIfWeTake.picks,
    ourCompNote: ourIfWeTake.note,
    ourBrief: ourIfWeTake.brief,
    tree: buildTree({
      firstPick: "us",
      contested,
      wePlayContested: Boolean(wePlayContested),
      players,
      home,
      theirBans: draft.theirBans.map((b) => b.hero),
      predicted: predicted.map((p) => p.hero),
      baitBans: baitBans.map((b) => b.hero),
      ourPlan: ourIfWeTake.picks,
    }),
  });

  return {
    summary,
    certainty,
    predictedPicks: predicted.slice(0, 4),
    baitBans,
    theirComp: answer.theirComp,
    fight: answer.fight,
    counter: answer.counter,
    macro,
    slots: answer.slots,
    steps,
    theirLikely,
    ourLikely: ours.picks,
    ourCompNote: ours.note,
    ourBrief: ours.brief,
    tree: theyFirst.tree,
    sides: { weFirst, theyFirst },
    playbook,
  };
}

function makeSide(side: DraftSide): DraftSide {
  return side;
}

function heroList(picks: DraftCompPick[]): string {
  return picks.map((p) => p.hero).join(", ");
}

function heroListWithPlayers(picks: DraftCompPick[]): string {
  return picks
    .map((p) => (p.player ? `${p.hero} (${p.player})` : p.hero))
    .join(", ");
}

/** Concrete lobby plan — names their five and what we ban/leave up. */
function sideSummary(args: {
  firstPick: "us" | "them";
  contested: string | null;
  wePlayContested: string | null;
  theirLikely: DraftCompPick[];
  ourLikely: DraftCompPick[];
  baitBans: { hero: string; reason: string }[];
  predicted: string[];
}): string {
  // Heroes we remove from the board (ban or take ourselves) are not "expected".
  const goneFromThem = new Set<string>();
  if (args.contested) goneFromThem.add(heroKey(args.contested));
  for (const b of args.baitBans) goneFromThem.add(heroKey(b.hero));

  const theirAfterPlan = args.theirLikely.filter(
    (p) => !goneFromThem.has(heroKey(p.hero)),
  );
  const theirHeroes = heroList(theirAfterPlan);
  const ourHeroes = heroList(args.ourLikely);
  const leaveUp = theirAfterPlan.map((p) => p.hero).filter(Boolean).slice(0, 5);
  const outs = args.baitBans.map((b) => b.hero).slice(0, 3);

  if (args.firstPick === "them") {
    const ban = args.contested
      ? `Ban ${args.contested} before any picks — if it stays up, that is their first pick.`
      : "Ban the hero they would open on immediately.";
    const leave = leaveUp.length
      ? `Leave ${leaveUp.join(", ")} up so they land on that five.`
      : "";
    const deny = outs.length
      ? `Deny their outs (${outs.join(", ")}) so they cannot dodge off that read.`
      : "";
    const answer = ourHeroes
      ? `We answer with ${ourHeroes}.`
      : "";
    return [ban, leave, deny, answer].filter(Boolean).join(" ");
  }

  if (args.contested && args.wePlayContested) {
    return [
      `We pick first — take ${args.contested} (${args.wePlayContested}).`,
      leaveUp.length
        ? `Expect them on ${theirHeroes || leaveUp.join(", ")}.`
        : "",
      outs.length
        ? `Ban ${outs.join(" / ")} if those are still their way out.`
        : "",
      ourHeroes ? `Finish our five as ${ourHeroes}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (args.contested) {
    return [
      `We pick first, but ${args.contested} is not in our pool — ban it or their first pick is ${args.contested}.`,
      leaveUp.length
        ? `If it is banned, expect ${theirHeroes}.`
        : "",
      ourHeroes ? `We answer with ${ourHeroes}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "We pick first — lock the best piece of our five early.",
    leaveUp.length ? `Expect them on ${theirHeroes}.` : "",
    ourHeroes ? `Our five: ${ourHeroes}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** How our five beats *their* five — reference the faces above; no roster rerun. */
function sideCounterNote(args: {
  theirLikely: DraftCompPick[];
  ourLikely: DraftCompPick[];
  ourBrief: OurCompBrief;
  answerKey: string;
  answerCounter: string;
}): string {
  const their = args.theirLikely;
  const our = args.ourLikely;
  if (their.length < 3 || our.length < 3) {
    return args.answerKey === "default"
      ? args.ourBrief.whyItWorks
      : args.answerCounter;
  }

  const parts: string[] = ["Against the likely five above:"];
  const fight = howOurFiveFights(our, their);
  if (fight) parts.push(fight);

  if (args.answerKey !== "default" && args.answerCounter) {
    // One short archetype line, no hero laundry list.
    const short = args.answerCounter.replace(/\s+/g, " ").trim();
    if (short.length < 160) parts.push(short);
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Kit-level how this five starts the fight / plays the map — keyed off the
 * *current* tank/dive/heal, so alts (E.T.C. over Stitches) rewrite the copy.
 * Returns ordered beats (engage, heal, lane, rotate) for callers that want
 * only the lead sentence.
 */
export function howOurFiveFightParts(
  our: DraftCompPick[],
  their: DraftCompPick[] = [],
): string[] {
  if (our.length < 3) return [];

  const theirHeal = their.find(
    (p) => heroRole(p.hero) === "Healer" || heroRole(p.hero) === "Support",
  );
  const theirCarry = their.find((p) => heroRole(p.hero).includes("Assassin"));
  const theirOff = their.find((p) => heroIsOfflaner(p.hero));
  const ourTank = our.find((p) => heroRole(p.hero) === "Tank");
  const ourHeal = our.find(
    (p) => heroRole(p.hero) === "Healer" || heroRole(p.hero) === "Support",
  );
  const ourDive = our.find(
    (p) =>
      tagsOf(p.hero).includes("dive") && heroRole(p.hero).includes("Assassin"),
  );
  const ourOff = our.find((p) => heroIsOfflaner(p.hero));
  const ourGlobal = our.find((p) =>
    tagsOf(p.hero).some((t) => t === "global" || t === "mobile"),
  );

  const parts: string[] = [];
  const tankKey = ourTank ? heroKey(ourTank.hero) : null;

  if (ourTank && tankKey === heroKey("Stitches")) {
    const follow = ourDive?.hero ?? ourHeal?.hero ?? "the follow-up";
    parts.push(
      `Stitches starts it with Hook / Gorge on ${theirCarry?.hero ?? theirOff?.hero ?? "their damage"} — ${follow} is drafted to hit the same target the moment they land, not to take a fair front-to-back.`,
    );
  } else if (ourTank && tankKey === heroKey("Garrosh")) {
    parts.push(
      `Garrosh throws ${theirCarry?.hero ?? "a carry"} into your pack; everyone else is there for the throw, not a long peel fight.`,
    );
  } else if (
    ourTank &&
    ["Anub'arak", "Anubarak", "Diablo", "ETC", "E.T.C."].some(
      (h) => heroKey(h) === tankKey,
    )
  ) {
    const kit =
      tankKey === heroKey("E.T.C.") || tankKey === heroKey("ETC")
        ? "Mosh / Face Melt"
        : tankKey === heroKey("Diablo")
          ? "Charge / Apocalypse"
          : "Cocoon / Impale";
    parts.push(
      `${ourTank.hero} engages first (${kit}) so ${ourDive?.hero ?? "the follow-up"} gets a free window — do not send the assassin in alone.`,
    );
  } else if (ourTank && ourDive) {
    parts.push(
      `${ourTank.hero} creates the engage; ${ourDive.hero} deletes ${theirCarry?.hero ?? "their carry"} before ${theirHeal?.hero ?? "their heal"} stabilizes.`,
    );
  } else if (ourTank) {
    parts.push(
      `${ourTank.hero} decides when the fight starts; the rest of the five follows that engage.`,
    );
  }

  if (ourHeal && heroKey(ourHeal.hero) === heroKey("Rehgar")) {
    parts.push(
      `Rehgar is not "starting" the engage — Wolf / Ancestral keeps the ${ourTank?.hero ?? "frontline"} alive through the commit, and Lightning Bloodlust only if the engage already landed.`,
    );
  }

  if (ourOff && theirOff) {
    parts.push(
      `Lane: ${ourOff.hero} soaks against ${theirOff.hero}; do not leave that matchup empty when the objective spawns or you lose a wave and the rotate.`,
    );
  } else if (ourOff) {
    parts.push(
      `Lane: ${ourOff.hero} clears and soaks so the four-man can move first.`,
    );
  }

  if (ourGlobal) {
    parts.push(
      `Rotate: ${ourGlobal.hero} covers the cross-map path so you do not walk five people mid every time.`,
    );
  }

  return parts;
}

export function howOurFiveFights(
  our: DraftCompPick[],
  their: DraftCompPick[] = [],
): string | null {
  const parts = howOurFiveFightParts(our, their);
  return parts.length ? parts.join(" ") : null;
}

/**
 * Live board copy for the interactive draft — shape + how it fights, built
 * from the *current* five (alts included), not the pre-draft Stitches brief.
 */
export function liveCompMatchupLine(args: {
  picks: DraftCompPick[];
  theirLikely?: DraftCompPick[];
  theirArchetype?: string | null;
  /** Fallback when we cannot name a kit-level fight plan. */
  fallbackCounter?: string | null;
}): string | null {
  if (!args.picks.length) return null;
  const kind = describeCompKind(args.picks);
  const theirRaw = args.theirArchetype?.trim() ?? "";
  const theirOk =
    theirRaw &&
    theirRaw !== "unclear" &&
    theirRaw !== "unknown" &&
    theirRaw !== "flexible / mixed";
  const their = theirOk ? `their ${theirRaw}` : "their likely shape";
  const head = `${kind} into ${their}`;
  const parts = howOurFiveFightParts(args.picks, args.theirLikely ?? []);
  // Lead with the engage beat only — lane/rotate stay in the full counter note.
  if (parts[0]) return `${head} — ${parts[0]}`;
  if (args.fallbackCounter) return `${head} — ${args.fallbackCounter}`;
  return `${head}.`;
}

function contestedHero(
  players: PlayerScout[],
  predicted: string[],
  meta: GlobalHeroStat[],
): string | null {
  let best: { hero: string; pressure: number } | null = null;
  for (const stat of meta) {
    const who = heroComfort(players, stat.hero);
    if (!who) continue;
    const pressure = banPressure(metaStrength(stat), who.comfort);
    if (!best || pressure > best.pressure) best = { hero: stat.hero, pressure };
  }
  if (best && best.pressure >= 0.2) return best.hero;
  return predicted[0] ?? null;
}

function whoPlays(players: PlayerScout[], hero: string | null): string | null {
  return hero ? heroComfort(players, hero)?.name ?? null : null;
}

function claimKeys(heroes: string[]): Set<string> {
  return new Set(heroes.map((hero) => heroKey(hero)));
}

/** Their heroes are off our board. One hero cannot be in both comps. */
function dropClaimedHeroes(
  picks: DraftCompPick[],
  claimed: Set<string>,
  slots: DraftPlanSlot[],
  home: PlayerScout[] | null,
): DraftCompPick[] {
  const next = picks.map((p) => ({ ...p }));
  next.forEach((p, i) => {
    if (!claimed.has(heroKey(p.hero))) return;
    backfillSlot(next, i, slots[i], home, claimed);
  });
  return next;
}

function forceFirstPick(
  picks: DraftCompPick[],
  hero: string | null,
  player: string,
  home: PlayerScout[] | null,
  slots: DraftPlanSlot[],
): DraftCompPick[] {
  if (!hero) return picks;
  const role = heroRole(hero);
  const next = picks.map((p) => ({ ...p }));
  const existing = next.findIndex((p) => heroKey(p.hero) === heroKey(hero));
  if (existing >= 0) {
    const previous = next.findIndex(
      (p, i) => i !== existing && p.player && playerId(p.player) === playerId(player),
    );
    next[existing] = { ...next[existing], player, note: "our first pick" };
    if (previous >= 0) backfillSlot(next, previous, slots[previous], home);
    return next;
  }

  const owned = next.findIndex(
    (p) => p.player && playerId(p.player) === playerId(player),
  );
  let target = -1;
  if (owned >= 0 && slotFits(next[owned].role, role, hero, [])) {
    target = owned;
  } else {
    let bestRank = Infinity;
    next.forEach((p, i) => {
      if (!slotFits(p.role, role, hero, [])) return;
      const rank = replaceRank(p.role, role);
      if (rank < bestRank) {
        bestRank = rank;
        target = i;
      }
    });
    if (target < 0) target = Math.max(next.length - 1, 0);
  }

  const slot = next[target];
  next[target] = {
    role: slot?.role ?? role,
    hero,
    player,
    note: "our first pick",
  };
  if (owned >= 0 && owned !== target) {
    backfillSlot(next, owned, slots[owned], home);
  }
  return next;
}

function backfillSlot(
  picks: DraftCompPick[],
  index: number,
  slot: DraftPlanSlot | undefined,
  home: PlayerScout[] | null,
  blocked?: Set<string>,
) {
  const role = slot?.role ?? picks[index]?.role ?? "Flex";
  const named = slot?.heroes ?? [];
  const usedH = new Set(
    picks.filter((_, i) => i !== index).map((p) => heroKey(p.hero)),
  );
  const usedP = new Set<string>();
  picks.forEach((p, i) => {
    if (i !== index && p.player) markPlayer(usedP, p.player);
  });
  const heroBlocked = (hero: string) =>
    usedH.has(heroKey(hero)) || (blocked?.has(heroKey(hero)) ?? false);
  let best: { hero: string; player: string; score: number } | null = null;
  for (const p of home ?? []) {
    const name = playerName(p.battletag);
    if (setHasPlayer(usedP, p.battletag) || setHasPlayer(usedP, name)) continue;
    for (const h of p.topHeroes) {
      if (heroBlocked(h.hero)) continue;
      if (!slotFits(role, heroRole(h.hero), h.hero, named)) continue;
      const score = comfortSlotScore(
        h.hero,
        h.comfort,
        { role, heroes: named, why: "" },
        [],
      );
      if (!best || score > best.score) {
        best = { hero: h.hero, player: name, score };
      }
    }
  }
  if (best) {
    picks[index] = {
      role,
      hero: best.hero,
      player: best.player,
      note: named.includes(best.hero) ? "matches the plan" : "closest comfort we have",
    };
    return;
  }
  const fallback = named.find((h) => !heroBlocked(h));
  picks[index] = {
    role,
    hero: fallback ?? "Open",
    player: null,
    note: "not in our saved pool",
  };
}

/** Lower rank is the slot a first pick should take. A non-tank never prefers the tank slot. */
function replaceRank(slotRole: string, heroRoleName: string): number {
  const s = slotRole.toLowerCase();
  if (heroRoleName === "Tank") return s.includes("tank") ? 0 : 40;
  if (s.includes("tank")) return 90;
  if (s.includes("heal")) return 70;
  if (s.includes("flex")) return 0;
  if (s.includes("follow")) return 1;
  if (s.includes("range") || s.includes("siege") || s.includes("percent"))
    return 2;
  if (s.includes("off") || s.includes("solo"))
    return heroRoleName === "Bruiser" ? 1 : 30;
  return 20;
}

const FILL_ROLES = [
  "Tank",
  "Bruiser",
  "Healer",
  "Ranged Assassin",
  "Melee Assassin",
] as const;

function fillLikelyComp(
  players: PlayerScout[],
  locks: string[],
  unavailable?: Set<string>,
  allowDoubleHealer = false,
): DraftCompPick[] {
  const pool = players.flatMap((p) =>
    p.topHeroes.map((h) => ({
      hero: h.hero,
      role: heroRole(h.hero),
      player: p.battletag,
      name: playerName(p.battletag),
      comfort: h.comfort,
    })),
  );
  const usedH = new Set<string>();
  const usedP = new Set<string>();
  const picks: DraftCompPick[] = [];
  const heroTaken = (hero: string) =>
    usedH.has(heroKey(hero)) || (unavailable?.has(heroKey(hero)) ?? false);
  const playerTaken = (tagOrName: string) => setHasPlayer(usedP, tagOrName);
  const roleOpen = (role: string) => {
    const bucket = roleBucket(role);
    const n = picks.filter((p) => roleBucket(p.role) === bucket).length;
    return n < roleCap(bucket, allowDoubleHealer);
  };

  const take = (
    hero: string,
    role: string,
    player: string | null,
    name: string | null,
    note: string | null,
  ): boolean => {
    if (picks.length >= 5 || heroTaken(hero)) return false;
    if (player && playerTaken(player)) return false;
    if (name && playerTaken(name)) return false;
    if (!roleOpen(role)) return false;
    picks.push({
      role,
      hero,
      player: name,
      note,
    });
    usedH.add(heroKey(hero));
    markPlayer(usedP, player);
    markPlayer(usedP, name);
    return true;
  };

  for (const hero of locks) {
    if (heroTaken(hero)) continue;
    const hit = pool
      .filter(
        (x) =>
          heroKey(x.hero) === heroKey(hero) &&
          !playerTaken(x.player) &&
          !playerTaken(x.name) &&
          roleOpen(x.role),
      )
      .sort((a, b) => b.comfort - a.comfort)[0];
    // Never pin a hero with no free owner — that is how one player gets two rows.
    if (!hit) continue;
    take(hit.hero, hit.role, hit.player, hit.name, "expected early");
  }

  for (const role of FILL_ROLES) {
    // One pass: fill each missing standard role once. Caps apply in `rest`.
    if (picks.some((p) => roleBucket(p.role) === roleBucket(role))) continue;
    const best = pool
      .filter(
        (x) =>
          roleBucket(x.role) === roleBucket(role) &&
          !heroTaken(x.hero) &&
          !playerTaken(x.player) &&
          !playerTaken(x.name),
      )
      .sort((a, b) => b.comfort - a.comfort)[0];
    if (best) take(best.hero, best.role, best.player, best.name, null);
  }

  const rest = pool
    .filter(
      (x) =>
        !heroTaken(x.hero) &&
        !playerTaken(x.player) &&
        !playerTaken(x.name) &&
        roleOpen(x.role),
    )
    .sort((a, b) => {
      const aNew = picks.some((p) => roleBucket(p.role) === roleBucket(a.role))
        ? 1
        : 0;
      const bNew = picks.some((p) => roleBucket(p.role) === roleBucket(b.role))
        ? 1
        : 0;
      if (aNew !== bNew) return aNew - bNew;
      return b.comfort - a.comfort;
    });
  for (const next of rest) {
    if (picks.length >= 5) break;
    take(next.hero, next.role, next.player, next.name, null);
  }

  // Always prefer a full five: if role caps stranded a free player, flex them in.
  if (picks.length < 5) {
    const leftovers = pool
      .filter(
        (x) =>
          !heroTaken(x.hero) &&
          !playerTaken(x.player) &&
          !playerTaken(x.name),
      )
      .sort((a, b) => b.comfort - a.comfort);
    for (const next of leftovers) {
      if (picks.length >= 5) break;
      // Bypass roleOpen — last seat is flex so we do not publish a 4-hero "five".
      picks.push({
        role: next.role,
        hero: next.hero,
        player: next.name,
        note: "flex seat",
      });
      usedH.add(heroKey(next.hero));
      markPlayer(usedP, next.player);
      markPlayer(usedP, next.name);
    }
  }

  // Still short: free player's top pool was entirely claimed — seat them on a
  // remaining lock / predicted hero so the board always shows five faces.
  if (picks.length < 5) {
    const freePlayers = players.filter(
      (p) =>
        !playerTaken(p.battletag) && !playerTaken(playerName(p.battletag)),
    );
    for (const hero of locks) {
      if (picks.length >= 5) break;
      if (heroTaken(hero)) continue;
      const owner = freePlayers.shift() ?? null;
      picks.push({
        role: heroRole(hero),
        hero,
        player: owner ? playerName(owner.battletag) : null,
        note: owner ? "flex seat" : "likely fifth",
      });
      usedH.add(heroKey(hero));
      if (owner) {
        markPlayer(usedP, owner.battletag);
        markPlayer(usedP, playerName(owner.battletag));
      }
    }
  }
  return picks;
}

function slotFits(slotRole: string, role: string, hero: string, named: string[]): boolean {
  if (named.some((n) => heroKey(n) === heroKey(hero))) return true;
  const s = slotRole.toLowerCase();
  const h = role.toLowerCase();
  if (s.includes("heal")) return h === "healer";
  if (s.includes("tank")) return h === "tank";
  if (s.includes("off") || s.includes("solo") || s.includes("clear"))
    return h === "bruiser" || h === "tank";
  if (s.includes("follow") || s.includes("threat") || s.includes("burst"))
    return h.includes("melee") || h === "bruiser" || h.includes("ranged");
  if (
    s.includes("range") ||
    s.includes("siege") ||
    s.includes("percent") ||
    s.includes("poke") ||
    s.includes("flex") ||
    s.includes("mage") ||
    s.includes("split") ||
    s.includes("global")
  ) {
    return h.includes("ranged") || h.includes("melee") || h === "bruiser";
  }
  return false;
}

/** Comfort is ~0–1; a +1 named bonus always crushed pockets like Qhira. */
const NAMED_PLAN_BONUS = 0.08;

function preferredTagsForAnswer(answerKey: string): string[] {
  if (answerKey === "pivot:poke") return ["poke", "siege", "safe"];
  if (answerKey === "pivot:blowup") return ["engage", "assassin"];
  if (answerKey === "pivot:global") return ["global", "mobile", "waveclear"];
  if (answerKey === "poke/siege" || answerKey === "hypercarry") {
    return ["dive", "engage", "assassin"];
  }
  if (answerKey === "double support") {
    return ["tankbuster", "siege", "percent"];
  }
  if (answerKey === "dive") {
    return ["peel", "frontline"];
  }
  // default / assassin-focused: we often answer with dive follow-up
  return ["dive", "assassin", "engage"];
}

function comfortSlotScore(
  hero: string,
  comfort: number,
  slot: DraftPlanSlot,
  preferredTags: string[],
): number {
  const named = slot.heroes.some((n) => heroKey(n) === heroKey(hero))
    ? NAMED_PLAN_BONUS
    : 0;
  const tags = tagsOf(hero);
  const tagHit = preferredTags.some((t) => tags.includes(t)) ? 0.12 : 0;
  // Priority dive cores (Qhira): always win the damage seat over template fillers.
  const coreHit = divePlaybook.priorityDiveCores.some(
    (h) => heroKey(h) === heroKey(hero),
  )
    ? 0.55
    : 0;
  let roleFit = 0;
  const s = slot.role.toLowerCase();
  const actual = heroRole(hero);
  // Ranged seat must prefer real ranged — bruisers filling it produced all-melee fives.
  if (s.includes("range") || s.includes("siege") || s.includes("percent")) {
    if (actual.includes("Ranged")) roleFit += 0.4;
    if (actual === "Bruiser" || actual.includes("Melee")) roleFit -= 0.35;
  }
  return comfort + named + tagHit + coreHit + roleFit;
}

/**
 * Seat OP / priority pockets first (Qhira), then fill the rest around them.
 * When anti-dive forced a pivot, she stays — the shell changes, not the pocket.
 */
function ourLikelyComp(
  home: PlayerScout[] | null,
  slots: DraftPlanSlot[],
  answerKey = "default",
  leaveDive = false,
): { picks: DraftCompPick[]; note: string | null } {
  const preferredTags = preferredTagsForAnswer(answerKey);
  const coreNote = leaveDive
    ? "priority pocket — keep her, rebuild into the pivot shell"
    : "priority dive — rebuild around this";
  if (!home?.length) {
    const used = new Set<string>();
    return {
      note: "Scout Little Buff Boyz once so this column can use our actual hero pool. Until then these are the recommended heroes, not locks.",
      picks: slots.map((s) => {
        const hero = s.heroes.find((h) => !used.has(heroKey(h)));
        if (hero) used.add(heroKey(hero));
        return {
          role: s.role,
          hero: hero ?? "Open",
          player: null,
          note: "recommended",
        };
      }),
    };
  }

  const usedH = new Set<string>();
  const usedP = new Set<string>();
  const picks: (DraftCompPick | null)[] = slots.map(() => null);

  const tryPlace = (
    slotIndex: number,
    hero: string,
    player: string,
    name: string,
    note: string,
  ): boolean => {
    if (picks[slotIndex]) return false;
    if (usedH.has(heroKey(hero))) return false;
    if (setHasPlayer(usedP, player) || setHasPlayer(usedP, name)) return false;
    usedH.add(heroKey(hero));
    markPlayer(usedP, player);
    markPlayer(usedP, name);
    picks[slotIndex] = {
      role: slots[slotIndex].role,
      hero,
      player: name,
      note,
    };
    return true;
  };

  // 1) Lock priority dive cores (Qhira) onto the best-fitting damage seat.
  type CoreHit = {
    hero: string;
    player: string;
    name: string;
    comfort: number;
    slotIndex: number;
    score: number;
  };
  const cores: CoreHit[] = [];
  for (const p of home) {
    const name = playerName(p.battletag);
    for (const h of p.topHeroes) {
      if (
        !divePlaybook.priorityDiveCores.some(
          (c) => heroKey(c) === heroKey(h.hero),
        )
      ) {
        continue;
      }
      slots.forEach((slot, slotIndex) => {
        if (
          !slotFits(slot.role, heroRole(h.hero), h.hero, slot.heroes)
        ) {
          return;
        }
        // Prefer ranged / flex / follow / burst seats over tank/heal/offlane.
        const r = slot.role.toLowerCase();
        if (r.includes("tank") || r.includes("heal") || r.includes("off")) {
          return;
        }
        cores.push({
          hero: h.hero,
          player: p.battletag,
          name,
          comfort: h.comfort,
          slotIndex,
          score:
            comfortSlotScore(h.hero, h.comfort, slot, preferredTags) +
            (r.includes("flex") ||
            r.includes("follow") ||
            r.includes("threat") ||
            r.includes("burst")
              ? 0.05
              : 0),
        });
      });
    }
  }
  cores.sort((a, b) => b.score - a.score || b.comfort - a.comfort);
  for (const c of cores) {
    if (tryPlace(c.slotIndex, c.hero, c.player, c.name, coreNote)) {
      break;
    }
  }

  // 2) Fill remaining seats by comfort vs the answer shape.
  slots.forEach((slot, slotIndex) => {
    if (picks[slotIndex]) return;
    let best: { hero: string; player: string; name: string; score: number } | null =
      null;
    for (const p of home) {
      const name = playerName(p.battletag);
      if (setHasPlayer(usedP, p.battletag) || setHasPlayer(usedP, name)) continue;
      for (const h of p.topHeroes) {
        if (usedH.has(heroKey(h.hero))) continue;
        if (!slotFits(slot.role, heroRole(h.hero), h.hero, slot.heroes)) continue;
        const score = comfortSlotScore(h.hero, h.comfort, slot, preferredTags);
        if (!best || score > best.score) {
          best = { hero: h.hero, player: p.battletag, name, score };
        }
      }
    }
    if (best) {
      tryPlace(
        slotIndex,
        best.hero,
        best.player,
        best.name,
        slot.heroes.some((n) => heroKey(n) === heroKey(best.hero))
          ? "matches the plan"
          : "closest comfort we have",
      );
    } else {
      const hero = slot.heroes.find((h) => !usedH.has(heroKey(h)));
      if (hero) usedH.add(heroKey(hero));
      picks[slotIndex] = {
        role: slot.role,
        hero: hero ?? "Open",
        player: null,
        note: "not in our saved pool",
      };
    }
  });

  return {
    picks: picks.map(
      (p, i) =>
        p ?? {
          role: slots[i].role,
          hero: "Open",
          player: null,
          note: "not in our saved pool",
        },
    ),
    note: leaveDive
      ? "Anti-dive on their side — shell is the pivot; Qhira stays if she was open."
      : null,
  };
}

/** Bruisers that want the solo lane (clear / sustain / soak). */
const OFFLANE_BRUISERS = new Set(
  [
    "Malthael",
    "Leoric",
    "Sonya",
    "Dehaka",
    "Blaze",
    "Xul",
    "Hogger",
    "Ragnaros",
    "Gazlowe",
    "Rexxar",
  ].map(heroKey),
);

/** Bruisers that want the 4-man (fight follow-up, not the soak seat). */
const FOUR_MAN_BRUISERS = new Set(
  [
    "Thrall",
    "Imperius",
    "Yrel",
    "Artanis",
    "Chen",
    "Dva",
    "D.Va",
    "Varian",
  ].map(heroKey),
);

function offlaneFitness(hero: string): number {
  const key = heroKey(hero);
  let score = 0;
  if (OFFLANE_BRUISERS.has(key)) score += 4;
  if (tagsOf(hero).includes("waveclear")) score += 3;
  if (tagsOf(hero).includes("solo")) score += 1;
  if (FOUR_MAN_BRUISERS.has(key)) score -= 2;
  if (heroRole(hero) !== "Bruiser") score -= 5;
  return score;
}

function fourManBruiserFitness(hero: string): number {
  const key = heroKey(hero);
  let score = 0;
  if (FOUR_MAN_BRUISERS.has(key)) score += 4;
  if (tagsOf(hero).some((t) => t === "dive" || t === "engage")) score += 2;
  if (OFFLANE_BRUISERS.has(key)) score -= 2;
  if (tagsOf(hero).includes("waveclear") && !FOUR_MAN_BRUISERS.has(key)) {
    score -= 1;
  }
  if (heroRole(hero) !== "Bruiser") score -= 5;
  return score;
}

/**
 * Human-readable seat for the plan UI — never call a Bruiser "Ranged"
 * just because they filled a damage template slot.
 * Never call Kael'thas / Valla "Offlane" just because they sat in that seat.
 * Dehaka / Sonya / etc. show as Offlane even when the raw role is Bruiser.
 */
export function planSeatJob(p: DraftCompPick): string {
  const slot = p.role.toLowerCase();
  const actual = heroRole(p.hero);
  if (slot.includes("tank") || actual === "Tank") {
    if (actual === "Tank") return "Tank";
  }
  if (slot.includes("heal") || actual === "Healer" || actual === "Support") {
    return actual === "Support" ? "Support" : "Healer";
  }
  // Real offlaners first — Dehaka is Offlane, not "4-man".
  if (heroIsOfflaner(p.hero)) return "Offlane";
  if (slot.includes("off") || slot.includes("solo") || slot.includes("clear")) {
    if (heroIsOfflaner(p.hero)) return "Offlane";
  }
  if (actual === "Bruiser" || actual.includes("Melee")) return "4-man";
  if (actual.includes("Ranged")) return "Ranged";
  if (slot.includes("flex")) return "Flex";
  if (actual === "Tank") return "Tank";
  return actual;
}

/** True offlane / soak heroes — not mages parked on the offlane seat. */
export function heroIsOfflaner(hero: string): boolean {
  const role = heroRole(hero);
  if (role.includes("Ranged")) return false;
  if (role === "Healer" || role === "Support") return false;
  // Blaze is stored as Tank but is a real offlaner.
  if (role === "Tank" && !OFFLANE_BRUISERS.has(heroKey(hero))) return false;
  return offlaneFitness(hero) >= 2;
}

/** Do we already have a committed offlaner in the five? */
export function planHasOfflane(picks: DraftCompPick[]): boolean {
  return picks.some((p) => heroIsOfflaner(p.hero));
}

/** Any hero in the five carries a waveclear tag (lane / shrine clear). */
export function planHasWaveclear(picks: DraftCompPick[]): boolean {
  return picks.some((p) => tagsOf(p.hero).includes("waveclear"));
}

export function heroHasWaveclear(hero: string): boolean {
  return tagsOf(hero).includes("waveclear");
}

/** Ranged damage (not healers) — at least one belongs in almost every five. */
export function heroIsRangedDamage(hero: string): boolean {
  const r = heroRole(hero);
  if (r === "Healer" || r === "Support" || r === "Tank") return false;
  return r.includes("Ranged");
}

export function planHasRangedDamage(picks: DraftCompPick[]): boolean {
  return picks.some((p) => heroIsRangedDamage(p.hero));
}

function laneSplitNote(offlane: string, fourMan: string): string {
  return (
    `${offlane} offlanes (waveclear / soak — offlane is ~half the game); ` +
    `${fourMan} plays the 4-man (teamfight follow-up, not the lane).`
  );
}

/** Drop prior lane-split annotations so re-runs do not stack the same sentence. */
function stripLaneSplitNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const cleaned = note
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p.length > 0 &&
        !/offlanes\s*\(waveclear/i.test(p) &&
        !/plays the 4-man/i.test(p),
    )
    .join("; ");
  return cleaned || null;
}

function withLaneSplitNote(
  note: string | null | undefined,
  why: string,
): string {
  const base = stripLaneSplitNote(note);
  return base ? `${base}; ${why}` : why;
}

/**
 * When we have two bruisers, put the clear specialist offlane and the fight
 * bruiser in the 4-man. Fixes Thrall-offlane / Malthael-"Ranged" mistakes.
 */
export function normalizeBruiserLanes(picks: DraftCompPick[]): DraftCompPick[] {
  const next = picks.map((p) => ({ ...p }));
  const offIdx = next.findIndex((p) => {
    const r = p.role.toLowerCase();
    return r.includes("off") || r.includes("solo") || r.includes("clear");
  });
  if (offIdx < 0) return next;

  const bruiserIdxs = next
    .map((p, i) => (heroRole(p.hero) === "Bruiser" ? i : -1))
    .filter((i) => i >= 0);
  if (bruiserIdxs.length < 2) {
    // Single bruiser in a non-offlane slot → move label to offlane job if empty slot nonsense
    const only = bruiserIdxs[0];
    if (
      only != null &&
      only !== offIdx &&
      offlaneFitness(next[only].hero) >= 3 &&
      heroRole(next[offIdx].hero) !== "Bruiser" &&
      heroRole(next[offIdx].hero) !== "Tank"
    ) {
      // Don't steal tank/heal — only swap if offlane seat is a misplaced damage hero
      const offHero = next[offIdx].hero;
      if (
        heroRole(offHero).includes("Assassin") ||
        next[offIdx].role.toLowerCase().includes("range") ||
        next[offIdx].role.toLowerCase().includes("flex")
      ) {
        // leave alone — single bruiser already elsewhere is a different problem
      }
    }
    return next;
  }

  // Best offlaner among bruisers vs whoever currently holds offlane if bruiser.
  let bestOff = bruiserIdxs[0];
  for (const i of bruiserIdxs) {
    if (offlaneFitness(next[i].hero) > offlaneFitness(next[bestOff].hero)) {
      bestOff = i;
    }
  }

  const currentOffIsBruiser = heroRole(next[offIdx].hero) === "Bruiser";
  if (bestOff === offIdx) {
    // Already correct seat — still annotate if another bruiser is in 4-man.
    const other = bruiserIdxs.find((i) => i !== offIdx);
    if (other != null) {
      const why = laneSplitNote(next[offIdx].hero, next[other].hero);
      next[offIdx] = {
        ...next[offIdx],
        role: "Offlane",
        note: withLaneSplitNote(next[offIdx].note, why),
      };
      next[other] = {
        ...next[other],
        role: "4-man",
        note: withLaneSplitNote(next[other].note, why),
      };
    }
    return next;
  }

  // Swap best offlane bruiser into offlane seat.
  if (currentOffIsBruiser || fourManBruiserFitness(next[offIdx].hero) >= 0) {
    const a = next[offIdx];
    const b = next[bestOff];
    const why = laneSplitNote(b.hero, a.hero);
    next[offIdx] = {
      ...b,
      role: "Offlane",
      note: withLaneSplitNote(b.note, why),
    };
    next[bestOff] = {
      ...a,
      role: "4-man",
      note: withLaneSplitNote(a.note, why),
    };
  }

  return next;
}

/** Export for UI — one clean lane-split sentence from plan notes. */
export function extractLaneSplitNote(
  picks: { note?: string | null }[],
): string | null {
  for (const p of picks) {
    if (!p.note) continue;
    const parts = p.note.split(/;\s*/).map((s) => s.trim());
    const off = parts.find((s) => /offlanes\s*\(waveclear/i.test(s));
    const four = parts.find((s) => /plays the 4-man/i.test(s));
    if (off && four) return `${off}; ${four}`;
    if (off) return off;
  }
  return null;
}

function finishOurComp(
  picks: DraftCompPick[],
  slots: DraftPlanSlot[],
  home: PlayerScout[] | null,
  draft: DraftInsights,
  note: string | null,
): { picks: DraftCompPick[]; note: string | null; brief: OurCompBrief } {
  const laneds = fillPlanHoles(
    normalizeBruiserLanes(picks),
    home ?? [],
    new Set(),
  );
  const withAlts = laneds.map((p, i) => ({
    ...p,
    alternatives: alternativesFor(
      home,
      slots[i] ?? { role: p.role, heroes: [], why: "" },
      laneds,
      i,
    ),
  }));
  const plan = mapPlanForComp(withAlts, draft);
  return {
    picks: withAlts,
    note,
    brief: {
      kind: describeCompKind(withAlts),
      noTankReason: explainNoTank(withAlts, slots),
      mapStrategy: plan.strategy,
      whyItWorks: plan.why,
      holes: explainCompHoles(withAlts),
    },
  };
}

export function explainCompHoles(picks: DraftCompPick[]): string | null {
  const counted = picks.some((p) => p.player)
    ? picks.filter((p) => p.player)
    : picks;
  if (counted.length < 3) return null;

  const heroes = counted.map((p) => p.hero);
  const roles = heroes.map((h) => heroRole(h));
  const ranged = heroes.filter((h) => heroRole(h).includes("Ranged"));
  const clear = heroes.filter((h) => tagsOf(h).includes("waveclear"));
  const parts: string[] = [];

  if (ranged.length === 0) {
    const clearNote =
      clear.length > 0
        ? `${clear.join(" / ")} can clear shrine waves up close`
        : "nobody has real waveclear";
    parts.push(
      `No ranged damage — all melee. On Infernal Shrines that means ${clearNote}, but Punisher DPS is a melee stack (easy to wombo, slow chip). ` +
        `Take a ranged seat (Valla / Greymane / Jaina / Kael'thas / Tychus) before stacking another bruiser.`,
    );
  }
  if (clear.length === 0) {
    parts.push(
      ranged.length === 0
        ? `Also no waveclear — a ranged mage/AA with clear (Jaina / Kael'thas / Greymane) patches both holes at once.`
        : `No waveclear tag in the five — shrine waves and Punisher races get ugly. Keep an offlane clear (Malthael / Leoric / Sonya) or a mage with wave clear.`,
    );
  }

  const tanks = roles.filter((r) => r === "Tank").length;
  const healers = roles.filter((r) => r === "Healer" || r === "Support").length;
  if (tanks === 0) {
    parts.push("No main tank — engages and Punisher bodyblocks fall apart.");
  }
  if (healers === 0) {
    parts.push("No healer — you cannot contest a Punisher fight.");
  }

  return parts.length ? parts.join(" ") : null;
}

const DEFAULT_RANGED_FILLS = [
  "Valla",
  "Greymane",
  "Falstad",
  "Raynor",
  "Jaina",
  "Kael'thas",
  "Hanzo",
  "Sylvanas",
];

function isLockedSeatNote(note: string | null | undefined): boolean {
  return Boolean(note && /\blocked\b/i.test(note));
}

function comfortOn(
  home: PlayerScout[],
  player: string | null,
  hero: string,
): number {
  if (!player || !home.length) return 0;
  const id = player.split("#")[0]?.trim().toLowerCase() ?? "";
  const row = home.find(
    (p) =>
      p.battletag.split("#")[0]?.trim().toLowerCase() === id ||
      p.battletag.toLowerCase() === player.toLowerCase(),
  );
  if (!row) return 0;
  return (
    row.topHeroes.find((h) => heroKey(h.hero) === heroKey(hero))?.comfort ?? 0
  );
}

/**
 * After locks / lane splits, rewrite open seats so the planned five does not
 * carry a known hole (no ranged with Qhira+Thrall, no clear, etc.).
 * Also: if someone locked a mage onto the offlane seat, relabel them and
 * open a real offlane NEED seat.
 */
export function fillPlanHoles(
  picks: DraftCompPick[],
  home: PlayerScout[],
  gone: Set<string>,
): DraftCompPick[] {
  if (picks.length < 3) return picks;
  let next = picks.map((p) => ({ ...p }));
  const heroesOf = () => next.map((p) => p.hero);
  const free = (h: string) =>
    !gone.has(heroKey(h)) &&
    !heroesOf().some((x) => heroKey(x) === heroKey(h));

  // Mage/assassin locked on "Offlane" → that is not offlane. Relabel + reopen lane.
  for (let i = 0; i < next.length; i++) {
    const p = next[i];
    const slot = p.role.toLowerCase();
    const looksOff =
      slot.includes("off") || slot.includes("solo") || slot.includes("clear");
    if (!looksOff || heroIsOfflaner(p.hero)) continue;
    const actual = heroRole(p.hero);
    next[i] = {
      ...p,
      role: actual.includes("Ranged")
        ? "Ranged"
        : actual === "Bruiser" || actual.includes("Melee")
          ? "4-man"
          : actual,
      note: isLockedSeatNote(p.note)
        ? "locked — not offlane"
        : p.note?.includes("not offlane")
          ? p.note
          : "not an offlaner",
    };
  }

  // No real offlaner in the five → put one on an open seat (prefer empty offlane label).
  if (!planHasOfflane(next)) {
    let offIdx = next.findIndex((p) => {
      if (isLockedSeatNote(p.note)) return false;
      const r = p.role.toLowerCase();
      return r.includes("off") || r.includes("solo") || r.includes("clear");
    });
    if (offIdx < 0) {
      // Steal an unlocked non-tank/heal seat that isn't our only ranged if we have two damage.
      offIdx = next.findIndex((p) => {
        if (isLockedSeatNote(p.note)) return false;
        const r = p.role.toLowerCase();
        if (r.includes("tank") || r.includes("heal")) return false;
        // Prefer 4-man / flex over our only ranged.
        if (r.includes("4-man") || r.includes("flex")) return true;
        return r.includes("range");
      });
    }
    if (offIdx >= 0) {
      const seat = next[offIdx];
      const options = [
        ...(seat.alternatives?.map((a) => a.hero) ?? []),
        "Malthael",
        "Leoric",
        "Sonya",
        "Blaze",
        "Xul",
        "Dehaka",
        "Hogger",
      ].filter((h) => free(h) && heroIsOfflaner(h));
      let best: string | null = null;
      let bestScore = -1;
      for (const h of options) {
        const score =
          offlaneFitness(h) + comfortOn(home, seat.player, h) * 20;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      if (best) {
        next[offIdx] = {
          ...seat,
          hero: best,
          role: "Offlane",
          note: "need real offlane",
        };
      }
    }
  }

  // Prefer a waveclear offlaner when the five has none.
  if (!heroesOf().some((h) => tagsOf(h).includes("waveclear"))) {
    const offIdx = next.findIndex((p) => {
      const r = p.role.toLowerCase();
      return r.includes("off") || r.includes("solo") || r.includes("clear");
    });
    if (offIdx >= 0 && !isLockedSeatNote(next[offIdx].note)) {
      const seat = next[offIdx];
      const options = [
        ...(seat.alternatives?.map((a) => a.hero) ?? []),
        "Malthael",
        "Leoric",
        "Sonya",
        "Blaze",
        "Xul",
      ].filter(free);
      let best: string | null = null;
      let bestScore = -1;
      for (const h of options) {
        if (!tagsOf(h).includes("waveclear")) continue;
        const score =
          offlaneFitness(h) + comfortOn(home, seat.player, h) * 20;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      if (best) {
        next[offIdx] = {
          ...seat,
          hero: best,
          role: "Offlane",
          note: seat.note?.includes("fills clear")
            ? seat.note
            : "fills waveclear hole",
        };
      }
    }
  }

  // Prefer a real ranged seat when the five is all melee (Qhira + Thrall case).
  if (!heroesOf().some((h) => heroRole(h).includes("Ranged"))) {
    const seatIdx = next.findIndex((p) => {
      if (isLockedSeatNote(p.note)) return false;
      const r = p.role.toLowerCase();
      if (r.includes("off") || r.includes("tank") || r.includes("heal")) {
        return false;
      }
      const role = heroRole(p.hero);
      return (
        role === "Bruiser" ||
        role.includes("Melee") ||
        r.includes("4-man") ||
        r.includes("flex")
      );
    });
    if (seatIdx >= 0) {
      const seat = next[seatIdx];
      const takenPlayers = new Set(
        next
          .map((x) => x.player?.split("#")[0]?.trim().toLowerCase())
          .filter((x): x is string => Boolean(x)),
      );
      type Opt = { hero: string; player: string | null; score: number };
      const best: { current: Opt | null } = { current: null };
      const consider = (hero: string, player: string | null, base: number) => {
        if (!free(hero) || !heroRole(hero).includes("Ranged")) return;
        const score = base + comfortOn(home, player, hero) * 30;
        if (!best.current || score > best.current.score) {
          best.current = { hero, player, score };
        }
      };
      for (const a of seat.alternatives ?? []) {
        consider(a.hero, a.player ?? seat.player, 2);
      }
      for (const h of DEFAULT_RANGED_FILLS) {
        consider(h, seat.player, 1);
        for (const p of home) {
          const name = p.battletag.split("#")[0]?.trim() ?? p.battletag;
          if (takenPlayers.has(name.toLowerCase())) continue;
          // Don't steal the seat's current player assignment unless comfort is real.
          consider(h, p.battletag, comfortOn(home, name, h) > 0.03 ? 3 : 0);
        }
      }
      if (best.current && best.current.score > 0) {
        next[seatIdx] = {
          ...seat,
          hero: best.current.hero,
          player: best.current.player ?? seat.player,
          role: "Ranged",
          note: "fills ranged hole — not a second melee with dive",
        };
      }
    }
  }

  return next;
}

function describeCompKind(picks: DraftCompPick[]): string {
  const counted = picks.some((p) => p.player)
    ? picks.filter((p) => p.player)
    : picks;
  const heroes = counted.map((p) => p.hero);
  const roles = heroes.map((h) => heroRole(h));
  const tanks = roles.filter((r) => r === "Tank").length;
  const healers = roles.filter((r) => r === "Healer" || r === "Support").length;
  const bruisers = roles.filter((r) => r === "Bruiser").length;
  const tankHero = heroes.find((h) => heroRole(h) === "Tank");
  const diveAssassin = heroes.find(
    (h) =>
      tagsOf(h).includes("dive") &&
      (heroRole(h).includes("Assassin") || heroRole(h) === "Bruiser"),
  );
  const poke = heroes.filter((h) =>
    tagsOf(h).some((t) => t === "poke" || t === "siege"),
  ).length;
  const hyper = heroes.filter((h) => tagsOf(h).includes("hypercarry")).length;
  const hookTank =
    tankHero &&
    ["Stitches", "Garrosh"].some((h) => heroKey(h) === heroKey(tankHero));
  const hardDiveTank =
    tankHero &&
    ["Anub'arak", "Anubarak", "Diablo", "ETC", "E.T.C.", "Tyrael", "Mei"].some(
      (h) => heroKey(h) === heroKey(tankHero!),
    );

  if (healers >= 2) return "Double support";
  if (tanks === 0 && diveAssassin)
    return `Dive without a main tank (${diveAssassin} looks for picks)`;
  if (tanks === 0 && bruisers >= 2) return "Double bruiser, no main tank";
  if (tanks === 0) return "Skirmish comp, no main tank";

  // Stitches / Garrosh + follow-up is hook/pick, not "dive".
  if (hookTank && diveAssassin) {
    return `${tankHero} hook/pick into ${diveAssassin}`;
  }
  if (hookTank) {
    return `${tankHero} pick/engage — not a classic dive shell`;
  }
  if (hardDiveTank && diveAssassin) {
    return `Dive — ${tankHero} + ${diveAssassin}`;
  }
  if (diveAssassin && tankHero) {
    return `${tankHero} frontline with ${diveAssassin} follow-up`;
  }
  if (poke >= 2) return "Poke / siege";
  if (hyper >= 1) return "Hypercarry protect";
  if (tanks >= 1 && healers >= 1) return "Standard five";
  return "Mixed comp";
}

function explainNoTank(
  picks: DraftCompPick[],
  slots: DraftPlanSlot[],
): string | null {
  const tankHeroes = picks.filter((p) => heroRole(p.hero) === "Tank");
  if (tankHeroes.some((p) => p.player)) return null;
  if (!picks.some((p) => p.player)) return null;

  const tankSlot = slots.find((s) => s.role.toLowerCase().includes("tank"));
  const altNames = (tankSlot?.heroes ?? [])
    .filter((h) => !picks.some((p) => p.hero === h))
    .slice(0, 3)
    .join(", ");
  const altLine = altNames ? ` Tank alternatives: ${altNames}.` : "";

  if (tankHeroes.length === 1 && !tankHeroes[0].player) {
    return `No tank selected. ${tankHeroes[0].hero} is the tank this shape wants, but nobody in the saved roster plays a main tank.`;
  }

  const sittingInTankSlot = picks.find(
    (p) => p.role.toLowerCase().includes("tank") && heroRole(p.hero) !== "Tank",
  );
  if (sittingInTankSlot) {
    const why =
      sittingInTankSlot.note === "our first pick"
        ? `${sittingInTankSlot.hero} took the tank slot as our first pick`
        : `${sittingInTankSlot.hero} is sitting in the tank slot`;
    return `No tank selected. ${why}, and ${sittingInTankSlot.hero} is a ${heroRole(sittingInTankSlot.hero).toLowerCase()}, not a main tank.`;
  }

  return `No tank selected. Nobody in this five is a main tank.${altLine}`;
}

function alternativesFor(
  home: PlayerScout[] | null,
  slot: DraftPlanSlot,
  picks: DraftCompPick[],
  index: number,
): CompAlternative[] {
  const chosen = picks[index];
  if (!chosen) return [];
  const usedElsewhere = new Set(
    picks.filter((_, i) => i !== index).map((p) => heroKey(p.hero)),
  );
  const usedPlayers = new Set<string>();
  picks.forEach((p, i) => {
    if (i !== index && p.player) markPlayer(usedPlayers, p.player);
  });
  const alts: CompAlternative[] = [];
  const seen = new Set<string>([heroKey(chosen.hero)]);

  // Same player's other comforts for this seat first (MrHustler → Qhira under Valla).
  if (home?.length && chosen.player) {
    const owner = home.find(
      (p) =>
        playerId(p.battletag) === playerId(chosen.player!) ||
        playerId(playerName(p.battletag)) === playerId(chosen.player!),
    );
    if (owner) {
      const owned = [...owner.topHeroes]
        .filter(
          (h) =>
            !seen.has(heroKey(h.hero)) &&
            !usedElsewhere.has(heroKey(h.hero)) &&
            slotFits(slot.role, heroRole(h.hero), h.hero, slot.heroes),
        )
        .sort((a, b) => b.comfort - a.comfort);
      for (const h of owned) {
        seen.add(heroKey(h.hero));
        alts.push({ hero: h.hero, player: playerName(owner.battletag) });
        if (alts.length >= 2) return alts;
      }
    }
  }

  if (home?.length) {
    const cands: { hero: string; player: string; score: number }[] = [];
    for (const p of home) {
      const name = playerName(p.battletag);
      if (setHasPlayer(usedPlayers, name) || setHasPlayer(usedPlayers, p.battletag)) {
        continue;
      }
      for (const h of p.topHeroes) {
        if (seen.has(heroKey(h.hero)) || usedElsewhere.has(heroKey(h.hero))) continue;
        if (!slotFits(slot.role, heroRole(h.hero), h.hero, slot.heroes)) continue;
        cands.push({
          hero: h.hero,
          player: name,
          score: comfortSlotScore(h.hero, h.comfort, slot, []),
        });
      }
    }
    cands.sort((a, b) => b.score - a.score || a.hero.localeCompare(b.hero));
    for (const c of cands) {
      if (seen.has(heroKey(c.hero))) continue;
      seen.add(heroKey(c.hero));
      alts.push({ hero: c.hero, player: c.player });
      if (alts.length >= 2) return alts;
    }
  }

  for (const hero of slot.heroes) {
    if (seen.has(heroKey(hero)) || usedElsewhere.has(heroKey(hero))) continue;
    seen.add(heroKey(hero));
    alts.push({ hero, player: null });
    if (alts.length >= 2) break;
  }
  return alts;
}

function mapPlanForComp(
  picks: DraftCompPick[],
  draft: DraftInsights,
  mapOverride?: string | null,
): { strategy: string; why: string } {
  const top = mapOverride
    ? { map: mapOverride }
    : draft.mapTendencies[0];
  const heroes = picks.filter((p) => p.player).map((p) => p.hero);
  const globalHero = heroes.find((h) =>
    tagsOf(h).some((t) => t === "global" || t === "mobile"),
  );
  const clearHero = heroes.find((h) => heroIsOfflaner(h));
  const tankHero = heroes.find((h) => heroRole(h) === "Tank");
  const healHero = heroes.find(
    (h) => heroRole(h) === "Healer" || heroRole(h) === "Support",
  );
  const diveHero = heroes.find(
    (h) =>
      tagsOf(h).includes("dive") && heroRole(h).includes("Assassin"),
  );
  const rangedHero = heroes.find((h) => heroRole(h).includes("Ranged"));
  const info = top ? MAP_MACRO[top.map] : undefined;
  const size =
    info?.size ?? (top && LARGE_MAPS.has(top.map) ? "large" : "point");
  const where = top
    ? `On ${top.map}`
    : size === "large"
      ? "On a large map"
      : "On a point-control map";

  const lanes: string[] = [];
  if (clearHero && tankHero) {
    lanes.push(
      `Lanes: ${clearHero} offlanes; ${tankHero}${healHero ? ` + ${healHero}` : ""}${rangedHero ? ` + ${rangedHero}` : ""} hold the 4-man / soak the short lane`,
    );
  } else if (clearHero) {
    lanes.push(`Lanes: ${clearHero} offlanes and clears before the rotate`);
  }
  if (globalHero) {
    lanes.push(
      `Rotate: ${globalHero} covers the long path so the offlaner can stay in lane until the last second`,
    );
  } else if (size === "large") {
    lanes.push(
      `Rotate: no global — leave the offlane earlier and accept a weaker wave to make the objective`,
    );
  }
  if (tankHero && heroKey(tankHero) === heroKey("Stitches") && diveHero) {
    lanes.push(
      `Fight: set up Hook sight on ${diveHero}'s target before the camp/punisher starts — do not walk in as five and hope`,
    );
  } else if (tankHero && diveHero) {
    lanes.push(
      `Fight: ${tankHero} engages first; ${diveHero} only follows the engage`,
    );
  } else if (info?.line) {
    lanes.push(`Objective: ${info.line}`);
  }

  const strategy =
    lanes.length > 0
      ? `${where}. ${lanes.join(". ")}.`
      : `${where}. ${info?.line ?? "Play the objective timing."}`;

  let why: string;
  if (tankHero && heroKey(tankHero) === heroKey("Stitches") && diveHero) {
    why = `${tankHero} is the pick tool, ${diveHero} is the punish — this is not a classic Anub/Diablo dive shell.`;
  } else if (!tankHero && diveHero && globalHero) {
    why = `${globalHero} gets you to the objective without five people soaking, and ${diveHero} wins a short fight. A long front-to-back against a real tank gives it back.`;
  } else if (!tankHero && diveHero) {
    why = `${diveHero} has to find a pick before their frontline locks the fight. Without a main tank this comp loses the longer the fight goes.`;
  } else if (size === "large" && globalHero && clearHero) {
    why = `${clearHero} keeps a lane from falling over and ${globalHero} still makes the objective, so ${tankHero ?? "the frontline"} fights on your timing.`;
  } else if (tankHero && diveHero) {
    why = `${tankHero} and ${diveHero} want the same short fight this objective forces.`;
  } else if (tankHero) {
    why = `${tankHero} decides when the objective fight starts; the rest of the five is there to follow that engage.`;
  } else {
    why = `Play the objective timing and do not take a fair 5v5 on their terms.`;
  }

  return { strategy, why };
}

/** Rebuild lane/rotate copy when the coach locks an NGS map. */
export function mapBriefForSelectedMap(
  picks: DraftCompPick[],
  mapName: string,
  draft: DraftInsights,
): { mapStrategy: string; whyItWorks: string; kind: string } {
  const plan = mapPlanForComp(picks, draft, mapName);
  return {
    mapStrategy: plan.strategy,
    whyItWorks: plan.why,
    kind: describeCompKind(picks),
  };
}

/**
 * Storm League / NGS "Mid Ban" draft (snake picks).
 *
 * Pre-bans: FP, SP, FP, SP
 * Picks: FP 1 → SP 2+3 → FP 4+5
 * Mid-bans: SP, FP
 * Picks: SP 6+7 (their 3rd+4th heroes) → FP 8+9 → SP 10 (last)
 */
export const DRAFT_ORDER: { side: "fp" | "sp"; kind: "ban" | "pick" }[] = [
  { side: "fp", kind: "ban" },
  { side: "sp", kind: "ban" },
  { side: "fp", kind: "ban" },
  { side: "sp", kind: "ban" },
  { side: "fp", kind: "pick" },
  { side: "sp", kind: "pick" },
  { side: "sp", kind: "pick" },
  { side: "fp", kind: "pick" },
  { side: "fp", kind: "pick" },
  { side: "sp", kind: "ban" },
  { side: "fp", kind: "ban" },
  { side: "sp", kind: "pick" },
  { side: "sp", kind: "pick" },
  { side: "fp", kind: "pick" },
  { side: "fp", kind: "pick" },
  { side: "sp", kind: "pick" },
];

type HeroOpt = {
  hero: string;
  player: string | null;
  comfort: number;
  role: string;
};

function buildTree(args: {
  firstPick: "us" | "them";
  contested: string | null;
  wePlayContested: boolean;
  players: PlayerScout[];
  home: PlayerScout[] | null;
  theirBans: string[];
  predicted: string[];
  baitBans: string[];
  ourPlan: DraftCompPick[];
}): DraftTreeNode {
  const theirPool = poolFrom(args.players);
  const ourPool = args.home?.length
    ? poolFrom(args.home)
    : args.ourPlan.map((p) => ({
        hero: p.hero,
        player: p.player,
        comfort: 1,
        role: p.role,
      }));
  const weAreFp = args.firstPick === "us";

  const fork: "our-first-ban" | "our-first-pick" | null = !args.contested
    ? null
    : weAreFp && args.wePlayContested
      ? "our-first-pick"
      : "our-first-ban";

  return (
    walkDraft({
    order: DRAFT_ORDER,
    index: 0,
    weAreFp,
    gone: new Set(),
    ourPlayers: new Set(),
    theirPlayers: new Set(),
    ourHeroes: new Set(),
    passed: new Set(),
    ourBans: 0,
    theirBansUsed: 0,
    ourPicks: 0,
    theirPicks: 0,
    theirPool,
    ourPool,
    theirBanList: args.theirBans,
    predicted: args.predicted,
    baitBans: args.baitBans,
    ourPlan: args.ourPlan,
    contested: args.contested,
    fork,
    forked: false,
    deviations: 0,
    id: weAreFp ? "we" : "they",
  }) ?? {
    id: "empty",
    title: "No draft read",
    detail: "Not enough hero data to walk a draft.",
  }
  );
}

function walkDraft(s: Walk): DraftTreeNode | null {
  if (s.index >= s.order.length) return null;
  const step = s.order[s.index];
  const ours = (step.side === "fp") === s.weAreFp;
  const choice = ours
    ? step.kind === "ban"
      ? nextOurBan(s)
      : nextOurPick(s)
    : step.kind === "ban"
      ? nextTheirBan(s)
      : nextTheirPick(s);

  const n =
    step.kind === "ban"
      ? (ours ? s.ourBans : s.theirBansUsed) + 1
      : (ours ? s.ourPicks : s.theirPicks) + 1;
  const who = ours ? "Our" : "Their";
  const title = `${who} ${ordinal(n)} ${step.kind}: ${choice.hero}`;
  const side = ours ? "our" : "their";
  const baseAction = {
    side: side as "our" | "their",
    kind: step.kind,
    ordinal: n,
    hero: choice.hero,
    player: choice.player,
  };

  const pivot =
    s.deviations === 0 && !ours ? theirPivot(s, step.kind, choice) : null;
  if (pivot) {
    const planned = applyChoice(s, false, step.kind, choice);
    const plannedRest = walkDraft(planned);
    const swung = applyChoice(s, false, step.kind, pivot.choice);
    const passed = new Set(s.passed);
    if (pivot.denyNext) passed.add(pivot.denyNext);
    const swungRest = walkDraft({
      ...swung,
      deviations: 1,
      denyNext: pivot.denyNext ?? swung.denyNext,
      passed,
      id: `${s.id}-pivot${s.index}`,
    });
    return {
      id: `${s.id}-${s.index}`,
      title: `${who} ${ordinal(n)} ${step.kind}`,
      detail:
        "Follow Expected unless they take a different hero — then use the Adjust path.",
      children: [
        {
          id: `${s.id}-${s.index}-plan`,
          title: `Expected: ${choice.hero}`,
          detail: choice.why,
          branch: "expected",
          action: baseAction,
          children: plannedRest ? [plannedRest] : undefined,
        },
        {
          id: `${s.id}-${s.index}-alt`,
          title: pivot.title,
          detail: pivot.why,
          branch: "adjust",
          action: {
            side: "their",
            kind: step.kind,
            ordinal: n,
            hero: pivot.choice.hero,
            player: pivot.choice.player,
          },
          children: swungRest ? [swungRest] : undefined,
        },
      ],
    };
  }

  const shouldFork =
    !s.forked &&
    s.contested &&
    ((s.fork === "our-first-ban" && ours && step.kind === "ban" && s.ourBans === 0) ||
      (s.fork === "our-first-pick" &&
        ours &&
        step.kind === "pick" &&
        s.ourPicks === 0));

  if (shouldFork && choice.hero === s.contested) {
    const taken = applyChoice(s, ours, step.kind, choice);
    const left = walkDraft({ ...taken, forked: true, id: `${s.id}-ban` });
    const alt = alternateIfLeftUp(s);
    return {
      id: `${s.id}-${s.index}`,
      title: `${who} ${ordinal(n)} ${step.kind}`,
      detail: choice.why,
      children: [
        {
          id: `${s.id}-${s.index}-take`,
          title: `Expected: ${choice.hero}`,
          detail: choice.why,
          branch: "expected" as const,
          action: baseAction,
          children: left ? [left] : undefined,
        },
        alt,
      ].filter((n): n is DraftTreeNode => n !== null),
    };
  }

  const taken = applyChoice(s, ours, step.kind, choice);
  const next = walkDraft(taken);
  return {
    id: `${s.id}-${s.index}`,
    title,
    detail: choice.why,
    action: baseAction,
    children: next ? [next] : undefined,
  };
}

/** Same step, but we spend it on the next hero and leave the contested one up. */
function alternateIfLeftUp(s: Walk): DraftTreeNode | null {
  const hero = s.contested!;
  const step = s.order[s.index];
  const blocked = new Set(s.gone);
  blocked.add(hero);
  const altState: Walk = { ...s, gone: blocked, forked: true };
  const ours = (step.side === "fp") === s.weAreFp;
  const alt =
    step.kind === "ban" ? nextOurBan(altState) : nextOurPick(altState);
  if (!alt.hero || alt.hero === hero) return null;
  const hit = s.theirPool.find((h) => h.hero === hero);
  const taken = applyChoice(s, ours, step.kind, alt);
  const rest = walkDraft({
    ...taken,
    forked: true,
    id: `${s.id}-up`,
    pendingSteal: hero,
    pendingStealPlayer: hit?.player ?? null,
  });
  const n =
    step.kind === "ban"
      ? (ours ? s.ourBans : s.theirBansUsed) + 1
      : (ours ? s.ourPicks : s.theirPicks) + 1;
  return {
    id: `${s.id}-leave`,
    title: `If we leave ${hero}: ${alt.hero}`,
    detail: `${hero} stays up, so their next pick is ${hero}.`,
    branch: "adjust",
    action: {
      side: ours ? "our" : "their",
      kind: step.kind,
      ordinal: n,
      hero: alt.hero,
      player: alt.player,
    },
    children: rest ? [rest] : undefined,
  };
}

type Choice = { hero: string; player: string | null; why: string };

type Walk = {
  order: typeof DRAFT_ORDER;
  index: number;
  weAreFp: boolean;
  gone: Set<string>;
  ourPlayers: Set<string>;
  theirPlayers: Set<string>;
  /** Heroes we already locked, so a filled slot does not fall through to its backup. */
  ourHeroes: Set<string>;
  /** Heroes they passed, so the next pick in a row does not undo the branch. */
  passed: Set<string>;
  ourBans: number;
  theirBansUsed: number;
  ourPicks: number;
  theirPicks: number;
  theirPool: HeroOpt[];
  ourPool: HeroOpt[];
  theirBanList: string[];
  predicted: string[];
  baitBans: string[];
  ourPlan: DraftCompPick[];
  contested: string | null;
  fork: "our-first-ban" | "our-first-pick" | null;
  forked: boolean;
  /** 0 on the planned line. Pivot lines are 1 so they do not branch again. */
  deviations: number;
  /** Hero they left up that our next ban should take. */
  denyNext?: string;
  id: string;
  pendingSteal?: string;
  pendingStealPlayer?: string | null;
};

function applyChoice(
  s: Walk,
  ours: boolean,
  kind: "ban" | "pick",
  choice: Choice,
): Walk {
  const gone = new Set(s.gone);
  for (const name of heroSpellings(choice.hero)) gone.add(name);
  const ourPlayers = new Set(s.ourPlayers);
  const theirPlayers = new Set(s.theirPlayers);
  const ourHeroes = new Set(s.ourHeroes);
  if (kind === "pick") {
    if (ours) {
      for (const name of heroSpellings(choice.hero)) ourHeroes.add(name);
    }
    if (choice.player) {
      const id = playerId(choice.player);
      if (ours) ourPlayers.add(id);
      else theirPlayers.add(id);
    }
  }
  return {
    ...s,
    index: s.index + 1,
    gone,
    ourPlayers,
    theirPlayers,
    ourHeroes,
    ourBans: s.ourBans + (ours && kind === "ban" ? 1 : 0),
    theirBansUsed: s.theirBansUsed + (!ours && kind === "ban" ? 1 : 0),
    ourPicks: s.ourPicks + (ours && kind === "pick" ? 1 : 0),
    theirPicks: s.theirPicks + (!ours && kind === "pick" ? 1 : 0),
    pendingSteal:
      !ours &&
      kind === "pick" &&
      s.pendingSteal &&
      heroKey(choice.hero) === heroKey(s.pendingSteal)
        ? undefined
        : s.pendingSteal,
    pendingStealPlayer:
      !ours &&
      kind === "pick" &&
      s.pendingSteal &&
      heroKey(choice.hero) === heroKey(s.pendingSteal)
        ? undefined
        : s.pendingStealPlayer,
    denyNext:
      s.denyNext && heroKey(s.denyNext) === heroKey(choice.hero)
        ? undefined
        : s.denyNext,
  };
}

type Pivot = {
  title: string;
  why: string;
  choice: Choice;
  denyNext?: string;
};

/** A second line only where their action changes our next pick or ban. */
function theirPivot(s: Walk, kind: "ban" | "pick", expected: Choice): Pivot | null {
  const earlyBan = kind === "ban" && s.theirBansUsed === 0;
  const midBan = kind === "ban" && s.theirBansUsed === 2;
  const firstPick = kind === "pick" && s.theirPicks === 0;
  if (!earlyBan && !midBan && !firstPick) return null;
  if (!expected.hero || expected.hero.startsWith("Flex")) return null;

  if (kind === "ban") {
    const threat = s.ourPlan.find(
      (p) =>
        p.hero !== expected.hero &&
        !s.gone.has(p.hero) &&
        Boolean(p.player),
    );
    if (!threat) return null;
    const alt = (threat.alternatives ?? []).find(
      (a) => a.hero !== threat.hero && !s.gone.has(a.hero),
    );
    const swap = alt
      ? `${alt.hero} takes ${threat.role} instead.`
      : `Listed backups for ${threat.role} are gone, so that slot is filled from whoever is left.`;
    return {
      title: `If they ban ${threat.hero} instead`,
      why: `${threat.hero} is our ${threat.role}${threat.player ? ` (${threat.player})` : ""}. ${swap}`,
      choice: { hero: threat.hero, player: null, why: "" },
    };
  }

  const dodge = dodgeHero(s, expected.hero);
  if (!dodge || dodge.hero === expected.hero) return null;
  const deny = s.predicted.includes(expected.hero) ? expected.hero : undefined;
  return {
    title: `If they don't take ${expected.hero}`,
    why: deny
      ? `They take ${dodge.hero} instead. ${expected.hero} stays up, so ban it the next time we can if they still have not taken it.`
      : `They take ${dodge.hero} instead. Keep the same shape, and stop drafting as if ${expected.hero} is locked.`,
    choice: dodge,
    denyNext: deny,
  };
}

function dodgeHero(s: Walk, skipped: string): Choice | null {
  for (const hero of s.predicted) {
    if (heroKey(hero) === heroKey(skipped) || s.gone.has(hero)) continue;
    const player = freePlayer(s.theirPool, s.theirPlayers, hero);
    if (
      !player &&
      s.theirPool.some((h) => heroKey(h.hero) === heroKey(hero))
    ) {
      continue;
    }
    return {
      hero,
      player,
      why: "",
    };
  }
  const best = s.theirPool.find(
    (h) =>
      heroKey(h.hero) !== heroKey(skipped) &&
      !s.gone.has(h.hero) &&
      (!h.player || !setHasPlayer(s.theirPlayers, h.player)),
  );
  if (!best) return null;
  return { hero: best.hero, player: best.player, why: "" };
}

function nextOurBan(s: Walk): Choice {
  if (s.denyNext && !s.gone.has(s.denyNext)) {
    return {
      hero: s.denyNext,
      player: null,
      why: `They left ${s.denyNext} up. Ban it before it gets through.`,
    };
  }
  const opening = s.ourBans < 2;
  const wantThemOn = new Set(opening ? s.predicted : []);
  const ordered = [
    ...(s.contested && !(s.weAreFp && s.fork === "our-first-pick")
      ? [s.contested]
      : []),
    ...s.baitBans,
    ...s.theirPool.map((h) => h.hero),
  ];
  for (const hero of ordered) {
    if (s.gone.has(hero)) continue;
    if (wantThemOn.has(hero) && hero !== s.contested) continue;
    if (s.ourPool.some((h) => h.hero === hero) && s.weAreFp && hero !== s.contested) {
      continue;
    }
    const who = s.theirPool.find((h) => h.hero === hero);
    const why = banWhy(hero, s, who?.player ?? null, opening);
    return { hero, player: null, why };
  }
  const fallback = s.theirPool.find((h) => !s.gone.has(h.hero));
  return {
    hero: fallback?.hero ?? "Flex ban",
    player: null,
    why: "Highest comfort still available.",
  };
}

function nextTheirBan(s: Walk): Choice {
  const ourNames = new Set([
    ...s.ourPlan.map((p) => p.hero),
    ...s.ourPool.map((h) => h.hero),
  ]);
  for (const hero of s.theirBanList) {
    if (s.gone.has(hero)) continue;
    if (!ourNames.has(hero) && !s.ourPool.some((h) => h.hero === hero)) continue;
    return {
      hero,
      player: null,
      why: `They have banned ${hero} before, and it is still in our pool.`,
    };
  }
  const best = [...s.ourPool]
    .filter((h) => !s.gone.has(h.hero))
    .sort((a, b) => b.comfort - a.comfort)[0];
  return {
    hero: best?.hero ?? "Flex ban",
    player: null,
    why: best
      ? `${best.hero} is our best hero still up, so this is the ban to expect.`
      : "No read on their bans yet.",
  };
}

function nextTheirPick(s: Walk): Choice {
  if (s.pendingSteal && !s.gone.has(s.pendingSteal) && s.theirPicks === 0) {
    const who =
      freePlayer(s.theirPool, s.theirPlayers, s.pendingSteal) ??
      (s.pendingStealPlayer && !setHasPlayer(s.theirPlayers, s.pendingStealPlayer)
        ? s.pendingStealPlayer
        : null);
    return {
      hero: s.pendingSteal,
      player: who,
      why: `${s.pendingSteal} survived the bans above, so this is the pick.`,
    };
  }
  if (
    s.contested &&
    !s.gone.has(s.contested) &&
    s.theirPicks === 0 &&
    !(s.weAreFp && s.fork === "our-first-pick")
  ) {
    const who = freePlayer(s.theirPool, s.theirPlayers, s.contested);
    return {
      hero: s.contested,
      player: who,
      why: `${s.contested} is still up after the bans above. They take it first.`,
    };
  }
  for (const hero of s.predicted) {
    if (s.gone.has(hero) || s.passed.has(hero)) continue;
    const who = freePlayer(s.theirPool, s.theirPlayers, hero);
    if (!who && s.theirPool.some((h) => heroKey(h.hero) === heroKey(hero))) {
      continue;
    }
    return {
      hero,
      player: who,
      why: `${hero} is the comfort you left up.`,
    };
  }
  const best = bestFree(s.theirPool, s.theirPlayers, s.gone, s.passed);
  return {
    hero: best?.hero ?? "Flex",
    player: best?.player ?? null,
    why: best
      ? `${best.hero} is the highest comfort still available for an open player.`
      : "Pool is exhausted.",
  };
}

function nextOurPick(s: Walk): Choice {
  if (
    s.weAreFp &&
    s.ourPicks === 0 &&
    s.contested &&
    !s.gone.has(s.contested) &&
    s.fork === "our-first-pick"
  ) {
    const who = freePlayer(s.ourPool, s.ourPlayers, s.contested);
    return {
      hero: s.contested,
      player: who,
      why: `First pick. ${s.contested} is up, and we play it. Leaving it means their next pick is ${s.contested}.`,
    };
  }
  for (const pick of s.ourPlan) {
    if (s.ourHeroes.has(pick.hero)) continue;
    const takenAlt = (pick.alternatives ?? []).some((a) => s.ourHeroes.has(a.hero));
    if (takenAlt) continue;
    const options = s.gone.has(pick.hero)
      ? (pick.alternatives ?? []).map((a) => a.hero)
      : [pick.hero];
    for (const hero of options) {
      if (s.gone.has(hero)) continue;
      const named = pick.alternatives?.find((a) => a.hero === hero);
      const who =
        freePlayer(s.ourPool, s.ourPlayers, hero) ??
        (hero === pick.hero ? pick.player : named?.player ?? null);
      if (who && setHasPlayer(s.ourPlayers, who)) continue;
      const swapped = hero !== pick.hero;
      return {
        hero,
        player: who,
        why: swapped
          ? `${pick.hero} was taken, so ${hero} takes ${pick.role}.`
          : `${hero} fills ${pick.role} from our plan.`,
      };
    }
  }
  const best = bestFree(s.ourPool, s.ourPlayers, s.gone);
  return {
    hero: best?.hero ?? "Flex",
    player: best?.player ?? null,
    why: "Next comfort still available.",
  };
}

function banWhy(
  hero: string,
  s: Walk,
  player: string | null,
  opening: boolean,
): string {
  const who = player ? `${player} plays ${hero}. ` : "";
  if (hero === s.contested && !s.weAreFp) {
    return `${who}They pick first, so this ban comes before any picks. If it is up, their first pick is ${hero}.`;
  }
  if (hero === s.contested && s.weAreFp) {
    return `${who}We do not take ${hero}, so it has to be banned or their first pick is ${hero}.`;
  }
  if (opening && s.baitBans.includes(hero)) {
    return `${who}Opening ban. This is their way off the comp you want. Leave ${s.predicted.filter((h) => !s.gone.has(h)).slice(0, 2).join(" and ") || "the core"} up.`;
  }
  if (!opening) {
    return `${who}Mid ban, after three pick rounds. ${hero} is the threat still on the board.`;
  }
  return `${who}Opening ban, before any picks.`;
}

function poolFrom(players: PlayerScout[]): HeroOpt[] {
  const out: HeroOpt[] = [];
  for (const p of players) {
    for (const h of p.topHeroes) {
      out.push({
        hero: h.hero,
        player: playerName(p.battletag),
        comfort: h.comfort,
        role: heroRole(h.hero),
      });
    }
  }
  out.sort((a, b) => b.comfort - a.comfort);
  return out;
}

function freePlayer(
  pool: HeroOpt[],
  used: Set<string>,
  hero: string,
): string | null {
  const hit = pool.find(
    (h) =>
      heroKey(h.hero) === heroKey(hero) &&
      h.player &&
      !setHasPlayer(used, h.player),
  );
  return hit?.player ?? null;
}

function bestFree(
  pool: HeroOpt[],
  used: Set<string>,
  gone: Set<string>,
  passed?: Set<string>,
): HeroOpt | null {
  return (
    pool.find(
      (h) =>
        !gone.has(h.hero) &&
        !passed?.has(h.hero) &&
        (!h.player || !setHasPlayer(used, h.player)),
    ) ?? null
  );
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
