import { useEffect, useState } from "react";
import RecommendPage from "./pages/RecommendPage";
import LibraryPage from "./pages/LibraryPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingWizard from "./pages/OnboardingWizard";
import { isOnboardingComplete } from "./lib/onboarding";
import "./App.css";

export default function App() {
  const [tab, setTab] = useState<"recommend" | "library" | "profile" | "settings">("recommend");
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => { isOnboardingComplete().then(setOnboarded); }, []);

  useEffect(() => {
    if (!onboarded) return;
    (async () => {
      try {
        const { runFullSync } = await import("./lib/steam/sync");
        const { enrichPending } = await import("./lib/steam/enrich");
        const { regenerateProfile } = await import("./lib/profile/store");
        await runFullSync();
        await regenerateProfile("sync");
        enrichPending({ limit: 50 });   // fire and forget
      } catch { /* offline or keyless: app remains usable on last-synced data (spec degraded mode) */ }
    })();
  }, [onboarded]);

  if (onboarded === null) return null;
  if (!onboarded) return <OnboardingWizard onFinished={() => setOnboarded(true)} />;
  return (
    <main>
      <nav className="row">
        <button onClick={() => setTab("recommend")} disabled={tab === "recommend"}>Recommend</button>
        <button onClick={() => setTab("library")} disabled={tab === "library"}>Library</button>
        <button onClick={() => setTab("profile")} disabled={tab === "profile"}>Profile</button>
        <button onClick={() => setTab("settings")} disabled={tab === "settings"}>Settings</button>
      </nav>
      {tab === "recommend" ? <RecommendPage /> : tab === "library" ? <LibraryPage />
        : tab === "profile" ? <ProfilePage /> : <SettingsPage />}
    </main>
  );
}
