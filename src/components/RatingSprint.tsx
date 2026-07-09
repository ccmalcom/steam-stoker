import { useEffect, useState } from "react";
import type { Game } from "../lib/types";
import { rateGame } from "../lib/ratings";
import { sprintGames } from "../lib/onboarding";
import { listGames } from "../lib/games";
import StarRating from "./StarRating";

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
          <td><StarRating value={rated.get(g.id) ?? 0} onChange={n => rate(g, n)} showValue /></td>
        </tr>)}
      </tbody></table>
      <button onClick={onDone}>{rated.size ? `Done (${rated.size} rated)` : "Skip"}</button>
    </div>
  );
}
