import { useState } from "react";
import { AlertTriangle, Info, ChevronRight } from "lucide-react";
import { useStore } from "../store";
import { Card } from "../components/Card";
import { ClusterSection } from "./Clusters";

export function InsightsView() {
  const { inv } = useStore();
  const [open, setOpen] = useState<number | null>(null);
  if (!inv) return null;

  return (
    <div className="view">
      <div className="group-head"><h3>Insights & Vorschläge</h3><span className="meta">vom Scanner berechnet — Anhaltspunkte, kein Automatismus</span><span className="line" /></div>
      {inv.insights.length === 0 ? (
        <div className="empty"><Info size={20} style={{ opacity: 0.5 }} /><div>Keine auffälligen Hinweise im aktuellen Bestand.</div></div>
      ) : inv.insights.map((ins, i) => {
        const entries = (ins.entry_ids ?? []).map((id) => inv.entries.find((e) => e.id === id)).filter(Boolean) as typeof inv.entries;
        const expandable = entries.length > 0;
        return (
          <div key={i}>
            <div className={"insight " + ins.severity} style={{ cursor: expandable ? "pointer" : "default" }} onClick={() => expandable && setOpen(open === i ? null : i)}>
              <span className="ico">{ins.severity === "warn" ? <AlertTriangle size={16} color="var(--warn)" /> : <Info size={16} color="var(--info)" />}</span>
              <span className="msg">{ins.message}</span>
              {expandable && <ChevronRight size={16} style={{ color: "var(--faint)", transform: open === i ? "rotate(90deg)" : "none", transition: "transform .15s" }} />}
            </div>
            {open === i && entries.length > 0 && (
              <div className="cards" style={{ margin: "0 0 14px 14px" }}>{entries.map((e) => <Card key={e.id} entry={e} />)}</div>
            )}
          </div>
        );
      })}

      <div style={{ height: 18 }} />
      <ClusterSection />
    </div>
  );
}
