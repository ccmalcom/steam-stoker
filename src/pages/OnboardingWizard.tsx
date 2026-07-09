import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type WizardStep, nextStep, completeOnboarding } from "../lib/onboarding";
import { getSetting, setSetting, setLibraryPaths } from "../lib/settings";
import { resolveVanityUrl } from "../lib/steam/webapi";
import { discoverLibraryPaths, detectSteamRoot, DEFAULT_STEAM_ROOT, tauriFs } from "../lib/steam/scan";
import { runFullSync } from "../lib/steam/sync";
import { enrichPending } from "../lib/steam/enrich";
import { regenerateProfile } from "../lib/profile/store";
import RatingSprint from "../components/RatingSprint";

export default function OnboardingWizard({ onFinished }: { onFinished: () => void }) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [key, setKey] = useState("");
  const [idInput, setIdInput] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const advance = () => setStep(nextStep(step));

  async function saveKey() { await setSetting("steam_api_key", key.trim()); advance(); }

  async function saveId() {
    let id = idInput.trim();
    if (!/^\d{17}$/.test(id)) {
      const resolved = await resolveVanityUrl((await getSetting("steam_api_key"))!, id);
      if (!resolved) { setStatus("Couldn't resolve that — paste your 17-digit SteamID64 or vanity name."); return; }
      id = resolved;
    }
    await setSetting("steam_id64", id); setStatus(""); advance();
  }

  async function confirmFolders() {
    if (paths.length === 0) {                          // first click discovers
      const root = (await detectSteamRoot()) ?? DEFAULT_STEAM_ROOT;
      const found = await discoverLibraryPaths(tauriFs, root);
      setPaths(found);
      setStatus(found.length
        ? `Found ${found.length} librar${found.length === 1 ? "y" : "ies"}.`
        : `Couldn't auto-detect Steam. Paste your Steam folder below (e.g. ${root}).`);
    } else { await setLibraryPaths(paths); setStatus(""); advance(); }
  }

  async function doSync() {
    setStatus("Syncing your Steam library…");
    const r = await runFullSync();
    setStatus(`${r.added} games imported. Fetching genre data (this continues in background)…`);
    enrichPending({ limit: 200 });   // deliberately not awaited: lazy per spec
    advance();
  }

  async function finish() {
    setStatus("Building your taste profile…");
    await regenerateProfile("manual");
    await completeOnboarding();
    onFinished();
  }

  return (
    <div className="page">
      <h2>Welcome to Stoker</h2>
      {step === "welcome" && <><p>Stoker keeps you fueled with the next game — from your backlog or beyond. Setup takes ~3 minutes.</p>
        <button onClick={advance}>Start</button></>}
      {step === "steam_key" && <><p>1/5 — Paste your Steam Web API key.
        <a href="https://steamcommunity.com/dev/apikey" onClick={e => { e.preventDefault(); openUrl("https://steamcommunity.com/dev/apikey"); }}> Get one here</a> (any domain value works, e.g. "localhost").</p>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} />
        <button onClick={saveKey} disabled={!key.trim()}>Next</button></>}
      {step === "steam_id" && <><p>2/5 — Your SteamID64 or custom profile (vanity) name.</p>
        <p className="hint">
          <a href="https://steamcommunity.com/my" onClick={e => { e.preventDefault(); openUrl("https://steamcommunity.com/my"); }}>Open my Steam profile →</a>
          {" "}then look at the URL in your browser:<br />
          • <code>steamcommunity.com/profiles/<b>7656119…</b></code> → paste that 17-digit number.<br />
          • <code>steamcommunity.com/id/<b>yourname</b></code> → paste just <code>yourname</code> and we'll resolve it.</p>
        <input value={idInput} onChange={e => setIdInput(e.target.value)} placeholder="7656119… or yourname" />
        <button onClick={saveId} disabled={!idInput.trim()}>Next</button></>}
      {step === "folders" && <><p>3/5 — Steam library folders {paths.length ? "(edit if wrong)" : "(click to auto-discover)"}:</p>
        <textarea rows={3} value={paths.join("\n")}
          onChange={e => setPaths(e.target.value.split("\n").map(p => p.trim()).filter(Boolean))} />
        <button onClick={confirmFolders}>{paths.length ? "Next" : "Discover"}</button></>}
      {step === "sync" && <><p>4/5 — Import your library.</p>
        <button onClick={doSync}>Sync now</button></>}
      {step === "sprint" && <><h3>5/5 — Teach Stoker your taste</h3>
        <RatingSprint mode="top" onDone={advance} /></>}
      {step === "bounced" && <RatingSprint mode="search" onDone={advance} />}
      {step === "done" && <><p>All set. Your taste profile is built from {`{playtime + your ratings}`} — head to Recommendations.</p>
        <button onClick={finish}>Open Stoker</button></>}
      <p>{status}</p>
    </div>
  );
}
