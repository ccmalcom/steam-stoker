import type { Game } from "../types";
import type { OwnedGame } from "./webapi";
import type { InstalledApp } from "./acf";
import { getDb } from "../db";
import { getSetting, setSetting, getLibraryPaths } from "../settings";
import { getOwnedGames } from "./webapi";
import { discoverLibraryPaths, scanInstalled, tauriFs } from "./scan";

export interface MergePlan { action: "insert" | "update" | "skip"; fields: Partial<Game>; }

export function planMerge(existing: Game | undefined, incoming: OwnedGame, now: number): MergePlan {
  const lastPlayed = incoming.rtime_last_played > 0 ? incoming.rtime_last_played : null;
  if (!existing) {
    return {
      action: "insert",
      fields: {
        steam_appid: incoming.appid, source: "steam", platform: "steam",
        title: incoming.name, playtime_minutes: incoming.playtime_forever,
        last_played_at: lastPlayed, added_at: now,
      },
    };
  }
  const changed =
    existing.title !== incoming.name ||
    existing.playtime_minutes !== incoming.playtime_forever ||
    existing.last_played_at !== lastPlayed;
  if (!changed) return { action: "skip", fields: {} };
  return {
    action: "update",
    fields: { title: incoming.name, playtime_minutes: incoming.playtime_forever, last_played_at: lastPlayed },
  };
}

export interface SyncResult { added: number; updated: number; installedMarked: number; }

export async function runFullSync(): Promise<SyncResult> {
  const apiKey = await getSetting("steam_api_key");
  const steamId = await getSetting("steam_id64");
  if (!apiKey || !steamId) throw new Error("Steam API key and SteamID64 must be set in Settings.");

  const db = await getDb();
  const owned = await getOwnedGames(apiKey, steamId);
  const now = Math.floor(Date.now() / 1000);
  let added = 0, updated = 0;

  for (const g of owned) {
    const rows = await db.select<Game[]>("SELECT * FROM games WHERE steam_appid = $1", [g.appid]);
    const plan = planMerge(rows[0], g, now);
    if (plan.action === "insert") {
      await db.execute(
        `INSERT INTO games (steam_appid, source, platform, title, playtime_minutes, last_played_at, added_at)
         VALUES ($1,'steam','steam',$2,$3,$4,$5)`,
        [g.appid, plan.fields.title, plan.fields.playtime_minutes, plan.fields.last_played_at, now]
      );
      added++;
    } else if (plan.action === "update") {
      const sets: string[] = []; const vals: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(plan.fields)) { sets.push(`${k} = $${i++}`); vals.push(v); }
      vals.push(rows[0].id);
      await db.execute(`UPDATE games SET ${sets.join(", ")} WHERE id = $${i}`, vals);
      updated++;
    }
  }

  // Install state: configured paths, else auto-discover.
  let paths = await getLibraryPaths();
  if (paths.length === 0) paths = await discoverLibraryPaths(tauriFs);
  const installedApps: InstalledApp[] = await scanInstalled(tauriFs, paths);
  await db.execute("UPDATE games SET installed = 0, install_size_bytes = NULL WHERE source = 'steam'");
  for (const app of installedApps) {
    await db.execute(
      "UPDATE games SET installed = 1, install_size_bytes = $1 WHERE steam_appid = $2",
      [app.sizeOnDisk, app.appid]
    );
  }

  await setSetting("last_sync_at", String(now));
  return { added, updated, installedMarked: installedApps.length };
}
