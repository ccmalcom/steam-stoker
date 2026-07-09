import { getDb } from "./db";

export const SETTINGS_KEYS = [
  "steam_api_key", "steam_id64", "anthropic_api_key", "rawg_api_key",
  "library_paths", "taste_notes", "last_sync_at", "onboarding_complete",
  "playtime_threshold_hours", "anthropic_model", "theme",
] as const;

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : null;
}

/**
 * Read a setting, treating empty/whitespace-only as unset (→ undefined).
 * Use this instead of `getSetting(k) ?? default` for any setting with a meaningful
 * default: the settings UI stores blank fields as "", which `??` does NOT catch.
 */
export async function getOptionalSetting(key: string): Promise<string | undefined> {
  const v = (await getSetting(key))?.trim();
  return v ? v : undefined;
}

/**
 * Read a numeric setting, falling back when unset/empty/non-numeric (and, when
 * `requirePositive`, on values ≤ 0). Guards the empty-string trap for number settings.
 */
export async function getNumberSetting(key: string, fallback: number, requirePositive = false): Promise<number> {
  const raw = (await getSetting(key))?.trim();
  if (!raw) return fallback;   // missing/empty/whitespace — Number("") is 0, so guard before parsing
  const n = Number(raw);
  if (!Number.isFinite(n) || (requirePositive && n <= 0)) return fallback;
  return n;
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
