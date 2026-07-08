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
