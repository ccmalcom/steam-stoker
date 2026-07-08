import { describe, it, expect } from "vitest";
import { resolveSteamApp, normalizeTitle } from "./resolve";

describe("normalizeTitle", () => {
  it("strips trademark symbols, punctuation and case", () => {
    expect(normalizeTitle("ELDEN RING™: Shadow of the Erdtree!")).toBe("elden ring shadow of the erdtree");
  });
});

describe("resolveSteamApp", () => {
  const body = { items: [
    { id: 1245620, name: "ELDEN RING", price: { final: 5999 } },
    { id: 999, name: "Elden Ring Soundtrack", price: null },
  ]};
  it("returns the best title match with appid and price", async () => {
    const hit = await resolveSteamApp("Elden Ring", async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(hit).toEqual({ appid: 1245620, name: "ELDEN RING", priceCents: 5999 });
  });
  it("returns null when nothing matches closely", async () => {
    const hit = await resolveSteamApp("Totally Unrelated Game", async () =>
      new Response(JSON.stringify(body), { status: 200 }));
    expect(hit).toBeNull();
  });
  it("prefers the exact match over an earlier loose match (best match, not first match)", async () => {
    const loose = { items: [
      { id: 1, name: "DOOM Eternal", price: { final: 1999 } },
      { id: 2, name: "DOOM", price: { final: 999 } },
    ]};
    const hit = await resolveSteamApp("Doom", async () => new Response(JSON.stringify(loose), { status: 200 }));
    expect(hit).toEqual({ appid: 2, name: "DOOM", priceCents: 999 });
  });
  it("returns null when fetchFn rejects (network failure), never throws", async () => {
    await expect(resolveSteamApp("Elden Ring", async () => { throw new Error("network down"); }))
      .resolves.toBeNull();
  });
});
