import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { TYPE_META, TypeTile, type ConceptType } from "./TypeBadge";

const ORDER: ConceptType[] = ["hook", "permission", "rule", "memory"];

/** App-wide legend: what each type is, in hardness order (hardest → softest).
 *  Collapsed by default to a single compact row; expands to full explanations. */
export function TypeLegend({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="type-legend">
      <button className="tl-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <HelpCircle size={14} className="tl-ico" />
        <span className="tl-title">Was ist was?</span>
        <span className="tl-chips">
          {ORDER.map((t) => (
            <span key={t} className={"tl-chip " + TYPE_META[t].cls}>
              <TypeTile type={t} size={16} /> {TYPE_META[t].label}
            </span>
          ))}
        </span>
        <span className="tl-hint">{open ? "" : "erklären"}</span>
      </button>
      {open && (
        <div className="tl-body">
          <div className="tl-scale">
            <span>härter · mechanisch erzwungen</span>
            <span className="tl-bar" />
            <span>weicher · nur Kontext</span>
          </div>
          {ORDER.map((t) => (
            <div key={t} className={"tl-row " + TYPE_META[t].cls}>
              <TypeTile type={t} size={28} />
              <div className="tl-text">
                <b>{TYPE_META[t].label}</b>
                <span>{TYPE_META[t].what}</span>
              </div>
            </div>
          ))}
          <div className="tl-foot">
            Reihenfolge = <b>Mächtigkeit</b>: Hooks &amp; Permissions setzt Claude Code <b>mechanisch</b> zur Tool-Zeit
            durch (deny&nbsp;▸&nbsp;ask&nbsp;▸&nbsp;allow). Regeln &amp; Memory sind <b>Kontext</b> — Claude folgt ihnen,
            erzwungen sind sie nicht.
          </div>
        </div>
      )}
    </div>
  );
}
