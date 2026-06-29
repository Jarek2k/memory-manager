import { useState } from "react";
import { Archive, CheckCircle2, Loader, MinusCircle, Power, RefreshCw, Terminal } from "lucide-react";
import { useStore } from "../store";

const shortPath = (p: string) =>
  p.replace(/^.*\/\.claude\//, "~/.claude/").replace(/^.*\/(memory|projects)\//, "…/$1/");

const ACTION: Record<string, string> = { create: "neu", modify: "geändert", delete: "gelöscht" };

/** Live strip under the topbar while a submission is being applied in the
 * terminal. Turns into an attention banner when Claude needs a yes/no there. */
export function SessionStrip() {
  const { session } = useStore();
  if (!session) return null;
  const p = session.phase;
  if (p === "curating" || p === "done" || p === "closing") return null;
  const waiting = p === "awaiting_terminal";
  return (
    <div className={"session-strip" + (waiting ? " attn" : "")} role="status" aria-live="polite">
      {waiting ? <Terminal size={15} /> : <Loader size={15} className="spin" />}
      <span>{session.message || (waiting
        ? "Claude wartet auf deine Bestätigung im Terminal."
        : "Claude verarbeitet die Änderungen …")}</span>
    </div>
  );
}

/** After a cycle finishes: exactly what got written vs. skipped, the backup
 * path, and the two ways forward — keep curating or end the session. */
export function ResultPanel() {
  const { session, continueCuration, finishSession } = useStore();
  if (!session || session.phase !== "done" || !session.result) return null;
  const r = session.result;
  return (
    <div className="result-overlay" role="dialog" aria-modal="true" aria-label="Ergebnis">
      <div className="result-backdrop" />
      <div className="result-panel">
        <header className="result-head">
          <CheckCircle2 size={18} />
          <h3>Übernommen</h3>
          <span className="result-count">{r.applied.length} geschrieben{r.skipped.length ? ` · ${r.skipped.length} übersprungen` : ""}</span>
        </header>
        <div className="result-body">
          {r.applied.length > 0 && (
            <div className="rg">
              {r.applied.map((f, i) => (
                <div key={"a" + i} className="rg-row ok">
                  <CheckCircle2 size={14} />
                  <code title={f.path}>{shortPath(f.path)}</code>
                  {f.action && <span className="rg-tag">{ACTION[f.action] || f.action}</span>}
                </div>
              ))}
            </div>
          )}
          {r.skipped.length > 0 && (
            <div className="rg">
              <div className="rg-h">Nicht geschrieben</div>
              {r.skipped.map((f, i) => (
                <div key={"s" + i} className="rg-row skip">
                  <MinusCircle size={14} />
                  <code title={f.path}>{shortPath(f.path)}</code>
                  {f.why && <span className="rg-why">{f.why}</span>}
                </div>
              ))}
            </div>
          )}
          {r.applied.length === 0 && r.skipped.length === 0 && (
            <div className="cart-empty">Nichts geschrieben.</div>
          )}
          <div className="rg-backup"><Archive size={14} /> Backup: <code title={r.backup_dir}>{r.backup_dir}</code></div>
        </div>
        <footer className="result-foot">
          <span className="result-hint">Originale liegen im Backup — alles reversibel.</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" onClick={finishSession}><Power size={14} /> Fertig</button>
          <button className="btn primary" onClick={continueCuration}><RefreshCw size={14} /> Weiter bearbeiten</button>
        </footer>
      </div>
    </div>
  );
}

/** Always-reachable way to stop the session + server, for when the user is done
 * mid-curation (not just from the result panel). Inline confirm guards misclicks. */
export function EndSessionButton() {
  const { session, finishSession } = useStore();
  const [confirm, setConfirm] = useState(false);
  if (session?.server === "closing") return null;   // already ending
  if (confirm) {
    return (
      <span className="end-session">
        <span className="end-q">Server stoppen?</span>
        <button className="btn danger sm" onClick={finishSession}>Beenden</button>
        <button className="btn ghost sm" onClick={() => setConfirm(false)}>Abbrechen</button>
      </span>
    );
  }
  return (
    <button className="btn ghost sm end-btn" title="Sitzung und lokalen Server beenden"
      onClick={() => setConfirm(true)}>
      <Power size={14} /> Beenden
    </button>
  );
}

/** Full-cover end card once the server has been stopped (Fertig or idle-out). */
export function ClosedScreen() {
  const { session } = useStore();
  if (session?.server !== "closing") return null;
  return (
    <div className="closed-screen">
      <Power size={30} />
      <h2>Sitzung beendet</h2>
      <p>Der lokale Server wurde gestoppt. Du kannst dieses Fenster schließen.</p>
    </div>
  );
}
