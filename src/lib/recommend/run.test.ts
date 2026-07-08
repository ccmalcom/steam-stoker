import { describe, it, expect, vi, beforeEach } from "vitest";
import { runRecommendation } from "./run";
import { getDb } from "../db";
import { getSetting } from "../settings";
import { loadLibraryWithMeta } from "../library";
import { scoreBacklog } from "./stage1";
import { discoverCandidates } from "./discovery";
import { rerank, fallbackRank } from "./rerank";
import { currentProfile, regenerateProfile } from "../profile/store";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../settings", () => ({ getSetting: vi.fn() }));
vi.mock("../library", () => ({ loadLibraryWithMeta: vi.fn() }));
vi.mock("./stage1", () => ({ scoreBacklog: vi.fn() }));
vi.mock("./discovery", () => ({ discoverCandidates: vi.fn() }));
vi.mock("./rerank", () => ({ rerank: vi.fn(), fallbackRank: vi.fn() }));
vi.mock("../profile/store", () => ({ currentProfile: vi.fn(), regenerateProfile: vi.fn() }));

const fakeDb = { execute: vi.fn(), select: vi.fn() };

const fakeProfile = {
  id: 1, generated_at: 0, trigger_reason: "manual" as const,
  profile_json: {
    loved_genres: [], loved_tags: [], avoided_genres: [], avoided_tags: [],
    loved_games: [], avoided_games: [], notes: "",
  },
  profile_text: "taste profile text",
};

function mockSettings(overrides: Record<string, string | null> = {}) {
  const values: Record<string, string | null> = {
    anthropic_api_key: null, rawg_api_key: null, anthropic_model: null,
    playtime_threshold_hours: null, ...overrides,
  };
  vi.mocked(getSetting).mockImplementation(async (key: string) => values[key] ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(fakeDb as any);
  fakeDb.execute.mockResolvedValue({ lastInsertId: 42 } as any);
  vi.mocked(currentProfile).mockResolvedValue(fakeProfile as any);
  vi.mocked(regenerateProfile).mockResolvedValue(fakeProfile as any);
  vi.mocked(loadLibraryWithMeta).mockResolvedValue([]);
  vi.mocked(scoreBacklog).mockReturnValue([]);
});

describe("runRecommendation", () => {
  it("backlog mode with no Anthropic key succeeds, skips discovery, uses fallbackRank, and marks degraded", async () => {
    mockSettings();
    const backlogCandidate = {
      game: { id: 1, title: "Backlog Game", steam_appid: 10, installed: 0 } as any,
      genres: ["RPG"], tags: ["Open World"], score: 5, reasons: ["matches loved genres: RPG"],
    };
    vi.mocked(scoreBacklog).mockReturnValue([backlogCandidate]);
    vi.mocked(fallbackRank).mockReturnValue([
      { title: "Backlog Game", why: "matches loved genres: RPG", origin: "backlog", steam_appid: 10, game_id: 1, installed: false, priceCents: null },
    ]);

    const run = await runRecommendation("backlog");

    expect(scoreBacklog).toHaveBeenCalledTimes(1);
    expect(discoverCandidates).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(fallbackRank).toHaveBeenCalledTimes(1);
    expect(run.degraded).toBe(true);
    expect(run.rerankFailed).toBe(false);
    expect(run.items).toEqual([
      { title: "Backlog Game", why: "matches loved genres: RPG", origin: "backlog", steam_appid: 10, game_id: 1, installed: false, priceCents: null },
    ]);
  });

  it("discovery mode with no Anthropic key throws before calling discoverCandidates", async () => {
    mockSettings();

    await expect(runRecommendation("discovery")).rejects.toThrow(/Anthropic API key/i);
    expect(discoverCandidates).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
  });

  it("mixed mode with a key present combines backlog + discovery candidates and uses rerank's output", async () => {
    mockSettings({ anthropic_api_key: "AK" });
    vi.mocked(scoreBacklog).mockReturnValue([{
      game: { id: 1, title: "Backlog Game", steam_appid: 10, installed: 0 } as any,
      genres: [], tags: [], score: 5, reasons: ["backlog reason"],
    }]);
    vi.mocked(discoverCandidates).mockResolvedValue({
      candidates: [{
        title: "Discovery Game", reason: "discovery reason",
        steam_appid: 20, priceCents: 1999, genres: [], tags: [],
      }],
      staleWarning: false,
    });
    vi.mocked(rerank).mockResolvedValue([
      { title: "Discovery Game", why: "great pick", origin: "discovery", steam_appid: 20, game_id: null, installed: false, priceCents: 1999 },
    ]);

    const run = await runRecommendation("mixed", "cozy");

    expect(rerank).toHaveBeenCalledTimes(1);
    const rerankArgs = vi.mocked(rerank).mock.calls[0][0];
    expect(rerankArgs.candidates.map(c => c.title).sort()).toEqual(["Backlog Game", "Discovery Game"]);
    const backlogCand = rerankArgs.candidates.find(c => c.title === "Backlog Game")!;
    expect(backlogCand.stage1Reasons).toEqual(["backlog reason"]);
    const discoveryCand = rerankArgs.candidates.find(c => c.title === "Discovery Game")!;
    expect(discoveryCand.stage1Reasons).toEqual(["discovery reason"]);

    expect(fallbackRank).not.toHaveBeenCalled();
    expect(run.degraded).toBe(false);
    expect(run.rerankFailed).toBe(false);
    expect(run.items).toEqual([
      { title: "Discovery Game", why: "great pick", origin: "discovery", steam_appid: 20, game_id: null, installed: false, priceCents: 1999 },
    ]);
  });

  it("falls back to heuristic ranking (instead of rejecting) when rerank throws with a key present", async () => {
    mockSettings({ anthropic_api_key: "AK" });
    vi.mocked(scoreBacklog).mockReturnValue([{
      game: { id: 1, title: "Backlog Game", steam_appid: 10, installed: 0 } as any,
      genres: [], tags: [], score: 5, reasons: ["backlog reason"],
    }]);
    vi.mocked(rerank).mockRejectedValue(new Error("rate limited"));
    vi.mocked(fallbackRank).mockReturnValue([
      { title: "Backlog Game", why: "backlog reason", origin: "backlog", steam_appid: 10, game_id: 1, installed: false, priceCents: null },
    ]);

    const run = await runRecommendation("backlog");

    expect(rerank).toHaveBeenCalledTimes(1);
    expect(fallbackRank).toHaveBeenCalledTimes(1);
    expect(run.items).toEqual([
      { title: "Backlog Game", why: "backlog reason", origin: "backlog", steam_appid: 10, game_id: 1, installed: false, priceCents: null },
    ]);
    expect(run.degraded).toBe(true);
    expect(run.rerankFailed).toBe(true);
  });
});
