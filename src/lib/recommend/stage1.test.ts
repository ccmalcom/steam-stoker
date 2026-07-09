import { describe, it, expect } from "vitest";
import { scoreBacklog } from "./stage1";
import type { GameWithMeta } from "../profile/signals";
import type { ProfileJson } from "../profile/generate";
import type { Game } from "../types";

function g(over: Partial<Game>, genres: string[] = [], tags: string[] = []): GameWithMeta {
  return {
    game: {
      id: Math.random(), steam_appid: 1, source: "steam", platform: "steam", title: "t",
      playtime_minutes: 0, last_played_at: null, installed: 0, install_size_bytes: null,
      user_rating: null, user_review: null, status: "active", added_at: 0, ...over,
    }, genres, tags,
  };
}

const profile: ProfileJson = {
  loved_genres: [{ name: "RPG", weight: 6 }], loved_tags: [{ name: "Open World", weight: 3 }],
  avoided_genres: [{ name: "Sports", weight: 3 }], avoided_tags: [],
  loved_games: [], avoided_games: [], notes: "",
};

describe("scoreBacklog", () => {
  it("only considers active games under the playtime threshold", () => {
    const out = scoreBacklog([
      g({ title: "Played", playtime_minutes: 600 }),
      g({ title: "NotInterested", status: "not_interested" }),
      g({ title: "WontRun", status: "wont_run" }),
      g({ title: "Fresh", playtime_minutes: 0 }),
    ], profile);
    expect(out.map(c => c.game.title)).toEqual(["Fresh"]);
  });
  it("ranks profile-matching games higher and explains why", () => {
    const out = scoreBacklog([
      g({ title: "Match" }, ["RPG"], ["Open World"]),
      g({ title: "NoMatch" }, ["Puzzle"], []),
    ], profile);
    expect(out[0].game.title).toBe("Match");
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].reasons.join(" ")).toContain("RPG");
  });
  it("penalizes avoided genres", () => {
    const out = scoreBacklog([
      g({ title: "Sporty" }, ["Sports"], []),
      g({ title: "Plain" }, [], []),
    ], profile);
    expect(out[0].game.title).toBe("Plain");
  });
  it("boosts installed games", () => {
    const out = scoreBacklog([
      g({ title: "OnDisk", installed: 1 }, ["RPG"], []),
      g({ title: "NotOnDisk", installed: 0 }, ["RPG"], []),
    ], profile);
    expect(out[0].game.title).toBe("OnDisk");
  });
  it("caps output at topN", () => {
    const lib = Array.from({ length: 40 }, (_, i) => g({ title: `G${i}` }, ["RPG"], []));
    expect(scoreBacklog(lib, profile, { topN: 20 })).toHaveLength(20);
  });
});
