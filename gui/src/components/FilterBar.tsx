import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SIGNALS, useStore, type FacetGroup } from "../store";
import { Help } from "./Tooltip";

function Chip({ group, value, label, tip }: { group: FacetGroup; value: string; label: string; tip?: string }) {
  const { filters, cycleFacet } = useStore();
  const state = filters[group][value];
  const cls = "chip" + (state ? " " + state : "");
  const node = (
    <button className={cls} onClick={() => cycleFacet(group, value)} title={tip}>
      {label}
      {state && <span className="state">{state === "include" ? "ist" : "ist nicht"}</span>}
    </button>
  );
  return node;
}

export function FilterBar({ showProject = false, showCluster = false }: { showProject?: boolean; showCluster?: boolean }) {
  const { inv, filters, setQ, setSort, clearFilters } = useStore();
  const [more, setMore] = useState(false);
  const types = useMemo(() => {
    const c: Record<string, number> = {};
    inv?.entries.forEach((e) => (c[e.type] = (c[e.type] || 0) + 1));
    return Object.keys(c).sort();
  }, [inv]);
  if (!inv) return null;

  const active = Boolean(filters.q || Object.keys(filters.type).length || Object.keys(filters.signal).length || Object.keys(filters.project).length || Object.keys(filters.cluster).length);

  return (
    <div className="filterbar">
      <div className="search">
        <Search size={14} />
        <input value={filters.q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Name, Beschreibung, Why/How)…" />
      </div>
      <select className="select" value={filters.sort} onChange={(e) => setSort(e.target.value as any)} title="Sortierung">
        <option value="project">Projekt</option>
        <option value="age">Alter</option>
        <option value="size">Größe</option>
        <option value="type">Typ</option>
        <option value="name">Name</option>
      </select>

      <div className="facet-group">
        <span className="facet-label">Typ</span>
        {types.map((t) => <Chip key={t} group="type" value={t} label={t} />)}
      </div>

      <div className="facet-group">
        <span className="facet-label">Signal</span>
        <Help text={`Klick auf ein Signal: 1× = nur diese (ist), 2× = ausblenden (ist nicht), 3× = aus. So lassen sich auch Einträge OHNE ein Signal oder ganz ohne Signale filtern.`} />
        {SIGNALS.map((s) => <Chip key={s.key} group="signal" value={s.key} label={s.label} />)}
      </div>

      {(showProject || showCluster) && (
        <button className="btn ghost sm" onClick={() => setMore((m) => !m)}>{more ? "weniger" : "Projekt/Cluster…"}</button>
      )}
      {more && showProject && (
        <div className="facet-group">
          <span className="facet-label">Projekt</span>
          {inv.projects.map((p) => <Chip key={p.encoded} group="project" value={p.slug} label={p.slug} />)}
        </div>
      )}
      {more && showCluster && (
        <div className="facet-group">
          <span className="facet-label">Cluster</span>
          {inv.clusters.map((c) => <Chip key={c.cluster_hint_id} group="cluster" value={c.cluster_hint_id} label={c.label_guess} />)}
        </div>
      )}

      {active && <button className="btn ghost sm" onClick={clearFilters}><X size={13} /> zurücksetzen</button>}
    </div>
  );
}
