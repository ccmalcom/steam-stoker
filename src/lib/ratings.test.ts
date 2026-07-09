import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateRating, rateGame } from "./ratings";
import * as dbModule from "./db";

describe("validateRating", () => {
  it("accepts null and integers 1-5", () => {
    for (const r of [null, 1, 2, 3, 4, 5]) expect(() => validateRating(r)).not.toThrow();
  });
  it("rejects 0, 6, floats, NaN", () => {
    for (const r of [0, 6, 3.5, NaN]) expect(() => validateRating(r as number)).toThrow(RangeError);
  });
});

describe("rateGame", () => {
  let executeCalls: { sql: string; params: unknown[] }[] = [];
  const mockDb = {
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      executeCalls.push({ sql, params });
    }),
  };

  beforeEach(() => {
    executeCalls = [];
    mockDb.execute.mockClear();
    vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);
  });

  it("rating-only update leaves existing user_review untouched", async () => {
    await rateGame(42, 4);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    const calls = mockDb.execute.mock.calls;
    // First call: INSERT into rating_events
    expect(calls[0][0]).toContain("INSERT INTO rating_events");
    expect(calls[0][1]).toEqual([42, 4, null, expect.any(Number)]);
    // Second call: UPDATE only rating (no user_review in SET clause)
    expect(calls[1][0]).toContain("UPDATE games SET user_rating = $1 WHERE id = $2");
    expect(calls[1][1]).toEqual([4, 42]);
    expect(calls[1][0]).not.toContain("user_review");
  });

  it("explicit null reviewText clears the review", async () => {
    await rateGame(42, 4, null);
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    const calls = mockDb.execute.mock.calls;
    // First call: INSERT into rating_events with null review_text
    expect(calls[0][0]).toContain("INSERT INTO rating_events");
    expect(calls[0][1]).toEqual([42, 4, null, expect.any(Number)]);
    // Second call: UPDATE both rating and review (explicitly set to null)
    expect(calls[1][0]).toContain("UPDATE games SET user_rating = $1, user_review = $2 WHERE id = $3");
    expect(calls[1][1]).toEqual([4, null, 42]);
  });

  it("explicit string reviewText updates the review", async () => {
    await rateGame(42, 4, "great game");
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
    const calls = mockDb.execute.mock.calls;
    // Second call: UPDATE both rating and review
    expect(calls[1][0]).toContain("UPDATE games SET user_rating = $1, user_review = $2 WHERE id = $3");
    expect(calls[1][1]).toEqual([4, "great game", 42]);
  });
});
