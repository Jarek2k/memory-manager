/* Unit test for the semantic + word-level diff. Bundles via esbuild because the
 * module imports `diff` from node_modules. Run: node test/semanticDiff.test.mjs */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const res = await build({
  entryPoints: [join(here, "../src/lib/semanticDiff.ts")],
  bundle: true, format: "esm", write: false, platform: "node", logLevel: "silent",
});
const m = await import("data:text/javascript," + encodeURIComponent(res.outputFiles[0].text));

let fail = 0;
const ok = (name, cond) => { if (!cond) { fail++; console.error("FAIL " + name); } };
const eq = (name, got, want) => ok(name + " (got " + JSON.stringify(got) + ")", JSON.stringify(got) === JSON.stringify(want));

// ---- diffSettings: moves, add, remove, hooks ----
const before = JSON.stringify({
  permissions: { allow: ["A"], deny: [], ask: ["B", "C"] },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "g1" }] }] },
});
const after = JSON.stringify({
  permissions: { allow: ["A", "B"], deny: ["C"], ask: [] },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "g2" }] }] },
});
const ch = m.diffSettings(before, after);
const find = (k, raw) => ch.find((c) => c.kind === k && c.raw === raw);
eq("move B ask->allow", find("perm-move", "B")?.from + ">" + find("perm-move", "B")?.to, "ask>allow");
eq("move C ask->deny", find("perm-move", "C")?.from + ">" + find("perm-move", "C")?.to, "ask>deny");
ok("hook g1 removed", !!find("hook-remove", "g1"));
ok("hook g2 added", !!find("hook-add", "g2"));
eq("no spurious changes", ch.length, 4);
eq("identical settings → no changes", m.diffSettings(before, before).length, 0);

// ---- textDiff: word-level on a modified line ----
const rows = m.textDiff("x\nold line\ny\n", "x\nnew line\ny\n");
const del = rows.find((r) => r.t === "del");
const add = rows.find((r) => r.t === "add");
ok("has del row", !!del); ok("has add row", !!add);
eq("del line text", del.tokens.map((t) => t.v).join(""), "old line");
eq("add line text", add.tokens.map((t) => t.v).join(""), "new line");
eq("only 'old' highlighted", del.tokens.filter((t) => t.hl).map((t) => t.v).join(""), "old");
eq("only 'new' highlighted", add.tokens.filter((t) => t.hl).map((t) => t.v).join(""), "new");
ok("context kept as same rows", rows.some((r) => r.t === "same" && r.line === "x"));

// long unchanged middle folds
const longBefore = "head\n" + Array.from({ length: 20 }, (_, i) => "ctx" + i).join("\n") + "\ntail-old\n";
const longAfter = "head\n" + Array.from({ length: 20 }, (_, i) => "ctx" + i).join("\n") + "\ntail-new\n";
ok("long context folds", m.textDiff(longBefore, longAfter).some((r) => r.t === "fold" && r.n > 0));

if (fail) { console.error("\nFAILED " + fail + " checks"); process.exit(1); }
console.log("semanticDiff: all checks passed");
