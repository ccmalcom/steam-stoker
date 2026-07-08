# Stoker Plan 3: Onboarding & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-run onboarding wizard (key setup → sync → rating sprint → first rec), manual add for non-Steam games, the taste-profile page, full settings with tunables, and error/empty-state polish.

**Architecture:** Pure additions on Plans 1–2. The wizard is a state machine component gated by the `onboarding_complete` setting. Manual add writes `source='manual'` games and enriches via Steam-store title search with RAWG fallback. No new external services.

**Tech Stack:** As Plans 1–2.

## Global Constraints

- All Plan 1 and Plan 2 global constraints apply. Plans 1–2 must be complete first.
- Spec: `docs/superpowers/specs/2026-07-08-stoker-mvp-design.md`.
- Rating sprint: top ~20 by playtime, star-tap fast, review optional, skippable; plus optional "games you bounced off" pass (spec UX §1).
- Manual-add fields (spec, locked in brainstorming): title, platform, playtime estimate, rating, review — with catalog title-search auto-enrich.
- Taste notes are the top signal tier; editing them must regenerate the profile.

---

### Task 1: Manual add (logic + form)

**Files:**
- Create: `src/lib/manual.ts`, `src/components/ManualAddForm.tsx`
- Modify: `src/pages/LibraryPage.tsx` (render the form behind an "Add game" button)
- Test: `src/lib/manual.test.ts`

**Interfaces:**
- Consumes: `getDb`, `rateGame` (Plan 2 Task 1), `fetchAppDetails` (Plan 1 Task 7), `resolveSteamApp` (Plan 2 Task 6), `rawgSearch` (Plan 2 Task 6), `getSetting`, `Platform`
- Produces:

```ts
export interface ManualGameInput {
  title: string; platform: Exclude<Platform, "steam">;
  playtimeHours: number; rating: number | null; review: string | null;
}
export function validateManualInput(input: ManualGameInput): string[];  // [] = valid, else messages
export async function addManualGame(input: ManualGameInput): Promise<number>; // game id; enriches best-effort; appends rating_event when rating present
```

- [ ] **Step 1: Write the failing tests** — `src/lib/manual.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateManualInput } from "./manual";

const good = { title: "Halo Infinite", platform: "xbox" as const, playtimeHours: 30, rating: 4, review: null };

describe("validateManualInput", () => {
  it("accepts a valid input", () => expect(validateManualInput(good)).toEqual([]));
  it("requires a non-empty title", () =>
    expect(validateManualInput({ ...good, title: "  " })).toContain("title is required"));
  it("rejects negative playtime", () =>
    expect(validateManualInput({ ...good, playtimeHours: -1 })).toContain("playtime must be >= 0"));
  it("rejects out-of-range rating", () =>
    expect(validateManualInput({ ...good, rating: 7 })).toContain("rating must be 1-5"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/manual.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/manual.ts`

```ts
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
  if (input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5))
    errs.push("rating must be 1-5");
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
```

- [ ] **Step 4: Run tests, build the form**

Run: `npx vitest run src/lib/manual.test.ts` → Expected: 4 passed.

`src/components/ManualAddForm.tsx`:

