import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ApiKeyGate } from "./components/common";
import Ask from "./screens/Ask";
import Search from "./screens/Search";
import Corpus from "./screens/Corpus";
import Metrics from "./screens/Metrics";
import Setup from "./screens/Setup";

const TABS = [
  { to: "/ask", label: "Ask" },
  { to: "/search", label: "Search" },
  { to: "/corpus", label: "Corpus" },
  { to: "/setup", label: "Setup" },
  { to: "/metrics", label: "Metrics" },
];

export default function App() {
  return (
    <ApiKeyGate>
      <div className="app">
        <header className="topbar">
          <span className="brand">
            RAG Core <span>· incident retrieval</span>
          </span>
          <nav className="nav">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <span className="spacer" />
          <button
            className="small"
            style={{ padding: "5px 12px" }}
            onClick={() => window.dispatchEvent(new Event("rag:settings"))}
          >
            API key
          </button>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={<Navigate to="/ask" replace />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/search" element={<Search />} />
            <Route path="/corpus" element={<Corpus />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/metrics" element={<Metrics />} />
            <Route path="*" element={<Navigate to="/ask" replace />} />
          </Routes>
        </main>
      </div>
    </ApiKeyGate>
  );
}
