import { useEffect } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import { createApi } from "./lib/api";
import { loadSettings } from "./lib/settings";
import { registerSyncRunner, scheduleSync, syncNow } from "./lib/sync";
import { getStore } from "./lib/useStore";
import AddPage from "./routes/AddPage";
import ArticlePage from "./routes/ArticlePage";
import ListPage from "./routes/ListPage";
import SettingsPage from "./routes/SettingsPage";
import SharePage from "./routes/SharePage";

export default function App() {
  useEffect(() => {
    registerSyncRunner(async () => {
      const settings = loadSettings();
      if (!settings.appToken) return null;
      const store = await getStore();
      const api = createApi({ token: settings.appToken });
      return syncNow(store, settings, api);
    });
    const onOnline = () => scheduleSync(0);
    window.addEventListener("online", onOnline);
    scheduleSync(0);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return (
    <BrowserRouter>
      <header className="app-header">
        <Link to="/" className="app-title">
          Quiosco
        </Link>
        <NavLink to="/settings" className="app-nav">
          Settings
        </NavLink>
      </header>
      <main className="app">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/add" element={<AddPage />} />
          <Route path="/article/:id" element={<ArticlePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
