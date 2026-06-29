import { useMemo, useState } from "react";
import { X, ChevronRight, Check, HelpCircle } from "lucide-react";
import { useStore } from "../store";
import { buildChangePreviews } from "../lib/changePreview";
import type { SemLine } from "../lib/changePreview";
import { TypeTile } from "./TypeBadge";
import { TextDiff } from "./TextDiff";

function SemRow({ s }: { s: SemLine }) {
  return (
    <div className={"sem-row " + s.tone}>
      <span className="sem-dot" aria-hidden />
      <code className="sem-text">{s.text}</code>
      {s.from && <span className={"sem-bucket" + (s.fromKey ? " act-" + s.fromKey : "")}>{s.from}</span>}
      {s.from && s.to && <span className="sem-arrow" aria-hidden>─▶</span>}
      {s.to && <span className={"sem-bucket" + (s.toKey ? " act-" + s.toKey : "")}>{s.to}</span>}
    </div>
  );
}

/** The in-browser diff gate: every staged change as a semantic summary + an
 * expandable word-level text diff, approved per file. Only approved changes are
 * sent; the browser still never writes — apply.py does, with backup + drift check. */
export function ReviewGate({ onClose }: { onClose: () => void }) {
  const { inv, cartList, submit, submitState, submitMsg } = useStore();
  const previews = useMemo(() => (inv ? buildChangePreviews(cartList, inv) : []), [cartList, inv]);
  const [approved, setApproved] = useState<Set<string>>(() => new Set(previews.map((p) => p.key)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (s: Set<string>, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const approvedItems = cartList.filter((it) => approved.has(it.key));
  const sent = submitState === "sent";

  return (
    <div className="review-overlay" role="dialog" aria-modal="true" aria-label="Änderungen prüfen und freigeben">
      <div className="review-backdrop" onClick={onClose} />
      <div className="review-panel">
        <header className="review-head">
          <h3>Prüfen &amp; freigeben</h3>
          <span className="review-count">{approved.size}/{previews.length}</span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><X size={16} /></button>
        </header>

        <div className="review-body">
          {previews.length === 0 ? (
            <div className="cart-empty">Nichts vorgemerkt.</div>
          ) : previews.map((p) => {
            const on = approved.has(p.key);
            const canDiff = p.previewable && (!!p.before || !!p.after);
            const isOpen = open.has(p.key);
            return (
              <div key={p.key} className={"review-card" + (on ? "" : " skipped")}>
                <div className="rc-head">
                  {p.type && <TypeTile type={p.type} size={22} />}
                  <div className="rc-title"><b>{p.title}</b><span className="rc-kind">{p.kindLabel}</span></div>
                  <span style={{ flex: 1 }} />
                  <button className={"approve-toggle" + (on ? " on" : "")} role="switch" aria-checked={on}
                    onClick={() => setApproved((s) => flip(s, p.key))}>
                    {on ? <><Check size={13} /> freigegeben</> : "übersprungen"}
                  </button>
                </div>
                <div className="rc-sem">{p.semantic.map((s, i) => <SemRow key={i} s={s} />)}</div>
                {p.note && <div className="rc-note"><HelpCircle size={13} /> {p.note}</div>}
                {canDiff && (
                  <>
                    <button className="rc-difftoggle" aria-expanded={isOpen} onClick={() => setOpen((s) => flip(s, p.key))}>
                      <ChevronRight size={13} className={"chev" + (isOpen ? " open" : "")} />
                      exakten Text-Diff {isOpen ? "verbergen" : "zeigen"}
                    </button>
                    {isOpen && <TextDiff before={p.before ?? ""} after={p.after ?? ""} />}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <footer className="review-foot">
          {sent ? (
            <div className="review-sent"><Check size={15} /> {submitMsg}</div>
          ) : (
            <>
              <span className="review-hint">Nur Freigegebenes geht an Claude. Geschrieben wird erst dort — mit Backup, und nur wenn die Datei seither unverändert ist.</span>
              <span style={{ flex: 1 }} />
              <button className="btn ghost" onClick={onClose} disabled={submitState === "sending"}>Zurück</button>
              <button className="btn primary" disabled={!approved.size || submitState === "sending"} onClick={() => submit(approvedItems)}>
                {submitState === "sending" ? "Sende…" : `${approved.size} freigeben & senden ▶`}
              </button>
            </>
          )}
          {submitState === "error" && <div className="review-err">{submitMsg}</div>}
        </footer>
      </div>
    </div>
  );
}
