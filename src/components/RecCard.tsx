import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { RecItem } from "../lib/recommend/rerank";
import { launchGame } from "../lib/games";
import { setGameStatus } from "../lib/ratings";
import { addManualGame } from "../lib/manual";
import { recordFeedback } from "../lib/recommend/run";
import StarRating from "./StarRating";

export default function RecCard({ recId, item, onFeedback }:
  { recId: number; item: RecItem; onFeedback: () => void }) {
  const [rating, setRating] = useState(false);   // showing the "already played" star picker
  const [saving, setSaving] = useState(false);

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
  // "Already played" for a discovery pick not yet tracked: add it to the library as a
  // finished, rated game (so it feeds taste and is excluded from future discovery).
  async function markPlayed(stars: number) {
    if (saving) return;
    setSaving(true);
    try {
      const gameId = await addManualGame({ title: item.title, platform: "other", playtimeHours: 0, rating: stars, review: null });
      await setGameStatus(gameId, "finished");
      await recordFeedback(recId, item.title, "already_played");
      onFeedback();
    } finally { setSaving(false); }
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
      {rating
        ? <div className="row">
            <span>Already played — how was it?</span>
            <StarRating value={0} onChange={markPlayed} showValue />
            <button onClick={() => setRating(false)} disabled={saving}>Cancel</button>
          </div>
        : <div className="row">
            {item.origin === "backlog" && item.installed && item.steam_appid
              ? <button onClick={launch}>▶ Launch</button> : null}
            {item.origin === "backlog" && !item.installed
              ? <button onClick={store}>Install via Steam</button> : null}
            {item.origin === "discovery" && item.steam_appid
              ? <button onClick={store}>View on Steam</button> : null}
            {item.origin === "discovery"
              ? <button onClick={() => setRating(true)}>Already played</button> : null}
            <button onClick={() => dismiss("dismissed_not_interested")}>Not interested</button>
            {item.origin === "backlog"
              ? <button onClick={() => dismiss("dismissed_wont_run")}>Won't run</button> : null}
          </div>}
    </div>
  );
}
