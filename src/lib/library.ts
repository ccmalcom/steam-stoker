import { getDb } from "./db";
import type { Game } from "./types";
import type { GameWithMeta } from "./profile/signals";

// Shared by profile/store.ts (Task 3) and the recommender's library loader (Task 8) —
// both need the exact same games+meta join and GameWithMeta shape, so it lives here once.
export async function loadLibraryWithMeta(): Promise<GameWithMeta[]> {
  const db = await getDb();
  const rows = await db.select<(Game & { genres: string | null; tags: string | null })[]>(
    "SELECT g.*, m.genres, m.tags FROM games g LEFT JOIN game_meta m ON m.game_id = g.id");
  return rows.map(r => ({
    game: r as Game,
    genres: r.genres ? JSON.parse(r.genres) : [],
    tags: r.tags ? JSON.parse(r.tags) : [],
  }));
}
