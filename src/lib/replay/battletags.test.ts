import { describe, expect, it } from "vitest";
import { battletagFromHistory, type ReplayName } from "@/lib/replay/battletags";

const history = new Map<string, ReplayName>([
  ["huckit", { display: "HuckIt", tag: "HuckIt#1840" }],
  ["trinity", { display: "Trinity", tag: "Trinity#12547" }],
]);

describe("battletagFromHistory", () => {
  it("uses the saved tag, which is the most recent shared game", () => {
    expect(battletagFromHistory(history, "Trinity")?.tag).toBe("Trinity#12547");
  });

  it("snaps an OCR slip onto that same tag", () => {
    expect(battletagFromHistory(history, "Hucklt")?.tag).toBe("HuckIt#1840");
  });

  it("returns null when the name has no shared game", () => {
    expect(battletagFromHistory(history, "Answered")).toBeNull();
  });

  it("matches replay names when OCR folds i/l on a long tag", () => {
    const withFree = new Map<string, ReplayName>([
      ["mfreepoints", { display: "mFreePoints", tag: "mFreePoints#1234" }],
    ]);
    expect(battletagFromHistory(withFree, "ImFreePoints")?.tag).toBe(
      "mFreePoints#1234",
    );
  });
});
