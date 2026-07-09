import { getDb } from "./db";
import { getSetting } from "./settings";
import { rateGame } from "./ratings";
import { fetchAppDetails } from "./steam/enrich";
import { resolveSteamApp } from "./recommend/resolve";
import { rawgSearch } from "./recommend/rawg";
import type { Platform } from "./types";

export interface ManualGameInput {
  title: string; platform: Exclude<Platform, "steam">;
  playtimeHours: number; rating: number | null; review: string | null;
}

export function validateManualInput(input: ManualGameInput): string[] {
  const errs: string[] = [];
  if (!input.title.trim()) errs.push("title is required");
  if (input.playtimeHours < 0 || !Number.isFinite(input.playtimeHours)) errs.push("playtime must be >= 0");
  if (input.rating !== null && (input.rating < 0.5 || input.rating > 5 || !Number.isInteger(input.rating * 2)))
    errs.push("rating must be a half-step between 0.5 and 5");
  return errs;
}

/** Insert a non-Steam game; enrich best-effort via Steam store title search, RAWG fallback. */
export async function addManualGame(input: ManualGameInput): Promise<number> {
  const errs = validateManualInput(input);
  if (errs.length) throw new Error(errs.join("; "));
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = await db.execute(
    `INSERT INTO games (steam_appid, source, platform, title, playtime_minutes, added_at)
     VALUES (NULL,'manual',$1,$2,$3,$4)`,
    [input.platform, input.title.trim(), Math.round(input.playtimeHours * 60), now]);
  const gameId = res.lastInsertId as number;

  if (input.rating !== null || input.review) await rateGame(gameId, input.rating, input.review);

  // Best-effort enrichment: same game often exists on Steam; else RAWG; else leave bare.
  try {
    const hit = await resolveSteamApp(input.title.trim());
    let meta = hit ? await fetchAppDetails(hit.appid) : null;
    if (!meta) {
      const rawgKey = await getSetting("rawg_api_key");
      if (rawgKey) {
        const [r] = await rawgSearch(rawgKey, input.title.trim());
        if (r) meta = { genres: r.genres, tags: r.tags, description: null,
                        header_image_url: null, release_date: r.released, metacritic: r.metacritic };
      }
    }
    if (meta) await db.execute(
      `INSERT INTO game_meta (game_id, genres, tags, description, header_image_url, release_date, metacritic)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(game_id) DO NOTHING`,
      [gameId, JSON.stringify(meta.genres), JSON.stringify(meta.tags), meta.description,
       meta.header_image_url, meta.release_date, meta.metacritic]);
  } catch { /* enrichment is never fatal */ }
  return gameId;
}