```tsx
import { useState } from "react";
import { addManualGame, validateManualInput, type ManualGameInput } from "../lib/manual";

export default function ManualAddForm({ onAdded }: { onAdded: () => void }) {
  const [input, setInput] = useState<ManualGameInput>({
    title: "", platform: "xbox", playtimeHours: 0, rating: null, review: null });
  const [msg, setMsg] = useState("");

  async function submit() {
    const errs = validateManualInput(input);
    if (errs.length) { setMsg(errs.join("; ")); return; }
    await addManualGame(input);
    setMsg(`Added "${input.title}".`);
    setInput({ title: "", platform: input.platform, playtimeHours: 0, rating: null, review: null });
    onAdded();
  }

  return (
    <div className="card">
      <strong>Add a non-Steam game</strong>
      <div className="row">
        <input placeholder="Title" value={input.title}
          onChange={e => setInput({ ...input, title: e.target.value })} style={{ flex: 2 }} />
        <select value={input.platform}
          onChange={e => setInput({ ...input, platform: e.target.value as ManualGameInput["platform"] })}>
          {["xbox", "psn", "epic", "ea", "other"].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="number" min={0} placeholder="Hours" value={input.playtimeHours || ""}
          onChange={e => setInput({ ...input, playtimeHours: Number(e.target.value) })} style={{ width: "5rem" }} />
        <select value={input.rating ?? ""} onChange={e =>
          setInput({ ...input, rating: e.target.value ? Number(e.target.value) : null })}>
          <option value="">no rating</option>
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{"★".repeat(n)}</option>)}
        </select>
      </div>
      <textarea placeholder="Review (optional)" rows={2} value={input.review ?? ""}
        onChange={e => setInput({ ...input, review: e.target.value || null })} />
      <div className="row"><button onClick={submit}>Add</button><span>{msg}</span></div>
    </div>
  );
}
```

In `src/pages/LibraryPage.tsx`: add `const [showAdd, setShowAdd] = useState(false);`, an "Add game" toggle button in the filter row, and `{showAdd && <ManualAddForm onAdded={reload} />}` above the table.

- [ ] **Step 5: Manual verification + commit**

`npm run tauri dev`: add an Xbox game with rating; verify it appears with platform tag, gets genres if title matched, and shows in the profile's loved list after regenerate. Then:

```bash
git add -A
git commit -m "feat: manual add for non-steam games with best-effort enrichment"
```

---

### Task 2: Taste profile page

**Files:**
- Create: `src/pages/ProfilePage.tsx`
- Modify: `src/App.tsx` (add Profile tab)

**Interfaces:**
- Consumes: `currentProfile`, `profileHistory`, `regenerateProfile` (Plan 2 Task 3), `getSetting`/`setSetting` (Plan 1 Task 2)
- Produces: the Profile screen.

- [ ] **Step 1: Build the page** — `src/pages/ProfilePage.tsx`

```tsx
import { useEffect, useState } from "react";
import { currentProfile, profileHistory, regenerateProfile, type StoredProfile } from "../lib/profile/store";
import { getSetting, setSetting } from "../lib/settings";

export default function ProfilePage() {
  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [history, setHistory] = useState<StoredProfile[]>([]);
  const [notes, setNotes] = useState("");
  const [viewing, setViewing] = useState<StoredProfile | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setProfile(await currentProfile());
    setHistory(await profileHistory());
    setNotes((await getSetting("taste_notes")) ?? "");
  }
  useEffect(() => { load(); }, []);

  async function saveNotes() {
    await setSetting("taste_notes", notes);
    await regenerateProfile("manual");   // notes are top-tier signal; must take effect immediately
    await load();
    setMsg("Notes saved, profile regenerated.");
  }
  async function regen() { await regenerateProfile("manual"); await load(); setMsg("Regenerated."); }

  const shown = viewing ?? profile;
  const when = (t: number) => new Date(t * 1000).toLocaleString();

  return (
    <div className="page">
      <h2>Taste profile</h2>
      <label>Your own words (highest-priority signal):
        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder='e.g. "Done with roguelikes. Prefer controller-friendly. Love a good story."' /></label>
      <div className="row"><button onClick={saveNotes}>Save notes</button>
        <button onClick={regen}>Regenerate profile</button><span>{msg}</span></div>
      {shown ? <>
        <h3>{viewing ? `Version from ${when(shown.generated_at)}` : `Current (${when(shown.generated_at)}, trigger: ${shown.trigger_reason})`}
          {viewing && <button onClick={() => setViewing(null)}> back to current</button>}</h3>
        <pre className="profile-text">{shown.profile_text}</pre>
      </> : <p>No profile yet — sync your library first.</p>}
      <h3>History</h3>
      <ul>{history.map(h =>
        <li key={h.id}><a onClick={() => setViewing(h)} style={{ cursor: "pointer" }}>
          {when(h.generated_at)} — {h.trigger_reason}</a></li>)}</ul>
    </div>
  );
}
```

