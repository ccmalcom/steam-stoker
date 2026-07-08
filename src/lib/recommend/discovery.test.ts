import { describe, it, expect, vi } from "vitest";
import { discoverCandidates } from "./discovery";
import * as anthropic from "../anthropic";
import * as resolve from "./resolve";

describe("discoverCandidates", () => {
  it("parses Claude output, resolves appids, filters owned games", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "Hades II", reason: "you loved Hades" },
      { title: "Elden Ring", reason: "souls-like" },        // owned → must be filtered
      { title: "Made Up Game", reason: "hallucination" },   // unresolvable → kept with null appid
    ]));
    vi.spyOn(resolve, "resolveSteamApp").mockImplementation(async (title) =>
      title === "Hades II" ? { appid: 1145350, name: "Hades II", priceCents: 2999 } : null);

    const { candidates, staleWarning } = await discoverCandidates({
      anthropicKey: "AK", rawgKey: "RK",
      profileText: "profile", ownedTitles: ["Elden Ring"],
    });
    expect(candidates.map(c => c.title)).toEqual(["Hades II", "Made Up Game"]);
    expect(candidates[0].steam_appid).toBe(1145350);
    expect(candidates[1].steam_appid).toBeNull();
    expect(staleWarning).toBe(false);
    vi.restoreAllMocks();
  });
  it("sets staleWarning and passes no tools when rawgKey is null", async () => {
    const spy = vi.spyOn(anthropic, "claudeComplete").mockResolvedValue("[]");
    const { staleWarning } = await discoverCandidates({
      anthropicKey: "AK", rawgKey: null, profileText: "p", ownedTitles: [],
    });
    expect(staleWarning).toBe(true);
    expect(spy.mock.calls[0][0].tools).toBeUndefined();
    vi.restoreAllMocks();
  });
});
