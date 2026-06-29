import type { CartItem, Entry, Inventory, SettingsFile } from "../types";
import type { ConceptType } from "../components/TypeBadge";
import { diffSettings, textDiff } from "./semanticDiff";
import type { SettingsChange } from "./semanticDiff";

/** Turns each staged cart item into a reviewable change: a domain-aware semantic
 * summary plus the before/after text for the drill-down word diff. Judgment ops
 * (Claude must compose the final text after submit) are flagged not-previewable. */

export interface SemLine {
  tone: "move" | "add" | "del" | "info";
  text: string; from?: string; to?: string;
  fromKey?: "deny" | "ask" | "allow"; toKey?: "deny" | "ask" | "allow"; // color the bucket
}
export interface ChangePreview {
  key: string;
  type?: ConceptType;
  title: string;
  kindLabel: string;
  semantic: SemLine[];
  before?: string;
  after?: string;
  previewable: boolean;
  note?: string;
}

const ACT: Record<string, string> = { deny: "Verboten", ask: "Nachfragen", allow: "Erlaubt" };
const projName = (path: string) => path.replace(/\/\.claude\/settings\.json$/, "").split("/").pop() || "Projekt";

const bodyOf = (e: Entry) =>
  e.why || e.how
    ? `${e.description}\n\n${e.why ? "**Why:** " + e.why : ""}\n${e.how ? "**How to apply:** " + e.how : ""}`.trim()
    : (e.snippet || e.description || "");

function stats(before: string, after: string): { add: number; del: number } {
  let add = 0, del = 0;
  for (const r of textDiff(before, after)) { if (r.t === "add") add++; else if (r.t === "del") del++; }
  return { add, del };
}
const delta = (s: { add: number; del: number }) => (s.add ? `+${s.add}` : "") + (s.add && s.del ? " / " : "") + (s.del ? `−${s.del}` : "") || "0";

function settingsSemantic(changes: SettingsChange[]): SemLine[] {
  return changes.map((c): SemLine => {
    if (c.kind === "perm-move") return { tone: "move", text: c.raw, from: ACT[c.from!], to: ACT[c.to!], fromKey: c.from, toKey: c.to };
    if (c.kind === "perm-add") return { tone: "add", text: c.raw, to: ACT[c.to!], toKey: c.to };
    if (c.kind === "perm-remove") return { tone: "del", text: c.raw, from: ACT[c.from!], fromKey: c.from };
    if (c.kind === "hook-add") return { tone: "add", text: `Hook: ${c.raw}`, to: c.event };
    return { tone: "del", text: `Hook: ${c.raw}`, from: c.event }; // hook-remove
  });
}

function findSettings(inv: Inventory, path: string): SettingsFile | null {
  if (inv.global.settings?.path === path) return inv.global.settings;
  for (const p of inv.projects) if (p.settings?.path === path) return p.settings;
  return null;
}
function findGlobalFile(inv: Inventory, path: string): { content: string } | null {
  if (inv.global.claude_md.path === path) return inv.global.claude_md;
  const r = inv.global.rules.find((x) => x.path === path);
  return r ? r : null;
}