Append to `src/App.css`: `.profile-text { white-space: pre-wrap; background: #4441; padding: 1rem; border-radius: 8px; }`

In `src/App.tsx`: extend the tab union to `"recommend" | "library" | "profile" | "settings"` and add the Profile button/render.

- [ ] **Step 2: Manual verification + commit**

`npm run tauri dev`: edit notes → save → verify the rendered profile text starts with your words; click an older version; regenerate. Then:

```bash
git add -A
git commit -m "feat: taste profile page with notes, history, regenerate"
```

---

### Task 3: Onboarding wizard with rating sprint

**Files:**
- Create: `src/pages/OnboardingWizard.tsx`, `src/components/RatingSprint.tsx`, `src/lib/onboarding.ts`
- Modify: `src/App.tsx` (gate on `onboarding_complete`)
- Test: `src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting`, `resolveVanityUrl`, `discoverLibraryPaths`, `tauriFs`, `runFullSync`, `enrichPending`, `rateGame`, `regenerateProfile`, `listGames`, `runRecommendation`
- Produces:

```ts
// src/lib/onboarding.ts
export type WizardStep = "welcome" | "steam_key" | "steam_id" | "folders" | "sync" | "sprint" | "bounced" | "done";
export const STEP_ORDER: WizardStep[];
export function nextStep(current: WizardStep): WizardStep;
export async function isOnboardingComplete(): Promise<boolean>;
export async function completeOnboarding(): Promise<void>;
export async function sprintGames(limit?: number): Promise<Game[]>;  // top by playtime, unrated, active
```

- [ ] **Step 1: Write the failing tests** — `src/lib/onboarding.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { STEP_ORDER, nextStep } from "./onboarding";

describe("wizard steps", () => {
  it("walks welcome→steam_key→steam_id→folders→sync→sprint→bounced→done", () => {
    expect(STEP_ORDER).toEqual(["welcome", "steam_key", "steam_id", "folders", "sync", "sprint", "bounced", "done"]);
    expect(nextStep("welcome")).toBe("steam_key");
    expect(nextStep("bounced")).toBe("done");
    expect(nextStep("done")).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/onboarding.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/onboarding.ts`

```ts
import { getDb } from "./db";
import { getSetting, setSetting } from "./settings";
import type { Game } from "./types";

export type WizardStep = "welcome" | "steam_key" | "steam_id" | "folders" | "sync" | "sprint" | "bounced" | "done";
export const STEP_ORDER: WizardStep[] = ["welcome", "steam_key", "steam_id", "folders", "sync", "sprint", "bounced", "done"];

export function nextStep(current: WizardStep): WizardStep {
  const i = STEP_ORDER.indexOf(current);
  return STEP_ORDER[Math.min(i + 1, STEP_ORDER.length - 1)];
}

export async function isOnboardingComplete(): Promise<boolean> {
  return (await getSetting("onboarding_complete")) === "1";
}
export async function completeOnboarding(): Promise<void> { await setSetting("onboarding_complete", "1"); }

export async function sprintGames(limit = 20): Promise<Game[]> {
  const db = await getDb();
  return db.select<Game[]>(
    `SELECT * FROM games WHERE user_rating IS NULL AND status = 'active'
     ORDER BY playtime_minutes DESC LIMIT $1`, [limit]);
}
```

- [ ] **Step 4: Run test, build the sprint component**

Run: `npx vitest run src/lib/onboarding.test.ts` → Expected: PASS.

