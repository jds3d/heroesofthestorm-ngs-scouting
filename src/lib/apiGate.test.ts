import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HeroesProfileError,
  checkHeroesProfileAuth,
  heroesProfileJobUrl,
  resetHeroesProfileAuthRejectionForTests,
} from "@/lib/heroesprofile/client";
import {
  allowApiRequest,
  resetApiRateLimitForTests,
  secretMatches,
} from "@/lib/apiGate";
import { ngsCurrentFromProfile } from "@/lib/scout/pipeline";

afterEach(() => {
  resetApiRateLimitForTests();
  resetHeroesProfileAuthRejectionForTests();
  vi.unstubAllGlobals();
});

describe("api gate", () => {
  it("rejects a different-length secret without a query-string path", () => {
    expect(secretMatches("short", "a-much-longer-secret")).toBe(false);
    expect(secretMatches("same-secret", "same-secret")).toBe(true);
    expect(secretMatches("", "same-secret")).toBe(false);
  });

  it("stops after 120 requests in the window", () => {
    for (let i = 0; i < 120; i += 1) {
      expect(allowApiRequest("127.0.0.1", 1_000)).toBe(true);
    }
    expect(allowApiRequest("127.0.0.1", 1_000)).toBe(false);
    expect(allowApiRequest("127.0.0.1", 1_000 + 60_000)).toBe(true);
  });
});

describe("heroesprofile job urls", () => {
  it("allows only https://www.heroesprofile.com", () => {
    expect(heroesProfileJobUrl("/api/external/v1/jobs/1")).toBe(
      "https://www.heroesprofile.com/api/external/v1/jobs/1",
    );
    expect(() => heroesProfileJobUrl("https://evil.example/steal")).toThrow(
      HeroesProfileError,
    );
    expect(() => heroesProfileJobUrl("//evil.example/steal")).toThrow(HeroesProfileError);
  });
});

describe("heroesprofile auth latch", () => {
  const previous = process.env.HEROESPROFILE_API_TOKEN;

  afterEach(() => {
    if (previous === undefined) delete process.env.HEROESPROFILE_API_TOKEN;
    else process.env.HEROESPROFILE_API_TOKEN = previous;
  });

  it("does not send another request after a 401", async () => {
    process.env.HEROESPROFILE_API_TOKEN = "test-token";
    resetHeroesProfileAuthRejectionForTests();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      async () => {
        calls += 1;
        return new Response("no", { status: 401 });
      },
    );
    const first = await checkHeroesProfileAuth();
    const second = await checkHeroesProfileAuth();
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("ngs hero pool", () => {
  it("does not invent games from a top-three name list", () => {
    const pool = ngsCurrentFromProfile({
      heroes: [],
      top_three_heroes: ["Diablo", "Rehgar", "Valla"],
    });
    expect(pool.size).toBe(0);
  });
});
