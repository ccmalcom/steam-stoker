# Stoker Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Tauri 2 Windows app that syncs the full Steam library via the Web API, detects installed games from local steamapps folders, lazily enriches games with genre/tag metadata, and shows it all in a minimal library grid.

**Architecture:** All business logic lives as pure TypeScript in `src/lib/` with injectable IO (fetch functions, file readers) so it unit-tests under Vitest without a Tauri runtime. Tauri plugins (sql, fs, http, opener) are thin adapters called from React. SQLite is the only store; schema created idempotently at startup.

**Tech Stack:** Tauri 2.x, React 18 + TypeScript 5 + Vite, @tauri-apps/plugin-sql (sqlite), @tauri-apps/plugin-fs, @tauri-apps/plugin-http, @tauri-apps/plugin-opener, Vitest.

## Global Constraints

- Windows 10/11 desktop target only. No mobile, no multi-user, no server.
- Spec: `docs/superpowers/specs/2026-07-08-stoker-mvp-design.md`. Locked decisions there override anything here.
- Sync is upsert-only and must NEVER overwrite `user_rating`, `user_review`, or `status` (spec locked decision; tested in Task 6).
- Steam store `appdetails` calls: minimum 1500 ms between requests.
- All external HTTP goes through an injectable `fetchFn` parameter defaulting to the Tauri http plugin's `fetch`.
- Every `src/lib/**` module gets Vitest coverage; UI components are verified manually via `npm run tauri dev`.
- DB file: `sqlite:stoker.db` (Tauri app data dir).

---

### Task 1: Scaffold Tauri 2 app with plugins and Vitest

**Files:**
- Create: entire app scaffold at repo root (`package.json`, `vite.config.ts`, `src/`, `src-tauri/`)
- Modify: `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `package.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: working `npm run tauri dev`, `npm test` (Vitest), all four plugins registered with capabilities

- [ ] **Step 1: Scaffold into the existing repo**

The repo root already contains `docs/`. Scaffold to a temp dir and move contents in:

```bash
cd C:\Users\chase\Documents\Code\coding-projects\stoker
npm create tauri-app@latest stoker-tmp -- --template react-ts --manager npm --yes
robocopy stoker-tmp . /E /MOVE /XD stoker-tmp
```

If `robocopy` exits with code 1–3 that is success (robocopy convention). Verify `package.json` and `src-tauri/` are at repo root, `stoker-tmp` is gone.

- [ ] **Step 2: Set product identity**

In `src-tauri/tauri.conf.json` set:

```json
{
  "productName": "Stoker",
  "identifier": "dev.chase.stoker"
}
```

(keep all other generated fields).

- [ ] **Step 3: Add the four plugins**

```bash
npm run tauri add sql
npm run tauri add fs
npm run tauri add http
npm run tauri add opener
```

Then in `src-tauri/Cargo.toml`, ensure the sql plugin has the sqlite feature:

```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

- [ ] **Step 4: Configure capabilities**

Replace `src-tauri/capabilities/default.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Stoker default window capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    { "identifier": "fs:allow-read-text-file", "allow": [{ "path": "**" }] },
    { "identifier": "fs:allow-read-dir", "allow": [{ "path": "**" }] },
    { "identifier": "fs:allow-exists", "allow": [{ "path": "**" }] },
    {
      "identifier": "http:default",
      "allow": [
        { "url": "https://api.steampowered.com/*" },
        { "url": "https://store.steampowered.com/*" },
        { "url": "https://api.rawg.io/*" },
        { "url": "https://api.anthropic.com/*" },
        { "url": "https://cdn.akamai.steamstatic.com/*" },
        { "url": "https://shared.akamai.steamstatic.com/*" }
      ]
    },
    { "identifier": "opener:allow-open-url", "allow": [{ "url": "steam://*" }] }
  ]
}
```

- [ ] **Step 5: Add Vitest**

```bash
npm install -D vitest
```

In `package.json` scripts add: `"test": "vitest run"`.

Create `src/lib/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

- [ ] **Step 6: Verify everything runs**

