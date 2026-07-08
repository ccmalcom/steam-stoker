import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "./webapi";
import { getDb } from "../db";

export interface AppDetails {
  genres: string[]; tags: string[]; description: string | null;
  header_image_url: string | null; release_date: string | null; metacritic: number | null;
}

export function parseAppDetails(appid: number, body: unknown): AppDetails | null {
  const entry = (body as any)?.[String(appid)];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  return {
    genres: (d.genres ?? []).map((g: any) => String(g.description)),
    tags: (d.categories ?? []).map((c: any) => String(c.description)),
    description: d.short_description ?? null,
    header_image_url: d.header_image ?? null,
    release_date: d.release_date?.date ?? null,
    metacritic: d.metacritic?.score ?? null,
  };
}

export async function fetchAppDetails(appid: number, fetchFn: FetchFn = tauriFetch): Promise<AppDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=US&l=english`;
  const res = await fetchFn(url);
  if (!res.ok) return null; // enrichment is best-effort; never fatal
  return parseAppDetails(appid, await res.json());
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Enrich games that have no game_meta row yet. Rate-limited: >=1500ms between store calls. */
export async function enrichPending(opts: {
  limit?: number; delayMs?: number; fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void>;
} = {}): Promise<number> {
  const { limit = 25, delayMs = 1500, fetchFn = tauriFetch, sleepFn = sleep } = opts;
  const db = await getDb();
  const pending = await db.select<{ id: number; steam_appid: number }[]>(
    `SELECT g.id, g.steam_appid FROM games g
     LEFT JOIN game_meta m ON m.game_id = g.id
     WHERE m.game_id IS NULL AND g.steam_appid IS NOT NULL
     LIMIT $1`, [limit]
  );
  let enriched = 0;
  for (const row of pending) {
    const details = await fetchAppDetails(row.steam_appid, fetchFn);
    if (details) {
      await db.execute(
        `INSERT INTO game_meta (game_id, genres, tags, description, header_image_url, release_date, metacritic)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(game_id) DO UPDATE SET genres=$2, tags=$3, description=$4, header_image_url=$5, release_date=$6, metacritic=$7`,
        [row.id, JSON.stringify(details.genres), JSON.stringify(details.tags),
         details.description, details.header_image_url, details.release_date, details.metacritic]
      );
      enriched++;
    } else {
      // Cache the miss so we don't retry delisted apps forever.
      await db.execute(
        `INSERT INTO game_meta (game_id) VALUES ($1) ON CONFLICT(game_id) DO NOTHING`, [row.id]
      );
    }
    await sleepFn(delayMs);
  }
  return enriched;
}
