import { useEffect, useState } from "react";
import { getSetting, setSetting, getLibraryPaths, setLibraryPaths } from "../lib/settings";
import { runFullSync } from "../lib/steam/sync";
import { enrichPending } from "../lib/steam/enrich";
import { resolveVanityUrl } from "../lib/steam/webapi";
import { openExternal } from "../lib/openExternal";
import { THEMES, THEME_LABELS, THEME_SWATCH, applyTheme, isTheme, DEFAULT_THEME, type Theme } from "../lib/theme";

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [steamKey, setSteamKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [vanity, setVanity] = useState("");
  const [paths, setPaths] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [rawgKey, setRawgKey] = useState("");
  const [threshold, setThreshold] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      setSteamKey((await getSetting("steam_api_key")) ?? "");
      setSteamId((await getSetting("steam_id64")) ?? "");
      setPaths((await getLibraryPaths()).join("\n"));
      setAnthropicKey((await getSetting("anthropic_api_key")) ?? "");
      setAnthropicModel((await getSetting("anthropic_model")) ?? "");
      setRawgKey((await getSetting("rawg_api_key")) ?? "");
      setThreshold((await getSetting("playtime_threshold_hours")) ?? "");
      setLastSync(await getSetting("last_sync_at"));
      const t = await getSetting("theme");
      if (isTheme(t)) setTheme(t);
    })();
  }, []);

  // Persist and paint immediately — theme changes should feel instant, no Save needed.
  async function chooseTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    await setSetting("theme", t);
  }

  async function save() {
    await setSetting("steam_api_key", steamKey.trim());
    await setSetting("steam_id64", steamId.trim());
    await setLibraryPaths(paths.split("\n").map(p => p.trim()).filter(Boolean));
    await setSetting("anthropic_api_key", anthropicKey.trim());
    await setSetting("anthropic_model", anthropicModel.trim());
    await setSetting("rawg_api_key", rawgKey.trim());
    await setSetting("playtime_threshold_hours", threshold.trim());
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
      setLastSync(await getSetting("last_sync_at"));
      setMsg(`Synced: ${r.added} added, ${r.updated} updated, ${r.installedMarked} installed. Enriching…`);
      const n = await enrichPending();
      setMsg(m => m + ` ${n} enriched.`);
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  }

  async function rerunOnboarding() {
    await setSetting("onboarding_complete", "0");
    window.location.reload();
  }

  return (
    <div className="page">
      <h2>Settings</h2>

      <h3>Appearance</h3>
      <label>Theme
        <div className="theme-picker" role="group" aria-label="Theme">
          {THEMES.map(t => (
            <button key={t} type="button" className="theme-swatch"
              aria-pressed={theme === t} onClick={() => chooseTheme(t)}>
              <span className="dot" style={{ background: THEME_SWATCH[t] }} />{THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </label>

      <h3>Steam</h3>
      <label>Steam Web API key <a href="https://steamcommunity.com/dev/apikey" onClick={e => { e.preventDefault(); openExternal("https://steamcommunity.com/dev/apikey"); }}>get one</a>
        <input type="password" value={steamKey} onChange={e => setSteamKey(e.target.value)} /></label>
      <label>SteamID64
        <input value={steamId} onChange={e => setSteamId(e.target.value)} /></label>
      <label>…or resolve from vanity URL name
        <span className="row"><input value={vanity} onChange={e => setVanity(e.target.value)} />
        <button onClick={resolve}>Resolve</button></span></label>
      <label>Steam library folders (one per line; leave empty to auto-discover)
        <textarea rows={3} value={paths} onChange={e => setPaths(e.target.value)} /></label>

      <h3>Recommendations</h3>
      <label>Anthropic API key (enables discovery + Claude rerank; backlog works without it)
        <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} /></label>
      <label>Anthropic model
        <input value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)} placeholder="claude-sonnet-5" /></label>
      <label>RAWG API key <a href="https://rawg.io/apidocs" onClick={e => { e.preventDefault(); openExternal("https://rawg.io/apidocs"); }}>get one</a> (fresh-release lookups in discovery)
        <input type="password" value={rawgKey} onChange={e => setRawgKey(e.target.value)} /></label>
      <label>Backlog playtime threshold (hours)
        <input type="number" min="0" step="0.5" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="2" />
        <span className="hint">games under this playtime count as backlog</span></label>

      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={sync} disabled={busy}>Sync now</button>
      </div>
      <p className="hint">Last sync: {lastSync ? new Date(Number(lastSync) * 1000).toLocaleString() : "never"}</p>
      <p><button onClick={rerunOnboarding}>Re-run onboarding</button></p>
      <p>{msg}</p>
    </div>
  );
}