Run: `npm test` → Expected: 1 passed.
Run: `npm run tauri dev` → Expected: window opens with the template page. Close it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + React/TS app with sql/fs/http/opener plugins and vitest"
```

---

### Task 2: Types, schema, DB access, settings repo

**Files:**
- Create: `src/lib/types.ts`, `src/lib/schema.ts`, `src/lib/db.ts`, `src/lib/settings.ts`
- Test: `src/lib/schema.test.ts`
- Delete: `src/lib/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by every later task):

```ts
// types.ts
export type GameSource = "steam" | "manual";
export type GameStatus = "active" | "not_interested" | "finished" | "wont_run";
export type Platform = "steam" | "xbox" | "psn" | "epic" | "ea" | "other";
export interface Game {
  id: number;
  steam_appid: number | null;
  source: GameSource;
  platform: Platform;
  title: string;
  playtime_minutes: number;
  last_played_at: number | null; // unix seconds
  installed: number;             // sqlite bool 0/1
  install_size_bytes: number | null;
  user_rating: number | null;    // 1-5
  user_review: string | null;
  status: GameStatus;
  added_at: number;              // unix seconds
}
export interface GameMeta {
  game_id: number;
  genres: string;      // JSON string[]
  tags: string;        // JSON string[]
  description: string | null;
  header_image_url: string | null;
  release_date: string | null;
  metacritic: number | null;
}
// db.ts
export async function getDb(): Promise<Database>;        // singleton, runs initSchema once
// settings.ts
export async function getSetting(key: string): Promise<string | null>;
export async function setSetting(key: string, value: string): Promise<void>;
export async function getLibraryPaths(): Promise<string[]>;   // JSON key "library_paths"
export async function setLibraryPaths(paths: string[]): Promise<void>;
export const SETTINGS_KEYS: readonly string[];
```

- [ ] **Step 1: Write the failing test** — `src/lib/schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { SCHEMA_STATEMENTS } from "./schema";

describe("schema", () => {
  it("creates all five tables idempotently", () => {
    const sql = SCHEMA_STATEMENTS.join("\n");
    for (const table of ["games", "rating_events", "game_meta", "taste_profile", "recommendations", "settings"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("steam_appid INTEGER UNIQUE");
    expect(sql).toContain("CHECK (status IN ('active','not_interested','finished','wont_run'))");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/schema.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/types.ts` exactly as in Interfaces above, plus `src/lib/schema.ts`:

```ts
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    steam_appid INTEGER UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('steam','manual')),
    platform TEXT NOT NULL DEFAULT 'steam',
    title TEXT NOT NULL,
    playtime_minutes INTEGER NOT NULL DEFAULT 0,
    last_played_at INTEGER,
    installed INTEGER NOT NULL DEFAULT 0,
    install_size_bytes INTEGER,
    user_rating INTEGER,
    user_review TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','not_interested','finished','wont_run')),
    added_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rating_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id),
    rating INTEGER,
    review_text TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_meta (
    game_id INTEGER PRIMARY KEY REFERENCES games(id),
    genres TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    header_image_url TEXT,
    release_date TEXT,
    metacritic INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS taste_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generated_at INTEGER NOT NULL,
    profile_json TEXT NOT NULL,
    profile_text TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('backlog','mixed','discovery')),
    mood_prompt TEXT,
    results_json TEXT NOT NULL,
    feedback_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];
```

`src/lib/db.ts`:

```ts
import Database from "@tauri-apps/plugin-sql";
import { SCHEMA_STATEMENTS } from "./schema";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:stoker.db");
    for (const stmt of SCHEMA_STATEMENTS) await db.execute(stmt);
  }
  return db;
}
```

`src/lib/settings.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npm test` → Expected: schema test PASS. Delete `src/lib/smoke.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: sqlite schema, db singleton, settings repo"
```

---

### Task 3: VDF/ACF parser (pure, fixture-driven)

