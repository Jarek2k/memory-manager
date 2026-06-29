import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { CartItem, Entry, KeepOrigin } from "../types";
import { useStore } from "../store";
import { SignalBadges } from "./SignalBadge";
import { Tooltip } from "./Tooltip";

const ACTION_TIP: Record<string, string> = {
  keep: "Unverändert lassen.",
  edit: "Den Text dieses Memorys im Projekt bearbeiten.",
  delete: "Memory löschen (inkl. Eintrag in der MEMORY.md des Projekts).",
  promote: "Daraus eine globale Regel machen (~/.claude/rules/ + @import). Gilt dann in jedem Projekt.",
  split: "Dauerregel behalten, datierte Logs in eine -log.md auslagern.",
};

const slug = (e: Entry) =>
  (e.name || e.filename).toLowerCase().replace(/^feedback_|^project_/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "rule";
const bodyOf = (e: Entry) =>
  e.why || e.how ? `${e.description}\n\n${e.why ? "**Why:** " + e.why : ""}\n${e.how ? "**How to apply:** " + e.how : ""}`.trim() : (e.snippet || e.description || "");

export function Card({ entry, showProject = true }: { entry: Entry; showProject?: boolean }) {
  const { cart, cartSet, cartRemove } = useStore();
  const item = cart.get(entry.id);
  const harden = cart.get("h:" + entry.id) as Extract<CartItem, { kind: "harden" }> | undefined;
  const action = item?.kind ?? "keep";

  const setAction = (a: string) => {
    if (a === "keep") return cartRemove(entry.id);
    if (a === "edit") cartSet({ key: entry.id, kind: "edit", id: entry.id, new_body: bodyOf(entry) });
    else if (a === "delete") cartSet({ key: entry.id, kind: "delete", id: entry.id, reason: "" });
    else if (a === "split") cartSet({ key: entry.id, kind: "split", id: entry.id, keep_as_rule: "", move_to_filename: entry.filename.replace(/\.md$/, "") + "-log.md", delete_moved: false });
    else if (a === "promote") cartSet({ key: entry.id, kind: "promote", id: entry.id, source_ids: [entry.id], target_topic: slug(entry), global_filename: slug(entry) + ".md", translated_text: "", keep_origin: "leave", supersedes_global: null });
  };

  const cls = "card" + (item ? (item.kind === "delete" ? " staged-delete" : " staged") : "") + (entry.previously_declined_promotion ? " dimmed" : "");

  return (
    <div className={cls}>
      <div className="top">
        <span className={"badge " + entry.type}>{entry.type}</span>
        {showProject && <span>{entry.project_slug}</span>}
        <span>· {entry.age_days}d</span>
        <span className={entry.split_candidate ? "" : ""} style={entry.split_candidate ? { color: "var(--info)" } : undefined}>· {entry.lines} Z.</span>
        {entry.origin_session_id && <Tooltip text={"Session " + entry.origin_session_id}><span className="mono">· {entry.origin_session_id.slice(0, 7)}</span></Tooltip>}
        {entry.parse_error && <span className="sig uni">parse: {entry.parse_error}</span>}
        <span style={{ flex: 1 }} />
        <SignalBadges entry={entry} />
      </div>

      <h4>{entry.name || entry.filename}</h4>
      {entry.description && <div className="desc">{entry.description}</div>}
      {(entry.why || entry.how) && (
        <div className="wh">
          {entry.why && <div><b>Why:</b> {entry.why}</div>}
          {entry.how && <div><b>How:</b> {entry.how}</div>}
        </div>
      )}
      {!entry.description && entry.snippet && <div className="wh">{entry.snippet}</div>}
      {entry.wiki_links.length > 0 && (
        <div className="links">
          {entry.wiki_links.map((w, i) => <span key={i} className={"wl" + (w.resolved ? "" : " dangling")}>[[{w.target}]]</span>)}
        </div>
      )}

      <div className="actions">
        <div className="seg">
          {["keep", "edit", "delete", "promote", "split"].map((a) => {
            if (a === "split" && !entry.split_candidate) return null;
            return (
              <Tooltip key={a} text={ACTION_TIP[a]}>
                <button className={(action === a ? "on " : "") + (a === "delete" ? "del" : a === "promote" ? "pro" : "")} onClick={() => setAction(a)}>{a}</button>
              </Tooltip>
            );
          })}
        </div>
        {entry.enforceable_candidate && (
          <div className="harden-toggle">
            <Tooltip text="Aus dieser Regel einen echten Hook in settings.json machen (über das Diff-Gate). Das Memory bleibt erhalten.">
              <button className={"btn sm harden-btn" + (harden ? " primary" : "")}
                onClick={() => harden ? cartRemove("h:" + entry.id) : cartSet({ key: "h:" + entry.id, kind: "harden", id: entry.id, scope: "global", suggestion_kind: "hook" })}>
                <ShieldAlert size={13} /> als Hook härten
              </button>
            </Tooltip>
            {harden && (
              <span className="radio-row" style={{ marginLeft: 6 }}>
                {(["global", "project"] as const).map((s) => (
                  <button key={s} className={"radio-chip" + (harden.scope === s ? " on" : "")}
                    onClick={() => cartSet({ ...harden, scope: s })}>{s === "global" ? "global" : "nur " + entry.project_slug}</button>
                ))}
              </span>
            )}
          </div>
        )}
      </div>

      {item && <Editor entry={entry} item={item} />}
    </div>
  );
}

function Editor({ entry, item }: { entry: Entry; item: CartItem }) {
  const { cartSet, inv } = useStore();
  const upd = (patch: Partial<CartItem>) => cartSet({ ...item, ...patch } as CartItem);

  if (item.kind === "edit") {
    return (
      <div className="editor">
        <div className="hint">Body bearbeiten (bleibt im Projekt):</div>
        <textarea value={item.new_body} onChange={(e) => upd({ new_body: e.target.value })} />
      </div>
    );
  }
  if (item.kind === "delete") {
    return (
      <div className="editor">
        <div className="row"><span className="hint">Grund (optional):</span>
          <input type="text" value={item.reason} onChange={(e) => upd({ reason: e.target.value })} placeholder="z. B. veraltet" />
        </div>
      </div>
    );
  }
  if (item.kind === "split") {
    return (
      <div className="editor">
        <div className="hint">Die DAUERHAFTE Regel, die bleibt (leer = Claude wählt die Grenze):</div>
        <textarea value={item.keep_as_rule} onChange={(e) => upd({ keep_as_rule: e.target.value })} placeholder="z. B. die ersten Zeilen mit Why/How…" />
        <div className="row">
          <span className="hint">Logs nach:</span>
          <input type="text" value={item.move_to_filename} onChange={(e) => upd({ move_to_filename: e.target.value })} style={{ flex: 1 }} />
          <label className="hint"><input type="checkbox" checked={item.delete_moved} onChange={(e) => upd({ delete_moved: e.target.checked })} /> Logs stattdessen löschen</label>
        </div>
      </div>
    );
  }
  if (item.kind === "promote") {
    const topics = inv?.global.rules.map((r) => r.filename.replace(/\.md$/, "")) ?? [];
    const collide = inv?.global.rules.find((r) => r.filename === item.global_filename);
    const addLines = item.translated_text.trim() ? item.translated_text.replace(/\n+$/, "").split("\n").length : 6;
    return (
      <div className="editor">
        {item.source_ids.length > 1 && <div className="hint">Merge aus {item.source_ids.length} Memories zu einer Regel.</div>}
        <div className="row">
          <span className="hint">→ ~/.claude/rules/</span>
          <select className="select" value={topics.includes(item.target_topic) ? item.target_topic : "__new"}
            onChange={(e) => { const v = e.target.value === "__new" ? slug(entry) : e.target.value; upd({ target_topic: v, global_filename: v + ".md", supersedes_global: e.target.value === "__new" ? null : v + ".md" }); }}>
            <option value="__new">+ neues Thema</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="text" value={item.target_topic} onChange={(e) => { const v = e.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase(); upd({ target_topic: v, global_filename: v + ".md", supersedes_global: inv?.global.rules.some((r) => r.filename === v + ".md") ? v + ".md" : null }); }} style={{ width: 150 }} />
          <span className="hint">.md</span>
        </div>
        <textarea value={item.translated_text} onChange={(e) => upd({ translated_text: e.target.value })}
          placeholder="Globale Regel als bewusste Anweisung (Imperativ). Leer lassen ⇒ Claude übersetzt die Beobachtung und zeigt dir den Vorschlag." />
        <div className="row">
          <span className="hint">Herkunft:</span>
          <span className="radio-row">
            {(["leave", "annotate", "delete"] as KeepOrigin[]).map((v) => (
              <button key={v} className={"radio-chip" + (item.keep_origin === v ? " on" : "")} onClick={() => upd({ keep_origin: v })}>
                {v === "leave" ? "im Projekt lassen" : v === "annotate" ? "Rückverweis" : "Projekt-Memory löschen"}
              </button>
            ))}
          </span>
        </div>
        <div className="row">
          <span className="delta">+{addLines} Zeilen Budget</span>
          {collide && <span className="collide">⚠ Regel existiert — Claude bietet Merge an</span>}
        </div>
      </div>
    );
  }
  return null;
}
