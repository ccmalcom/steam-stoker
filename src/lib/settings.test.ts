import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dbModule from "./db";
import { getOptionalSetting, getNumberSetting } from "./settings";

// getSetting (which both accessors wrap) reads a single-row `value`; mock getDb's select.
function mockStored(value: string | null) {
  const db = { select: vi.fn(async () => (value === null ? [] : [{ value }])) };
  vi.spyOn(dbModule, "getDb").mockResolvedValue(db as any);
}

beforeEach(() => vi.restoreAllMocks());

describe("getOptionalSetting", () => {
  it("treats missing / empty / whitespace as unset (undefined)", async () => {
    for (const v of [null, "", "   "]) {
      mockStored(v);
      expect(await getOptionalSetting("k")).toBeUndefined();
    }
  });
  it("returns the trimmed value when set", async () => {
    mockStored("  claude-sonnet-5  ");
    expect(await getOptionalSetting("k")).toBe("claude-sonnet-5");
  });
});

describe("getNumberSetting", () => {
  it("falls back on missing / empty / non-numeric", async () => {
    for (const v of [null, "", "   ", "abc"]) {
      mockStored(v);
      expect(await getNumberSetting("k", 2)).toBe(2);
    }
  });
  it("falls back on values ≤ 0 only when requirePositive", async () => {
    mockStored("0");
    expect(await getNumberSetting("k", 2, true)).toBe(2);
    mockStored("-5");
    expect(await getNumberSetting("k", 2, true)).toBe(2);
    mockStored("0");
    expect(await getNumberSetting("k", 2)).toBe(0);   // 0 allowed when not requirePositive
  });
  it("returns the parsed number (including halves) when valid", async () => {
    mockStored("10");
    expect(await getNumberSetting("k", 2, true)).toBe(10);
    mockStored("2.5");
    expect(await getNumberSetting("k", 2)).toBe(2.5);
  });
});
