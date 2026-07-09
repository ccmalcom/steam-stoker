import { getDb } from "./db";
import type { GameStatus } from "./types";

export function validateRating(rating: number | null): void {
  if (rating === null) return;
  // Half-step ratings 0.5–5. `rating * 2` is an exact integer for valid halves
  // (0.5, 1, 1.5, …, 5) since halves are representable in binary floating point.
  if (rating < 0.5 || rating > 5 || !Number.isInteger(rating * 2))
    throw new RangeError(`rating must be null or a half-step between 0.5 and 5, got ${rating}`);
}

/** Append-only history + current-value mirror, single call path (spec: rating_events). */
export async function rateGame(gameId: number, rating: number | null, reviewText?: string | null): Promise<void> {
  validateRating(rating);
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    "INSERT INTO rating_events (game_id, rating, review_text, created_at) VALUES ($1,$2,$3,$4)",
    [gameId, rating, reviewText ?? null, now]
  );
  if (reviewText === undefined) {
    await db.execute("UPDATE games SET user_rating = $1 WHERE id = $2", [rating, gameId]);
  } else {
    await db.execute("UPDATE games SET user_rating = $1, user_review = $2 WHERE id = $3", [rating, reviewText, gameId]);
  }
}

export async function setGameStatus(gameId: number, status: GameStatus): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE games SET status = $1 WHERE id = $2", [status, gameId]);
}

export async function ratingHistory(gameId: number) {
  const db = await getDb();
  return db.select<{ rating: number | null; review_text: string | null; created_at: number }[]>(
    "SELECT rating, review_text, created_at FROM rating_events WHERE game_id = $1 ORDER BY created_at DESC",
    [gameId]
  );
}
