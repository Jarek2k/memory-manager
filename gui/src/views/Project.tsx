import { useMemo } from "react";
import { ArrowRight, Lock } from "lucide-react";
import type { Entry } from "../types";
import { useStore } from "../store";
import { Card } from "../components/Card";
import { FilterBar } from "../components/FilterBar";
import { CascadeLayer } from "../components/CascadeLayer";
import { SettingsSummary } from "../components/SettingsSummary";
import { EditableSettings } from "../components/SettingsEditor";
import { RuleItem } from "../components/RuleItem";
import { TypeLegend } from "../components/TypeLegend";
import { decompose } from "../lib/decompose";

const STEPS = ["Global (geerbt)", "Hooks", "Permissions", "Regeln", "Memories"];

export function ProjectView() {
  const { inv, selectedProject, openProject, setView, filterEntries } = useStore();
  if (!inv) return null;
  const projects = inv.projects;
  const slug = selectedProject ?? projects[0]?.slug ?? null;
  const project = projects.find((p) => p.slug === slug);
  if (!project) return <div className="empty"><div className="big">Kein Projekt mit Memories.</div></div>;

  const own = filterEntries(inv.entries.filter((e) => e.project_slug === slug));
  const clusterLabel = (id: string) => inv.clusters.find((c) => c.cluster_hint_id === id)?.label_guess ?? id;

  const groups = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of own) {
      const key = e.cluster_hint_ids[0] ? "⛓ " + clusterLabel(e.cluster_hint_ids[0]) : "weitere";
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] === "weitere" ? 1 : 0) - (b[0] === "weitere" ? 1 : 0));
  }, [own]);

  const g = inv.global;
  const gs = g.settings;
  const ps = project.settings;
  const memCount = inv.entries.filter((e) => e.project_slug === slug).length;

  return (
    <div className="view">
      <TypeLegend />
      <div className="eff-header">
        <select className="select" value={slug ?? ""} onChange={(e) => openProject(e.target.value)} style={{ fontSize: 13, padding: "8px 10px" }}>
          {projects.map((p) => <option key={p.encoded} value={p.slug}>{p.slug} ({p.entry_count})</option>)}
        </select>
        <span className="mono" style={{ color: "var(--faint)", fontSize: 12 }}>
          {project.path_resolved ? project.path : project.encoded + " (Pfad ungelöst)"}
        </span>
      </div>

      <div className="scope-stepper">
        {STEPS.map((s, i) => (
          <span key={s} className="step">{s}{i < STEPS.length - 1 && <ArrowRight size={12} className="step-arrow" />}</span>
        ))}
      </div>

      {/* Layer 1 — inherited global (collapsed summary) */}
      <CascadeLayer scope="global" title="Gilt global — geerbt"
        summary={`${gs?.hook_count ?? 0} Hooks · ${gs?.permission_count ?? 0} Permissions · ${g.rules.length + 1} Regeln`}
        action={<button className="btn ghost sm" onClick={() => setView("global")}>In Global bearbeiten <ArrowRight size={13} /></button>}>
        <div className="eff-inherited">
          <div className="eff-rf-head"><span className="mono">~/.claude/CLAUDE.md</span>{g.rules.map((r) => <span key={r.path} className="pill">{r.filename}</span>)}</div>
          {gs ? <SettingsSummary s={gs} /> : <div className="ri-empty">Keine globale settings.json.</div>}
        </div>
      </CascadeLayer>

      {/* Layer 2 — project Hooks (hard, read-only) */}
      <CascadeLayer scope="project-repo" type="hook" title="Hooks"
        count={ps && ps.hook_count > 0 ? ps.hook_count : undefined} defaultOpen={!!(ps && ps.hook_count)}>
        {ps && ps.hook_count > 0 ? <div className="settings-body"><EditableSettings s={ps} scope="project" only="hooks" /></div>
          : <div className="ri-empty">Keine projekt-eigenen Hooks.</div>}
      </CascadeLayer>

      {/* Layer 3 — project Permissions (hard, read-only) */}
      <CascadeLayer scope="project-repo" type="permission" title="Permissions"
        count={ps && ps.permission_count > 0 ? ps.permission_count : undefined} defaultOpen={!!(ps && ps.permission_count)}>
        {ps && ps.permission_count > 0 ? <div className="settings-body"><EditableSettings s={ps} scope="project" only="permissions" /></div>
          : <div className="ri-empty">Keine projekt-eigenen Permissions.</div>}
      </CascadeLayer>

      {/* Layer 4 — project rules (soft, read-only, in the repo) */}
      <CascadeLayer scope="project-repo" type="rule" title="Regeln" count={project.rules.length || undefined}
        defaultOpen={project.rules.length > 0}>
        {project.rules.length === 0 ? (
          <div className="ri-empty">Dieses Projekt hat keine eigenen Regeldateien (CLAUDE.md, .claude/rules/ …).</div>
        ) : project.rules.map((r) => (
          <div key={r.path} className="eff-rulefile">
            <div className="eff-rf-head"><Lock size={11} /><span className="mono">{r.source}</span><span className="pill">{r.lines} Z.</span></div>
            <div className="rule-items ro">{decompose(r.content).map((it, i) => <RuleItem key={i} item={it} />)}{r.truncated && <div className="ri-empty">… (gekürzt)</div>}</div>
          </div>
        ))}
      </CascadeLayer>

      {/* Layer 5 — this project's memories (editable) */}
      <CascadeLayer scope="memory" type="memory" title="Memories" count={memCount} defaultOpen>
        <FilterBar />
        {own.length === 0 ? (
          <div className="ri-empty">Keine Treffer — Filter zurücksetzen oder anderes Projekt wählen.</div>
        ) : groups.map(([label, list]) => (
          <div key={label}>
            <div className="group-head"><h3>{label}</h3><span className="meta">{list.length}</span><span className="line" /></div>
            <div className="cards">{list.map((e) => <Card key={e.id} entry={e} showProject={false} />)}</div>
          </div>
        ))}
      </CascadeLayer>
    </div>
  );
}
