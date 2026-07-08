# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stoker: a Tauri + React + TypeScript desktop app that syncs a user's Steam library, tracks ratings/status per game, builds a versioned taste profile, and recommends what to play next (backlog re-engagement and/or new-game discovery) using the Anthropic API and RAWG.

Implementation is being driven by a sequence of plans in `docs/superpowers/plans/` against the spec in `docs/superpowers/specs/2026-07-08-stoker-mvp-design.md`. Read the spec for product/behavior decisions ("locked decisions") before changing recommendation or profile logic.

## Commands

- `npm test` — run the full Vitest suite once (no watch mode configured)
- `npx vitest run <path>` — run a single test file
- `npm run dev` — Vite dev server only (frontend, no Tauri shell)
- `npm run tauri dev` — full Tauri app (required for any manual verification touching SQLite, HTTP, or filesystem access)
- `npm run build` — `tsc` typecheck + Vite production build

There is no lint script configured.

## Architecture

**Pure logic / thin adapter split.** All business logic lives in `src/lib/**` as plain functions with no Tauri imports baked in — network calls take an injectable `fetchFn: FetchFn` (default `@tauri-apps/plugin-http`'s `fetch`), and DB calls go through `getDb()` from `src/lib/db.ts`. This is what makes the logic unit-testable under plain Vitest without a Tauri runtime. `src/pages/*` and `src/components/*` are thin — they call `src/lib` functions and render state, they don't contain business logic.

**Database:** a single SQLite file (`stoker.db`) opened via `@tauri-apps/plugin-sql`. Schema is plain `CREATE TABLE IF NOT EXISTS` statements in `src/lib/schema.ts`, applied idempotently every time `getDb()` first runs — there is no separate migration system. Add new tables/columns by extending `SCHEMA_STATEMENTS`.

Key tables: `games` (one row per owned/manual game; `status` is `active | not_interested | finished | wont_run`), `rating_events` (append-only rating/review history), `game_meta` (genres/tags/description enrichment, one row per game), `taste_profile` (versioned, `is_current` flag marks the active one), `recommendations` (one row per recommendation run, `results_json` + `feedback_json`), `settings` (key/value store — see `SETTINGS_KEYS` in `src/lib/settings.ts` for the known keys, e.g. API keys, `taste_notes`, `playtime_threshold_hours`).

**Steam integration** (`src/lib/steam/`): `webapi.ts` calls the Steam Web API (`GetOwnedGames`, `ResolveVanityURL`); `scan.ts`/`acf.ts` discover local Steam library folders and parse `.acf` manifests to detect installed games and disk size; `enrich.ts` lazily fetches per-app store metadata (genres/tags) with rate limiting and miss-caching so a full library doesn't hammer the store API; `sync.ts` (`runFullSync`) orchestrates all of the above — merges owned games into `games` (insert/update/skip via `planMerge`, never clobbering user-set fields like rating/review/status), then reconciles `installed`/`install_size_bytes` against the local scan.

**External APIs used directly over HTTP (no SDKs):** Steam Web API, Steam store search API, Anthropic Messages API (`anthropic-version: 2023-06-01`, default model `claude-sonnet-5`, overridable via the `anthropic_model` setting), and RAWG. The Anthropic client wraps Claude's tool-use loop generically (pass `tools` + `handlers`, it round-trips tool calls until a final text response).

**Recommendation flow (two-stage):** stage 1 is a pure heuristic backlog scorer that must produce a usable ranking with zero API keys (this is a locked product decision — never make the LLM required for backlog mode). Stage 2 (discovery + rerank) calls Claude, optionally with RAWG tools for fresh-release lookups, and always filters/validates model output against the actual candidate set before trusting it (anti-hallucination: never surface a title the model invented that isn't in the candidate list). Signal hierarchy for taste, highest to lowest priority: user-authored notes > explicit ratings > playtime > rec feedback. Games marked `wont_run` are excluded from candidates and must never be used as a taste signal (technically broken ≠ disliked).

## Testing conventions

Every `src/lib` module with logic worth testing has a co-located `*.test.ts`. Tests inject a fake `fetchFn` (returning a `Response`) rather than mocking `fetch` globally, and inject fake data rather than hitting `getDb()` where the function under test is pure. Follow this pattern for new modules: keep the core function pure/injectable, test it directly, and let the thin Tauri-wired wrapper go unverified by unit tests (verify those manually via `npm run tauri dev`).
