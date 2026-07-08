import { describe, it, expect } from "vitest";
import { SCHEMA_STATEMENTS } from "./schema";

describe("schema", () => {
  it("creates all five tables idempotently", () => {
    const sql = SCHEMA_STATEMENTS.join("\n");
    for (const table of ["games", "rating_events", "game_meta", "taste_profile", "recommendations", "settings"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("steam_appid INTEGER UNIQUE");
    expect(sql).toContain("CHECK (status IN ('active','not_interested','finished','wont_run'))");
  });
});
