import { useEffect, useState } from "react";
import { currentProfile, profileHistory, regenerateProfile, type StoredProfile } from "../lib/profile/store";
import { getSetting, setSetting } from "../lib/settings";

export default function ProfilePage() {
  const [profile, setProfile] = useState<StoredProfile | null>(null);
  const [history, setHistory] = useState<StoredProfile[]>([]);
  const [notes, setNotes] = useState("");
  const [viewing, setViewing] = useState<StoredProfile | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    setProfile(await currentProfile());
    setHistory(await profileHistory());
    setNotes((await getSetting("taste_notes")) ?? "");
  }
  useEffect(() => { load(); }, []);

  async function saveNotes() {
    try {
      await setSetting("taste_notes", notes);
      await regenerateProfile("manual");   // notes are top-tier signal; must take effect immediately
      await load();
      setMsg("Notes saved, profile regenerated.");
    } catch (e) { setMsg(`Error: ${String(e)}`); }
  }
  async function regen() {
    try { await regenerateProfile("manual"); await load(); setMsg("Regenerated."); }
    catch (e) { setMsg(`Error: ${String(e)}`); }
  }

  const shown = viewing ?? profile;
  const when = (t: number) => new Date(t * 1000).toLocaleString();

  return (
    <div className="page">
      <h2>Taste profile</h2>
      <label>Your own words (highest-priority signal):
        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder='e.g. "Done with roguelikes. Prefer controller-friendly. Love a good story."' /></label>
      <div className="row"><button onClick={saveNotes}>Save notes</button>
        <button onClick={regen}>Regenerate profile</button><span>{msg}</span></div>
      {shown ? <>
        <h3>{viewing ? `Version from ${when(shown.generated_at)}` : `Current (${when(shown.generated_at)}, trigger: ${shown.trigger_reason})`}
          {viewing && <button onClick={() => setViewing(null)}> back to current</button>}</h3>
        <pre className="profile-text">{shown.profile_text}</pre>
      </> : <p>No profile yet — sync your library first.</p>}
      <h3>History</h3>
      <ul>{history.map(h =>
        <li key={h.id}><a onClick={() => setViewing(h)} style={{ cursor: "pointer" }}>
          {when(h.generated_at)} — {h.trigger_reason}</a></li>)}</ul>
    </div>
  );
}
