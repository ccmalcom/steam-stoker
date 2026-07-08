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
