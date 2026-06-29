import { useMemo, useState } from "react";
import { FileLock2, Trash2, Undo2 } from "lucide-react";
import type { CartItem, GlobalFile, GlobalRuleFile } from "../types";
import { useStore } from "../store";
import { BudgetMeter } from "../components/BudgetMeter";
import { AboutMeSection } from "./AboutMe";
import { EditableSettings } from "../components/SettingsEditor";
import { RuleItem } from "../components/RuleItem";
import { TypeLegend } from "../components/TypeLegend";
import { TypeSectionHead } from "../components/TypeBadge";
import { decompose, spliceItem } from "../lib/decompose";

const lc = (s: string) => (s ? s.replace(/\n+$/, "").split("\n").length : 0);

/* ---- editable global file (CLAUDE.md + ~/.claude/rules/*) ---- */
function FileBlock({ file, isRule }: { file: GlobalFile | GlobalRuleFile; isRule: boolean }) {
  const { cart, cartSet, cartRemove } = useStore();
  const editKey = "g:" + file.path;
  const delKey = "gd:" + file.path;
  const edit = cart.get(editKey) as Extract<CartItem, { kind: "edit_global" }> | undefined;
  const del = cart.get(delKey);
  const rule = isRule ? (file as GlobalRuleFile) : null;
  const [raw, setRaw] = useState(false);

  // working content = staged edit if any, else the raw file. Items are always
  // re-derived from working content (no frozen ranges → no drift).
  const working = edit?.new_content ?? file.content;
  const items = useMemo(() => decompose(working), [working]);

  const setContent = (c: string) => {
    if (c === file.content) cartRemove(editKey);
    else cartSet({ key: editKey, kind: "edit_global", path: file.path, new_content: c, estLines: lc(c) });
  };

  return (
    <div className="glob-file" style={del ? { opacity: 0.5, borderColor: "var(--danger)" } : undefined}>
      <div className="gf-head">
        <span className="path">{file.path}</span>
        <span className="pill tabnum">{lc(working)} Z.</span>
        {rule && <span className={"pill" + (rule.imported ? " imp" : "")}>{rule.imported ? "@import aktiv" : "nicht eingebunden"}</span>}
        {edit && <span className="pill imp">geändert</span>}
        <span style={{ flex: 1 }} />
        {del ? (
          <button className="btn ghost sm" onClick={() => cartRemove(delKey)}><Undo2 size={13} /> Löschen verwerfen</button>
        ) : (
          <>
            <button className="btn ghost sm" onClick={() => setRaw((r) => !r)}>{raw ? "Einzelregeln" : "ganze Datei"}</button>
            {edit && <button className="btn ghost sm" onClick={() => cartRemove(editKey)}><Undo2 size={13} /> Änderungen verwerfen</button>}
            {rule && <button className="btn danger sm" onClick={() => cartSet({ key: delKey, kind: "delete_global", path: file.path })}><Trash2 size={13} /> Datei löschen</button>}
          </>
        )}
      </div>
      {del ? (
        <pre style={{ opacity: 0.6 }}>{file.content || "(leer)"}</pre>
      ) : raw ? (
        <div style={{ padding: 12 }}>
          <textarea style={{ width: "100%", minHeight: 200, background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontFamily: "var(--mono)", fontSize: 12 }}
            value={working} onChange={(e) => setContent(e.target.value)} />
          <div className="hint" style={{ color: "var(--faint)", fontSize: 12, marginTop: 6 }}>Ganze Datei — landet im Warenkorb, geschrieben erst über das Diff-Gate.</div>
        </div>
      ) : (
        <div className="rule-items">
          {items.length === 0 ? <div className="ri-empty">(leer)</div> : items.map((it, idx) => (
            <RuleItem key={idx + ":" + it.line_start} item={it} editable
              onSave={(t) => setContent(spliceItem(working, it.line_start, it.line_end, t))}
              onDelete={() => setContent(spliceItem(working, it.line_start, it.line_end, null))} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GlobalView() {
  const { inv } = useStore();
  if (!inv) return null;
  const g = inv.global;
  const s = g.settings;

  return (
    <div className="view">
      <TypeLegend />

      {/* 1 · HOOKS — hardest, mechanical */}
      <TypeSectionHead type="hook" title="Hooks" meta="~/.claude/settings.json · läuft vor jedem Tool" />
      <p className="sect-intro">Kleine Programme, die <b>vor</b> einem Tool-Aufruf laufen und ihn erlauben, blockieren oder nachfragen. Mechanisch — Claude kann nicht abweichen.</p>
      {s && s.hook_count > 0 ? (
        <div className="hard-block hook"><EditableSettings s={s} scope="global" only="hooks" /></div>
      ) : (
        <div className="empty"><FileLock2 size={20} style={{ opacity: 0.5 }} /><div>Noch keine Hooks. Über <b>„⚖ härten"</b> an einer harten „nie/immer"-Memory entsteht hier der erste.</div></div>
      )}

      {/* 2 · PERMISSIONS — mechanical */}
      <TypeSectionHead type="permission" title="Permissions" meta="~/.claude/settings.json · Erlaubnis-Liste" />
      <p className="sect-intro">Feste Muster, mechanisch gegen jeden Tool-Aufruf geprüft: <b>verboten</b> ▸ <b>nachfragen</b> ▸ <b>erlaubt</b> (verboten sticht).</p>
      {s && s.permission_count > 0 ? (
        <div className="hard-block perm"><EditableSettings s={s} scope="global" only="permissions" /></div>
      ) : (
        <div className="empty"><FileLock2 size={20} style={{ opacity: 0.5 }} /><div>Keine Permissions in der globalen <span className="mono">settings.json</span>.</div></div>
      )}

      {/* 3 · REGELN — soft, always-loaded context */}
      <TypeSectionHead type="rule" title="Regeln" meta="CLAUDE.md + rules/ · jede Session geladen" />
      <p className="sect-intro">Klartext-Anweisungen, die jede Session laden. <b>Weich</b> — Claude befolgt sie, erzwungen sind sie nicht. Schlank halten (Warnung ab 150, Limit 200 Z.).</p>
      <div className="rules-intro">
        <BudgetMeter />
        <span className="ri-text">Jede Regel ist einzeln editier-/löschbar; Änderungen landen im Warenkorb und werden erst über das Diff-Gate geschrieben.</span>
      </div>
      <div className="sub-head"><span className="mono">~/.claude/CLAUDE.md</span><span className="meta">dein Index</span></div>
      <FileBlock file={g.claude_md} isRule={false} />
      <div className="sub-head"><span className="mono">~/.claude/rules/</span><span className="meta">{g.rules.length} Datei{g.rules.length === 1 ? "" : "en"}</span></div>
      {g.rules.length === 0 ? (
        <div className="empty"><FileLock2 size={20} style={{ opacity: 0.5 }} /><div>Noch keine globalen Regeln.<br />Über <b>„promote"</b> an einer Memory entsteht hier die erste — als bewusste, immer geladene Regel.</div></div>
      ) : g.rules.map((r) => <FileBlock key={r.path} file={r} isRule />)}

      {/* 4 · ÜBER MICH — softest, context (renders its own type-colored header) */}
      <AboutMeSection />
    </div>
  );
}
