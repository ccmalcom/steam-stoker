# Stoker — MVP Design

*2026-07-08. Approved section-by-section in brainstorming. Sibling project to MyLibrary (books); this is games. Solo, personal, desktop.*

## Vision

Stoker is a native Windows Steam companion app that answers one question well: **"what should I play next?"** — from your existing backlog or from games you don't own yet, tuneably mixed. It syncs your Steam library automatically, accepts manual entries for games from other platforms, builds a persistent taste profile from playtime + explicit ratings, and produces ranked recommendations with per-game reasoning via a two-stage recommender (heuristic retrieval → Claude rerank).

Named for the crew member who feeds a steam engine's firebox: the app keeps you fueled with the next game.

## Locked decisions (do not relitigate)

1. **Steam is the only automated sync source.** Via the official Web API (`GetOwnedGames`: every owned game + playtime + last-played). Xbox/PSN/Epic/EA are manual-add only — their APIs are absent, gated, or reverse-engineered and fragile. Manual games exist primarily as taste-profile signal.
2. **Native app: Tauri 2** + React/TypeScript frontend + SQLite (Tauri SQL plugin). No server, no hosting, no auth, no multi-user — ever, for this project. Official Tauri plugins (fs, http, sql, shell/opener) mean near-zero Rust.
3. **Hybrid Steam integration:** Web API for the canonical library (installed or not); local scan of `steamapps` folders (`appmanifest_*.acf`, discovered via `libraryfolders.vdf`, with manual override — Chase uses `C:\games` / `D:\games`) for install state + disk size; `steam://run/<appid>` for one-click launch. Local file parsing is best-effort — a Steam client format change degrades companion features, never core sync.
4. **The recommender is two-stage** (retrieval → Claude rerank). The LLM is not the recommender for backlog mode; heuristic stage-1 must work standalone (offline/keyless fallback). Mirrors MyLibrary's locked decision #3.
5. **Discovery candidates come from Claude with RAWG tool access** (not IGDB, not a raw catalog dump): Claude reasons from the taste profile and calls RAWG tools (`search_games`, `get_similar`, `new_releases_by_genre`) for freshness and title validation, then the app resolves results to Steam appids via store search and filters owned games.
6. **Explicit signal outranks implicit.** User-authored taste notes > explicit ratings/reviews > playtime > rec feedback. Mirrors MyLibrary's `app_review` weighting rule.
7. **Dislikes are first-class.** The taste profile carries an explicit *avoid* tier from 1–2★ ratings. Negative space is half the picture.
8. **`wont_run` is not a taste signal.** Games that don't work on this system (e.g., AC Origins) are excluded from backlog recs but are neutral to the profile — technical rejection ≠ dislike.
9. **Enrichment is lazy and cached.** Steam store `appdetails` (free, keyless, rate-limited) fills genres/tags/description in a background queue after sync, cached permanently. Manual games enrich via title search (Steam store, RAWG fallback).
10. **Desktop-first UI.** Mobile is out of scope entirely (you rate and browse at the PC you play on).

## Data model (SQLite)

### `games`
One row per owned game, any source.

| column | notes |
|---|---|
| `id` | PK |
| `steam_appid` | nullable (manual games), unique when present |
| `source` | `'steam'` \| `'manual'` |
| `platform` | for manual: `xbox` \| `psn` \| `epic` \| `ea` \| `other`; `steam` otherwise |
| `title` | |
| `playtime_minutes` | Steam-synced, or manual estimate |
| `last_played_at` | from `GetOwnedGames` `rtime_last_played` |
| `installed` | bool, from local scan |
| `install_size_bytes` | nullable |
| `user_rating` | 1–5, nullable — **current** value |
| `user_review` | text, nullable — **current** value |
| `status` | `'active'` \| `'not_interested'` \| `'finished'` \| `'wont_run'` |
| `added_at` | |

Rating/review live as columns (1:1 forever, solo app); history lives in `rating_events`.

### `rating_events`
Append-only. `game_id`, `rating`, `review_text`, `created_at`. Every rating and re-rating appends; `games.user_rating/user_review` mirror the latest. Preserves "disliked it in 2026, loved it in 2027."

### `game_meta`
Enrichment cache keyed to `games.id`: `genres` (JSON), `tags` (JSON), `description`, `header_image_url`, `release_date`, `metacritic`. Separate table because its lifecycle differs (lazily filled, re-fetchable).

