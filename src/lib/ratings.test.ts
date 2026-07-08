import { describe, it, expect } from "vitest";
import { validateRating } from "./ratings";

describe("validateRating", () => {
  it("accepts null and integers 1-5", () => {
    for (const r of [null, 1, 2, 3, 4, 5]) expect(() => validateRating(r)).not.toThrow();
  });
  it("rejects 0, 6, floats, NaN", () => {
    for (const r of [0, 6, 3.5, NaN]) expect(() => validateRating(r as number)).toThrow(RangeError);
  });
});