`src/components/RatingSprint.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Game } from "../lib/types";
import { rateGame } from "../lib/ratings";
import { sprintGames } from "../lib/onboarding";
import { listGames } from "../lib/games";

/** mode "top": top-playtime unrated. mode "search": find games you bounced off. */
export default function RatingSprint({ mode, onDone }: { mode: "top" | "search"; onDone: () => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [search, setSearch] = useState("");
  const [rated, setRated] = useState<Map<number, number>>(new Map()); // game id → rating just given

  useEffect(() => {
    if (mode === "top") sprintGames().then(setGames);
  }, [mode]);
  useEffect(() => {
    if (mode === "search" && search.length >= 2)
      listGames({ search, sort: "playtime" }).then(g => setGames(g.slice(0, 10)));
  }, [mode, search]);

  async function rate(g: Game, n: number) {
    await rateGame(g.id, n);
    setRated(prev => new Map(prev).set(g.id, n));
  }

  return (
    <div>
      {mode === "top"
        ? <p>Quick pass: rate your most-played games. Playtime says you liked these — correct it where it's wrong (burnout counts!). Skip any you're unsure about.</p>
        : <><p>Any games you bounced off or disliked? Rating a few 1–2★ teaches Stoker what to avoid.</p>
            <input placeholder="Search your library…" value={search} onChange={e => setSearch(e.target.value)} /></>}
      <table><tbody>
        {games.map(g => <tr key={g.id} className={rated.has(g.id) ? "muted" : ""}>
          <td>{g.title}</td><td>{(g.playtime_minutes / 60).toFixed(0)} h</td>
          <td>{[1, 2, 3, 4, 5].map(n =>
            <span key={n} className="star" onClick={() => rate(g, n)}>
              {n <= (rated.get(g.id) ?? 0) ? "★" : "☆"}</span>)}</td>
        </tr>)}
      </tbody></table>
      <button onClick={onDone}>{rated.size ? `Done (${rated.size} rated)` : "Skip"}</button>
    </div>
  );
}
```

- [ ] **Step 5: Build the wizard** — `src/pages/OnboardingWizard.tsx`

