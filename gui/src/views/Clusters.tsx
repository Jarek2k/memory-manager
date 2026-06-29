import { Layers, Boxes } from "lucide-react";
import type { Cluster } from "../types";
import { useStore } from "../store";
import { Card } from "../components/Card";
import { Tooltip } from "../components/Tooltip";

/** Cross-project repetitions → promotion candidates. Rendered as a section
 * inside Insights ("what should I act on"). */
export function ClusterSection() {
  const { inv, cartSet } = useStore();
  if (!inv || inv.clusters.length === 0) return null;

  const promoteCluster = (c: Cluster) => {
    const topic = (c.label_guess || "rule").split(" ")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "rule";
    cartSet({ key: c.member_ids[0], kind: "promote", id: c.member_ids[0], source_ids: c.member_ids.slice(),
      target_topic: topic, global_filename: topic + ".md", translated_text: "", keep_origin: "leave", supersedes_global: null });
  };

  return (
    <>
      <div className="group-head"><h3><Boxes size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Wiederkehrende Themen</h3>
        <span className="meta">dieselbe Sache in ≥2 Projekten — Kandidaten für eine globale Regel</span><span className="line" /></div>

      {inv.clusters.map((c) => {
        const members = c.member_ids.map((id) => inv.entries.find((e) => e.id === id)).filter(Boolean) as typeof inv.entries;
        return (
          <div key={c.cluster_hint_id} style={{ marginBottom: 22 }}>
            <div className="group-head">
              <h3>⛓ {c.label_guess}</h3>
              <span className="meta">{c.member_count} Memories · {c.project_count} Projekte</span>
              <span className="meta mono" style={{ fontStyle: "italic" }}>{c.basis}</span>
              <span style={{ flex: 1 }} />
              <Tooltip text="Alle Memories dieses Clusters zu EINER globalen Regel zusammenfassen (Merge). Du formulierst den Text oder lässt Claude übersetzen.">
                <button className="btn sm primary" onClick={() => promoteCluster(c)}><Layers size={13} /> als 1 globale Regel</button>
              </Tooltip>
            </div>
            <div className="cards">{members.map((e) => <Card key={e.id} entry={e} />)}</div>
          </div>
        );
      })}
    </>
  );
}