### `taste_profile`
Versioned, first-class — not an ephemeral prompt artifact.
`id`, `generated_at`, `profile_json` (structured: weighted loved genres/tags, loved games, avoid tier, patterns), `profile_text` (rendered block sent to Claude), `trigger` (`'sync'` \| `'rating_change'` \| `'manual'`), `is_current`. Old versions are kept and browsable.
Plus a persistent **user notes** field (stored in `settings`, merged into every generation) — e.g., "done with roguelikes," "prefer controller-friendly." Notes are the top signal tier.

### `recommendations`
`id`, `created_at`, `mode` (`'backlog'` \| `'mixed'` \| `'discovery'`), `mood_prompt`, `results_json` (ranked: title, appid/game_id, origin pool, score, reason), per-item `feedback` (`'launched'` \| `'dismissed_not_interested'` \| `'dismissed_wont_run'` \| null). Feedback loops into the profile as the lightest signal tier.

### `settings`
Key/value: Steam API key, SteamID64, Anthropic key, RAWG key, library folder paths (JSON), taste notes, last-sync timestamp, tunables (playtime threshold, stage-1 weights), onboarding-complete flag.

## Recommender

### Stage 1 — candidates
- **Backlog:** pool = owned, `status='active'`, playtime < threshold (default 2 h, tunable). Score = weighted tag/genre overlap with profile + installed boost + variety bonus (penalize similarity to most-recent play). Top ~20 advance.
- **Discovery:** Claude + RAWG tools proposes ~20 titles matching the profile (told the library in compressed form to exclude it); app validates → Steam appid, price, store link; unresolvable titles dropped; owned titles filtered.
- **Mixed:** both pools, tagged by origin.

### Stage 2 — rerank
One Claude call: `profile_text` + optional mood prompt ("short and chill tonight") + candidate metadata. Returns top 5–10, each with a 1–2 sentence personal "why." Persisted to `recommendations`; rendered as cards — installed backlog games get **Launch** (`steam://run/`), discovery games get a store link. Dismissing asks which flavor of no: not interested (taste signal) vs. won't run (neutral).

### Cold start
Effectively none: first sync imports years of playtime signal, so day-one backlog recs work unrated. The onboarding rating sprint sharpens the profile immediately after.

### Degraded modes
- No Anthropic key / offline → backlog mode runs on stage-1 scores alone (plain reasons); discovery disabled.
- RAWG down/keyless → Claude discovers from its own knowledge, results flagged possibly stale.
- Steam Web API down → app fully usable on last-synced data.

## UX (desktop-first)

1. **Onboarding wizard:** Steam API key walkthrough (link to Valve key page) → SteamID64 auto-resolve from vanity URL (`ResolveVanityURL`) → library-folder confirm (auto-discovered, editable) → first sync → **rating sprint** (top ~20 by playtime, fast 1–5 star taps, review optional, skippable; then an optional second pass — "any games you bounced off?" — with library search, to seed the avoid tier) → first recommendation.
2. **Recommendations (home):** Backlog / Mixed / New tuner, mood prompt box, rec cards (art, reason, Launch/Store, dismiss-with-flavor), history.
3. **Library:** sortable/filterable grid (playtime, rating, installed, source, status), inline rating/review, manual-add form (title + platform + playtime estimate + rating + review, catalog title-search auto-enrich), status controls.
4. **Taste profile:** current profile, editable notes, version history, regenerate.
5. **Settings:** keys, library paths, sync now, tunables.

## Error handling & testing

- All external calls (Steam Web API, store appdetails, RAWG, Anthropic) get timeouts, typed error states surfaced in UI, and never corrupt local data; sync is upsert-only and never clobbers `user_rating`/`user_review`/`status` (mirrors MyLibrary locked decision #2).
- ACF/VDF parsing failures degrade to "install state unknown," logged, non-fatal.
- Tests: VDF/ACF parser fixtures, sync upsert invariants (ratings survive re-sync), stage-1 scoring determinism, discovery validator (drops unresolvable/owned titles), profile generation tiering.

## Out of scope (MVP)

Mobile, multi-user, achievements, friends/social data, price tracking/deal alerts, HowLongToBeat integration, non-Steam automated sync, IGDB. Any of these can come later without breaking the model above.

## Next step

Invoke `writing-plans` to produce the implementation plan. Implementation/build work should run on a cheaper model than Fable.
