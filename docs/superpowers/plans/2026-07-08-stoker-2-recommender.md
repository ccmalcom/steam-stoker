# Stoker Plan 2: Recommender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ratings with history, a versioned taste profile, and the full two-stage recommender — heuristic backlog retrieval and Claude+RAWG discovery, reranked by Claude with mood support — rendered as launchable rec cards.

**Architecture:** Continues Plan 1's pattern: pure logic in `src/lib/` with injectable `fetchFn`, thin Tauri adapters, Vitest for all logic. LLM calls go direct to the Anthropic Messages REST API through the Tauri http plugin (no SDK). Discovery uses Claude tool-use with two RAWG tools; results resolve to Steam appids via the store search API. Stage 1 must work with no keys at all (degraded mode).

**Tech Stack:** As Plan 1, plus the Anthropic Messages API (`anthropic-version: 2023-06-01`) and RAWG REST API.

## Global Constraints

- All Plan 1 global constraints apply. Plan 1 must be complete first.
- Spec: `docs/superpowers/specs/2026-07-08-stoker-mvp-design.md`.
- The LLM is NOT the recommender for backlog mode: stage-1 heuristic must produce a usable ranking with zero API keys (locked decision #4).
- Signal hierarchy (locked decision #6): taste notes > explicit ratings > playtime > rec feedback.
- `wont_run` games: excluded from candidates, NEVER used as taste signal (locked decision #8).
- Default Anthropic model: `claude-sonnet-5` (settings key `anthropic_model` overrides).
- Every rating write appends to `rating_events` AND updates `games.user_rating`/`user_review` in the same call path.

---

### Task 1: Rating events + status changes (repo layer + library UI hooks)

**Files:**
- Create: `src/lib/ratings.ts`
- Modify: `src/components/GameRow.tsx`, `src/pages/LibraryPage.tsx`
- Test: `src/lib/ratings.test.ts`

**Interfaces:**
- Consumes: `getDb` (Plan 1 Task 2), `Game`, `GameStatus`
- Produces:

```ts
export async function rateGame(gameId: number, rating: number | null, reviewText?: string | null): Promise<void>;
export async function setGameStatus(gameId: number, status: GameStatus): Promise<void>;
export async function ratingHistory(gameId: number): Promise<{ rating: number | null; review_text: string | null; created_at: number }[]>;
export function validateRating(rating: number | null): void; // throws RangeError unless null or integer 1-5
```

- [ ] **Step 1: Write the failing test** — `src/lib/ratings.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateRating } from "./ratings";

describe("validateRating", () => {
  it("accepts null and integers 1-5", () => {
    for (const r of [null, 1, 2, 3, 4, 5]) expect(() => validateRating(r)).not.toThrow();
  });
  it("rejects 0, 6, floats, NaN", () => {
    for (const r of [0, 6, 3.5, NaN]) expect(() => validateRating(r as number)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ratings.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/ratings.ts`

```ts
import { getDb } from "./db";
import type { GameStatus } from "./types";

export function validateRating(rating: number | null): void {
  if (rating === null) return;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new RangeError(`rating must be null or an integer 1-5, got ${rating}`);
}

/** Append-only history + current-value mirror, single call path (spec: rating_events). */
export async function rateGame(gameId: number, rating: number | null, reviewText: string | null = null): Promise<void> {
  validateRating(rating);
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    "INSERT INTO rating_events (game_id, rating, review_text, created_at) VALUES ($1,$2,$3,$4)",
    [gameId, rating, reviewText, now]
  );
  await db.execute(
    "UPDATE games SET user_rating = $1, user_review = COALESCE($2, user_review) WHERE id = $3",
    [rating, reviewText, gameId]
  );
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ratings.test.ts` → Expected: PASS.

- [ ] **Step 5: Wire into the library UI**

Replace `src/components/GameRow.tsx` with:

```tsx
import { useState } from "react";
import type { Game, GameStatus } from "../lib/types";
import { launchGame } from "../lib/games";
import { rateGame, setGameStatus } from "../lib/ratings";

export default function GameRow({ game, genres, onChanged }:
  { game: Game; genres: string | null; onChanged: () => void }) {
  const [rating, setRating] = useState<number | null>(game.user_rating);
  const hours = (game.playtime_minutes / 60).toFixed(1);

  async function setStars(n: number) {
    const next = rating === n ? null : n;      // click current star again to clear
    setRating(next);
    await rateGame(game.id, next);
    onChanged();
  }
  async function changeStatus(s: GameStatus) { await setGameStatus(game.id, s); onChanged(); }

  return (
    <tr className={game.status !== "active" ? "muted" : ""}>
      <td>{game.title}{game.source === "manual" ? ` (${game.platform})` : ""}</td>
      <td>{hours} h</td>
      <td>{game.installed ? "✔" : ""}</td>
      <td>{[1, 2, 3, 4, 5].map(n =>
        <span key={n} className="star" onClick={() => setStars(n)}>{rating && n <= rating ? "★" : "☆"}</span>)}</td>
      <td>{genres ? (JSON.parse(genres) as string[]).slice(0, 3).join(", ") : ""}</td>
      <td>
        <select value={game.status} onChange={e => changeStatus(e.target.value as GameStatus)}>
          <option value="active">active</option>
          <option value="finished">finished</option>
          <option value="not_interested">not interested</option>
          <option value="wont_run">won't run</option>
        </select>
      </td>
      <td>{game.installed && game.steam_appid
        ? <button onClick={() => launchGame(game.steam_appid!)}>Launch</button> : null}</td>
    </tr>
  );
}
```

In `src/pages/LibraryPage.tsx`, add a refresh callback and pass it down: add `const reload = () => listGames(filter).then(setGames);` and render `<GameRow key={g.id} game={g} genres={g.genres} onChanged={reload} />`. Append to `src/App.css`: `.star { cursor: pointer; } .muted { opacity: .45; }`

- [ ] **Step 6: Manual verification + commit**

Run `npm run tauri dev`: star a game, change a status, re-star to clear. Then:

```bash
git add -A
git commit -m "feat: ratings with append-only history, status controls in library"
```

---

### Task 2: Taste signal extraction (pure, tiered)

**Files:**
- Create: `src/lib/profile/signals.ts`
- Test: `src/lib/profile/signals.test.ts`

**Interfaces:**
- Consumes: `Game`, `GameMeta` types
- Produces:

```ts
export interface GameWithMeta { game: Game; genres: string[]; tags: string[]; }
export interface RecFeedbackSignal { title: string; feedback: "launched" | "dismissed_not_interested"; }
export interface TasteSignals {
  notes: string;                       // top tier (user-authored)
  loved: GameWithMeta[];               // rating >= 4
  avoided: GameWithMeta[];             // rating <= 2 (wont_run NEVER lands here)
  highPlaytimeUnrated: GameWithMeta[]; // implicit tier: unrated, >= minHours, top N by playtime
  recFeedback: RecFeedbackSignal[];    // lightest tier
}
export function extractSignals(
  library: GameWithMeta[], notes: string, recFeedback: RecFeedbackSignal[],
  opts?: { minHours?: number; maxImplicit?: number }
): TasteSignals;
```

- [ ] **Step 1: Write the failing tests** — `src/lib/profile/signals.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { extractSignals, type GameWithMeta } from "./signals";
import type { Game } from "../types";

function g(over: Partial<Game>, genres: string[] = [], tags: string[] = []): GameWithMeta {
  return {
    game: {
      id: 1, steam_appid: 1, source: "steam", platform: "steam", title: "t",
      playtime_minutes: 0, last_played_at: null, installed: 0, install_size_bytes: null,
      user_rating: null, user_review: null, status: "active", added_at: 0, ...over,
    }, genres, tags,
  };
}

describe("extractSignals", () => {
  it("tiers loved (>=4), avoided (<=2), implicit high-playtime unrated", () => {
    const s = extractSignals([
      g({ id: 1, title: "Loved", user_rating: 5 }),
      g({ id: 2, title: "Meh", user_rating: 3 }),
      g({ id: 3, title: "Hated", user_rating: 1 }),
      g({ id: 4, title: "Grinder", playtime_minutes: 6000 }),
      g({ id: 5, title: "Barely", playtime_minutes: 30 }),
    ], "notes here", []);
    expect(s.loved.map(x => x.game.title)).toEqual(["Loved"]);
    expect(s.avoided.map(x => x.game.title)).toEqual(["Hated"]);
    expect(s.highPlaytimeUnrated.map(x => x.game.title)).toEqual(["Grinder"]);
    expect(s.notes).toBe("notes here");
  });
  it("NEVER treats wont_run as avoided (locked decision #8)", () => {
    const s = extractSignals([g({ id: 1, title: "AC Origins", user_rating: null, status: "wont_run", playtime_minutes: 9000 })], "", []);
    expect(s.avoided).toEqual([]);
    expect(s.highPlaytimeUnrated).toEqual([]); // wont_run is fully neutral
  });
  it("a rated game does not double-count in the implicit tier", () => {
    const s = extractSignals([g({ id: 1, title: "Both", user_rating: 5, playtime_minutes: 9000 })], "", []);
    expect(s.loved).toHaveLength(1);
    expect(s.highPlaytimeUnrated).toHaveLength(0);
  });
  it("caps the implicit tier and sorts by playtime desc", () => {
    const lib = Array.from({ length: 30 }, (_, i) =>
      g({ id: i, title: `G${i}`, playtime_minutes: (i + 1) * 600 }));
    const s = extractSignals(lib, "", [], { maxImplicit: 10 });
    expect(s.highPlaytimeUnrated).toHaveLength(10);
    expect(s.highPlaytimeUnrated[0].game.title).toBe("G29");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/profile/signals.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/profile/signals.ts`

```ts
import type { Game } from "../types";

export interface GameWithMeta { game: Game; genres: string[]; tags: string[]; }
export interface RecFeedbackSignal { title: string; feedback: "launched" | "dismissed_not_interested"; }
export interface TasteSignals {
  notes: string;
  loved: GameWithMeta[];
  avoided: GameWithMeta[];
  highPlaytimeUnrated: GameWithMeta[];
  recFeedback: RecFeedbackSignal[];
}

export function extractSignals(
  library: GameWithMeta[], notes: string, recFeedback: RecFeedbackSignal[],
  opts: { minHours?: number; maxImplicit?: number } = {}
): TasteSignals {
  const { minHours = 5, maxImplicit = 15 } = opts;
  // wont_run is technically-broken, not disliked: fully neutral (spec locked decision #8).
  const eligible = library.filter(x => x.game.status !== "wont_run");
  const loved = eligible.filter(x => (x.game.user_rating ?? 0) >= 4);
  const avoided = eligible.filter(x => x.game.user_rating !== null && x.game.user_rating <= 2);
  const highPlaytimeUnrated = eligible
    .filter(x => x.game.user_rating === null && x.game.playtime_minutes >= minHours * 60)
    .sort((a, b) => b.game.playtime_minutes - a.game.playtime_minutes)
    .slice(0, maxImplicit);
  return { notes, loved, avoided, highPlaytimeUnrated, recFeedback };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/profile/signals.test.ts` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile
git commit -m "feat: tiered taste-signal extraction (wont_run neutral, explicit over implicit)"
```

---

### Task 3: Profile generation + versioned persistence

**Files:**
- Create: `src/lib/profile/generate.ts`, `src/lib/profile/store.ts`
- Test: `src/lib/profile/generate.test.ts`

**Interfaces:**
- Consumes: `TasteSignals`, `GameWithMeta` (Task 2); `getDb`, `getSetting` (Plan 1)
- Produces:

```ts
// generate.ts (pure)
export interface WeightedName { name: string; weight: number; }
export interface ProfileJson {
  loved_genres: WeightedName[]; loved_tags: WeightedName[];
  avoided_genres: WeightedName[]; avoided_tags: WeightedName[];
  loved_games: { title: string; why: string }[];
  avoided_games: { title: string; why: string }[];
  notes: string;
}
export function buildProfile(signals: TasteSignals): { profile_json: ProfileJson; profile_text: string };
// store.ts
export type ProfileTrigger = "sync" | "rating_change" | "manual";
export interface StoredProfile { id: number; generated_at: number; profile_json: ProfileJson; profile_text: string; trigger_reason: ProfileTrigger; }
export async function saveProfile(p: { profile_json: ProfileJson; profile_text: string }, trigger: ProfileTrigger): Promise<number>;
export async function currentProfile(): Promise<StoredProfile | null>;
export async function profileHistory(): Promise<StoredProfile[]>;
export async function regenerateProfile(trigger: ProfileTrigger): Promise<StoredProfile>; // loads library+meta+notes+feedback, extractSignals, buildProfile, saveProfile
```

- [ ] **Step 1: Write the failing tests** — `src/lib/profile/generate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildProfile } from "./generate";
import type { TasteSignals } from "./signals";

const signals: TasteSignals = {
  notes: "Done with roguelikes. Prefer controller-friendly.",
  loved: [
    { game: { title: "Hades" } as any, genres: ["Action"], tags: ["Rogue-lite", "Indie"] },
    { game: { title: "Elden Ring" } as any, genres: ["Action", "RPG"], tags: ["Souls-like", "Open World"] },
  ],
  avoided: [{ game: { title: "FIFA 23", user_rating: 1 } as any, genres: ["Sports"], tags: ["Football"] }],
  highPlaytimeUnrated: [{ game: { title: "Factorio", playtime_minutes: 12000 } as any, genres: ["Simulation"], tags: ["Automation"] }],
  recFeedback: [],
};

describe("buildProfile", () => {
  it("weights explicit genres 3x over implicit 1x", () => {
    const { profile_json } = buildProfile(signals);
    const action = profile_json.loved_genres.find(g => g.name === "Action")!;
    const sim = profile_json.loved_genres.find(g => g.name === "Simulation")!;
    expect(action.weight).toBe(6);  // 3 per explicit loved game, two games
    expect(sim.weight).toBe(1);     // 1 per implicit game
  });
  it("builds an avoid tier from low ratings", () => {
    const { profile_json } = buildProfile(signals);
    expect(profile_json.avoided_genres.map(g => g.name)).toContain("Sports");
    expect(profile_json.avoided_games[0]).toEqual({ title: "FIFA 23", why: "rated 1★" });
  });
  it("puts notes first in the rendered text (top signal tier)", () => {
    const { profile_text } = buildProfile(signals);
    expect(profile_text.indexOf("Done with roguelikes")).toBeLessThan(profile_text.indexOf("Hades"));
    expect(profile_text).toContain("AVOID");
  });
  it("is deterministic", () => {
    expect(buildProfile(signals)).toEqual(buildProfile(signals));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/profile/generate.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/profile/generate.ts`

```ts
import type { TasteSignals, GameWithMeta } from "./signals";

export interface WeightedName { name: string; weight: number; }
export interface ProfileJson {
  loved_genres: WeightedName[]; loved_tags: WeightedName[];
  avoided_genres: WeightedName[]; avoided_tags: WeightedName[];
  loved_games: { title: string; why: string }[];
  avoided_games: { title: string; why: string }[];
  notes: string;
}

const EXPLICIT_WEIGHT = 3, IMPLICIT_WEIGHT = 1;

function tally(items: { source: GameWithMeta; weight: number }[], pick: (x: GameWithMeta) => string[]): WeightedName[] {
  const map = new Map<string, number>();
  for (const { source, weight } of items)
    for (const name of pick(source)) map.set(name, (map.get(name) ?? 0) + weight);
  return [...map.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

function why(x: GameWithMeta): string {
  if (x.game.user_rating) return `rated ${x.game.user_rating}★`;
  return `${Math.round(x.game.playtime_minutes / 60)}h played`;
}

export function buildProfile(signals: TasteSignals): { profile_json: ProfileJson; profile_text: string } {
  const lovedSources = [
    ...signals.loved.map(s => ({ source: s, weight: EXPLICIT_WEIGHT })),
    ...signals.highPlaytimeUnrated.map(s => ({ source: s, weight: IMPLICIT_WEIGHT })),
  ];
  const avoidedSources = signals.avoided.map(s => ({ source: s, weight: EXPLICIT_WEIGHT }));

  const profile_json: ProfileJson = {
    loved_genres: tally(lovedSources, x => x.genres),
    loved_tags: tally(lovedSources, x => x.tags),
    avoided_genres: tally(avoidedSources, x => x.genres),
    avoided_tags: tally(avoidedSources, x => x.tags),
    loved_games: [...signals.loved, ...signals.highPlaytimeUnrated].map(x => ({ title: x.game.title, why: why(x) })),
    avoided_games: signals.avoided.map(x => ({ title: x.game.title, why: why(x) })),
    notes: signals.notes,
  };

  const fmt = (w: WeightedName[], n = 10) => w.slice(0, n).map(x => `${x.name} (${x.weight})`).join(", ") || "none yet";
  const games = (g: { title: string; why: string }[]) => g.map(x => `- ${x.title} — ${x.why}`).join("\n") || "- none yet";

  const profile_text = [
    signals.notes ? `PLAYER'S OWN WORDS (highest priority):\n${signals.notes}\n` : "",
    `LOVED GAMES:\n${games(profile_json.loved_games)}`,
    `\nLOVED GENRES: ${fmt(profile_json.loved_genres)}`,
    `LOVED TAGS: ${fmt(profile_json.loved_tags, 15)}`,
    `\nAVOID — GAMES:\n${games(profile_json.avoided_games)}`,
    `AVOID — GENRES: ${fmt(profile_json.avoided_genres)}`,
    `AVOID — TAGS: ${fmt(profile_json.avoided_tags)}`,
    signals.recFeedback.length
      ? `\nRECENT REC FEEDBACK (light signal):\n${signals.recFeedback.map(f => `- ${f.title}: ${f.feedback}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return { profile_json, profile_text };
}
```

`src/lib/profile/store.ts`:

```ts
import { getDb } from "../db";
import { getSetting } from "../settings";
import { extractSignals, type GameWithMeta, type RecFeedbackSignal } from "./signals";
import { buildProfile, type ProfileJson } from "./generate";
import type { Game } from "../types";

export type ProfileTrigger = "sync" | "rating_change" | "manual";
export interface StoredProfile {
  id: number; generated_at: number; profile_json: ProfileJson;
  profile_text: string; trigger_reason: ProfileTrigger;
}

export async function saveProfile(
  p: { profile_json: ProfileJson; profile_text: string }, trigger: ProfileTrigger
): Promise<number> {
  const db = await getDb();
  await db.execute("UPDATE taste_profile SET is_current = 0 WHERE is_current = 1");
  const res = await db.execute(
    `INSERT INTO taste_profile (generated_at, profile_json, profile_text, trigger_reason, is_current)
     VALUES ($1,$2,$3,$4,1)`,
    [Math.floor(Date.now() / 1000), JSON.stringify(p.profile_json), p.profile_text, trigger]
  );
  return res.lastInsertId as number;
}

function rowToProfile(r: any): StoredProfile {
  return { id: r.id, generated_at: r.generated_at, profile_json: JSON.parse(r.profile_json),
           profile_text: r.profile_text, trigger_reason: r.trigger_reason };
}

export async function currentProfile(): Promise<StoredProfile | null> {
  const db = await getDb();
  const rows = await db.select<any[]>("SELECT * FROM taste_profile WHERE is_current = 1 LIMIT 1");
  return rows.length ? rowToProfile(rows[0]) : null;
}

export async function profileHistory(): Promise<StoredProfile[]> {
  const db = await getDb();
  return (await db.select<any[]>("SELECT * FROM taste_profile ORDER BY generated_at DESC")).map(rowToProfile);
}

async function loadLibraryWithMeta(): Promise<GameWithMeta[]> {
  const db = await getDb();
  const rows = await db.select<(Game & { genres: string | null; tags: string | null })[]>(
    "SELECT g.*, m.genres, m.tags FROM games g LEFT JOIN game_meta m ON m.game_id = g.id");
  return rows.map(r => ({
    game: r as Game,
    genres: r.genres ? JSON.parse(r.genres) : [],
    tags: r.tags ? JSON.parse(r.tags) : [],
  }));
}

async function loadRecentFeedback(): Promise<RecFeedbackSignal[]> {
  const db = await getDb();
  const recs = await db.select<{ results_json: string; feedback_json: string }[]>(
    "SELECT results_json, feedback_json FROM recommendations ORDER BY created_at DESC LIMIT 10");
  const out: RecFeedbackSignal[] = [];
  for (const rec of recs) {
    const feedback = JSON.parse(rec.feedback_json) as Record<string, string>;
    for (const [title, fb] of Object.entries(feedback))
      if (fb === "launched" || fb === "dismissed_not_interested") out.push({ title, feedback: fb });
  }
  return out;
}

export async function regenerateProfile(trigger: ProfileTrigger): Promise<StoredProfile> {
  const library = await loadLibraryWithMeta();
  const notes = (await getSetting("taste_notes")) ?? "";
  const feedback = await loadRecentFeedback();
  const built = buildProfile(extractSignals(library, notes, feedback));
  const id = await saveProfile(built, trigger);
  return { id, generated_at: Math.floor(Date.now() / 1000), trigger_reason: trigger, ...built };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/profile/generate.test.ts` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile
git commit -m "feat: deterministic profile build + versioned persistence with notes as top tier"
```

---

### Task 4: Anthropic client (messages + tool-use loop)

**Files:**
- Create: `src/lib/anthropic.ts`
- Test: `src/lib/anthropic.test.ts`

**Interfaces:**
- Consumes: `FetchFn` (Plan 1 Task 5), `getSetting`
- Produces:

```ts
export interface ClaudeTool { name: string; description: string; input_schema: object; }
export type ToolHandler = (input: any) => Promise<unknown>;
export async function claudeComplete(opts: {
  apiKey: string; system: string; user: string; model?: string;
  tools?: ClaudeTool[]; handlers?: Record<string, ToolHandler>;
  maxTokens?: number; fetchFn?: FetchFn; maxToolRounds?: number;
}): Promise<string>;                       // final text content, tool loop resolved internally
export function extractJson<T>(text: string): T;  // tolerant: strips prose/code fences around JSON
export class AnthropicError extends Error { constructor(public status: number, message: string); }
```

- [ ] **Step 1: Write the failing tests** — `src/lib/anthropic.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { claudeComplete, extractJson, AnthropicError } from "./anthropic";

const textResponse = (text: string) => new Response(JSON.stringify({
  content: [{ type: "text", text }], stop_reason: "end_turn",
}), { status: 200 });

describe("claudeComplete", () => {
  it("returns text for a plain completion", async () => {
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      fetchFn: async () => textResponse("hello"),
    });
    expect(out).toBe("hello");
  });
  it("runs the tool loop: executes handler, feeds result back", async () => {
    let call = 0;
    const out = await claudeComplete({
      apiKey: "K", system: "s", user: "u",
      tools: [{ name: "double", description: "", input_schema: { type: "object" } }],
      handlers: { double: async (inp: any) => ({ result: inp.x * 2 }) },
      fetchFn: async (_url, init) => {
        call++;
        if (call === 1) return new Response(JSON.stringify({
          content: [{ type: "tool_use", id: "t1", name: "double", input: { x: 21 } }],
          stop_reason: "tool_use",
        }), { status: 200 });
        const body = JSON.parse(init!.body as string);
        const toolResult = body.messages.at(-1).content[0];
        expect(toolResult.type).toBe("tool_result");
        expect(JSON.parse(toolResult.content)).toEqual({ result: 42 });
        return textResponse("done");
      },
    });
    expect(out).toBe("done");
    expect(call).toBe(2);
  });
  it("throws AnthropicError on HTTP failure", async () => {
    await expect(claudeComplete({
      apiKey: "K", system: "s", user: "u",
      fetchFn: async () => new Response("{}", { status: 401 }),
    })).rejects.toBeInstanceOf(AnthropicError);
  });
});

describe("extractJson", () => {
  it("parses bare JSON, fenced JSON, and JSON with surrounding prose", () => {
    expect(extractJson<number[]>("[1,2]")).toEqual([1, 2]);
    expect(extractJson<number[]>("```json\n[1,2]\n```")).toEqual([1, 2]);
    expect(extractJson<{ a: number }>('Here you go:\n{"a":1}\nEnjoy!')).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/anthropic.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/anthropic.ts`

```ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "./steam/webapi";

export class AnthropicError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AnthropicError"; }
}

export interface ClaudeTool { name: string; description: string; input_schema: object; }
export type ToolHandler = (input: any) => Promise<unknown>;

const API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-sonnet-5";

export async function claudeComplete(opts: {
  apiKey: string; system: string; user: string; model?: string;
  tools?: ClaudeTool[]; handlers?: Record<string, ToolHandler>;
  maxTokens?: number; fetchFn?: FetchFn; maxToolRounds?: number;
}): Promise<string> {
  const {
    apiKey, system, user, model = DEFAULT_MODEL, tools, handlers = {},
    maxTokens = 4096, fetchFn = tauriFetch, maxToolRounds = 8,
  } = opts;

  const messages: any[] = [{ role: "user", content: user }];

  for (let round = 0; round <= maxToolRounds; round++) {
    const res = await fetchFn(API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, ...(tools ? { tools } : {}) }),
    });
    if (!res.ok) throw new AnthropicError(res.status, `Anthropic API: HTTP ${res.status}`);
    const body = await res.json();

    if (body.stop_reason !== "tool_use") {
      return (body.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }

    messages.push({ role: "assistant", content: body.content });
    const results = [];
    for (const block of body.content) {
      if (block.type !== "tool_use") continue;
      let content: string;
      try { content = JSON.stringify(await handlers[block.name]?.(block.input) ?? { error: "unknown tool" }); }
      catch (e) { content = JSON.stringify({ error: String(e) }); }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new AnthropicError(0, "tool loop exceeded maxToolRounds");
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate.trim()) as T; } catch { /* fall through */ }
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  for (let end = candidate.length; end > start; end--) {
    try { return JSON.parse(candidate.slice(start, end)) as T; } catch { /* keep shrinking */ }
  }
  throw new Error("no parseable JSON found in model output");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/anthropic.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/anthropic.ts src/lib/anthropic.test.ts
git commit -m "feat: anthropic messages client with tool-use loop and tolerant JSON extraction"
```

---

### Task 5: Stage-1 backlog scoring (pure heuristic)

**Files:**
- Create: `src/lib/recommend/stage1.ts`
- Test: `src/lib/recommend/stage1.test.ts`

**Interfaces:**
- Consumes: `GameWithMeta` (Task 2), `ProfileJson` (Task 3)
- Produces:

```ts
export interface Candidate { game: Game; genres: string[]; tags: string[]; score: number; reasons: string[]; }
export interface Stage1Opts { playtimeThresholdHours?: number; installedBoost?: number; genreWeight?: number; tagWeight?: number; avoidPenalty?: number; varietyWeight?: number; topN?: number; }
export function scoreBacklog(library: GameWithMeta[], profile: ProfileJson, opts?: Stage1Opts): Candidate[];
```

- [ ] **Step 1: Write the failing tests** — `src/lib/recommend/stage1.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { scoreBacklog } from "./stage1";
import type { GameWithMeta } from "../profile/signals";
import type { ProfileJson } from "../profile/generate";
import type { Game } from "../types";

function g(over: Partial<Game>, genres: string[] = [], tags: string[] = []): GameWithMeta {
  return {
    game: {
      id: Math.random(), steam_appid: 1, source: "steam", platform: "steam", title: "t",
      playtime_minutes: 0, last_played_at: null, installed: 0, install_size_bytes: null,
      user_rating: null, user_review: null, status: "active", added_at: 0, ...over,
    }, genres, tags,
  };
}

const profile: ProfileJson = {
  loved_genres: [{ name: "RPG", weight: 6 }], loved_tags: [{ name: "Open World", weight: 3 }],
  avoided_genres: [{ name: "Sports", weight: 3 }], avoided_tags: [],
  loved_games: [], avoided_games: [], notes: "",
};

describe("scoreBacklog", () => {
  it("only considers active games under the playtime threshold", () => {
    const out = scoreBacklog([
      g({ title: "Played", playtime_minutes: 600 }),
      g({ title: "NotInterested", status: "not_interested" }),
      g({ title: "WontRun", status: "wont_run" }),
      g({ title: "Fresh", playtime_minutes: 0 }),
    ], profile);
    expect(out.map(c => c.game.title)).toEqual(["Fresh"]);
  });
  it("ranks profile-matching games higher and explains why", () => {
    const out = scoreBacklog([
      g({ title: "Match" }, ["RPG"], ["Open World"]),
      g({ title: "NoMatch" }, ["Puzzle"], []),
    ], profile);
    expect(out[0].game.title).toBe("Match");
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out[0].reasons.join(" ")).toContain("RPG");
  });
  it("penalizes avoided genres", () => {
    const out = scoreBacklog([
      g({ title: "Sporty" }, ["Sports"], []),
      g({ title: "Plain" }, [], []),
    ], profile);
    expect(out[0].game.title).toBe("Plain");
  });
  it("boosts installed games", () => {
    const out = scoreBacklog([
      g({ title: "OnDisk", installed: 1 }, ["RPG"], []),
      g({ title: "NotOnDisk", installed: 0 }, ["RPG"], []),
    ], profile);
    expect(out[0].game.title).toBe("OnDisk");
  });
  it("caps output at topN", () => {
    const lib = Array.from({ length: 40 }, (_, i) => g({ title: `G${i}` }, ["RPG"], []));
    expect(scoreBacklog(lib, profile, { topN: 20 })).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/recommend/stage1.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/recommend/stage1.ts`

```ts
import type { Game } from "../types";
import type { GameWithMeta } from "../profile/signals";
import type { ProfileJson, WeightedName } from "../profile/generate";

export interface Candidate { game: Game; genres: string[]; tags: string[]; score: number; reasons: string[]; }
export interface Stage1Opts {
  playtimeThresholdHours?: number; installedBoost?: number; genreWeight?: number;
  tagWeight?: number; avoidPenalty?: number; varietyWeight?: number; topN?: number;
}

function matchScore(names: string[], weighted: WeightedName[]): { score: number; hits: string[] } {
  const total = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  let score = 0; const hits: string[] = [];
  for (const w of weighted) if (names.includes(w.name)) { score += w.weight / total; hits.push(w.name); }
  return { score, hits };
}

export function scoreBacklog(library: GameWithMeta[], profile: ProfileJson, opts: Stage1Opts = {}): Candidate[] {
  const {
    playtimeThresholdHours = 2, installedBoost = 1.5, genreWeight = 3,
    tagWeight = 2, avoidPenalty = 2.5, varietyWeight = 1, topN = 20,
  } = opts;

  // Variety baseline: tags of the most recently played game.
  const recent = [...library].sort((a, b) => (b.game.last_played_at ?? 0) - (a.game.last_played_at ?? 0))[0];
  const recentTags = new Set(recent?.tags ?? []);

  const eligible = library.filter(x =>
    x.game.status === "active" && x.game.playtime_minutes < playtimeThresholdHours * 60);

  const scored: Candidate[] = eligible.map(x => {
    const reasons: string[] = [];
    const lg = matchScore(x.genres, profile.loved_genres);
    const lt = matchScore(x.tags, profile.loved_tags);
    const ag = matchScore(x.genres, profile.avoided_genres);
    const at = matchScore(x.tags, profile.avoided_tags);
    let score = genreWeight * lg.score + tagWeight * lt.score - avoidPenalty * (ag.score + at.score);
    if (lg.hits.length) reasons.push(`matches loved genres: ${lg.hits.join(", ")}`);
    if (lt.hits.length) reasons.push(`matches loved tags: ${lt.hits.slice(0, 4).join(", ")}`);
    if (ag.hits.length || at.hits.length) reasons.push(`⚠ overlaps avoids: ${[...ag.hits, ...at.hits].join(", ")}`);
    if (x.game.installed) { score += installedBoost; reasons.push("already installed"); }
    if (recentTags.size) {
      const overlap = x.tags.filter(t => recentTags.has(t)).length;
      const variety = 1 - overlap / Math.max(recentTags.size, 1);
      score += varietyWeight * variety;
      if (variety > 0.8 && x.tags.length) reasons.push("a change of pace from your last game");
    }
    return { game: x.game, genres: x.genres, tags: x.tags, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/recommend/stage1.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommend
git commit -m "feat: stage-1 heuristic backlog scoring with variety bonus and avoid penalties"
```

---

### Task 6: RAWG client + Steam appid resolver

**Files:**
- Create: `src/lib/recommend/rawg.ts`, `src/lib/recommend/resolve.ts`
- Test: `src/lib/recommend/rawg.test.ts`, `src/lib/recommend/resolve.test.ts`

**Interfaces:**
- Consumes: `FetchFn`
- Produces:

```ts
// rawg.ts
export interface RawgGame { name: string; released: string | null; genres: string[]; tags: string[]; metacritic: number | null; }
export async function rawgSearch(key: string, query: string, fetchFn?: FetchFn): Promise<RawgGame[]>;
export async function rawgByGenre(key: string, opts: { genres?: string[]; fromDate?: string; toDate?: string; ordering?: string }, fetchFn?: FetchFn): Promise<RawgGame[]>;
// resolve.ts
export interface SteamStoreHit { appid: number; name: string; priceCents: number | null; }
export async function resolveSteamApp(title: string, fetchFn?: FetchFn): Promise<SteamStoreHit | null>;
export function normalizeTitle(t: string): string;  // lowercase, strip punctuation/™®, collapse spaces
```

- [ ] **Step 1: Write the failing tests**

`src/lib/recommend/rawg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rawgSearch, rawgByGenre } from "./rawg";

const RESULTS = { results: [{
  name: "Hades II", released: "2024-05-06",
  genres: [{ name: "Action" }], tags: [{ name: "Roguelike" }], metacritic: 93,
}]};
const ok = () => new Response(JSON.stringify(RESULTS), { status: 200 });

describe("rawg client", () => {
  it("search maps results and sends key + query", async () => {
    let seen = "";
    const out = await rawgSearch("RK", "hades", async (url) => { seen = url; return ok(); });
    expect(out[0]).toEqual({ name: "Hades II", released: "2024-05-06", genres: ["Action"], tags: ["Roguelike"], metacritic: 93 });
    expect(seen).toContain("key=RK");
    expect(seen).toContain("search=hades");
  });
  it("byGenre builds genres/dates/ordering params", async () => {
    let seen = "";
    await rawgByGenre("RK", { genres: ["rpg"], fromDate: "2025-01-01", toDate: "2026-07-08", ordering: "-added" },
      async (url) => { seen = url; return ok(); });
    expect(seen).toContain("genres=rpg");
    expect(seen).toContain("dates=2025-01-01,2026-07-08");
    expect(seen).toContain("ordering=-added");
  });
  it("returns [] on HTTP error (degraded mode, non-fatal)", async () => {
    expect(await rawgSearch("RK", "x", async () => new Response("", { status: 500 }))).toEqual([]);
  });
});
```

`src/lib/recommend/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSteamApp, normalizeTitle } from "./resolve";

describe("normalizeTitle", () => {
  it("strips trademark symbols, punctuation and case", () => {
    expect(normalizeTitle("ELDEN RING™: Shadow of the Erdtree!")).toBe("elden ring shadow of the erdtree");
  });
});

describe("resolveSteamApp", () => {
  const body = { items: [
    { id: 1245620, name: "ELDEN RING", price: { final: 5999 } },
    { id: 999, name: "Elden Ring Soundtrack", price: null },
  ]};
  it("returns the best title match with appid and price", async () => {
    const hit = await resolveSteamApp("Elden Ring", async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(hit).toEqual({ appid: 1245620, name: "ELDEN RING", priceCents: 5999 });
  });
  it("returns null when nothing matches closely", async () => {
    const hit = await resolveSteamApp("Totally Unrelated Game", async () =>
      new Response(JSON.stringify(body), { status: 200 }));
    expect(hit).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/recommend/rawg.test.ts src/lib/recommend/resolve.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/recommend/rawg.ts`:

```ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "../steam/webapi";

export interface RawgGame {
  name: string; released: string | null; genres: string[]; tags: string[]; metacritic: number | null;
}

const BASE = "https://api.rawg.io/api/games";

function mapResults(body: any): RawgGame[] {
  return (body?.results ?? []).map((r: any) => ({
    name: String(r.name),
    released: r.released ?? null,
    genres: (r.genres ?? []).map((g: any) => String(g.name)),
    tags: (r.tags ?? []).slice(0, 10).map((t: any) => String(t.name)),
    metacritic: r.metacritic ?? null,
  }));
}

export async function rawgSearch(key: string, query: string, fetchFn: FetchFn = tauriFetch): Promise<RawgGame[]> {
  const res = await fetchFn(`${BASE}?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=10`);
  if (!res.ok) return [];
  return mapResults(await res.json());
}

export async function rawgByGenre(
  key: string,
  opts: { genres?: string[]; fromDate?: string; toDate?: string; ordering?: string },
  fetchFn: FetchFn = tauriFetch
): Promise<RawgGame[]> {
  const params = new URLSearchParams({ key, page_size: "20" });
  if (opts.genres?.length) params.set("genres", opts.genres.join(","));
  if (opts.fromDate && opts.toDate) params.set("dates", `${opts.fromDate},${opts.toDate}`);
  if (opts.ordering) params.set("ordering", opts.ordering);
  const res = await fetchFn(`${BASE}?${params.toString()}`);
  if (!res.ok) return [];
  return mapResults(await res.json());
}
```

`src/lib/recommend/resolve.ts`:

```ts
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "../steam/webapi";

export interface SteamStoreHit { appid: number; name: string; priceCents: number | null; }

export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[™®©]/g, "").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

export async function resolveSteamApp(title: string, fetchFn: FetchFn = tauriFetch): Promise<SteamStoreHit | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`;
  const res = await fetchFn(url);
  if (!res.ok) return null;
  const body = await res.json();
  const want = normalizeTitle(title);
  for (const item of body?.items ?? []) {
    const got = normalizeTitle(String(item.name));
    if (got === want || got.startsWith(want) || want.startsWith(got)) {
      return { appid: Number(item.id), name: String(item.name), priceCents: item.price?.final ?? null };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/recommend/rawg.test.ts src/lib/recommend/resolve.test.ts` → Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommend
git commit -m "feat: RAWG client and steam store appid resolver"
```

---

### Task 7: Discovery — Claude with RAWG tools

**Files:**
- Create: `src/lib/recommend/discovery.ts`
- Test: `src/lib/recommend/discovery.test.ts`

**Interfaces:**
- Consumes: `claudeComplete`, `extractJson`, `ClaudeTool` (Task 4); `rawgSearch`, `rawgByGenre` (Task 6); `resolveSteamApp` (Task 6)
- Produces:

```ts
export interface DiscoveryCandidate {
  title: string; reason: string;
  steam_appid: number | null; priceCents: number | null;   // null appid = not on Steam / unresolved (kept, flagged)
  genres: string[]; tags: string[];
}
export async function discoverCandidates(opts: {
  anthropicKey: string; rawgKey: string | null;   // null rawgKey → Claude runs toolless, flagged stale
  profileText: string; ownedTitles: string[]; mood?: string;
  model?: string; fetchFn?: FetchFn; count?: number;
}): Promise<{ candidates: DiscoveryCandidate[]; staleWarning: boolean }>;
```

- [ ] **Step 1: Write the failing tests** — `src/lib/recommend/discovery.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { discoverCandidates } from "./discovery";
import * as anthropic from "../anthropic";
import * as resolve from "./resolve";

describe("discoverCandidates", () => {
  it("parses Claude output, resolves appids, filters owned games", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "Hades II", reason: "you loved Hades" },
      { title: "Elden Ring", reason: "souls-like" },        // owned → must be filtered
      { title: "Made Up Game", reason: "hallucination" },   // unresolvable → kept with null appid
    ]));
    vi.spyOn(resolve, "resolveSteamApp").mockImplementation(async (title) =>
      title === "Hades II" ? { appid: 1145350, name: "Hades II", priceCents: 2999 } : null);

    const { candidates, staleWarning } = await discoverCandidates({
      anthropicKey: "AK", rawgKey: "RK",
      profileText: "profile", ownedTitles: ["Elden Ring"],
    });
    expect(candidates.map(c => c.title)).toEqual(["Hades II", "Made Up Game"]);
    expect(candidates[0].steam_appid).toBe(1145350);
    expect(candidates[1].steam_appid).toBeNull();
    expect(staleWarning).toBe(false);
    vi.restoreAllMocks();
  });
  it("sets staleWarning and passes no tools when rawgKey is null", async () => {
    const spy = vi.spyOn(anthropic, "claudeComplete").mockResolvedValue("[]");
    const { staleWarning } = await discoverCandidates({
      anthropicKey: "AK", rawgKey: null, profileText: "p", ownedTitles: [],
    });
    expect(staleWarning).toBe(true);
    expect(spy.mock.calls[0][0].tools).toBeUndefined();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/recommend/discovery.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/recommend/discovery.ts`

```ts
import { claudeComplete, extractJson, type ClaudeTool } from "../anthropic";
import { rawgSearch, rawgByGenre } from "./rawg";
import { resolveSteamApp } from "./resolve";
import * as resolveModule from "./resolve";
import type { FetchFn } from "../steam/webapi";

export interface DiscoveryCandidate {
  title: string; reason: string;
  steam_appid: number | null; priceCents: number | null;
  genres: string[]; tags: string[];
}

const TOOLS: ClaudeTool[] = [
  {
    name: "search_games",
    description: "Search the RAWG game catalog by title or keywords. Use to verify a game exists and check its release date, genres and reception.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "games_by_genre",
    description: "List recent/popular RAWG games filtered by genre slugs (e.g. 'role-playing-games-rpg', 'indie', 'strategy'). Use to find recent releases matching the player's taste.",
    input_schema: {
      type: "object",
      properties: {
        genres: { type: "array", items: { type: "string" } },
        from_date: { type: "string", description: "YYYY-MM-DD" },
        to_date: { type: "string", description: "YYYY-MM-DD" },
        ordering: { type: "string", description: "-added | -released | -metacritic" },
      },
    },
  },
];

const SYSTEM = `You are the discovery engine for a personal game recommender.
Given a player's taste profile, propose games they do NOT already own.
Use the tools to verify titles and find recent releases before answering. Prefer well-received games; include a couple of adventurous picks.
Respond with ONLY a JSON array: [{"title": "...", "reason": "one sentence tied to their profile"}]. No other text.`;

export async function discoverCandidates(opts: {
  anthropicKey: string; rawgKey: string | null;
  profileText: string; ownedTitles: string[]; mood?: string;
  model?: string; fetchFn?: FetchFn; count?: number;
}): Promise<{ candidates: DiscoveryCandidate[]; staleWarning: boolean }> {
  const { anthropicKey, rawgKey, profileText, ownedTitles, mood, model, fetchFn, count = 20 } = opts;

  const user = [
    `TASTE PROFILE:\n${profileText}`,
    mood ? `\nMOOD RIGHT NOW: ${mood}` : "",
    `\nALREADY OWNED (do not propose these):\n${ownedTitles.join("; ")}`,
    `\nPropose ${count} games.`,
  ].join("\n");

  const raw = await claudeComplete({
    apiKey: anthropicKey, system: SYSTEM, user, model, fetchFn,
    ...(rawgKey ? {
      tools: TOOLS,
      handlers: {
        search_games: (inp: any) => rawgSearch(rawgKey, inp.query, fetchFn),
        games_by_genre: (inp: any) => rawgByGenre(rawgKey, {
          genres: inp.genres, fromDate: inp.from_date, toDate: inp.to_date, ordering: inp.ordering,
        }, fetchFn),
      },
    } : {}),
  });

  const proposed = extractJson<{ title: string; reason: string }[]>(raw);
  const ownedNorm = new Set(ownedTitles.map(resolveModule.normalizeTitle));
  const candidates: DiscoveryCandidate[] = [];

  for (const p of proposed) {
    if (ownedNorm.has(resolveModule.normalizeTitle(p.title))) continue;
    const hit = await resolveModule.resolveSteamApp(p.title, fetchFn);
    if (hit && ownedNorm.has(resolveModule.normalizeTitle(hit.name))) continue;
    candidates.push({
      title: hit?.name ?? p.title, reason: p.reason,
      steam_appid: hit?.appid ?? null, priceCents: hit?.priceCents ?? null,
      genres: [], tags: [],
    });
  }
  return { candidates, staleWarning: rawgKey === null };
}
```

Note: `resolveSteamApp`/`normalizeTitle` are called through the module namespace (`resolveModule.…`) so the Vitest `vi.spyOn` in the test intercepts them; the direct import of `resolveSteamApp` may be removed if the linter flags it as unused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/recommend/discovery.test.ts` → Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommend
git commit -m "feat: discovery via Claude with RAWG tools, resolved and owned-filtered"
```

---

### Task 8: Stage-2 rerank + fallback + persistence

**Files:**
- Create: `src/lib/recommend/rerank.ts`, `src/lib/recommend/run.ts`
- Test: `src/lib/recommend/rerank.test.ts`

**Interfaces:**
- Consumes: `Candidate` (Task 5), `DiscoveryCandidate` (Task 7), `claudeComplete`/`extractJson` (Task 4), `currentProfile`/`regenerateProfile` (Task 3), `getDb`, `getSetting`, `scoreBacklog`
- Produces:

```ts
// rerank.ts
export type RecMode = "backlog" | "mixed" | "discovery";
export interface RecItem {
  title: string; why: string; origin: "backlog" | "discovery";
  steam_appid: number | null; game_id: number | null; installed: boolean; priceCents: number | null;
}
export interface UnifiedCandidate {  // common shape fed to the reranker
  title: string; origin: "backlog" | "discovery"; steam_appid: number | null; game_id: number | null;
  installed: boolean; priceCents: number | null; genres: string[]; tags: string[]; stage1Reasons: string[];
}
export async function rerank(opts: { apiKey: string; profileText: string; mood?: string; candidates: UnifiedCandidate[]; topN?: number; model?: string; fetchFn?: FetchFn }): Promise<RecItem[]>;
export function fallbackRank(candidates: UnifiedCandidate[], topN?: number): RecItem[]; // stage-1 order, reasons joined
// run.ts
export interface RecRun { id: number; created_at: number; mode: RecMode; mood_prompt: string | null; items: RecItem[]; degraded: boolean; staleWarning: boolean; }
export async function runRecommendation(mode: RecMode, mood?: string): Promise<RecRun>;
export async function recordFeedback(recId: number, title: string, feedback: "launched" | "dismissed_not_interested" | "dismissed_wont_run"): Promise<void>;
export async function latestRuns(limit?: number): Promise<RecRun[]>;
```

- [ ] **Step 1: Write the failing tests** — `src/lib/recommend/rerank.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { rerank, fallbackRank, type UnifiedCandidate } from "./rerank";
import * as anthropic from "../anthropic";

const cand = (title: string, origin: "backlog" | "discovery" = "backlog"): UnifiedCandidate => ({
  title, origin, steam_appid: 1, game_id: origin === "backlog" ? 1 : null,
  installed: false, priceCents: null, genres: [], tags: [], stage1Reasons: ["r1"],
});

describe("rerank", () => {
  it("returns items in Claude's order with Claude's reasons", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "B", why: "because B" }, { title: "A", why: "because A" },
    ]));
    const out = await rerank({ apiKey: "K", profileText: "p", candidates: [cand("A"), cand("B")] });
    expect(out.map(i => i.title)).toEqual(["B", "A"]);
    expect(out[0].why).toBe("because B");
    vi.restoreAllMocks();
  });
  it("drops items Claude names that are not in the candidate list (anti-hallucination)", async () => {
    vi.spyOn(anthropic, "claudeComplete").mockResolvedValue(JSON.stringify([
      { title: "Ghost Game", why: "x" }, { title: "A", why: "real" },
    ]));
    const out = await rerank({ apiKey: "K", profileText: "p", candidates: [cand("A")] });
    expect(out.map(i => i.title)).toEqual(["A"]);
    vi.restoreAllMocks();
  });
});

describe("fallbackRank", () => {
  it("keeps stage-1 order and joins reasons as why", () => {
    const out = fallbackRank([cand("A"), cand("B")], 1);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("A");
    expect(out[0].why).toBe("r1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/recommend/rerank.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/recommend/rerank.ts`:

```ts
import { claudeComplete, extractJson } from "../anthropic";
import { normalizeTitle } from "./resolve";
import type { FetchFn } from "../steam/webapi";

export type RecMode = "backlog" | "mixed" | "discovery";
export interface RecItem {
  title: string; why: string; origin: "backlog" | "discovery";
  steam_appid: number | null; game_id: number | null; installed: boolean; priceCents: number | null;
}
export interface UnifiedCandidate {
  title: string; origin: "backlog" | "discovery"; steam_appid: number | null; game_id: number | null;
  installed: boolean; priceCents: number | null; genres: string[]; tags: string[]; stage1Reasons: string[];
}

const SYSTEM = `You are the final ranking stage of a personal game recommender.
You will receive the player's taste profile, an optional mood, and a list of CANDIDATES.
Rank ONLY games from the candidate list — never introduce new titles.
Respond with ONLY a JSON array, best first: [{"title": "<exact candidate title>", "why": "1-2 sentences, personal, tied to their profile/mood"}].`;

export async function rerank(opts: {
  apiKey: string; profileText: string; mood?: string;
  candidates: UnifiedCandidate[]; topN?: number; model?: string; fetchFn?: FetchFn;
}): Promise<RecItem[]> {
  const { apiKey, profileText, mood, candidates, topN = 8, model, fetchFn } = opts;
  const user = [
    `TASTE PROFILE:\n${profileText}`,
    mood ? `\nMOOD RIGHT NOW: ${mood}` : "",
    `\nCANDIDATES:\n${JSON.stringify(candidates.map(c => ({
      title: c.title, origin: c.origin, installed: c.installed,
      genres: c.genres, tags: c.tags, signals: c.stage1Reasons,
      price: c.priceCents !== null ? `$${(c.priceCents / 100).toFixed(2)}` : undefined,
    })), null, 1)}`,
    `\nReturn the best ${topN}.`,
  ].join("\n");

  const raw = await claudeComplete({ apiKey, system: SYSTEM, user, model, fetchFn });
  const ranked = extractJson<{ title: string; why: string }[]>(raw);
  const byTitle = new Map(candidates.map(c => [normalizeTitle(c.title), c]));
  const items: RecItem[] = [];
  for (const r of ranked) {
    const c = byTitle.get(normalizeTitle(r.title));
    if (!c) continue; // anti-hallucination: only candidates survive
    items.push({ title: c.title, why: r.why, origin: c.origin, steam_appid: c.steam_appid,
                 game_id: c.game_id, installed: c.installed, priceCents: c.priceCents });
    if (items.length >= topN) break;
  }
  return items;
}

export function fallbackRank(candidates: UnifiedCandidate[], topN = 8): RecItem[] {
  return candidates.slice(0, topN).map(c => ({
    title: c.title, why: c.stage1Reasons.join("; ") || "matches your library profile",
    origin: c.origin, steam_appid: c.steam_appid, game_id: c.game_id,
    installed: c.installed, priceCents: c.priceCents,
  }));
}
```

`src/lib/recommend/run.ts`:

```ts
import { getDb } from "../db";
import { getSetting } from "../settings";
import { currentProfile, regenerateProfile } from "../profile/store";
import { scoreBacklog } from "./stage1";
import { discoverCandidates } from "./discovery";
import { rerank, fallbackRank, type RecMode, type RecItem, type UnifiedCandidate } from "./rerank";
import type { Game } from "../types";
import type { GameWithMeta } from "../profile/signals";

export interface RecRun {
  id: number; created_at: number; mode: RecMode; mood_prompt: string | null;
  items: RecItem[]; degraded: boolean; staleWarning: boolean;
}

async function loadLibrary(): Promise<GameWithMeta[]> {
  const db = await getDb();
  const rows = await db.select<(Game & { genres: string | null; tags: string | null })[]>(
    "SELECT g.*, m.genres, m.tags FROM games g LEFT JOIN game_meta m ON m.game_id = g.id");
  return rows.map(r => ({ game: r as Game, genres: r.genres ? JSON.parse(r.genres) : [], tags: r.tags ? JSON.parse(r.tags) : [] }));
}

export async function runRecommendation(mode: RecMode, mood?: string): Promise<RecRun> {
  const anthropicKey = await getSetting("anthropic_api_key");
  const rawgKey = await getSetting("rawg_api_key");
  const model = (await getSetting("anthropic_model")) ?? undefined;
  const thresholdHours = Number((await getSetting("playtime_threshold_hours")) ?? "2");

  const profile = (await currentProfile()) ?? (await regenerateProfile("manual"));
  const library = await loadLibrary();

  const unified: UnifiedCandidate[] = [];
  if (mode !== "discovery") {
    for (const c of scoreBacklog(library, profile.profile_json, { playtimeThresholdHours: thresholdHours }))
      unified.push({ title: c.game.title, origin: "backlog", steam_appid: c.game.steam_appid,
                     game_id: c.game.id, installed: !!c.game.installed, priceCents: null,
                     genres: c.genres, tags: c.tags, stage1Reasons: c.reasons });
  }
  let staleWarning = false;
  if (mode !== "backlog") {
    if (!anthropicKey) throw new Error("Discovery requires an Anthropic API key (Settings).");
    const d = await discoverCandidates({
      anthropicKey, rawgKey: rawgKey || null, profileText: profile.profile_text,
      ownedTitles: library.map(x => x.game.title), mood, model,
    });
    staleWarning = d.staleWarning;
    for (const c of d.candidates)
      unified.push({ title: c.title, origin: "discovery", steam_appid: c.steam_appid, game_id: null,
                     installed: false, priceCents: c.priceCents, genres: c.genres, tags: c.tags,
                     stage1Reasons: [c.reason] });
  }

  const degraded = !anthropicKey;
  const items = degraded
    ? fallbackRank(unified)
    : await rerank({ apiKey: anthropicKey!, profileText: profile.profile_text, mood, candidates: unified, model });

  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const res = await db.execute(
    "INSERT INTO recommendations (created_at, mode, mood_prompt, results_json) VALUES ($1,$2,$3,$4)",
    [now, mode, mood ?? null, JSON.stringify(items)]);
  return { id: res.lastInsertId as number, created_at: now, mode, mood_prompt: mood ?? null, items, degraded, staleWarning };
}

export async function recordFeedback(
  recId: number, title: string,
  feedback: "launched" | "dismissed_not_interested" | "dismissed_wont_run"
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ feedback_json: string }[]>(
    "SELECT feedback_json FROM recommendations WHERE id = $1", [recId]);
  if (!rows.length) return;
  const fb = JSON.parse(rows[0].feedback_json) as Record<string, string>;
  fb[title] = feedback;
  await db.execute("UPDATE recommendations SET feedback_json = $1 WHERE id = $2", [JSON.stringify(fb), recId]);
}

export async function latestRuns(limit = 10): Promise<RecRun[]> {
  const db = await getDb();
  const rows = await db.select<any[]>(
    "SELECT * FROM recommendations ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.map(r => ({ id: r.id, created_at: r.created_at, mode: r.mode, mood_prompt: r.mood_prompt,
    items: JSON.parse(r.results_json), degraded: false, staleWarning: false }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/recommend/rerank.test.ts` → Expected: 3 passed. `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommend
git commit -m "feat: stage-2 rerank with anti-hallucination filter, degraded fallback, run persistence"
```

---

### Task 9: Recommendations page (home)

**Files:**
- Create: `src/pages/RecommendPage.tsx`, `src/components/RecCard.tsx`
- Modify: `src/App.tsx` (add tab, make it default), `src/App.css`

**Interfaces:**
- Consumes: `runRecommendation`, `recordFeedback`, `latestRuns` (Task 8), `launchGame` (Plan 1 Task 8), `setGameStatus` (Task 1), `regenerateProfile` (Task 3), `openUrl` from `@tauri-apps/plugin-opener`
- Produces: the home screen.

- [ ] **Step 1: Build RecCard** — `src/components/RecCard.tsx`

```tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import type { RecItem } from "../lib/recommend/rerank";
import { launchGame } from "../lib/games";
import { setGameStatus } from "../lib/ratings";
import { recordFeedback } from "../lib/recommend/run";

export default function RecCard({ recId, item, onFeedback }:
  { recId: number; item: RecItem; onFeedback: () => void }) {

  async function launch() {
    if (item.steam_appid) await launchGame(item.steam_appid);
    await recordFeedback(recId, item.title, "launched");
    onFeedback();
  }
  async function dismiss(kind: "dismissed_not_interested" | "dismissed_wont_run") {
    await recordFeedback(recId, item.title, kind);
    if (item.game_id) await setGameStatus(item.game_id, kind === "dismissed_wont_run" ? "wont_run" : "not_interested");
    onFeedback();
  }
  async function store() {
    if (item.steam_appid) await openUrl(`https://store.steampowered.com/app/${item.steam_appid}`);
  }

  return (
    <div className="card">
      <div className="card-head">
        <strong>{item.title}</strong>
        <span className="origin">{item.origin === "discovery"
          ? (item.priceCents !== null ? `new · $${(item.priceCents / 100).toFixed(2)}` : "new")
          : (item.installed ? "owned · installed" : "owned")}</span>
      </div>
      <p>{item.why}</p>
      <div className="row">
        {item.origin === "backlog" && item.installed && item.steam_appid
          ? <button onClick={launch}>▶ Launch</button> : null}
        {item.origin === "backlog" && !item.installed
          ? <button onClick={store}>Install via Steam</button> : null}
        {item.origin === "discovery" && item.steam_appid
          ? <button onClick={store}>View on Steam</button> : null}
        <button onClick={() => dismiss("dismissed_not_interested")}>Not interested</button>
        {item.origin === "backlog"
          ? <button onClick={() => dismiss("dismissed_wont_run")}>Won't run</button> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build RecommendPage** — `src/pages/RecommendPage.tsx`

```tsx
import { useEffect, useState } from "react";
import { runRecommendation, latestRuns, type RecRun } from "../lib/recommend/run";
import type { RecMode } from "../lib/recommend/rerank";
import { regenerateProfile } from "../lib/profile/store";
import RecCard from "../components/RecCard";

export default function RecommendPage() {
  const [mode, setMode] = useState<RecMode>("backlog");
  const [mood, setMood] = useState("");
  const [run, setRun] = useState<RecRun | null>(null);
  const [history, setHistory] = useState<RecRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { latestRuns().then(setHistory); }, [run]);

  async function go() {
    setBusy(true); setErr("");
    try {
      await regenerateProfile("manual");           // profile always fresh at rec time
      setRun(await runRecommendation(mode, mood.trim() || undefined));
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <h2>What should I play?</h2>
      <div className="row">
        {(["backlog", "mixed", "discovery"] as RecMode[]).map(m =>
          <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
            {m === "backlog" ? "My backlog" : m === "mixed" ? "Mix" : "New games"}</button>)}
        <input placeholder="Mood (optional): short & chill, big RPG, co-op…"
          value={mood} onChange={e => setMood(e.target.value)} style={{ flex: 1 }} />
        <button onClick={go} disabled={busy}>{busy ? "Thinking…" : "Recommend"}</button>
      </div>
      {err && <p className="error">{err}</p>}
      {run?.degraded && <p className="warn">No Anthropic key set — showing basic heuristic ranking only.</p>}
      {run?.staleWarning && <p className="warn">No RAWG key — discovery may miss very recent releases.</p>}
      {run?.items.length === 0 && mode === "backlog" &&
        <p>Backlog zero! Every owned game has playtime past your threshold — try Discovery mode.</p>}
      {run?.items.map(item =>
        <RecCard key={item.title} recId={run.id} item={item} onFeedback={() => {}} />)}
      {!run && history.length > 0 && <>
        <h3>Previous runs</h3>
        {history.map(h => <div key={h.id} className="row">
          <a style={{ cursor: "pointer" }} onClick={() => setRun(h)}>
            {new Date(h.created_at * 1000).toLocaleString()} — {h.mode}{h.mood_prompt ? ` · "${h.mood_prompt}"` : ""}</a>
        </div>)}
      </>}
    </div>
  );
}
```

- [ ] **Step 3: Wire the tab**

In `src/App.tsx`, extend the tab union and nav: `const [tab, setTab] = useState<"recommend" | "library" | "settings">("recommend");` with a Recommend button first, rendering `<RecommendPage />` when active. Append to `src/App.css`:

```css
.card { border: 1px solid #4444; border-radius: 8px; padding: .75rem 1rem; margin: .75rem 0; }
.card-head { display: flex; justify-content: space-between; }
.origin { opacity: .6; font-size: .85em; }
.error { color: #c33; } .warn { color: #b80; }
button.active { outline: 2px solid #58a; }
```

- [ ] **Step 4: Manual verification**

`npm run tauri dev` with real keys: run Backlog mode (works even without Anthropic key — verify degraded banner by clearing the key), then Mixed with a mood. Verify: launch button opens Steam, dismiss buttons update `recommendations.feedback_json` and game status, discovery items show price/store link. `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: recommendations home with mode tuner, mood prompt, rec cards"
```

---

## Plan 2 exit criteria

- All Vitest suites green.
- With keys: Mixed-mode run returns personally-reasoned picks from both pools; feedback and status flow back into the next profile regeneration.
- Without Anthropic key: backlog mode still ranks and explains via stage-1 signals (degraded banner shown).
