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
