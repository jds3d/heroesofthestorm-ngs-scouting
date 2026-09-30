import { describe, expect, it } from "vitest";
import {
  canonicalDraftHero,
  draftActionsFromReplay,
  findOurTeam,
  mapFromReplayFile,
  type ParsedReplayDraft,
} from "@/lib/review/replayDraft";

const CODES: Record<string, string> = {
  Crus: "Johanna",
  Andu: "Anduin",
  DEAT: "Deathwing",
  Anub: "Anub'arak",
  Junk: "Junkrat",
  Leor: "Leoric",
};

// LBB vs Tricky Gooses, game 1 (Infernal Shrines): LBB were team 0 with first pick.
const game1: ParsedReplayDraft = {
  map: "Infernal Shrines",
  firstPickTeam: 0,
  winnerTeam: 1,
  picks: [
    ["Qhira", "Whitemane", "Kael'thas", "E.T.C.", "Xul"],
    ["Dehaka", "Falstad", "Varian", "Auriel", "Hanzo"],
  ],
  bans: [
    ["Crus", "Andu", "DEAT"],
    ["Anub", "Junk", "Leor"],
  ],
  players: [
    { team: 0, name: "Beachyman", hero: "Qhira" },
    { team: 0, name: "Somebody", hero: "Whitemane" },
    { team: 1, name: "Polarus", hero: "Dehaka" },
  ],
};

const name = (code: string) => CODES[code] ?? null;

describe("replay draft order", () => {
  it("lays bans and picks onto DRAFT_ORDER from our side", () => {
    const { weFirst, actions, problems } = draftActionsFromReplay(game1, 0, name);
    expect(weFirst).toBe(true);
    expect(problems).toEqual([]);
    expect(actions.map((a) => `${a.side} ${a.kind} ${a.hero}`)).toEqual([
      "our ban Johanna",
      "their ban Anub'arak",
      "our ban Anduin",
      "their ban Junkrat",
      "our pick Qhira",
      "their pick Dehaka",
      "their pick Falstad",
      "our pick Whitemane",
      `our pick ${canonicalDraftHero("Kael'thas")}`,
      "their ban Leoric",
      "our ban Deathwing",
      "their pick Varian",
      "their pick Auriel",
      `our pick ${canonicalDraftHero("E.T.C.")}`,
      "our pick Xul",
      "their pick Hanzo",
    ]);
  });

  it("flips sides when we are the second-pick team", () => {
    const { weFirst, actions } = draftActionsFromReplay(game1, 1, name);
    expect(weFirst).toBe(false);
    expect(actions[0]).toEqual({ side: "their", kind: "ban", hero: "Johanna" });
    expect(actions[5]).toEqual({
      side: "our",
      kind: "pick",
      hero: "Dehaka",
      player: "Polarus",
    });
  });

  it("carries who actually played each pick", () => {
    const { actions } = draftActionsFromReplay(game1, 0, name);
    expect(actions[4]).toMatchObject({ hero: "Qhira", player: "Beachyman" });
    expect(actions[6]).toMatchObject({ hero: "Falstad", player: null });
    expect(actions[0].player).toBeUndefined();
  });

  it("stops at a skipped ban instead of shifting later steps", () => {
    const skipped: ParsedReplayDraft = {
      ...game1,
      bans: [["Crus", "", "DEAT"], game1.bans[1]],
    };
    const { actions, problems } = draftActionsFromReplay(skipped, 0, name);
    expect(actions).toHaveLength(2);
    expect(problems).toEqual([
      "Our ban 2 was skipped, so the replay stops at step 3.",
    ]);
  });

  it("finds our team by roster names and the map from the NGS filename", () => {
    expect(findOurTeam(game1.players, ["Beachyman#11746", "Somebody#1"])).toBe(0);
    expect(findOurTeam(game1.players, ["Nobody#1"])).toBeNull();
    expect(
      mapFromReplayFile(
        "ngs_9-24-2026_Little_Buff_Boyz_vs_Tricky_Gooses_Towers_of_Doom.stormReplay",
        ["Infernal Shrines", "Towers of Doom"],
      ),
    ).toBe("Towers of Doom");
  });
});