export function buildChangePreview(it: CartItem, inv: Inventory): ChangePreview {
  switch (it.kind) {
    case "edit_settings": {
      const orig = findSettings(inv, it.path);
      const before = orig?.raw ?? "";
      const changes = diffSettings(before, it.new_content);
      const onlyHooks = changes.length > 0 && changes.every((c) => c.kind.startsWith("hook"));
      return {
        key: it.key, type: onlyHooks ? "hook" : "permission",
        title: it.scope === "global" ? "Globale settings.json" : `${projName(it.path)} · settings.json`,
        kindLabel: it.scope === "global" ? "global" : "Projekt",
        semantic: changes.length ? settingsSemantic(changes) : [{ tone: "info", text: "Keine inhaltliche Änderung" }],
        before, after: it.new_content, previewable: true,
      };
    }
    case "edit_global": {
      const before = findGlobalFile(inv, it.path)?.content ?? "";
      const s = stats(before, it.new_content);
      const isMd = it.path.endsWith("CLAUDE.md");
      return {
        key: it.key, type: "rule",
        title: it.path.replace(/^.*\/\.claude\//, "~/.claude/"),
        kindLabel: isMd ? "CLAUDE.md" : "Regeldatei",
        semantic: [{ tone: "info", text: `Text bearbeitet · ${delta(s)} Zeilen` }],
        before, after: it.new_content, previewable: true,
      };
    }
    case "delete_global": {
      const before = findGlobalFile(inv, it.path)?.content ?? "";
      return {
        key: it.key, type: "rule",
        title: it.path.replace(/^.*\/\.claude\//, "~/.claude/"),
        kindLabel: "Regeldatei",
        semantic: [{ tone: "del", text: "Datei gelöscht" }, { tone: "del", text: "@import in CLAUDE.md entfernt" }],
        before, after: "", previewable: true,
      };
    }
    case "edit": {
      const e = inv.entries.find((x) => x.id === it.id);
      const before = e ? bodyOf(e) : "";
      const s = stats(before, it.new_body);
      return {
        key: it.key, type: "memory",
        title: e?.name || it.id, kindLabel: "Memory",
        semantic: [{ tone: "info", text: `Text bearbeitet · ${delta(s)} Zeilen` }],
        before, after: it.new_body, previewable: true,
      };
    }
    case "delete": {
      const e = inv.entries.find((x) => x.id === it.id);
      // a delete's key question is "what do I lose?" — surface the content inline,
      // not only behind the diff drill-down
      const gist = e ? (e.description || e.snippet || bodyOf(e)).replace(/\s+/g, " ").trim().slice(0, 140) : "";
      const sem: SemLine[] = [{ tone: "del", text: "Memory gelöscht" + (e ? ` (${e.project_slug})` : "") }];
      if (gist) sem.push({ tone: "info", text: gist });
      return {
        key: it.key, type: "memory",
        title: e?.name || it.id, kindLabel: "Memory",
        semantic: sem,
        before: e ? bodyOf(e) : "", after: "", previewable: true,
      };
    }
    case "promote": {
      const e = inv.entries.find((x) => x.id === it.id);
      const hasText = it.translated_text.trim().length > 0;
      return {
        key: it.key, type: "rule",
        title: `~/.claude/rules/${it.global_filename}`, kindLabel: "neue globale Regel",
        semantic: [
          { tone: "add", text: `Neue Regel rules/${it.global_filename}` },
          { tone: "add", text: "@import in CLAUDE.md" },
          ...(it.source_ids.length > 1 ? [{ tone: "info", text: `Merge aus ${it.source_ids.length} Memories` } as SemLine] : []),
        ],
        before: "", after: hasText ? it.translated_text : undefined,
        previewable: hasText,
        note: hasText ? undefined : `Claude formuliert die Regel aus „${e?.name || it.id}" und zeigt sie vor dem Schreiben.`,
      };
    }
    case "split":
      return {
        key: it.key, type: "memory", title: it.id, kindLabel: "Memory aufteilen",
        semantic: [{ tone: "info", text: "Dauerregel behalten, Logs auslagern" }],
        previewable: false,
        note: it.keep_as_rule.trim() ? undefined : "Claude wählt die Schnittgrenze und zeigt das Ergebnis vor dem Schreiben.",
      };
    case "harden":
      return {
        key: it.key, type: "hook", title: it.id, kindLabel: "als Hook härten",
        semantic: [{ tone: "add", text: `Neuer Hook (${it.scope === "global" ? "global" : "Projekt"})` }],
        previewable: false,
        note: "Claude komponiert den Hook-Block für settings.json und zeigt ihn vor dem Schreiben.",
      };
    case "user_summary":
      return {
        key: it.key, type: "memory", title: "Über mich", kindLabel: "Profil entwerfen",
        semantic: [{ tone: "add", text: "Über-mich-Text aus deinen Memories" }],
        previewable: false,
        note: "Claude entwirft den Text und zeigt ihn vor dem Schreiben.",
      };
  }
}

export const buildChangePreviews = (items: CartItem[], inv: Inventory): ChangePreview[] =>
  items.map((it) => buildChangePreview(it, inv));
