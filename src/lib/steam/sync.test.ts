import { describe, it, expect } from "vitest";
import { planMerge } from "./sync";
import type { Game } from "../types";

const NOW = 1751000000;
const incoming = { appid: 570, name: "Dota 2", playtime_forever: 500, rtime_last_played: 1750000000 };

const existing: Game = {
  id: 1, steam_appid: 570, source: "steam", platform: "steam", title: "Dota 2",
  playtime_minutes: 400, last_played_at: 1749000000, installed: 1, install_size_bytes: 1000,
  user_rating: 5, user_review: "the one true moba", status: "finished", added_at: 1700000000,
};

describe("planMerge", () => {
  it("inserts new games with sync-owned defaults", () => {
    const plan = planMerge(undefined, incoming, NOW);
    expect(plan.action).toBe("insert");
    expect(plan.fields).toMatchObject({
      steam_appid: 570, source: "steam", platform: "steam", title: "Dota 2",
      playtime_minutes: 500, last_played_at: 1750000000, added_at: NOW,
    });
  });
  it("updates ONLY title/playtime/last_played on existing games", () => {
    const plan = planMerge(existing, incoming, NOW);
    expect(plan.action).toBe("update");
    expect(Object.keys(plan.fields).sort()).toEqual(["last_played_at", "playtime_minutes", "title"]);
  });
  it("NEVER touches user_rating, user_review, or status", () => {
    const plan = planMerge(existing, incoming, NOW);
    expect(plan.fields).not.toHaveProperty("user_rating");
    expect(plan.fields).not.toHaveProperty("user_review");
    expect(plan.fields).not.toHaveProperty("status");
  });
  it("skips when nothing sync-owned changed", () => {
    const same = { ...incoming, playtime_forever: 400, rtime_last_played: 1749000000 };
    expect(planMerge(existing, same, NOW).action).toBe("skip");
  });
  it("treats rtime_last_played=0 as null", () => {
    const plan = planMerge(undefined, { ...incoming, rtime_last_played: 0 }, NOW);
    expect(plan.fields.last_played_at).toBeNull();
  });
});
