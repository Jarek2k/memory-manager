/* Unit test for the change-preview mapper. Bundles via esbuild (imports `diff`).
 * Run: node test/changePreview.test.mjs */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const res = await build({
  entryPoints: [join(here, "../src/lib/changePreview.ts")],
  bundle: true, format: "esm", write: false, platform: "node", logLevel: "silent",
});
const m = await import("data:text/javascript," + encodeURIComponent(res.outputFiles[0].text));

let fail = 0;
const ok = (name, cond) => { if (!cond) { fail++; console.error("FAIL " + name); } };

const inv = {
  global: {
    settings: { path: "/x/.claude/settings.json", raw: JSON.stringify({ permissions: { allow: ["A"], deny: [], ask: ["B"] } }) },
    claude_md: { path: "/x/.claude/CLAUDE.md", content: "# old\n- one\n" },
    rules: [],
  },
  projects: [],
  entries: [{ id: "p::m", name: "mem-one", description: "d", why: "", how: "", snippet: "body", project_slug: "p" }],
};

// edit_settings: B moves ask -> allow, previewable, perm-colored
{
  const it = { key: "s:/x/.claude/settings.json", kind: "edit_settings", path: "/x/.claude/settings.json", scope: "global",
    new_content: JSON.stringify({ permissions: { allow: ["A", "B"], deny: [], ask: [] } }), summary: "x" };
  const pv = m.buildChangePreview(it, inv);
  ok("settings previewable", pv.previewable === true);
  ok("settings type=permission", pv.type === "permission");
  ok("settings before/after present", !!pv.before && !!pv.after);
  const move = pv.semantic.find((s) => s.tone === "move" && s.text === "B");
  ok("B move ask->allow", move && move.from === "Nachfragen" && move.to === "Erlaubt" && move.toKey === "allow");
}

// edit_global: text edit, rule-colored, previewable with before from inventory
{
  const it = { key: "g:/x/.claude/CLAUDE.md", kind: "edit_global", path: "/x/.claude/CLAUDE.md", new_content: "# old\n- one\n- two\n", estLines: 3 };
  const pv = m.buildChangePreview(it, inv);
  ok("edit_global previewable", pv.previewable === true && pv.type === "rule");
  ok("edit_global before from inventory", pv.before === "# old\n- one\n");
}

// harden: judgment op → not previewable, has a note, hook-colored
{
  const pv = m.buildChangePreview({ key: "h:p::m", kind: "harden", id: "p::m", scope: "global", suggestion_kind: "hook" }, inv);
  ok("harden not previewable", pv.previewable === false);
  ok("harden has note", !!pv.note);
  ok("harden type=hook", pv.type === "hook");
}

// delete memory: semantic delete, previewable, before = body
{
  const pv = m.buildChangePreview({ key: "p::m", kind: "delete", id: "p::m", reason: "" }, inv);
  ok("delete title from entry", pv.title === "mem-one");
  ok("delete tone", pv.semantic[0].tone === "del");
}

if (fail) { console.error("\nFAILED " + fail + " checks"); process.exit(1); }
console.log("changePreview: all checks passed");
