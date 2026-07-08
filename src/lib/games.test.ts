import { describe, it, expect } from "vitest";
import { buildLibraryQuery } from "./games";

describe("buildLibraryQuery", () => {
  it("defaults to all games sorted by playtime desc", () => {
    const { sql, params } = buildLibraryQuery({ sort: "playtime" });
    expect(sql).toContain("ORDER BY g.playtime_minutes DESC");
    expect(params).toEqual([]);
  });
  it("applies search, installed and status filters with params", () => {
    const { sql, params } = buildLibraryQuery({ search: "dota", installedOnly: true, status: "active", sort: "title" });
    expect(sql).toContain("g.title LIKE");
    expect(sql).toContain("g.installed = 1");
    expect(sql).toContain("g.status = ");
    expect(params).toEqual(["%dota%", "active"]);
  });
});
