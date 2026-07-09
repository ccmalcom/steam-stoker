import { readTextFile, readDir, exists } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { parseAppManifest, parseLibraryFolders, type InstalledApp } from "./acf";

export interface FsAdapter {
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<{ name: string }[]>;
  exists(path: string): Promise<boolean>;
}

export const tauriFs: FsAdapter = {
  readTextFile: (p) => readTextFile(p),
  readDir: async (p) => (await readDir(p)).map((e) => ({ name: e.name ?? "" })),
  exists: (p) => exists(p),
};

export const DEFAULT_STEAM_ROOT = "C:\\Program Files (x86)\\Steam";

/** Steam's install dir from the OS registry (via the `steam_path` Rust command),
 *  normalized to backslashes; null when unknown. Falls back to DEFAULT_STEAM_ROOT at the call site. */
export async function detectSteamRoot(): Promise<string | null> {
  try {
    const p = await invoke<string | null>("steam_path");
    if (!p || !p.trim()) return null;
    return p.replace(/\//g, "\\").replace(/\\+$/, "");
  } catch { return null; }
}

export async function discoverLibraryPaths(fs: FsAdapter, steamRoot = DEFAULT_STEAM_ROOT): Promise<string[]> {
  try {
    const text = await fs.readTextFile(`${steamRoot}\\steamapps\\libraryfolders.vdf`);
    return parseLibraryFolders(text);
  } catch {
    return [];
  }
}

export async function scanInstalled(fs: FsAdapter, libraryPaths: string[]): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  for (const lib of libraryPaths) {
    const steamapps = `${lib}\\steamapps`;
    let entries: { name: string }[] = [];
    try { entries = await fs.readDir(steamapps); } catch { continue; }
    for (const e of entries) {
      if (!/^appmanifest_\d+\.acf$/.test(e.name)) continue;
      try {
        const parsed = parseAppManifest(await fs.readTextFile(`${steamapps}\\${e.name}`));
        if (parsed) apps.push(parsed);
      } catch { /* unreadable manifest: skip, non-fatal per spec */ }
    }
  }
  return apps;
}
