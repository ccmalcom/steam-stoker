import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "../steam/webapi";

export interface SteamStoreHit { appid: number; name: string; priceCents: number | null; }

export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[™®©]/g, "").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

export async function resolveSteamApp(title: string, fetchFn: FetchFn = tauriFetch): Promise<SteamStoreHit | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const body = await res.json();
    const want = normalizeTitle(title);
    const toHit = (item: any): SteamStoreHit => (
      { appid: Number(item.id), name: String(item.name), priceCents: item.price?.final ?? null }
    );

    let best: { item: any; diff: number } | null = null;
    for (const item of body?.items ?? []) {
      const got = normalizeTitle(String(item.name));
      if (got === want) return toHit(item);
      if (got.startsWith(want) || want.startsWith(got)) {
        const diff = Math.abs(got.length - want.length);
        if (!best || diff < best.diff) best = { item, diff };
      }
    }
    return best ? toHit(best.item) : null;
  } catch (err) {
    console.error("resolveSteamApp failed:", err);
    return null;
  }
}
