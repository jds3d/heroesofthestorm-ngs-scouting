import { describe, expect, it } from "vitest";
import { heroPortraitUrlCandidates } from "@/lib/scoring/heroPortrait";

describe("heroPortraitUrlCandidates", () => {
  it("prefers local draft art then CDN", () => {
    const urls = heroPortraitUrlCandidates("Muradin", "draft");
    expect(urls[0]).toBe("/heroes/draft/muradin.png");
    expect(urls[1]).toContain("storm_ui_glues_draft_portrait_muradin");
  });

  it("maps Falstad select slug to gryphon_rider locally first", () => {
    const urls = heroPortraitUrlCandidates("Falstad", "select");
    expect(urls[0]).toBe("/heroes/select/gryphon_rider.png");
    expect(urls.some((u) => u.includes("gryphon_rider"))).toBe(true);
  });
});
