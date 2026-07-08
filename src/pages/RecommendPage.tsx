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
