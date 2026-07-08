import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "../steam/webapi";

export interface RawgGame {
  name: string; released: string | null; genres: string[]; tags: string[]; metacritic: number | null;
}

const BASE = "https://api.rawg.io/api/games";

function mapResults(body: any): RawgGame[] {
  return (body?.results ?? []).map((r: any) => ({
    name: String(r.name),
    released: r.released ?? null,
    genres: (r.genres ?? []).map((g: any) => String(g.name)),
    tags: (r.tags ?? []).slice(0, 10).map((t: any) => String(t.name)),
    metacritic: r.metacritic ?? null,
  }));
}

export async function rawgSearch(key: string, query: string, fetchFn: FetchFn = tauriFetch): Promise<RawgGame[]> {
  try {
    const res = await fetchFn(`${BASE}?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=10`);
    if (!res.ok) return [];
    return mapResults(await res.json());
  } catch (err) {
    console.error("rawgSearch failed:", err);
    return [];
  }
}

export async function rawgByGenre(
  key: string,
  opts: { genres?: string[]; fromDate?: string; toDate?: string; ordering?: string },
  fetchFn: FetchFn = tauriFetch
): Promise<RawgGame[]> {
  let url = `${BASE}?key=${encodeURIComponent(key)}&page_size=20`;
  if (opts.genres?.length) url += `&genres=${opts.genres.join(",")}`;
  if (opts.fromDate && opts.toDate) url += `&dates=${opts.fromDate},${opts.toDate}`;
  if (opts.ordering) url += `&ordering=${opts.ordering}`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return [];
    return mapResults(await res.json());
  } catch (err) {
    console.error("rawgByGenre failed:", err);
    return [];
  }
}
