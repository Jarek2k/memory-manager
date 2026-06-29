import { useState } from "react";
import { Pencil, ShieldCheck, ShieldQuestion, ShieldX, Webhook, Trash2, Undo2, GripVertical, ArrowUpToLine } from "lucide-react";
import type { CartItem, ParsedPermission, PermAction, SettingsFile } from "../types";
import { useStore } from "../store";
import { SettingsSummary } from "./SettingsSummary";
import {
  addHook, addPermission, currentHooks, currentPerms, deleteHook, deletePermission,
  findHook, movePermission,
} from "../lib/settingsEdit";

/** Read-only summary by default, flips to the editor on "Bearbeiten". The toggle
 * footer is the only chrome the caller needs; wrap it in a hard-block/settings-body. */
export function EditableSettings({ s, scope, only }: { s: SettingsFile; scope: "global" | "project"; only?: "hooks" | "permissions" }) {
  const { cart } = useStore();
  const [edit, setEdit] = useState(false);
  const staged = cart.has("s:" + s.path);
  return (
    <>
      {edit ? <SettingsEditor s={s} scope={scope} only={only} /> : <SettingsSummary s={s} only={only} />}
      <div className="hb-foot">
        <span style={{ flex: 1, color: staged ? "var(--rule-tx)" : edit ? "var(--accent)" : "var(--faint)" }}>
          {staged ? "Änderung vorgemerkt — geschrieben erst übers Diff-Gate" : edit ? (scope === "project" ? "Bearbeiten: löschen 🗑, ziehen oder ↥ nach Global" : "Bearbeiten: löschen 🗑 oder ziehen") : "Anzeige"}
        </span>
        <button className={"btn ghost sm" + (edit ? "" : " edit-btn")} onClick={() => setEdit((e) => !e)}>
          {edit ? "Fertig" : <><Pencil size={13} /> Bearbeiten</>}
        </button>
      </div>
    </>
  );
}

const ACTIONS: { action: PermAction; label: string; short: string; cls: string; Icon: any }[] = [
  { action: "deny", label: "Verboten", short: "Verboten", cls: "deny", Icon: ShieldX },
  { action: "ask", label: "Nachfragen", short: "Nachfragen", cls: "ask", Icon: ShieldQuestion },
  { action: "allow", label: "Ohne Nachfrage erlaubt", short: "Erlaubt", cls: "allow", Icon: ShieldCheck },
];

/** Editable view of a settings.json (global or a known project). Delete hooks /
 * permissions and drag permissions between deny/ask/allow. Every change is just a
 * staged edit_settings cart item — the browser never writes; apply.py + the
 * diff-gate do. `only` mirrors SettingsSummary so Global can split the sections. */
