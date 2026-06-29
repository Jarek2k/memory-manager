import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CartItem } from "../types";
import { useStore } from "../store";
import { ReviewGate } from "./ReviewGate";

function label(it: CartItem): { op: string; text: string } {
  switch (it.kind) {
    case "edit": return { op: "edit", text: it.id.split("::")[1] || it.id };
    case "delete": return { op: "delete", text: it.id.split("::")[1] || it.id };
    case "split": return { op: "split", text: it.id.split("::")[1] || it.id };
    case "promote": return { op: it.source_ids.length > 1 ? "promote×" + it.source_ids.length : "promote", text: "→ " + it.target_topic };
    case "harden": return { op: "harden", text: (it.id.split("::")[1] || it.id) + " (" + it.scope + ")" };
    case "edit_global": return { op: "edit", text: it.path.split("/").pop() || it.path };
    case "delete_global": return { op: "delete", text: it.path.split("/").pop() || it.path };
    case "edit_settings": return { op: "settings", text: it.scope + " · " + it.summary };
    case "user_summary": return { op: "über-mich", text: "Zusammenfassung anfordern" };
  }
}

export function CartDrawer({ onClose }: { onClose: () => void }) {
  const { cartList, cartRemove, clearCart, submitState } = useStore();
  const [review, setReview] = useState(false);
  // once the submission is handed off, collapse the review + drawer so the live
  // status strip and result panel take over
  useEffect(() => {
    if (submitState === "sent") { setReview(false); onClose(); }
  }, [submitState, onClose]);
  return (
    <>
      {review && <ReviewGate onClose={() => setReview(false)} />}
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Vorgemerkte Änderungen">
        <header>
          <h3>Vorgemerkt</h3>
          <span className="cart-pill"><span className="dot">{cartList.length}</span></span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={onClose}><X size={15} /></button>
        </header>
        <div className="body">
          {cartList.length === 0 ? (
            <div className="cart-empty">Nichts vorgemerkt.<br />Aktionen an den Karten landen hier — geschrieben wird erst nach „Übernehmen".</div>
          ) : cartList.map((it) => {
            const l = label(it);
            return (
              <div key={it.key} className="cart-item">
                <span className="op">{l.op}</span>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{l.text}</span>
                <button className="x" onClick={() => cartRemove(it.key)} aria-label="entfernen"><X size={14} /></button>
              </div>
            );
          })}
        </div>
        <div className="foot">
          <button className="btn" onClick={clearCart} disabled={!cartList.length}>Leeren</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setReview(true)} disabled={!cartList.length}>
            Prüfen &amp; freigeben ▶
          </button>
        </div>
      </aside>
    </>
  );
}