**Files:**
- Create: `src/lib/steam/acf.ts`, `src/lib/steam/fixtures/appmanifest_570.acf`, `src/lib/steam/fixtures/libraryfolders.vdf`
- Test: `src/lib/steam/acf.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:

```ts
export function parseVdf(text: string): Record<string, unknown>;   // nested object of the whole file
export interface InstalledApp { appid: number; name: string; sizeOnDisk: number; }
export function parseAppManifest(text: string): InstalledApp | null;
export function parseLibraryFolders(text: string): string[];       // library root paths
```

- [ ] **Step 1: Create fixtures**

`src/lib/steam/fixtures/appmanifest_570.acf`:

```
"AppState"
{
	"appid"		"570"
	"name"		"Dota 2"
	"StateFlags"		"4"
	"installdir"		"dota 2 beta"
	"SizeOnDisk"		"39098080858"
	"LastUpdated"		"1719430000"
}
```

`src/lib/steam/fixtures/libraryfolders.vdf`:

```
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"570"		"39098080858"
		}
	}
	"1"
	{
		"path"		"D:\\games"
		"apps"
		{
			"1086940"		"98707096678"
		}
	}
}
```

- [ ] **Step 2: Write the failing tests** — `src/lib/steam/acf.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVdf, parseAppManifest, parseLibraryFolders } from "./acf";

const fx = (f: string) => readFileSync(join(__dirname, "fixtures", f), "utf8");

describe("parseVdf", () => {
  it("parses nested keyvalues", () => {
    const o = parseVdf(fx("appmanifest_570.acf")) as any;
    expect(o.AppState.appid).toBe("570");
    expect(o.AppState.name).toBe("Dota 2");
  });
  it("returns {} for garbage input", () => {
    expect(parseVdf("not vdf at all")).toEqual({});
  });
});

describe("parseAppManifest", () => {
  it("extracts appid, name, size", () => {
    expect(parseAppManifest(fx("appmanifest_570.acf"))).toEqual({
      appid: 570, name: "Dota 2", sizeOnDisk: 39098080858,
    });
  });
  it("returns null when fields are missing", () => {
    expect(parseAppManifest('"AppState" { "foo" "bar" }')).toBeNull();
  });
});

