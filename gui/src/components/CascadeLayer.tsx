import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ScopeBadge, type Scope } from "./ScopeBadge";
import { TypeTile, TYPE_META, type ConceptType } from "./TypeBadge";

/** One layer of the per-project cascade ("was gilt hier"). Collapsible, carries
 * a scope badge (where it applies) and, when typed, the concept-type color +
 * icon tile (what it is) — so both axes read at a glance. */
export function CascadeLayer({ scope, type, title, summary, count, defaultOpen = false, action, children }: {
  scope: Scope;
  type?: ConceptType;
  title: string;
  summary?: string;
  count?: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const typeCls = type ? " type-" + TYPE_META[type].cls : "";
  return (
    <div className={"cascade-layer " + scope + typeCls + (open ? " open" : "")}>
      <div className="cl-head">
        <button className="cl-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chev">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
          {type && <TypeTile type={type} size={20} />}
          <span className="cl-title">{title}</span>
          <ScopeBadge scope={scope} compact />
          {count != null && <span className="cl-count">{count}</span>}
          {summary && !open && <span className="cl-summary">{summary}</span>}
        </button>
        {action && <span className="cl-action">{action}</span>}
      </div>
      {open && <div className="cl-body">{children}</div>}
    </div>
  );
}
