import { describe, it, expect } from "vitest";
import { validateManualInput } from "./manual";

const good = { title: "Halo Infinite", platform: "xbox" as const, playtimeHours: 30, rating: 4, review: null };

describe("validateManualInput", () => {
  it("accepts a valid input", () => expect(validateManualInput(good)).toEqual([]));
  it("requires a non-empty title", () =>
    expect(validateManualInput({ ...good, title: "  " })).toContain("title is required"));
  it("rejects negative playtime", () =>
    expect(validateManualInput({ ...good, playtimeHours: -1 })).toContain("playtime must be >= 0"));
  it("rejects out-of-range rating", () =>
    expect(validateManualInput({ ...good, rating: 7 })).toContain("rating must be 1-5"));
});