describe("parseLibraryFolders", () => {
  it("extracts all library paths", () => {
    expect(parseLibraryFolders(fx("libraryfolders.vdf"))).toEqual([
      "C:\\Program Files (x86)\\Steam",
      "D:\\games",
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/steam/acf.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 4: Implement** — `src/lib/steam/acf.ts`

```ts
// Valve KeyValues (VDF) text format: quoted keys, quoted values or nested { } blocks.
type VdfObject = Record<string, unknown>;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[1] !== undefined ? m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"') : m[2]);
  }
  return tokens;
}

export function parseVdf(text: string): VdfObject {
  const tokens = tokenize(text);
  let i = 0;
  function parseBlock(): VdfObject {
    const obj: VdfObject = {};
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (tok === "}") return obj;
      if (tok === "{") continue; // stray brace; skip defensively
      const next = tokens[i];
      if (next === "{") { i++; obj[tok] = parseBlock(); }
      else if (next !== undefined && next !== "}") { i++; obj[tok] = next; }
    }
    return obj;
  }
  return parseBlock();
}

export interface InstalledApp { appid: number; name: string; sizeOnDisk: number; }

export function parseAppManifest(text: string): InstalledApp | null {
  const o = parseVdf(text) as any;
  const s = o?.AppState;
  if (!s?.appid || !s?.name) return null;
  return {
    appid: Number(s.appid),
    name: String(s.name),
    sizeOnDisk: Number(s.SizeOnDisk ?? 0),
  };
}

export function parseLibraryFolders(text: string): string[] {
  const o = parseVdf(text) as any;
  const root = o?.libraryfolders;
  if (!root) return [];
  const paths: string[] = [];
  for (const key of Object.keys(root)) {
    const entry = root[key];
    if (entry && typeof entry === "object" && typeof entry.path === "string") paths.push(entry.path);
  }
  return paths;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/steam/acf.test.ts` → Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/steam
git commit -m "feat: VDF/ACF parser for appmanifests and libraryfolders"
```

---

### Task 4: Library folder discovery + installed-games scan

**Files:**
- Create: `src/lib/steam/scan.ts`
- Test: `src/lib/steam/scan.test.ts`

**Interfaces:**
- Consumes: `parseAppManifest`, `parseLibraryFolders` from Task 3; `getLibraryPaths`/`setLibraryPaths` from Task 2
- Produces:

```ts
export interface FsAdapter {
  readTextFile(path: string): Promise<string>;
  readDir(path: string): Promise<{ name: string }[]>;
  exists(path: string): Promise<boolean>;
}
export const tauriFs: FsAdapter;                                     // wraps @tauri-apps/plugin-fs
export const DEFAULT_STEAM_ROOT = "C:\\Program Files (x86)\\Steam";
export async function discoverLibraryPaths(fs: FsAdapter, steamRoot?: string): Promise<string[]>;
export async function scanInstalled(fs: FsAdapter, libraryPaths: string[]): Promise<InstalledApp[]>;
```

- [ ] **Step 1: Write the failing tests** — `src/lib/steam/scan.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { discoverLibraryPaths, scanInstalled, type FsAdapter } from "./scan";

function fakeFs(files: Record<string, string>, dirs: Record<string, string[]>): FsAdapter {
  return {
    readTextFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    readDir: async (p) => (dirs[p] ?? []).map((name) => ({ name })),
    exists: async (p) => p in files || p in dirs,
  };
}

const LIBVDF = `"libraryfolders" { "0" { "path" "C:\\\\games" } "1" { "path" "D:\\\\games" } }`;
const ACF = (id: number, name: string) =>
  `"AppState" { "appid" "${id}" "name" "${name}" "SizeOnDisk" "1000" }`;

describe("discoverLibraryPaths", () => {
  it("reads libraryfolders.vdf under the steam root", async () => {
    const fs = fakeFs({ "C:\\Steam\\steamapps\\libraryfolders.vdf": LIBVDF }, {});
    expect(await discoverLibraryPaths(fs, "C:\\Steam")).toEqual(["C:\\games", "D:\\games"]);
  });
  it("returns [] when the file is missing", async () => {
    expect(await discoverLibraryPaths(fakeFs({}, {}), "C:\\Steam")).toEqual([]);
  });
});

describe("scanInstalled", () => {
  it("parses every appmanifest in every library's steamapps", async () => {
    const fs = fakeFs(
      {
        "C:\\games\\steamapps\\appmanifest_570.acf": ACF(570, "Dota 2"),
        "D:\\games\\steamapps\\appmanifest_1086940.acf": ACF(1086940, "Baldur's Gate 3"),
      },
      {
        "C:\\games\\steamapps": ["appmanifest_570.acf", "workshop"],
        "D:\\games\\steamapps": ["appmanifest_1086940.acf"],
      }
    );
    const apps = await scanInstalled(fs, ["C:\\games", "D:\\games"]);
    expect(apps.map((a) => a.appid).sort((a, b) => a - b)).toEqual([570, 1086940]);
  });
  it("skips unreadable/corrupt manifests without throwing", async () => {
    const fs = fakeFs(
      { "C:\\games\\steamapps\\appmanifest_1.acf": "garbage" },
      { "C:\\games\\steamapps": ["appmanifest_1.acf", "appmanifest_2.acf"] } // _2 unreadable
    );
    expect(await scanInstalled(fs, ["C:\\games"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/steam/scan.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/steam/scan.ts`

```ts
import { readTextFile, readDir, exists } from "@tauri-apps/plugin-fs";
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/steam/scan.test.ts` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/steam
git commit -m "feat: steam library discovery and installed-games scan"
```

---

### Task 5: Steam Web API client

**Files:**
- Create: `src/lib/steam/webapi.ts`
- Test: `src/lib/steam/webapi.test.ts`

**Interfaces:**
- Consumes: nothing (pure + injectable fetch)
- Produces:

```ts
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export interface OwnedGame { appid: number; name: string; playtime_forever: number; rtime_last_played: number; }
export async function getOwnedGames(apiKey: string, steamId64: string, fetchFn?: FetchFn): Promise<OwnedGame[]>;
export async function resolveVanityUrl(apiKey: string, vanity: string, fetchFn?: FetchFn): Promise<string | null>;
export class SteamApiError extends Error { constructor(public status: number, message: string); }
```

- [ ] **Step 1: Write the failing tests** — `src/lib/steam/webapi.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { getOwnedGames, resolveVanityUrl, SteamApiError } from "./webapi";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("getOwnedGames", () => {
  it("returns games and passes key/steamid in query", async () => {
    let seen = "";
    const games = await getOwnedGames("KEY", "76561198000000000", async (url) => {
      seen = url;
      return jsonResponse({ response: { game_count: 1, games: [
        { appid: 570, name: "Dota 2", playtime_forever: 12345, rtime_last_played: 1719000000 },
      ]}});
    });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ appid: 570, name: "Dota 2" });
    expect(seen).toContain("key=KEY");
    expect(seen).toContain("steamid=76561198000000000");
    expect(seen).toContain("include_appinfo=1");
  });
  it("returns [] when the response has no games (private profile)", async () => {
    expect(await getOwnedGames("K", "S", async () => jsonResponse({ response: {} }))).toEqual([]);
  });
  it("throws SteamApiError on HTTP failure", async () => {
    await expect(getOwnedGames("K", "S", async () => jsonResponse({}, 403)))
      .rejects.toBeInstanceOf(SteamApiError);
  });
});

describe("resolveVanityUrl", () => {
  it("returns steamid on success", async () => {
    const id = await resolveVanityUrl("K", "chase", async () =>
      jsonResponse({ response: { success: 1, steamid: "76561198000000000" } }));
    expect(id).toBe("76561198000000000");
  });
  it("returns null when no match", async () => {
    const id = await resolveVanityUrl("K", "nobody", async () =>
      jsonResponse({ response: { success: 42, message: "No match" } }));
    expect(id).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/steam/webapi.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/steam/webapi.ts`

```ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class SteamApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "SteamApiError"; }
}

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;   // minutes
  rtime_last_played: number;  // unix seconds, 0 = never
}

const BASE = "https://api.steampowered.com";

export async function getOwnedGames(
  apiKey: string, steamId64: string, fetchFn: FetchFn = tauriFetch
): Promise<OwnedGame[]> {
  const url = `${BASE}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}` +
    `&steamid=${encodeURIComponent(steamId64)}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new SteamApiError(res.status, `GetOwnedGames failed: HTTP ${res.status}`);
  const body = await res.json();
  return (body?.response?.games ?? []) as OwnedGame[];
}

export async function resolveVanityUrl(
  apiKey: string, vanity: string, fetchFn: FetchFn = tauriFetch
): Promise<string | null> {
  const url = `${BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}` +
    `&vanityurl=${encodeURIComponent(vanity)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new SteamApiError(res.status, `ResolveVanityURL failed: HTTP ${res.status}`);
  const body = await res.json();
  return body?.response?.success === 1 ? body.response.steamid : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/steam/webapi.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/steam
git commit -m "feat: steam web api client (GetOwnedGames, ResolveVanityURL)"
```

---

### Task 6: Sync merge logic + orchestration (the invariant task)

**Files:**
- Create: `src/lib/steam/sync.ts`
- Test: `src/lib/steam/sync.test.ts`

**Interfaces:**
- Consumes: `OwnedGame` (Task 5), `InstalledApp` (Task 3), `Game` (Task 2), `getDb`, `getSetting`/`setSetting`, `getLibraryPaths`, `scanInstalled`, `discoverLibraryPaths`, `tauriFs`, `getOwnedGames`
- Produces:

```ts
export interface MergePlan {
  action: "insert" | "update" | "skip";
  fields: Partial<Game>;   // ONLY sync-owned fields: title, playtime_minutes, last_played_at
}
export function planMerge(existing: Game | undefined, incoming: OwnedGame, now: number): MergePlan;
export interface SyncResult { added: number; updated: number; installedMarked: number; }
export async function runFullSync(): Promise<SyncResult>;   // webapi sync + install scan, updates last_sync_at
```

- [ ] **Step 1: Write the failing tests** — `src/lib/steam/sync.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { planMerge } from "./sync";
import type { Game } from "../types";

const NOW = 1751000000;
const incoming = { appid: 570, name: "Dota 2", playtime_forever: 500, rtime_last_played: 1750000000 };

const existing: Game = {
  id: 1, steam_appid: 570, source: "steam", platform: "steam", title: "Dota 2",
  playtime_minutes: 400, last_played_at: 1749000000, installed: 1, install_size_bytes: 1000,
  user_rating: 5, user_review: "the one true moba", status: "finished", added_at: 1700000000,
};

describe("planMerge", () => {
  it("inserts new games with sync-owned defaults", () => {
    const plan = planMerge(undefined, incoming, NOW);
    expect(plan.action).toBe("insert");
    expect(plan.fields).toMatchObject({
      steam_appid: 570, source: "steam", platform: "steam", title: "Dota 2",
      playtime_minutes: 500, last_played_at: 1750000000, added_at: NOW,
    });
  });
  it("updates ONLY title/playtime/last_played on existing games", () => {
    const plan = planMerge(existing, incoming, NOW);
    expect(plan.action).toBe("update");
    expect(Object.keys(plan.fields).sort()).toEqual(["last_played_at", "playtime_minutes", "title"]);
  });
  it("NEVER touches user_rating, user_review, or status", () => {
    const plan = planMerge(existing, incoming, NOW);
    expect(plan.fields).not.toHaveProperty("user_rating");
    expect(plan.fields).not.toHaveProperty("user_review");
    expect(plan.fields).not.toHaveProperty("status");
  });
  it("skips when nothing sync-owned changed", () => {
    const same = { ...incoming, playtime_forever: 400, rtime_last_played: 1749000000 };
    expect(planMerge(existing, same, NOW).action).toBe("skip");
  });
  it("treats rtime_last_played=0 as null", () => {
    const plan = planMerge(undefined, { ...incoming, rtime_last_played: 0 }, NOW);
    expect(plan.fields.last_played_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/steam/sync.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/steam/sync.ts`

```ts
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
  const fields: Partial<Game> = {};
  if (existing.title !== incoming.name) fields.title = incoming.name;
  if (existing.playtime_minutes !== incoming.playtime_forever) fields.playtime_minutes = incoming.playtime_forever;
  if (existing.last_played_at !== lastPlayed) fields.last_played_at = lastPlayed;
  return Object.keys(fields).length ? { action: "update", fields } : { action: "skip", fields: {} };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/steam/sync.test.ts` → Expected: 5 passed. Run `npm test` → all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/steam
git commit -m "feat: sync merge planning (rating/review/status never clobbered) and full sync orchestration"
```

---

### Task 7: Lazy enrichment via Steam store appdetails

**Files:**
- Create: `src/lib/steam/enrich.ts`
- Test: `src/lib/steam/enrich.test.ts`

**Interfaces:**
- Consumes: `FetchFn` (Task 5), `getDb` (Task 2)
- Produces:

```ts
export interface AppDetails {
  genres: string[]; tags: string[]; description: string | null;
  header_image_url: string | null; release_date: string | null; metacritic: number | null;
}
export function parseAppDetails(appid: number, body: unknown): AppDetails | null;  // pure
export async function fetchAppDetails(appid: number, fetchFn?: FetchFn): Promise<AppDetails | null>;
export async function enrichPending(opts?: { limit?: number; delayMs?: number; fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void> }): Promise<number>; // returns count enriched
```

- [ ] **Step 1: Write the failing tests** — `src/lib/steam/enrich.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseAppDetails } from "./enrich";

const BODY = {
  "570": {
    success: true,
    data: {
      short_description: "Every day, millions battle.",
      header_image: "https://cdn.akamai.steamstatic.com/steam/apps/570/header.jpg",
      genres: [{ id: "1", description: "Action" }, { id: "2", description: "Strategy" }],
      categories: [{ id: 1, description: "Multi-player" }, { id: 2, description: "Co-op" }],
      release_date: { coming_soon: false, date: "9 Jul, 2013" },
      metacritic: { score: 90 },
    },
  },
};

describe("parseAppDetails", () => {
  it("maps genres, categories-as-tags, description, image, release, metacritic", () => {
    const d = parseAppDetails(570, BODY)!;
    expect(d.genres).toEqual(["Action", "Strategy"]);
    expect(d.tags).toEqual(["Multi-player", "Co-op"]);
    expect(d.description).toBe("Every day, millions battle.");
    expect(d.metacritic).toBe(90);
    expect(d.release_date).toBe("9 Jul, 2013");
  });
  it("returns null when success is false (delisted app)", () => {
    expect(parseAppDetails(1, { "1": { success: false } })).toBeNull();
  });
  it("tolerates missing optional fields", () => {
    const d = parseAppDetails(2, { "2": { success: true, data: { genres: [] } } })!;
    expect(d).toMatchObject({ genres: [], tags: [], description: null, metacritic: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/steam/enrich.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/steam/enrich.ts`

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/steam/enrich.test.ts` → Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/steam
git commit -m "feat: lazy rate-limited appdetails enrichment with miss caching"
```

---

### Task 8: Minimal UI — settings form, sync button, library grid

**Files:**
- Create: `src/lib/games.ts`, `src/pages/SettingsPage.tsx`, `src/pages/LibraryPage.tsx`, `src/components/GameRow.tsx`
- Modify: `src/App.tsx`, `src/App.css`
- Test: `src/lib/games.test.ts` (query-builder logic only; pages verified manually)

**Interfaces:**
- Consumes: everything above
- Produces:

```ts
// src/lib/games.ts
export interface LibraryFilter { search?: string; installedOnly?: boolean; status?: GameStatus | "all"; sort: "playtime" | "title" | "last_played" | "rating"; }
export function buildLibraryQuery(f: LibraryFilter): { sql: string; params: unknown[] };
export async function listGames(f: LibraryFilter): Promise<(Game & { genres: string | null })[]>;
export async function launchGame(appid: number): Promise<void>;   // opener: steam://run/<appid>
```

- [ ] **Step 1: Write the failing test** — `src/lib/games.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildLibraryQuery } from "./games";

describe("buildLibraryQuery", () => {
  it("defaults to all games sorted by playtime desc", () => {
    const { sql, params } = buildLibraryQuery({ sort: "playtime" });
    expect(sql).toContain("ORDER BY g.playtime_minutes DESC");
    expect(params).toEqual([]);
  });
  it("applies search, installed and status filters with params", () => {
    const { sql, params } = buildLibraryQuery({ search: "dota", installedOnly: true, status: "active", sort: "title" });
    expect(sql).toContain("g.title LIKE");
    expect(sql).toContain("g.installed = 1");
    expect(sql).toContain("g.status = ");
    expect(params).toEqual(["%dota%", "active"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/games.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/games.ts`

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/games.test.ts` → Expected: 2 passed.

- [ ] **Step 5: Build the pages**

`src/pages/SettingsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getSetting, setSetting, getLibraryPaths, setLibraryPaths } from "../lib/settings";
import { runFullSync } from "../lib/steam/sync";
import { enrichPending } from "../lib/steam/enrich";
import { resolveVanityUrl } from "../lib/steam/webapi";

export default function SettingsPage() {
  const [steamKey, setSteamKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [vanity, setVanity] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      setSteamKey((await getSetting("steam_api_key")) ?? "");
      setSteamId((await getSetting("steam_id64")) ?? "");
      setPaths((await getLibraryPaths()).join("\n"));
    })();
  }, []);

  async function save() {
    await setSetting("steam_api_key", steamKey.trim());
    await setSetting("steam_id64", steamId.trim());
    await setLibraryPaths(paths.split("\n").map(p => p.trim()).filter(Boolean));
    setMsg("Saved.");
  }

  async function resolve() {
    const id = await resolveVanityUrl(steamKey.trim(), vanity.trim());
    if (id) { setSteamId(id); setMsg(`Resolved to ${id}`); } else setMsg("No match for that vanity URL.");
  }

  async function sync() {
    setBusy(true); setMsg("Syncing…");
    try {
      const r = await runFullSync();
      setMsg(`Synced: ${r.added} added, ${r.updated} updated, ${r.installedMarked} installed. Enriching…`);
      const n = await enrichPending();
      setMsg(m => m + ` ${n} enriched.`);
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      <label>Steam Web API key <a href="https://steamcommunity.com/dev/apikey" target="_blank">get one</a>
        <input type="password" value={steamKey} onChange={e => setSteamKey(e.target.value)} /></label>
      <label>SteamID64
        <input value={steamId} onChange={e => setSteamId(e.target.value)} /></label>
      <label>…or resolve from vanity URL name
        <span className="row"><input value={vanity} onChange={e => setVanity(e.target.value)} />
        <button onClick={resolve}>Resolve</button></span></label>
      <label>Steam library folders (one per line; leave empty to auto-discover)
        <textarea rows={3} value={paths} onChange={e => setPaths(e.target.value)} /></label>
      <div className="row">
        <button onClick={save}>Save</button>
        <button onClick={sync} disabled={busy}>Sync now</button>
      </div>
      <p>{msg}</p>
    </div>
  );
}
```

`src/components/GameRow.tsx`:

```tsx
import type { Game } from "../lib/types";
import { launchGame } from "../lib/games";

export default function GameRow({ game, genres }: { game: Game; genres: string | null }) {
  const hours = (game.playtime_minutes / 60).toFixed(1);
  return (
    <tr>
      <td>{game.title}</td>
      <td>{hours} h</td>
      <td>{game.installed ? "✔ installed" : ""}</td>
      <td>{game.user_rating ? "★".repeat(game.user_rating) : "—"}</td>
      <td>{genres ? (JSON.parse(genres) as string[]).join(", ") : ""}</td>
      <td>{game.installed && game.steam_appid
        ? <button onClick={() => launchGame(game.steam_appid!)}>Launch</button> : null}</td>
    </tr>
  );
}
```

`src/pages/LibraryPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listGames, type LibraryFilter } from "../lib/games";
import type { Game } from "../lib/types";
import GameRow from "../components/GameRow";

export default function LibraryPage() {
  const [filter, setFilter] = useState<LibraryFilter>({ sort: "playtime" });
  const [games, setGames] = useState<(Game & { genres: string | null })[]>([]);

  useEffect(() => { listGames(filter).then(setGames); }, [filter]);

  return (
    <div className="page">
      <h2>Library ({games.length})</h2>
      <div className="row">
        <input placeholder="Search…" onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
        <label><input type="checkbox"
          onChange={e => setFilter(f => ({ ...f, installedOnly: e.target.checked }))} /> installed only</label>
        <select onChange={e => setFilter(f => ({ ...f, sort: e.target.value as LibraryFilter["sort"] }))}>
          <option value="playtime">Most played</option>
          <option value="title">Title</option>
          <option value="last_played">Recently played</option>
          <option value="rating">Rating</option>
        </select>
      </div>
      {games.length === 0
        ? <p>No games yet — set your Steam key in Settings and hit Sync.</p>
        : <table><tbody>{games.map(g => <GameRow key={g.id} game={g} genres={g.genres} />)}</tbody></table>}
    </div>
  );
}
```

`src/App.tsx` (replace template content):

```tsx
import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import SettingsPage from "./pages/SettingsPage";
import "./App.css";

export default function App() {
  const [tab, setTab] = useState<"library" | "settings">("library");
  return (
    <main>
      <nav className="row">
        <button onClick={() => setTab("library")} disabled={tab === "library"}>Library</button>
        <button onClick={() => setTab("settings")} disabled={tab === "settings"}>Settings</button>
      </nav>
      {tab === "library" ? <LibraryPage /> : <SettingsPage />}
    </main>
  );
}
```

Append to `src/App.css`:

```css
.page { padding: 1rem; text-align: left; }
.page label { display: block; margin: .5rem 0; }
.page input, .page textarea { width: 100%; max-width: 480px; display: block; }
.row { display: flex; gap: .5rem; align-items: center; }
.page table { width: 100%; border-collapse: collapse; }
.page td { padding: .25rem .5rem; border-bottom: 1px solid #4443; }
```

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`. In Settings: paste real Steam key, resolve SteamID from vanity name, Save, Sync now. Expected: message reports added games and installed count; Library tab lists your games sorted by playtime with installed badges; Launch opens Steam for an installed game. Then run `npm test` → all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: minimal UI - settings, sync, library grid with launch"
```

---

## Plan 1 exit criteria

- `npm test` green (schema, acf, scan, webapi, sync, enrich, games suites).
- Real sync against Chase's account populates the library, marks installed games from `C:\games`/`D:\games`, enrichment fills genres over time, Launch works.
