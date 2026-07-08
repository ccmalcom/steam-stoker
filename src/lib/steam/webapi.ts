import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class SteamApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "SteamApiError"; }
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;   // minutes
  rtime_last_played: number;  // unix seconds, 0 = never
}

const BASE = "https://api.steampowered.com";

export async function getOwnedGames(
  apiKey: string, steamId64: string, fetchFn: FetchFn = tauriFetch
): Promise<OwnedGame[]> {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamId64)}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new SteamApiError(res.status, `GetOwnedGames failed: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.response?.games ?? []) as OwnedGame[];
}

export async function resolveVanityUrl(
  apiKey: string, vanity: string, fetchFn: FetchFn = tauriFetch
): Promise<string | null> {
  const url = `${BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}` +
    `&vanityurl=${encodeURIComponent(vanity)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new SteamApiError(res.status, `ResolveVanityURL failed: HTTP ${res.status}`);
  const body = await res.json();
  return body?.response?.success === 1 ? body.response.steamid : null;
}
