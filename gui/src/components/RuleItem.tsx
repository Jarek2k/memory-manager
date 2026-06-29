import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { RuleItem as RuleItemData } from "../lib/decompose";

/** One decomposed rule (heading / bullet / paragraph / frontmatter). Editable
 * variant maps an edit/delete back to the raw .md via the parent; read-only
 * variant (project rules) just displays. */
export function RuleItem({ item, editable = false, onSave, onDelete }: {
  item: RuleItemData;
  editable?: boolean;
  onSave?: (newText: string) => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.content);
  useEffect(() => setText(item.content), [item.content]);

  const isHeading = item.type === "heading";
  const isFront = item.type === "frontmatter";

  return (
    <div className={"rule-item " + item.type + (editing ? " editing" : "")}>
      {editing ? (
        <div className="ri-editor">
          <textarea value={text} onChange={(e) => setText(e.target.value)}
            rows={Math.min(12, Math.max(2, text.split("\n").length + 1))} />
          <div className="ri-edit-actions">
            <button className="btn sm primary" onClick={() => { onSave?.(text); setEditing(false); }}>Übernehmen</button>
            <button className="btn sm ghost" onClick={() => { setText(item.content); setEditing(false); }}>Abbrechen</button>
            <span className="hint">Landet im Warenkorb — geschrieben wird erst über das Diff-Gate.</span>
          </div>
        </div>
      ) : (
        <>
          {isHeading ? (
            <div className="ri-heading" style={{ paddingLeft: ((item.level ?? 2) - 2) * 12 }}>{item.content.replace(/^#+\s*/, "")}</div>
          ) : (
            <pre className={"ri-content" + (isFront ? " front" : "")}>{item.content}</pre>
          )}
          {editable && (
            <div className="ri-actions">
              <button className="icon-btn edit" title="Diese Regel bearbeiten" onClick={() => setEditing(true)}><Pencil size={13} /></button>
              {!isFront && <button className="icon-btn danger" title="Diese Regel löschen" onClick={onDelete}><Trash2 size={13} /></button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
