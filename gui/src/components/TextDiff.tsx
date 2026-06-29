import { useMemo } from "react";
import { textDiff } from "../lib/semanticDiff";

/** The drill-down: a unified word-level text diff rendered with our own CSS
 * (no CSS-in-JS dependency). Changed words inside a modified line are highlighted
 * so a small edit doesn't read as a full rewrite. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => textDiff(before ?? "", after ?? ""), [before, after]);
  return (
    <div className="tdiff" role="group" aria-label="exakter Unterschied">
      {rows.map((r, i) => {
        if (r.t === "fold") return <div key={i} className="tdiff-fold">··· {r.n} unveränderte Zeilen ···</div>;
        if (r.t === "same")
          return <div key={i} className="tdiff-row same"><span className="gut" aria-hidden> </span><code>{r.line || " "}</code></div>;
        return (
          <div key={i} className={"tdiff-row " + r.t}>
            <span className="gut" aria-hidden>{r.t === "add" ? "+" : "−"}</span>
            <code>{r.tokens.map((t, j) => (t.hl ? <mark key={j}>{t.v}</mark> : <span key={j}>{t.v}</span>))}{r.tokens.length === 0 && " "}</code>
          </div>
        );
      })}
    </div>
  );
}
