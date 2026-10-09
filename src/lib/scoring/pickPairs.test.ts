import { describe, expect, it } from "vitest";
import { DRAFT_ORDER } from "@/lib/scoring/draftPlan";
import { nextStepSuggestion } from "@/lib/scoring/pickPairs";

describe("nextStepSuggestion", () => {
  it("names the step the draft order says is next", () => {
    expect(nextStepSuggestion(DRAFT_ORDER, 0)).toEqual({
      side: "fp",
      kind: "ban",
      picks: 1,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 4)).toEqual({
      side: "fp",
      kind: "pick",
      picks: 1,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 5)).toEqual({
      side: "sp",
      kind: "pick",
      picks: 2,
      last: false,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 13)).toEqual({
      side: "fp",
      kind: "pick",
      picks: 2,
      last: true,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, 15)).toEqual({
      side: "sp",
      kind: "pick",
      picks: 1,
      last: true,
    });
    expect(nextStepSuggestion(DRAFT_ORDER, DRAFT_ORDER.length)).toBeNull();
  });
});
