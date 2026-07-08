import { describe, it, expect, vi } from "vitest";
import { rerank, fallbackRank, type UnifiedCandidate } from "./rerank";
import * as anthropic from "../anthropic";

const cand = (title: string, origin: "backlog" | "discovery" = "backlog"): UnifiedCandidate => ({
  title, origin, steam_appid: 1, game_id: origin === "backlog" ? 1 : null,
  installed: false, priceCents: null, genres: [], tags: [], stage1Reasons: ["r1"],
});

describe("rerank", () => {
  it("returns items in Claude's order with Claude's reasons", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "B", why: "because B" }, { title: "A", why: "because A" },
    ]));
    const out = await rerank({ apiKey: "K", profileText: "p", candidates: [cand("A"), cand("B")] });
    expect(out.map(i => i.title)).toEqual(["B", "A"]);
    expect(out[0].why).toBe("because B");
    vi.restoreAllMocks();
  });
  it("drops items Claude names that are not in the candidate list (anti-hallucination)", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "Ghost Game", why: "x" }, { title: "A", why: "real" },
    ]));
    const out = await rerank({ apiKey: "K", profileText: "p", candidates: [cand("A")] });
    expect(out.map(i => i.title)).toEqual(["A"]);
    vi.restoreAllMocks();
  });
});

describe("fallbackRank", () => {
  it("keeps stage-1 order and joins reasons as why", () => {
    const out = fallbackRank([cand("A"), cand("B")], 1);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("A");
    expect(out[0].why).toBe("r1");
  });
});
