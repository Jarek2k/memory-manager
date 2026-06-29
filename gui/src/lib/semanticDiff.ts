import { diffLines, diffWordsWithSpace } from "diff";

/** Domain-aware ("semantic") diffs + a word-level text diff model. Pure functions,
 * unit-tested. The review gate leads with the semantic summary and offers the
 * text diff as a drill-down. */

export type PermAction = "allow" | "deny" | "ask";
const ACTIONS: PermAction[] = ["deny", "ask", "allow"];

export interface SettingsChange {
  kind: "perm-move" | "perm-add" | "perm-remove" | "hook-add" | "hook-remove";
  raw: string;            // permission pattern, or a hook command
  from?: PermAction;      // perm-move / perm-remove
  to?: PermAction;        // perm-move / perm-add
  event?: string;         // hook-add / hook-remove
}

function safeParse(text: string): any {
  try { const o = JSON.parse(text || "{}"); return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}

/** raw pattern → its action (last wins if duplicated across lists). */
function permMap(o: any): Map<string, PermAction> {
  const m = new Map<string, PermAction>();
  const p = o.permissions || {};
  for (const a of ACTIONS) for (const raw of Array.isArray(p[a]) ? p[a] : []) m.set(String(raw), a);
  return m;
}

/** flat hook rows keyed event::matcher::command. */
function hookRows(o: any): Map<string, { event: string; command: string }> {
  const m = new Map<string, { event: string; command: string }>();
  const h = o.hooks || {};
  if (h && typeof h === "object") {
    for (const [event, arr] of Object.entries(h)) {
      if (!Array.isArray(arr)) continue;
      for (const grp of arr as any[]) {
        const matcher = String(grp?.matcher ?? "");
        for (const hk of grp?.hooks ?? []) {
          if (hk?.command) m.set(event + "::" + matcher + "::" + hk.command, { event, command: String(hk.command) });
        }
      }
    }
  }
  return m;
}

/** Semantic change list between two settings.json texts: permissions that moved
 * between deny/ask/allow or were added/removed, and hooks added/removed. */
export function diffSettings(before: string, after: string): SettingsChange[] {
  const a = permMap(safeParse(before)), b = permMap(safeParse(after));
  const out: SettingsChange[] = [];
  const raws = new Set<string>([...a.keys(), ...b.keys()]);
  for (const raw of raws) {
    const from = a.get(raw), to = b.get(raw);
    if (from && to && from !== to) out.push({ kind: "perm-move", raw, from, to });
    else if (from && !to) out.push({ kind: "perm-remove", raw, from });
    else if (!from && to) out.push({ kind: "perm-add", raw, to });
  }
  const ha = hookRows(safeParse(before)), hb = hookRows(safeParse(after));
  for (const [k, v] of ha) if (!hb.has(k)) out.push({ kind: "hook-remove", raw: v.command, event: v.event });
  for (const [k, v] of hb) if (!ha.has(k)) out.push({ kind: "hook-add", raw: v.command, event: v.event });
  // stable, scannable order: moves, adds, removes, hooks
  const rank = (c: SettingsChange) =>
    ({ "perm-move": 0, "perm-add": 1, "perm-remove": 2, "hook-add": 3, "hook-remove": 4 })[c.kind];
  return out.sort((x, y) => rank(x) - rank(y) || x.raw.localeCompare(y.raw));
}

/* ---------- word-level text diff (the drill-down) ---------- */

export interface Tok { v: string; hl: boolean }
export type DiffRow =
  | { t: "same"; line: string }
  | { t: "fold"; n: number }
  | { t: "del"; tokens: Tok[] }
  | { t: "add"; tokens: Tok[] };

const splitLines = (s: string) => (s.endsWith("\n") ? s.slice(0, -1) : s).split("\n");

/** Pair an equal-length removed/added run line-by-line and highlight only the
 * words that actually changed (so a one-word edit isn't a full-line rewrite). */
function refinePair(delLines: string[], addLines: string[]): { del: DiffRow[]; add: DiffRow[] } {
  const del: DiffRow[] = [], add: DiffRow[] = [];
  for (let i = 0; i < delLines.length; i++) {
    const parts = diffWordsWithSpace(delLines[i], addLines[i]);
    del.push({ t: "del", tokens: parts.filter((p) => !p.added).map((p) => ({ v: p.value, hl: !!p.removed })) });
    add.push({ t: "add", tokens: parts.filter((p) => !p.removed).map((p) => ({ v: p.value, hl: !!p.added })) });
  }
  return { del, add };
}

/** Unified word-level diff rows. Long unchanged runs fold; a modified line shows
 * only its changed words highlighted. */
export function textDiff(before: string, after: string, context = 3): DiffRow[] {
  const blocks = diffLines(before ?? "", after ?? "");
  const rows: DiffRow[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    if (blk.added || blk.removed) {
      // a removed block immediately followed by an added block of equal line count
      // → refine word-level; otherwise emit uniform colored lines
      const next = blocks[i + 1];
      if (blk.removed && next && next.added) {
        const dl = splitLines(blk.value), al = splitLines(next.value);
        if (dl.length === al.length) {
          const { del, add } = refinePair(dl, al);
          rows.push(...del, ...add);
          i++; // consumed the paired added block
          continue;
        }
      }
      for (const line of splitLines(blk.value))
        rows.push({ t: blk.added ? "add" : "del", tokens: [{ v: line, hl: false }] });
    } else {
      const lines = splitLines(blk.value);
      const leading = rows.length === 0;            // before the first change
      const trailing = i === blocks.length - 1;     // after the last change
      const push = (ls: string[]) => { for (const l of ls) rows.push({ t: "same", line: l }); };
      if (lines.length > context * 2 + 1) {
        if (leading && !trailing) {                 // fold the head, keep context before the change
          rows.push({ t: "fold", n: lines.length - context });
          push(lines.slice(-context));
        } else if (trailing && !leading) {          // keep context after the change, fold the tail
          push(lines.slice(0, context));
          rows.push({ t: "fold", n: lines.length - context });
        } else {                                    // interior (or whole-file): keep both ends
          push(lines.slice(0, context));
          rows.push({ t: "fold", n: lines.length - context * 2 });
          push(lines.slice(-context));
        }
      } else {
        push(lines);
      }
    }
  }
  return rows;
}
