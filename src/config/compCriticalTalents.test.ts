import { describe, expect, it } from "vitest";
import { criticalTalentsFor } from "@/config/compCriticalTalents";

const lbb = ["Qhira", "Whitemane", "Kael'thas", "E.T.C.", "Xul"];
const tg = ["Dehaka", "Falstad", "Varian", "Auriel", "Hanzo"];

describe("comp-critical talents", () => {
  it("flags the Mosh Pit + AoE combo from both sides", () => {
    const etc = criticalTalentsFor("E.T.C.", lbb, tg);
    expect(etc.map((t) => `${t.level} ${t.talent}`)).toEqual(["10 Mosh Pit"]);
    expect(etc[0].why).toContain("Kael'thas and Xul");
    expect(criticalTalentsFor("Xul", lbb, tg).map((t) => t.talent)).toEqual([
      "Poison Nova",
    ]);
  });

  it("says nothing for heroes whose comp doesn't hinge on a talent", () => {
    expect(criticalTalentsFor("Whitemane", lbb, tg)).toEqual([]);
    expect(criticalTalentsFor("Qhira", lbb, tg)).toEqual([]);
    expect(criticalTalentsFor("E.T.C.", ["E.T.C.", "Qhira", "Whitemane"], tg)).toEqual([]);
  });

  it("only demands Taunt when Varian is the only tank", () => {
    expect(criticalTalentsFor("Varian", tg, lbb).map((t) => t.talent)).toEqual(["Taunt"]);
    expect(criticalTalentsFor("Varian", ["Varian", "Johanna", "Uther"], lbb)).toEqual([]);
  });
});
