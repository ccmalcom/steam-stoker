import { useEffect, useState } from "react";
import { getSetting, setSetting, getLibraryPaths, setLibraryPaths } from "../lib/settings";
import { runFullSync } from "../lib/steam/sync";
import { enrichPending } from "../lib/steam/enrich";
import { resolveVanityUrl } from "../lib/steam/webapi";
import { openUrl } from "@tauri-apps/plugin-opener";

export default function SettingsPage() {
  const [steamKey, setSteamKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [vanity, setVanity] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      setSteamKey((await getSetting("steam_api_key")) ?? "");
      setSteamId((await getSetting("steam_id64")) ?? "");
      setPaths((await getLibraryPaths()).join("\n"));
    })();
  }, []);

  async function save() {
    await setSetting("steam_api_key", steamKey.trim());
    await setSetting("steam_id64", steamId.trim());
    await setLibraryPaths(paths.split("\n").map(p => p.trim()).filter(Boolean));
    setMsg("Saved.");
  }

  async function resolve() {
    const id = await resolveVanityUrl(steamKey.trim(), vanity.trim());
    if (id) { setSteamId(id); setMsg(`Resolved to ${id}`); } else setMsg("No match for that vanity URL.");
  }

  async function sync() {
    setBusy(true); setMsg("Syncing…");
    try {
      const r = await runFullSync();
      setMsg(`Synced: ${r.added} added, ${r.updated} updated, ${r.installedMarked} installed. Enriching…`);
      const n = await enrichPending();
      setMsg(m => m + ` ${n} enriched.`);
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      <label>Steam Web API key <a href="https://steamcommunity.com/dev/apikey" onClick={e => { e.preventDefault(); openUrl("https://steamcommunity.com/dev/apikey"); }}>get one</a>
        <input type="password" value={steamKey} onChange={e => setSteamKey(e.target.value)} /></label>
      <label>SteamID64
        <input value={steamId} onChange={e => setSteamId(e.target.value)} /></label>
      <label>…or resolve from vanity URL name
        <span className="row"><input value={vanity} onChange={e => setVanity(e.target.value)} />
        <button onClick={resolve}>Resolve</button></span></label>
      <label>Steam library folders (one per line; leave empty to auto-discover)
        <textarea rows={3} value={paths} onChange={e => setPaths(e.target.value)} /></label>
      <div className="row">
        <button onClick={save}>Save</button>
        <button onClick={sync} disabled={busy}>Sync now</button>
      </div>
      <p>{msg}</p>
    </div>
  );
}
