import { useEffect, useState } from "react";
import RecommendPage from "./pages/RecommendPage";
import LibraryPage from "./pages/LibraryPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import { isOnboardingComplete } from "./lib/onboarding";
import { getSetting } from "./lib/settings";
import { applyTheme, isTheme, DEFAULT_THEME } from "./lib/theme";
import "./App.css";

type Tab = "recommend" | "library" | "profile" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "recommend", label: "Recommend" },
  { id: "library", label: "Library" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("recommend");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    // Apply the saved accent theme before first paint of the app UI. `||` (not `??`)
    // guards the empty-string settings trap; unknown/blank values fall back to default.
    getSetting("theme").then(v => applyTheme(isTheme(v) ? v : DEFAULT_THEME));
    isOnboardingComplete().then(done => {
      setOnboarded(done);
      // Auto-sync only when the app launches *already* onboarded — not on the wizard's
      // false→true transition, since the wizard already runs a full sync + profile build.
      if (done) launchSync();
    });
  }, []);

  async function launchSync() {
    try {
      const { runFullSync } = await import("./lib/steam/sync");
      const { enrichPending } = await import("./lib/steam/enrich");
      const { regenerateProfile } = await import("./lib/profile/store");
      await runFullSync();
      await regenerateProfile("sync");
      enrichPending({ limit: 50 });   // fire and forget
    } catch { /* offline or keyless: app remains usable on last-synced data (spec degraded mode) */ }
  }

  if (onboarded === null) return null;
  if (!onboarded) return <OnboardingWizard onFinished={() => setOnboarded(true)} />;
  return (
    <div className="app">
      <header className="appbar">
        <span className="brand">Stoker</span>
        <nav className="tabs">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? "tab on" : "tab"}
              aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "recommend" ? <RecommendPage /> : tab === "library" ? <LibraryPage />
          : tab === "profile" ? <ProfilePage /> : <SettingsPage />}
      </main>
    </div>
  );
}
