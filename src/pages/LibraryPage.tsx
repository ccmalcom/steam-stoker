import { useEffect, useState } from "react";
import { listGames, type LibraryFilter } from "../lib/games";
import type { Game } from "../lib/types";
import GameRow from "../components/GameRow";

export default function LibraryPage() {
  const [filter, setFilter] = useState<LibraryFilter>({ sort: "playtime" });
  const [games, setGames] = useState<(Game & { genres: string | null })[]>([]);

  useEffect(() => { listGames(filter).then(setGames); }, [filter]);
  const reload = () => listGames(filter).then(setGames);

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
        : <table><tbody>{games.map(g => <GameRow key={g.id} game={g} genres={g.genres} onChanged={reload} />)}</tbody></table>}
    </div>
  );
}
