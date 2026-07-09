import { useState } from "react";
import type { Game, GameStatus } from "../lib/types";
import { launchGame } from "../lib/games";
import { rateGame, setGameStatus } from "../lib/ratings";
import StarRating from "./StarRating";

export default function GameRow({ game, genres, onChanged }:
  { game: Game; genres: string | null; onChanged: () => void }) {
  const [rating, setRating] = useState<number | null>(game.user_rating);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const hours = (game.playtime_minutes / 60).toFixed(1);

  async function setStars(n: number) {
    const prev = rating;
    const next = rating === n ? null : n;      // click current star again to clear
    setRating(next);
    setRatingError(null);
    try {
      await rateGame(game.id, next);
      onChanged();
    } catch (e) {
      setRating(prev);
      setRatingError(`Failed to update rating: ${e instanceof Error ? e.message : "Unknown error"}`);
      console.error("Failed to rate game:", e);
    }
  }
  async function changeStatus(s: GameStatus) { await setGameStatus(game.id, s); onChanged(); }

  return (
    <>
      <tr className={game.status === "not_interested" || game.status === "wont_run" ? "muted" : ""}>
        <td>{game.title}{game.source === "manual" ? ` (${game.platform})` : ""}</td>
        <td>{hours} h</td>
        <td>{game.installed ? "✔" : ""}</td>
        <td>
          <span className="row" style={{ gap: 0 }}>
            <StarRating value={rating ?? 0} onChange={setStars} showValue />
            {rating !== null && <span className="star-clear" onClick={() => setStars(rating)} title="Clear rating">clear</span>}
          </span>
          {ratingError && <div style={{ color: "red", fontSize: "0.8em" }}>{ratingError}</div>}
        </td>
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
    </>
  );
}
