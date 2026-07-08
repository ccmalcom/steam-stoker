import { openUrl } from "@tauri-apps/plugin-opener";
import { getDb } from "./db";
import type { Game, GameStatus } from "./types";

export interface LibraryFilter {
  search?: string; installedOnly?: boolean; status?: GameStatus | "all";
  sort: "playtime" | "title" | "last_played" | "rating";
}

const SORTS: Record<LibraryFilter["sort"], string> = {
  playtime: "g.playtime_minutes DESC",
  title: "g.title COLLATE NOCASE ASC",
  last_played: "g.last_played_at DESC NULLS LAST",
  rating: "g.user_rating DESC NULLS LAST",
};

export function buildLibraryQuery(f: LibraryFilter): { sql: string; params: unknown[] } {
  const where: string[] = []; const params: unknown[] = []; let i = 1;
  if (f.search) { where.push(`g.title LIKE $${i++}`); params.push(`%${f.search}%`); }
  if (f.installedOnly) where.push("g.installed = 1");
  if (f.status && f.status !== "all") { where.push(`g.status = $${i++}`); params.push(f.status); }
  const sql =
    `SELECT g.*, m.genres FROM games g LEFT JOIN game_meta m ON m.game_id = g.id` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ${SORTS[f.sort]}`;
  return { sql, params };
}

export async function listGames(f: LibraryFilter): Promise<(Game & { genres: string | null })[]> {
  const db = await getDb();
  const { sql, params } = buildLibraryQuery(f);
  return db.select(sql, params);
}

export async function launchGame(appid: number): Promise<void> {
  await openUrl(`steam://run/${appid}`);
}
