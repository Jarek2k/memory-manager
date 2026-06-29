/* TS port of scripts/scan.py:decompose_markdown — MUST stay byte-identical in
 * its item boundaries (guarded by the Python↔TS parity test). Segments a
 * markdown rule file into addressable items with 1-based inclusive line ranges
 * so a single rule can be shown/edited/deleted while the raw .md is the source
 * of truth. */

export type RuleItemType = "frontmatter" | "heading" | "bullet" | "paragraph";
export interface RuleItem {
  type: RuleItemType;
  line_start: number; // 1-based inclusive
  line_end: number;
  content: string;
  heading: string | null;
  level: number | null;
}

const H_RE = /^(#{1,6})\s/;
const BULLET_RE = /^(\s*)(?:[-*+]|\d+\.)\s/;

const leadingWs = (s: string) => s.length - s.replace(/^\s+/, "").length;

export function decompose(content: string): RuleItem[] {
  const items: RuleItem[] = [];
  if (!content) return items;
  const lines = content.split("\n");
  const n = lines.length;
  let i = 0;
  let curHeading: string | null = null;

  if (lines.length && lines[0].trim() === "---") {
    let j = 1;
    while (j < n && lines[j].trim() !== "---") j++;
    if (j < n) {
      j += 1; // include closing ---
      items.push({ type: "frontmatter", line_start: 1, line_end: j, content: lines.slice(0, j).join("\n"), heading: null, level: null });
      i = j;
    }
  }

  while (i < n) {
    const ln = lines[i];
    if (!ln.trim()) { i++; continue; }
    const hm = H_RE.exec(ln);
    if (hm) {
      const level = hm[1].length;
      items.push({ type: "heading", line_start: i + 1, line_end: i + 1, content: ln, heading: ln.slice(level).trim(), level });
      if (level <= 3) curHeading = ln.slice(level).trim();
      i++;
      continue;
    }
    if (BULLET_RE.test(ln)) {
      const baseIndent = leadingWs(ln);
      let j = i + 1;
      while (j < n) {
        const nxt = lines[j];
        if (!nxt.trim() || H_RE.test(nxt)) break;
        if (BULLET_RE.test(nxt)) {
          if (leadingWs(nxt) > baseIndent) { j++; continue; }
          break;
        }
        if (nxt.startsWith(" ") || nxt.startsWith("\t")) { j++; continue; }
        break;
      }
      items.push({ type: "bullet", line_start: i + 1, line_end: j, content: lines.slice(i, j).join("\n"), heading: curHeading, level: null });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < n && lines[j].trim() && !H_RE.test(lines[j]) && !BULLET_RE.test(lines[j])) j++;
    items.push({ type: "paragraph", line_start: i + 1, line_end: j, content: lines.slice(i, j).join("\n"), heading: curHeading, level: null });
    i = j;
  }
  return items;
}

/** Replace one item's line range with new text (or delete it when newText is
 * null), returning the full new file content. Operates on the SAME content the
 * items were decomposed from — no frozen inventory ranges. */
export function spliceItem(content: string, lineStart: number, lineEnd: number, newText: string | null): string {
  const lines = content.split("\n");
  const before = lines.slice(0, lineStart - 1);
  const after = lines.slice(lineEnd);
  if (newText === null) {
    // drop one orphaned blank gap so a delete doesn't leave a double blank
    if (after.length && !after[0].trim() && before.length && !before[before.length - 1].trim()) after.shift();
    return [...before, ...after].join("\n");
  }
  return [...before, ...newText.split("\n"), ...after].join("\n");
}
