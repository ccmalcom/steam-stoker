import { useState } from "react";
import LibraryPage from "./pages/LibraryPage";
import SettingsPage from "./pages/SettingsPage";
import "./App.css";

export default function App() {
  const [tab, setTab] = useState<"library" | "settings">("library");
  return (
    <main>
      <nav className="row">
        <button onClick={() => setTab("library")} disabled={tab === "library"}>Library</button>
        <button onClick={() => setTab("settings")} disabled={tab === "settings"}>Settings</button>
      </nav>
      {tab === "library" ? <LibraryPage /> : <SettingsPage />}
    </main>
  );
}
