import { describe, it, expect } from "vitest";
import { getOwnedGames, resolveVanityUrl, SteamApiError } from "./webapi";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getOwnedGames", () => {
  it("returns games and passes key/steamid in query", async () => {
    let seen = "";
    const games = await getOwnedGames("KEY", "76561198000000000", async (url) => {
      seen = url;
      return jsonResponse({ response: { game_count: 1, games: [
        { appid: 570, name: "Dota 2", playtime_forever: 12345, rtime_last_played: 1719000000 },
      ]}});
    });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ appid: 570, name: "Dota 2" });
    expect(seen).toContain("key=KEY");
    expect(seen).toContain("steamid=76561198000000000");
    expect(seen).toContain("include_appinfo=1");
  });
  it("returns [] when the response has no games (private profile)", async () => {
    expect(await getOwnedGames("K", "S", async () => jsonResponse({ response: {} }))).toEqual([]);
  });
  it("throws SteamApiError on HTTP failure", async () => {
    await expect(getOwnedGames("K", "S", async () => jsonResponse({}, 403)))
      .rejects.toBeInstanceOf(SteamApiError);
  });
});

describe("resolveVanityUrl", () => {
  it("returns steamid on success", async () => {
    const id = await resolveVanityUrl("K", "chase", async () =>
      jsonResponse({ response: { success: 1, steamid: "76561198000000000" } }));
    expect(id).toBe("76561198000000000");
  });
  it("returns null when no match", async () => {
    const id = await resolveVanityUrl("K", "nobody", async () =>
      jsonResponse({ response: { success: 42, message: "No match" } }));
    expect(id).toBeNull();
  });
});