export function SettingsEditor({ s, scope, only }: { s: SettingsFile; scope: "global" | "project"; only?: "hooks" | "permissions" }) {
  const { inv, cart, cartSet, cartRemove } = useStore();
  const key = "s:" + s.path;
  const edit = cart.get(key) as Extract<CartItem, { kind: "edit_settings" }> | undefined;
  const working = edit?.new_content ?? s.raw;
  const [dragOver, setDragOver] = useState<PermAction | null>(null);

  // promote target = the global settings.json (only offered while editing a project file)
  const canPromote = scope === "project";
  const gPath = inv?.global.settings?.path ?? ((inv?.claude_dir ?? "") + "/settings.json");
  const gRaw = inv?.global.settings?.raw ?? "";
  const projName = s.path.replace(/\/\.claude\/settings\.json$/, "").split("/").pop() || "Projekt";

  /** Lift an entry to global: stage an add on global's settings (its own cart item),
   * composing with any pending global edit. The matching remove on this project file
   * is staged by the caller via apply(). Two diff-gated edit_settings, one promote. */
  const pushToGlobal = (mutate: (gWorking: string) => string, summary: string) => {
    const gKey = "s:" + gPath;
    const gEdit = cart.get(gKey) as Extract<CartItem, { kind: "edit_settings" }> | undefined;
    const gNext = mutate(gEdit?.new_content ?? gRaw);
    if (gNext === gRaw) cartRemove(gKey);
    else cartSet({ key: gKey, kind: "edit_settings", path: gPath, new_content: gNext, scope: "global", summary });
  };

  // raw pattern → its parsed meta (category etc.), action-independent
  const meta = new Map<string, ParsedPermission>();
  [...s.parsed.allow, ...s.parsed.ask, ...s.parsed.deny].forEach((p) => meta.set(p.raw, p));
  const hookSummary = new Map<string, string | null>();
  s.hooks.forEach((h) => h.parsed.forEach((p) => hookSummary.set(p.command, p.summary)));

  const apply = (next: string, summary: string) => {
    if (next === s.raw) cartRemove(key);
    else cartSet({ key, kind: "edit_settings", path: s.path, new_content: next, scope, summary });
  };

  // promote one or a whole category at once — fold all removals into one project
  // edit and all additions into one global edit (never N stale single applies)
  const promotePerms = (action: PermAction, raws: string[], catLabel?: string) => {
    if (!raws.length) return;
    const projNext = raws.reduce((w, raw) => deletePermission(w, action, raw), working);
    apply(projNext, raws.length === 1 ? "Permission nach Global verschoben"
      : `${raws.length}× ${catLabel ?? "Permission"} nach Global verschoben`);
    pushToGlobal((gw) => raws.reduce((w, raw) => addPermission(w, action, raw), gw),
      raws.length === 1 ? `Permission „${raws[0]}" aus ${projName} übernommen`
        : `${raws.length} ${catLabel ? catLabel + "-" : ""}Permissions aus ${projName} übernommen`);
  };
  // move one or a whole category between actions (deny/ask/allow) without dragging —
  // the non-drag path that keeps a long list manageable; folded into one edit
  const movePerms = (from: PermAction, to: PermAction, raws: string[], catLabel?: string) => {
    if (from === to || !raws.length) return;
    const next = raws.reduce((w, raw) => movePermission(w, from, to, raw), working);
    const toLabel = ACTIONS.find((a) => a.action === to)!.short;
    apply(next, raws.length === 1 ? `Permission nach „${toLabel}" verschoben`
      : `${raws.length}× ${catLabel ?? "Permission"} nach „${toLabel}" verschoben`);
  };
  const promoteHook = (h: { event: string; matcher: string; command: string }) => {
    const obj = findHook(working, h.event, h.matcher, h.command);
    apply(deleteHook(working, h.event, h.matcher, h.command), "Hook nach Global verschoben");
    if (obj) pushToGlobal((gw) => addHook(gw, h.event, h.matcher, obj), `Hook (${h.event}) aus ${projName} übernommen`);
  };

  const perms = currentPerms(working);
  const hooks = currentHooks(working);
  const showHooks = only !== "permissions";
  const showPerms = only !== "hooks";

  // within an action group, cluster patterns by their command category (MCP, Git, …)
  // so a whole category can be promoted at once; fixed order, "Sonstiges" last
  const CAT_ORDER = ["MCP", "Git", "Tests", "Netzwerk", "Dateien", "Shell", "Sonstiges"];
  const byCategory = (raws: string[]): [string, string[]][] => {
    const m = new Map<string, string[]>();
    for (const raw of raws) {
      const cat = meta.get(raw)?.category ?? "Sonstiges";
      (m.get(cat) ?? m.set(cat, []).get(cat)!).push(raw);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a[0]), ib = CAT_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    });
  };

  return (
    <div className="settings-editor">
      {edit && (
        <div className="se-banner">
          <span>geändert — landet im Warenkorb, geschrieben erst übers Diff-Gate</span>
          <button className="btn ghost sm" onClick={() => cartRemove(key)}><Undo2 size={13} /> verwerfen</button>
        </div>
      )}

      {showHooks && (
        <div className="se-hooks">
          {hooks.length === 0 ? <div className="ri-empty">Keine Hooks.</div> : hooks.map((h, i) => (
            <div key={i} className="se-hook">
              <Webhook size={14} className="se-ico hook" />
              <div className="se-hook-body">
                <div className="sset-summary">{hookSummary.get(h.command) || <span className="sset-opaque">Eigener Hook</span>}</div>
                <div className="sset-sub mono">{h.event}{h.matcher ? " · " + h.matcher : ""}</div>
              </div>
              {canPromote && (
                <button className="icon-btn promote" title="Nach Global verschieben — gilt dann in allen Projekten" aria-label="Hook nach Global verschieben"
                  onClick={() => promoteHook(h)}>
                  <ArrowUpToLine size={14} />
                </button>
              )}
              <button className="icon-btn danger" title="Hook löschen" aria-label="Hook löschen"
                onClick={() => apply(deleteHook(working, h.event, h.matcher, h.command), "Hook gelöscht")}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPerms && (
        <div className="se-perms">
          {ACTIONS.map(({ action, label, cls, Icon }) => (
            <div key={action}
              className={"se-group " + cls + (dragOver === action ? " drag-over" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(action); }}
              onDragLeave={() => setDragOver((d) => (d === action ? null : d))}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(null);
                const raw = e.dataTransfer.getData("text/perm");
                const from = e.dataTransfer.getData("text/from") as PermAction;
                if (raw && from && from !== action) apply(movePermission(working, from, action, raw), `Permission nach „${label}" verschoben`);
              }}>
              <div className={"se-group-head " + cls}><Icon size={13} /> {label} <span className="dim">· {perms[action].length}</span></div>
              {perms[action].length === 0 ? (
                <div className="se-drop-hint">hierher ziehen</div>
              ) : byCategory(perms[action]).map(([cat, raws]) => (
                <div key={cat} className="se-catgroup">
                  <div className="se-catgroup-head">
                    <span className="se-cat">{cat}</span>
                    <span className="dim">· {raws.length}</span>
                    {raws.length > 1 && (
                      <span className="se-cat-actions">
                        <span className="se-move-label">alle →</span>
                        {ACTIONS.filter((a) => a.action !== action).map((a) => (
                          <button key={a.action} className={"se-move-chip " + a.cls}
                            title={`Alle ${raws.length} ${cat}-Permissions nach „${a.short}"`}
                            onClick={() => movePerms(action, a.action, raws, cat)}>
                            <a.Icon size={12} /> {a.short}
                          </button>
                        ))}
                        {canPromote && (
                          <button className="se-promote-all" title={`Alle ${raws.length} ${cat}-Permissions nach Global verschieben`}
                            onClick={() => promotePerms(action, raws, cat)}>
                            <ArrowUpToLine size={12} /> Global
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {raws.map((raw) => (
                <div key={raw} className="se-perm" draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/perm", raw); e.dataTransfer.setData("text/from", action); e.dataTransfer.effectAllowed = "move"; }}>
                  <GripVertical size={13} className="se-grip" />
                  <div className="se-perm-body">
                    <code className="se-raw">{raw}</code>
                  </div>
                  {ACTIONS.filter((a) => a.action !== action).map((a) => (
                    <button key={a.action} className={"icon-btn move " + a.cls}
                      title={`Nach „${a.short}" verschieben`} aria-label={`nach ${a.short}`}
                      onClick={() => movePerms(action, a.action, [raw], meta.get(raw)?.category)}>
                      <a.Icon size={13} />
                    </button>
                  ))}
                  {canPromote && (
                    <button className="icon-btn promote" title="Nach Global verschieben — gilt dann in allen Projekten" aria-label="Permission nach Global verschieben"
                      onClick={() => promotePerms(action, [raw], meta.get(raw)?.category)}>
                      <ArrowUpToLine size={14} />
                    </button>
                  )}
                  <button className="icon-btn danger" title="Permission löschen" aria-label="Permission löschen"
                    onClick={() => apply(deletePermission(working, action, raw), "Permission gelöscht")}>
                    <Trash2 size={14} />
                  </button>
                </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
          <div className="se-hint">Verschieben: Ziel-Knopf am Eintrag (z. B. <b>Nachfragen</b>) oder per Griff ziehen · ganze Kategorie über „alle →" · 🗑 löscht{canPromote ? " · ↥ hebt nach Global (gilt dann überall)" : ""}.</div>
        </div>
      )}
    </div>
  );
}