```tsx
import { useState } from "react";
import { type WizardStep, nextStep, completeOnboarding } from "../lib/onboarding";
import { getSetting, setSetting, getLibraryPaths, setLibraryPaths } from "../lib/settings";
import { resolveVanityUrl } from "../lib/steam/webapi";
import { discoverLibraryPaths, tauriFs } from "../lib/steam/scan";
import { runFullSync } from "../lib/steam/sync";
import { enrichPending } from "../lib/steam/enrich";
import { regenerateProfile } from "../lib/profile/store";
import RatingSprint from "../components/RatingSprint";

export default function OnboardingWizard({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [key, setKey] = useState("");
  const [idInput, setIdInput] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const advance = () => setStep(nextStep(step));

  async function saveKey() { await setSetting("steam_api_key", key.trim()); advance(); }

  async function saveId() {
    let id = idInput.trim();
    if (!/^\d{17}$/.test(id)) {
      const resolved = await resolveVanityUrl((await getSetting("steam_api_key"))!, id);
      if (!resolved) { setStatus("Couldn't resolve that — paste your 17-digit SteamID64 or vanity name."); return; }
      id = resolved;
    }
    await setSetting("steam_id64", id); setStatus(""); advance();
  }

  async function confirmFolders() {
    if (paths.length === 0) setPaths(await discoverLibraryPaths(tauriFs)); // first click discovers
    else { await setLibraryPaths(paths); advance(); }
  }

  async function doSync() {
    setStatus("Syncing your Steam library…");
    const r = await runFullSync();
    setStatus(`${r.added} games imported. Fetching genre data (this continues in background)…`);
    enrichPending({ limit: 200 });   // deliberately not awaited: lazy per spec
    advance();
  }

  async function finish() {
    setStatus("Building your taste profile…");
    await regenerateProfile("manual");
    await completeOnboarding();
    onFinished();
  }

  return (
    <div className="page">
      <h2>Welcome to Stoker</h2>
      {step === "welcome" && <><p>Stoker keeps you fueled with the next game — from your backlog or beyond. Setup takes ~3 minutes.</p>
        <button onClick={advance}>Start</button></>}
      {step === "steam_key" && <><p>1/5 — Paste your Steam Web API key.
        <a href="https://steamcommunity.com/dev/apikey" target="_blank"> Get one here</a> (any domain value works, e.g. "localhost").</p>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} />
        <button onClick={saveKey} disabled={!key.trim()}>Next</button></>}
      {step === "steam_id" && <><p>2/5 — Your SteamID64 or custom profile (vanity) name.</p>
        <input value={idInput} onChange={e => setIdInput(e.target.value)} placeholder="7656119… or chasesteamname" />
        <button onClick={saveId} disabled={!idInput.trim()}>Next</button></>}
      {step === "folders" && <><p>3/5 — Steam library folders {paths.length ? "(edit if wrong)" : "(click to auto-discover)"}:</p>
        <textarea rows={3} value={paths.join("\n")}
          onChange={e => setPaths(e.target.value.split("\n").map(p => p.trim()).filter(Boolean))} />
        <button onClick={confirmFolders}>{paths.length ? "Next" : "Discover"}</button></>}
      {step === "sync" && <><p>4/5 — Import your library.</p>
        <button onClick={doSync}>Sync now</button></>}
      {step === "sprint" && <><h3>5/5 — Teach Stoker your taste</h3>
        <RatingSprint mode="top" onDone={advance} /></>}
      {step === "bounced" && <RatingSprint mode="search" onDone={advance} />}
      {step === "done" && <><p>All set. Your taste profile is built from {`{playtime + your ratings}`} — head to Recommendations.</p>
        <button onClick={finish}>Open Stoker</button></>}
      <p>{status}</p>
    </div>
  );
}
```

- [ ] **Step 6: Gate the app** — in `src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { isOnboardingComplete } from "./lib/onboarding";
import OnboardingWizard from "./pages/OnboardingWizard";
// …existing page imports…

export default function App() {
  const [tab, setTab] = useState<"recommend" | "library" | "profile" | "settings">("recommend");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => { isOnboardingComplete().then(setOnboarded); }, []);

  if (onboarded === null) return null;
  if (!onboarded) return <OnboardingWizard onFinished={() => setOnboarded(true)} />;
  return (/* existing tab nav + pages */);
}
```

- [ ] **Step 7: Manual verification + commit**

Delete the app's DB file (or set `onboarding_complete` to 0) and run `npm run tauri dev`: walk the whole wizard with real credentials, rate a few in the sprint, search for a disliked game in the bounced pass, land on Recommendations. `npm test` → green. Then:

```bash
git add -A
git commit -m "feat: onboarding wizard with rating sprint and bounced-games pass"
```

---

### Task 4: Settings completion + auto-sync on launch + polish

**Files:**
- Modify: `src/pages/SettingsPage.tsx`, `src/App.tsx`, `src/App.css`

**Interfaces:**
- Consumes: everything existing. No new exports.

- [ ] **Step 1: Complete the settings page**

Add to `src/pages/SettingsPage.tsx` (same patterns as existing fields):
- Anthropic API key (password input, settings key `anthropic_api_key`) with model field (`anthropic_model`, placeholder `claude-sonnet-5`).
- RAWG API key (password input, `rawg_api_key`) with link to `https://rawg.io/apidocs`.
- Backlog playtime threshold hours (number input, `playtime_threshold_hours`, default 2) with caption "games under this playtime count as backlog".
- Show last sync time from `last_sync_at` (render as locale string).
- "Re-run onboarding" button: sets `onboarding_complete` to `0` and reloads.

- [ ] **Step 2: Auto-sync on app launch (spec: manual sync + auto-sync on launch)**

