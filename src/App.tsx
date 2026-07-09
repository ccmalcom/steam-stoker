import { useState } from "react";
import RecommendPage from "./pages/RecommendPage";
import LibraryPage from "./pages/LibraryPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import "./App.css";

export default function App() {
  const [tab, setTab] = useState<"recommend" | "library" | "profile" | "settings">("recommend");
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
