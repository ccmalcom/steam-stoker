import { describe, it, expect } from "vitest";
import { extractSignals, type GameWithMeta } from "./signals";
import type { Game } from "../types";

function g(over: Partial<Game>, genres: string[] = [], tags: string[] = []): GameWithMeta {
  return {
    game: {
      id: 1, steam_appid: 1, source: "steam", platform: "steam", title: "t",
      playtime_minutes: 0, last_played_at: null, installed: 0, install_size_bytes: null,
      user_rating: null, user_review: null, status: "active", added_at: 0, ...over,
    }, genres, tags,
  };
}

describe("extractSignals", () => {
  it("tiers loved (>=4), avoided (<=2), implicit high-playtime unrated", () => {
    const s = extractSignals([
      g({ id: 1, title: "Loved", user_rating: 5 }),
      g({ id: 2, title: "Meh", user_rating: 3 }),
      g({ id: 3, title: "Hated", user_rating: 1 }),
      g({ id: 4, title: "Grinder", playtime_minutes: 6000 }),
      g({ id: 5, title: "Barely", playtime_minutes: 30 }),
    ], "notes here", []);
    expect(s.loved.map(x => x.game.title)).toEqual(["Loved"]);
    expect(s.avoided.map(x => x.game.title)).toEqual(["Hated"]);
    expect(s.highPlaytimeUnrated.map(x => x.game.title)).toEqual(["Grinder"]);
    expect(s.notes).toBe("notes here");
  });
  it("NEVER treats wont_run as avoided (locked decision #8)", () => {
    const s = extractSignals([g({ id: 1, title: "AC Origins", user_rating: null, status: "wont_run", playtime_minutes: 9000 })], "", []);
    expect(s.avoided).toEqual([]);
    expect(s.highPlaytimeUnrated).toEqual([]); // wont_run is fully neutral
  });
  it("a rated game does not double-count in the implicit tier", () => {
    const s = extractSignals([g({ id: 1, title: "Both", user_rating: 5, playtime_minutes: 9000 })], "", []);
    expect(s.loved).toHaveLength(1);
    expect(s.highPlaytimeUnrated).toHaveLength(0);
  });
  it("caps the implicit tier and sorts by playtime desc", () => {
    const lib = Array.from({ length: 30 }, (_, i) =>
      g({ id: i, title: `G${i}`, playtime_minutes: (i + 1) * 600 }));
    const s = extractSignals(lib, "", [], { maxImplicit: 10 });
    expect(s.highPlaytimeUnrated).toHaveLength(10);
    expect(s.highPlaytimeUnrated[0].game.title).toBe("G29");
  });
});
