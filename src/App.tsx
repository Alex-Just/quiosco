import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import AddPage from "./routes/AddPage";
import ArticlePage from "./routes/ArticlePage";
import ListPage from "./routes/ListPage";
import SettingsPage from "./routes/SettingsPage";
import SharePage from "./routes/SharePage";

export default function App() {
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