In `src/App.tsx`, after the onboarded check, add:

```tsx
useEffect(() => {
  if (!onboarded) return;
  (async () => {
    try {
      const { runFullSync } = await import("./lib/steam/sync");
      const { enrichPending } = await import("./lib/steam/enrich");
      const { regenerateProfile } = await import("./lib/profile/store");
      await runFullSync();
      await regenerateProfile("sync");
      enrichPending({ limit: 50 });   // fire and forget
    } catch { /* offline or keyless: app remains usable on last-synced data (spec degraded mode) */ }
  })();
}, [onboarded]);
```

- [ ] **Step 3: Empty/error state polish**

- LibraryPage empty state already exists (Plan 1). Verify copy: "No games yet — set your Steam key in Settings and hit Sync."
- RecommendPage: when the library has zero active under-threshold games in backlog mode, show "Backlog zero! Every owned game has playtime past your threshold — try Discovery mode." (check `run.items.length === 0 && mode === "backlog"`).
- RecommendPage: wrap `go()` errors so a missing-key error in discovery mode renders as a hint linking to Settings, not a raw exception string: replace `setErr(String(e))` with `setErr(e instanceof Error ? e.message : String(e))`.
- ProfilePage: "No profile yet" state exists; verify.

- [ ] **Step 4: Manual verification**

`npm run tauri dev`:
1. Fresh launch auto-syncs (status visible in Settings' last-sync time) and regenerates profile.
2. Clear Anthropic key → backlog recs still work with degraded banner; discovery shows the Settings hint.
3. Clear RAWG key only → discovery works with stale warning.
4. Threshold change (2 → 10) visibly changes backlog candidate pool.
`npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: full settings, auto-sync on launch, empty/error state polish"
```

---

### Task 5: CLAUDE.md project doc (MyLibrary convention)

**Files:**
- Create: `CLAUDE.md`

**Interfaces:** none — documentation.

- [ ] **Step 1: Write `CLAUDE.md`** at repo root, following MyLibrary's format (what-this-is, sub-docs, locked decisions, commands). Content:

```markdown
# CLAUDE.md — Stoker

Project context for AI assistants. Read this first.

## What this is

Stoker is a personal native Windows Steam companion app (Tauri 2 + React/TS + SQLite): syncs the
Steam library, tracks ratings with history, builds a versioned taste profile, and recommends what
to play next — from the backlog or new games — via a two-stage recommender (heuristic retrieval →
Claude rerank, discovery via Claude with RAWG tools). Solo-only, desktop-only. Sibling project to
MyLibrary (books).

**Current state:** MVP complete (Plans 1–3 executed).

## Key documents

- `docs/superpowers/specs/2026-07-08-stoker-mvp-design.md` — the approved MVP spec (locked decisions live there)
- `docs/superpowers/plans/` — implementation plans 1–3

## Locked decisions (do not relitigate)

See the spec. Highlights: Steam-only automated sync (manual add for other platforms); Tauri 2
native, no server, solo-only forever; heuristic stage-1 must work keyless; explicit signal
outranks implicit (notes > ratings > playtime > feedback); wont_run is neutral, never a dislike;
sync never clobbers user_rating/user_review/status.

## Commands

- `npm run tauri dev` — run the app
- `npm test` — vitest suites (all logic in src/lib is pure and tested)
- `npm run tauri build` — produce the Windows installer

## Conventions

- All IO (fetch, fs) is injectable; tests never hit the network or Tauri APIs.
- SQLite access only through src/lib repos; UI components never write SQL.
- Settings keys are listed in src/lib/settings.ts SETTINGS_KEYS.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md project doc"
```

---

## Plan 3 exit criteria

- Fresh install experience: wizard → synced library → rated sprint → first recommendation, no dead ends.
- Manual games participate in the taste profile.
- All degraded modes render helpful states, not raw errors.
- `npm test` green; `npm run tauri build` produces a working installer.
