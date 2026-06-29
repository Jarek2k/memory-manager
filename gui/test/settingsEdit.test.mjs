/* Unit test for the settings-edit helpers — covers delete / move / deleteHook
 * deterministically (the drag&drop UI is hard to e2e). Run: node test/settingsEdit.test.mjs */
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tsSrc = readFileSync(join(here, "../src/lib/settingsEdit.ts"), "utf8");
const js = (await transform(tsSrc, { loader: "ts", format: "esm" })).code;
const m = await import("data:text/javascript," + encodeURIComponent(js));

let fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { fail++; console.error(`FAIL ${name}:\n  got:  ${a}\n  want: ${b}`); }
};

const base = JSON.stringify({
  permissions: { allow: ["Bash(npm test:*)"], deny: [], ask: ["Bash(ssh:*)", "Bash(scp:*)"] },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "ssh-guard" }] }] },
  model: "keep",
}, null, 2);

// delete permission — pattern gone, unrelated keys survive
{
  const o = JSON.parse(m.deletePermission(base, "ask", "Bash(ssh:*)"));
  eq("delete: ssh removed", o.permissions.ask, ["Bash(scp:*)"]);
  eq("delete: model preserved", o.model, "keep");
  eq("delete: hooks preserved", o.hooks.PreToolUse.length, 1);
}
// move permission ask -> allow
{
  const o = JSON.parse(m.movePermission(base, "ask", "allow", "Bash(ssh:*)"));
  eq("move: removed from ask", o.permissions.ask, ["Bash(scp:*)"]);
  eq("move: appended to allow", o.permissions.allow, ["Bash(npm test:*)", "Bash(ssh:*)"]);
}
// move within same group is a no-op (returns input unchanged)
eq("move: same group no-op", m.movePermission(base, "ask", "ask", "Bash(ssh:*)"), base);
// delete the only hook → empty group is dropped
{
  const o = JSON.parse(m.deleteHook(base, "PreToolUse", "Bash", "ssh-guard"));
  eq("deleteHook: group emptied", o.hooks.PreToolUse, []);
}
// add permission — appended, dedup is a no-op
{
  const o = JSON.parse(m.addPermission(base, "deny", "Bash(rm:*)"));
  eq("add: appended to deny", o.permissions.deny, ["Bash(rm:*)"]);
  eq("add: dedup no-op", JSON.parse(m.addPermission(base, "ask", "Bash(ssh:*)")).permissions.ask, ["Bash(ssh:*)", "Bash(scp:*)"]);
}
// find hook returns the full object (keeps type/timeout/…)
eq("findHook: object", m.findHook(base, "PreToolUse", "Bash", "ssh-guard"), { type: "command", command: "ssh-guard" });
eq("findHook: miss", m.findHook(base, "PreToolUse", "Bash", "nope"), null);
// add hook — new event creates group; same matcher merges; dup command is skipped
{
  const empty = JSON.stringify({}, null, 2);
  const o1 = JSON.parse(m.addHook(empty, "PreToolUse", "Bash", { type: "command", command: "ssh-guard" }));
  eq("addHook: into empty", o1.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "ssh-guard" }] }]);
  const o2 = JSON.parse(m.addHook(base, "PreToolUse", "Bash", { type: "command", command: "scp-guard" }));
  eq("addHook: merge matcher", o2.hooks.PreToolUse[0].hooks.map((h) => h.command), ["ssh-guard", "scp-guard"]);
  eq("addHook: dup skipped", JSON.parse(m.addHook(base, "PreToolUse", "Bash", { type: "command", command: "ssh-guard" })).hooks.PreToolUse[0].hooks.length, 1);
}
// promote = remove here + add to a (separate) global text — round-trips valid
{
  const project = base;
  const global = JSON.stringify({ permissions: { allow: [], deny: [], ask: [] } }, null, 2);
  const proj2 = JSON.parse(m.deletePermission(project, "ask", "Bash(ssh:*)"));
  const glob2 = JSON.parse(m.addPermission(global, "ask", "Bash(ssh:*)"));
  eq("promote: gone from project", proj2.permissions.ask, ["Bash(scp:*)"]);
  eq("promote: arrived in global", glob2.permissions.ask, ["Bash(ssh:*)"]);
}
// group move = fold movePermission over the list (ask -> deny), all land, source emptied
{
  const raws = ["Bash(ssh:*)", "Bash(scp:*)"];
  const o = JSON.parse(raws.reduce((w, r) => m.movePermission(w, "ask", "deny", r), base));
  eq("group move: source emptied", o.permissions.ask, []);
  eq("group move: all in deny", o.permissions.deny, raws);
}
// group promote = fold deletes over the project text + folds adds over the global text
{
  const raws = ["Bash(ssh:*)", "Bash(scp:*)"];
  const projNext = raws.reduce((w, r) => m.deletePermission(w, "ask", r), base);
  eq("group: all gone from project", JSON.parse(projNext).permissions.ask, []);
  const global = JSON.stringify({ permissions: { allow: [], deny: [], ask: [] } }, null, 2);
  const globNext = raws.reduce((w, r) => m.addPermission(w, "ask", r), global);
  eq("group: all arrived in global", JSON.parse(globNext).permissions.ask, raws);
}
// readers
eq("currentPerms.ask", m.currentPerms(base).ask, ["Bash(ssh:*)", "Bash(scp:*)"]);
eq("currentHooks", m.currentHooks(base).map((h) => h.command), ["ssh-guard"]);
// invalid JSON never throws → empty object
eq("parse invalid", m.parseSettings("{bad"), {});
// round-trips stay valid JSON
{
  const out = m.movePermission(base, "ask", "deny", "Bash(scp:*)");
  JSON.parse(out);
  eq("roundtrip deny", JSON.parse(out).permissions.deny, ["Bash(scp:*)"]);
}

if (fail) { console.error(`\nFAILED ${fail} checks`); process.exit(1); }
console.log("settingsEdit: all checks passed");
