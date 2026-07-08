import { describe, it, expect } from "vitest";
import { rawgSearch, rawgByGenre } from "./rawg";

const RESULTS = { results: [{
  name: "Hades II", released: "2024-05-06",
  genres: [{ name: "Action" }], tags: [{ name: "Roguelike" }], metacritic: 93,
}]};
const ok = () => new Response(JSON.stringify(RESULTS), { status: 200 });

describe("rawg client", () => {
  it("search maps results and sends key + query", async () => {
    let seen = "";
    const out = await rawgSearch("RK", "hades", async (url) => { seen = url; return ok(); });
    expect(out[0]).toEqual({ name: "Hades II", released: "2024-05-06", genres: ["Action"], tags: ["Roguelike"], metacritic: 93 });
    expect(seen).toContain("key=RK");
    expect(seen).toContain("search=hades");
  });
  it("byGenre builds genres/dates/ordering params", async () => {
    let seen = "";
    await rawgByGenre("RK", { genres: ["rpg"], fromDate: "2025-01-01", toDate: "2026-07-08", ordering: "-added" },
      async (url) => { seen = url; return ok(); });
    expect(seen).toContain("genres=rpg");
    expect(seen).toContain("dates=2025-01-01,2026-07-08");
    expect(seen).toContain("ordering=-added");
  });
  it("returns [] on HTTP error (degraded mode, non-fatal)", async () => {
    expect(await rawgSearch("RK", "x", async () => new Response("", { status: 500 }))).toEqual([]);
  });
});
