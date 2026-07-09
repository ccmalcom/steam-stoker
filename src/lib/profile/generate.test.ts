import { describe, it, expect } from "vitest";
import { buildProfile } from "./generate";
import type { TasteSignals } from "./signals";

const signals: TasteSignals = {
  notes: "Done with roguelikes. Prefer controller-friendly.",
  loved: [
    { game: { title: "Hades" } as any, genres: ["Action"], tags: ["Rogue-lite", "Indie"] },
    { game: { title: "Elden Ring" } as any, genres: ["Action", "RPG"], tags: ["Souls-like", "Open World"] },
  ],
  avoided: [{ game: { title: "FIFA 23", user_rating: 1 } as any, genres: ["Sports"], tags: ["Football"] }],
  highPlaytimeUnrated: [{ game: { title: "Factorio", playtime_minutes: 12000 } as any, genres: ["Simulation"], tags: ["Automation"] }],
  recFeedback: [],
};

describe("buildProfile", () => {
  it("weights explicit genres 3x over implicit 1x", () => {
    const { profile_json } = buildProfile(signals);
    const action = profile_json.loved_genres.find(g => g.name === "Action")!;
    const sim = profile_json.loved_genres.find(g => g.name === "Simulation")!;
    expect(action.weight).toBe(6);  // 3 per explicit loved game, two games
    expect(sim.weight).toBe(1);     // 1 per implicit game
  });
  it("builds an avoid tier from low ratings", () => {
    const { profile_json } = buildProfile(signals);
    expect(profile_json.avoided_genres.map(g => g.name)).toContain("Sports");
    expect(profile_json.avoided_games[0]).toEqual({ title: "FIFA 23", why: "rated 1★" });
  });
  it("puts notes first in the rendered text (top signal tier)", () => {
    const { profile_text } = buildProfile(signals);
    expect(profile_text.indexOf("Done with roguelikes")).toBeLessThan(profile_text.indexOf("Hades"));
    expect(profile_text).toContain("AVOID");
  });
  it("is deterministic", () => {
    expect(buildProfile(signals)).toEqual(buildProfile(signals));
  });
});
