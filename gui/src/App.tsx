import { useState } from "react";
import { Brain, FolderGit2, Globe, Lightbulb, Network, TriangleAlert } from "lucide-react";
import { useStore } from "./store";
import { GraphView } from "./views/Graph";
import { ProjectView } from "./views/Project";
import { GlobalView } from "./views/Global";
import { InsightsView } from "./views/Insights";
import { BudgetMeter } from "./components/BudgetMeter";
import { CartDrawer } from "./components/Cart";
import { ClosedScreen, EndSessionButton, ResultPanel, SessionStrip } from "./components/Session";

type NavItem = { id: string; label: string; Icon: any };
type NavEntry = { group: string } | NavItem;

const NAV: NavEntry[] = [
  { id: "graph", label: "Übersicht", Icon: Network },
  { group: "Global · gilt überall" },
  { id: "global", label: "Global", Icon: Globe },
  { group: "Pro Projekt" },
  { id: "project", label: "Projekt", Icon: FolderGit2 },
  { group: "Querschnitt" },
  { id: "insights", label: "Insights", Icon: Lightbulb },
];

const TITLES: Record<string, { t: string; s: string }> = {
  graph: { t: "Übersicht", s: "Global im Zentrum, Projekte drumherum" },
  global: { t: "Global", s: "was überall gilt — Profil, Regeln & Durchsetzung (editierbar)" },
  project: { t: "Projekt", s: "was hier gilt — erbt global, plus Projekt-eigenes & Memories" },
  insights: { t: "Insights", s: "berechnete Hinweise & projektübergreifende Themen" },
};

export function App() {
  const { inv, loading, error, view, setView, cartList, submitState, submitMsg } = useStore();
  const [drawer, setDrawer] = useState(false);

  if (loading) return <div className="empty" style={{ height: "100%", display: "grid", placeItems: "center" }}>lädt Inventar…</div>;
  if (error) return <div className="empty" style={{ color: "var(--danger)", height: "100%", display: "grid", placeItems: "center" }}>Fehler: {error}</div>;
  if (!inv) return null;

  const counts: Record<string, number> = {
    project: inv.projects.length,
    insights: inv.insights.length + inv.clusters.length,
  };
  const title = TITLES[view] ?? TITLES.graph;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="logo"><Brain size={18} /></span><h1>Memory Manager</h1></div>
        <nav className="nav">
          {NAV.map((entry, i) =>
            "group" in entry ? (
              <div key={"g" + i} className="nav-group">{entry.group}</div>
            ) : (
              <button key={entry.id} className={view === entry.id ? "active" : ""} onClick={() => setView(entry.id)}>
                <entry.Icon size={16} /> {entry.label}
                {counts[entry.id] !== undefined && <span className="count">{counts[entry.id]}</span>}
              </button>
            )
          )}
        </nav>
        <div className="foot">{inv.entries.length} Memories · {inv.projects.length} Projekte<br />Budget {inv.budget.current_lines}/{inv.budget.soft_limit_lines} Z.</div>
      </aside>

      <div className="main">
        {!inv.is_real_claude_dir && (
          <div className="banner"><TriangleAlert size={15} /> SANDBOX — Übungskopie, nicht dein echtes ~/.claude <span className="mono">({inv.claude_dir})</span></div>
        )}
        <div className="topbar">
          <h2>{title.t}</h2><span className="sub">{title.s}</span>
          <span className="spacer" />
          <BudgetMeter />
          <button className="cart-pill" onClick={() => setDrawer(true)} title="Vorgemerkte Änderungen">
            <span className="dot">{cartList.length}</span> vorgemerkt
          </button>
          <EndSessionButton />
        </div>
        <SessionStrip />

        {view === "graph" && <div className="view view-wide" style={{ padding: 0 }}><GraphView /></div>}
        {view === "project" && <ProjectView />}
        {view === "global" && <GlobalView />}
        {view === "insights" && <InsightsView />}
      </div>

      {drawer && <CartDrawer onClose={() => setDrawer(false)} />}
      <ResultPanel />
      <ClosedScreen />
      {submitState === "error" && <div className="toast err">{submitMsg}</div>}
    </div>
  );
}
