import { getDb } from "./db";

export const SETTINGS_KEYS = [
  "steam_api_key", "steam_id64", "anthropic_api_key", "rawg_api_key",
  "library_paths", "taste_notes", "last_sync_at", "onboarding_complete",
  "playtime_threshold_hours", "anthropic_model",
] as const;

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value]
  );
}

export async function getLibraryPaths(): Promise<string[]> {
  const raw = await getSetting("library_paths");
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function setLibraryPaths(paths: string[]): Promise<void> {
  await setSetting("library_paths", JSON.stringify(paths));
}
