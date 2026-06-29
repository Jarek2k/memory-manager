import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge, type NodeMouseHandler, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X } from "lucide-react";
import { SIGNALS, signalHas, useStore } from "../store";
import { TypeCounts, TypeCountChip } from "../components/TypeBadge";
import { TypeLegend } from "../components/TypeLegend";

function GlobalNode({ data }: any) {
  return (
    <div className={"gnode global hub" + (data.active ? " is-active" : "")}>
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="n">⌂ Global</div>
      <div className="c">{data.lines} Z. immer geladen</div>
      <div className="c2"><TypeCounts hooks={data.hooks} perms={data.perms} rules={data.rules} /></div>
      <div className="hint-open">Details →</div>
    </div>
  );
}
function ProjectNode({ data }: any) {
  const big = Math.min(1.4, 0.95 + data.count / 24);
  return (
    <div className={"gnode" + (data.count === 0 ? " empty" : "") + (data.active ? " is-active" : "")} title={data.path} style={{ fontSize: 13.5 * big }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="n">{data.label}</div>
      <div className="c">{data.count} {data.count === 1 ? "Memory" : "Memories"}</div>
      {(data.rules > 0 || data.hooks > 0 || data.perms > 0) && <div className="c2"><TypeCounts hooks={data.hooks} perms={data.perms} rules={data.rules} /></div>}
    </div>
  );
}
function ClusterNode({ data }: any) {
  return (
    <div className={"gnode cluster" + (data.active ? " is-active" : "")}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      ⛓ {data.label}
    </div>
  );
}
const nodeTypes = { global: GlobalNode, project: ProjectNode, cluster: ClusterNode };

/* ---- right-side inspector ---- */
function Inspector({ id, onClose }: { id: string; onClose: () => void }) {
  const { inv, openProject, setView } = useStore();
  if (!inv) return null;

  let body: React.ReactNode = null;

  if (id === "global") {
    const g = inv.global;
    const lines = g.claude_md.content.split("\n");
    const preview = lines.slice(0, 16).join("\n");
    const b = inv.budget;
    const pct = Math.min(100, Math.round((b.current_lines / b.soft_limit_lines) * 100));
    body = (
      <>
        <div className="insp-head">
          <span className="insp-kicker">Zentrum · lädt jede Session</span>
          <h3>⌂ Global</h3>
          <p className="insp-sub">{g.rules.length} {g.rules.length === 1 ? "Regel" : "Regeln"} · {b.current_lines} Zeilen immer geladen</p>
        </div>
        <div className="insp-section">
          <div className="insp-label">Budget</div>
          <div className="insp-budget"><span style={{ width: pct + "%" }} className={b.current_lines > b.soft_limit_lines ? "over" : b.current_lines > b.warn_threshold_lines ? "warn" : ""} /></div>
          <div className="insp-dim">{b.current_lines} / {b.soft_limit_lines} Zeilen (Warnung ab {b.warn_threshold_lines})</div>
        </div>
        <div className="insp-section">
          <div className="insp-label">Regeldateien (~/.claude/rules/)</div>
          {g.rules.length ? g.rules.map((r) => (
            <div key={r.path} className="insp-row">
              <span className="mono">{r.filename}</span>
              <span className="insp-dim">{r.lines} Z.{r.imported ? " · @import" : " · nicht eingebunden"}</span>
            </div>
          )) : <div className="insp-empty">Noch keine Regeln. Memories per „Global machen" hierher befördern.</div>}
        </div>
        <div className="insp-section">
          <div className="insp-label">CLAUDE.md — Vorschau</div>
          <pre className="insp-pre">{preview}{lines.length > 16 ? "\n…" : ""}</pre>
        </div>
        <button className="btn primary block" onClick={() => setView("global")}>Global bearbeiten →</button>
      </>
    );
  } else if (id.startsWith("p:")) {
    const slug = id.slice(2);
    const proj = inv.projects.find((p) => p.slug === slug);
    const ents = inv.entries.filter((e) => e.project_slug === slug);
    const types: Record<string, number> = {};
    ents.forEach((e) => (types[e.type] = (types[e.type] || 0) + 1));
    const sigs = SIGNALS.filter((s) => s.key !== "none").map((s) => ({ s, n: ents.filter((e) => signalHas(e, s.key)).length })).filter((x) => x.n > 0);
    const cls = inv.clusters.filter((c) => c.member_ids.some((m) => m.split("::")[0] === slug));
    const shown = ents.slice(0, 8);
    body = (
      <>
        <div className="insp-head">
          <span className="insp-kicker">Projekt</span>
          <h3>{slug}</h3>
          <p className="insp-sub mono" title={proj?.path}>{proj?.path_resolved === false ? "⚠ Pfad ungelöst · " : ""}{proj?.path || ""}</p>
          <p className="insp-sub">{ents.length} {ents.length === 1 ? "Memory" : "Memories"}</p>
        </div>
        <div className="insp-section">
          <div className="insp-label">Gilt hier (eigenes)</div>
          <div className="insp-chips">
            <TypeCountChip type="hook" label="Hooks" n={proj?.settings?.hook_count ?? 0} />
            <TypeCountChip type="permission" label="Permissions" n={proj?.settings?.permission_count ?? 0} />
            <TypeCountChip type="rule" label="Regeldateien" n={proj?.rules.length ?? 0} />
          </div>
        </div>
        <div className="insp-section">
          <div className="insp-label">Typen</div>
          <div className="insp-chips">{Object.entries(types).sort().map(([t, n]) => <span key={t} className="insp-chip">{t} <b>{n}</b></span>)}</div>
        </div>
        {sigs.length > 0 && (
          <div className="insp-section">
            <div className="insp-label">Signale</div>
            <div className="insp-chips">{sigs.map(({ s, n }) => <span key={s.key} className="insp-chip sig">{s.label} <b>{n}</b></span>)}</div>
          </div>
        )}
        {cls.length > 0 && (
          <div className="insp-section">
            <div className="insp-label">Cluster-Themen</div>
            <div className="insp-chips">{cls.map((c) => <span key={c.cluster_hint_id} className="insp-chip">{c.label_guess} <b>{c.member_ids.filter((m) => m.split("::")[0] === slug).length}</b></span>)}</div>
          </div>
        )}
        <div className="insp-section">
          <div className="insp-label">Memories</div>
          {shown.map((e) => (
            <div key={e.id} className="insp-row">
              <span className="mono">{e.name}</span>
              <span className="insp-dim">{e.type}</span>
            </div>
          ))}
          {ents.length > shown.length && <div className="insp-dim">+{ents.length - shown.length} weitere</div>}
          {ents.length === 0 && <div className="insp-empty">Keine Memories in diesem Projekt.</div>}
        </div>
        <button className="btn primary block" onClick={() => openProject(slug)}>Projekt öffnen →</button>
      </>
    );
  } else if (id.startsWith("c:")) {
    const cid = id.slice(2);
    const c = inv.clusters.find((x) => x.cluster_hint_id === cid);
    if (c) {
      const byProj: Record<string, string[]> = {};
      c.member_ids.forEach((m) => { const [p, f] = m.split("::"); (byProj[p] = byProj[p] || []).push(f); });
      body = (
        <>
          <div className="insp-head">
            <span className="insp-kicker">Cluster-Thema</span>
            <h3>⛓ {c.label_guess}</h3>
            <p className="insp-sub">{c.member_count} {c.member_count === 1 ? "Memory" : "Memories"} in {c.project_count} {c.project_count === 1 ? "Projekt" : "Projekten"}</p>
          </div>
          <div className="insp-section">
            <div className="insp-label">Mitglieder</div>
            {Object.entries(byProj).map(([p, files]) => (
              <div key={p} className="insp-row col">
                <span className="mono insp-projhead">{p}</span>
                {files.map((f) => <span key={f} className="insp-dim mono">· {f}</span>)}
              </div>
            ))}
          </div>
          <div className="insp-section"><div className="insp-dim">Basis: {c.basis}</div></div>
          <button className="btn primary block" onClick={() => setView("insights")}>In Insights öffnen →</button>
        </>
      );
    }
  }

  return (
    <aside className="graph-inspector" key={id}>
      <button className="insp-close" onClick={onClose} title="Schließen" aria-label="Schließen"><X size={15} /></button>
      {body}
    </aside>
  );
}

export function GraphView() {
  const { inv } = useStore();
  const [showClusters, setShowClusters] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const instRef = useRef<ReactFlowInstance | null>(null);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    if (!inv) return { nodes, edges };
    const gs = inv.global.settings;
    nodes.push({ id: "global", type: "global", position: { x: -78, y: -40 }, data: { rules: inv.global.rules.length, lines: inv.budget.current_lines, hooks: gs?.hook_count ?? 0, perms: gs?.permission_count ?? 0, active: selected === "global" } });

    // wide ellipse: uses the broad stage instead of being height-bound like a circle
    const P = inv.projects.length;
    const Rx = Math.max(380, P * 76);
    const Ry = Math.max(240, P * 48);
    inv.projects.forEach((p, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, P) - Math.PI / 2;
      const id = "p:" + p.slug;
      nodes.push({ id, type: "project", position: { x: Rx * Math.cos(a) - 76, y: Ry * Math.sin(a) - 38 }, data: { label: p.slug, count: p.entry_count, path: p.path, slug: p.slug, rules: p.rules.length, hooks: p.settings?.hook_count ?? 0, perms: p.settings?.permission_count ?? 0, active: selected === id } });
      edges.push({ id: "e-g-" + p.slug, source: "global", target: id, style: { stroke: "var(--border-strong)", opacity: 0.55 } });
    });

    if (showClusters) {
      const C = inv.clusters.length;
      const R2x = Rx * 0.5, R2y = Ry * 0.5;
      inv.clusters.forEach((c, i) => {
        const a = (2 * Math.PI * i) / Math.max(1, C) - Math.PI / 2 + Math.PI / Math.max(1, C);
        const id = "c:" + c.cluster_hint_id;
        nodes.push({ id, type: "cluster", position: { x: R2x * Math.cos(a) - 40, y: R2y * Math.sin(a) - 20 }, data: { label: c.label_guess, active: selected === id } });
        new Set(c.member_ids.map((m) => "p:" + m.split("::")[0])).forEach((pid) => {
          if (nodes.find((n) => n.id === pid)) edges.push({ id: "e-" + id + "-" + pid, source: id, target: pid, style: { stroke: "var(--accent-line)", opacity: 0.3, strokeDasharray: "4 3" } });
        });
      });
    }
    return { nodes, edges };
  }, [inv, showClusters, selected]);

  // re-center the graph into the (now narrower/wider) stage whenever the inspector toggles
  useEffect(() => {
    const t = setTimeout(() => instRef.current?.fitView({ padding: 0.12, duration: 300 }), 230);
    return () => clearTimeout(t);
  }, [selected !== null]);

  const onNodeClick: NodeMouseHandler = (_, node) => setSelected((cur) => (cur === node.id ? null : node.id));

  if (!inv) return null;
  return (
    <div className="graph-view">
      <div className="graph-legendbar"><TypeLegend /></div>
      <div className="graphwrap">
      <div className="graph-stage">
        <div className="graph-toolbar">
          <span className="mono">{inv.projects.length} Projekte · {inv.entries.length} Memories</span>
          <label className="toggle"><input type="checkbox" checked={showClusters} onChange={(e) => setShowClusters(e.target.checked)} /> Cluster-Themen einblenden ({inv.clusters.length})</label>
        </div>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} onPaneClick={() => setSelected(null)}
          onInit={(inst) => (instRef.current = inst)} fitView fitViewOptions={{ padding: 0.12 }}
          proOptions={{ hideAttribution: true }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} minZoom={0.2} maxZoom={1.9}>
          <Background color="var(--border)" gap={28} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="graph-legend">
          <div className="row"><span className="sw" style={{ background: "var(--accent-dim)", borderColor: "var(--accent-line)" }} /> Global → klicken für Details</div>
          <div className="row"><span className="sw" style={{ background: "var(--surface)" }} /> Projekt → klicken für Details</div>
          {showClusters && <div className="row"><span className="sw" style={{ background: "var(--panel)", borderStyle: "dashed" }} /> Cluster-Thema → klicken</div>}
        </div>
      </div>
      {selected && <Inspector id={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
