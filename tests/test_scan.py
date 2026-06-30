#!/usr/bin/env python3
"""Unit tests for the deterministic scanner, resolver, and safety classifier.

Fixtures are generated in a temp directory (not committed) so that invisible-
Unicode test content cannot be mangled by editors or git. Stdlib unittest only.

Run:  python3 tests/test_scan.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import apply  # noqa: E402
import pathcodec  # noqa: E402
import safety  # noqa: E402
import scan  # noqa: E402
import serve  # noqa: E402


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


METADATA_BLOCK = """---
name: pnpm-preference
description: Immer pnpm statt npm
metadata:
  node_type: memory
  type: feedback
  originSessionId: abc-123
---

Der Nutzer nutzt pnpm.

**Why:** Lockfile-Konsistenz.
**How to apply:** Niemals npm verwenden, immer pnpm.
"""

TOP_LEVEL = """---
name: Roadmap-Notiz
description: Projektstand
type: project
originSessionId: def-456
---

Aktueller Stand. Siehe [[pnpm-preference]] und [[gibt-es-nicht]].
"""

UNTERMINATED = """---
name: broken
type: feedback

body without closing fence
"""


def poisoned():
    # ZWSP, a Unicode Tag char, and a bidi override embedded in plain text.
    return (
        "---\nname: poisoned\ntype: reference\n---\n\n"
        "Normaler Text​ mit \U000e0041versteckten ‮Zeichen.\n"
    )


def long_log():
    head = "---\nname: remote-mode\ntype: project\n---\n\nDauerregel: remote ok.\n\n"
    body = []
    for d in ("2026-06-18", "2026-06-20", "2026-06-21"):
        body.append("## Testlauf {} durchgeführt\n".format(d))
        for i in range(40):
            body.append("- log line {} {}\n".format(d, i))
    return head + "".join(body)


class ScanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.claude = Path(cls.tmp.name) / ".claude"
        # one project memory dir
        enc = "-Users-demo-dev-myproject"
        mem = cls.claude / "projects" / enc / "memory"
        write(mem / "MEMORY.md", "# Memory Index\n\n- [pnpm](pnpm-preference.md) — x\n")
        write(mem / "pnpm-preference.md", METADATA_BLOCK)
        write(mem / "roadmap.md", TOP_LEVEL)
        write(mem / "broken.md", UNTERMINATED)
        write(mem / "poisoned.md", poisoned())
        write(mem / "remote-mode.md", long_log())
        # more projects so clustering has cross-project material (needs 3+
        # entries sharing a token across >=2 projects)
        mem2 = cls.claude / "projects" / "-Users-demo-dev-other" / "memory"
        write(mem2 / "pnpm-too.md",
              "---\nname: pnpm-other\ntype: feedback\n---\n\nAuch hier pnpm preference.\n")
        mem3 = cls.claude / "projects" / "-Users-demo-dev-third" / "memory"
        write(mem3 / "pnpm-third.md",
              "---\nname: pnpm-third\ntype: feedback\n---\n\nDrittes Projekt nutzt pnpm.\n")
        write(cls.claude / "CLAUDE.md", "# Prefs\n- be nice\n")
        cls.inv, cls.summary = scan.scan(cls.claude)
        cls.by_id = {e["id"]: e for e in cls.inv["entries"]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def get(self, suffix):
        for e in self.inv["entries"]:
            if e["filename"] == suffix:
                return e
        self.fail("entry not found: " + suffix)

    def test_excludes_memory_index(self):
        names = [e["filename"] for e in self.inv["entries"]]
        self.assertNotIn("MEMORY.md", names)

    def test_metadata_block_type_not_node_type(self):
        e = self.get("pnpm-preference.md")
        self.assertEqual(e["type"], "feedback")          # NOT "memory"
        self.assertEqual(e["node_type"], "memory")
        self.assertEqual(e["frontmatter_shape"], "metadata_block")
        self.assertIn("Lockfile", e["why"])
        self.assertIn("pnpm", e["how"])

    def test_top_level_shape(self):
        e = self.get("roadmap.md")
        self.assertEqual(e["type"], "project")
        self.assertEqual(e["frontmatter_shape"], "top_level")

    def test_wiki_links_resolved_and_dangling(self):
        e = self.get("roadmap.md")
        targets = {w["target"]: w["resolved"] for w in e["wiki_links"]}
        self.assertTrue(targets.get("pnpm-preference"))
        self.assertFalse(targets.get("gibt-es-nicht"))

    def test_parse_error_still_listed(self):
        e = self.get("broken.md")
        self.assertEqual(e["parse_error"], "unterminated_frontmatter")

    def test_unicode_flags_block(self):
        e = self.get("poisoned.md")
        reasons = {f["reason"] for f in e["unicode_flags"]}
        self.assertIn("zero-width", reasons)
        self.assertIn("unicode-tag", reasons)
        self.assertIn("bidi-override", reasons)

    def test_must_flags_and_enforceable(self):
        e = self.get("pnpm-preference.md")
        self.assertTrue(e["enforceable_candidate"])
        phrases = {m["phrase"].lower() for m in e["must_flags"]}
        self.assertTrue({"niemals", "immer"} & phrases)

    def test_split_candidate(self):
        e = self.get("remote-mode.md")
        self.assertTrue(e["split_candidate"])
        self.assertGreater(e["lines"], 60)

    def test_budget(self):
        self.assertEqual(self.inv["budget"]["current_lines"],
                         self.inv["budget"]["always_loaded_files"][0]["lines"])
        self.assertGreater(self.inv["budget"]["current_lines"], 0)

    def test_cluster_cross_project(self):
        # both projects mention pnpm; expect at least one cluster spanning 2.
        spanning = [c for c in self.inv["clusters"] if c["project_count"] >= 2]
        self.assertTrue(spanning, "expected a cross-project cluster")

    def test_global_section_has_content(self):
        g = self.inv["global"]
        self.assertIn("Prefs", g["claude_md"]["content"])
        self.assertEqual(g["rules"], [])
        self.assertTrue(self.inv["is_real_claude_dir"] is False)

    def test_insights_present(self):
        kinds = {i["kind"] for i in self.inv["insights"]}
        self.assertIn("enforceable", kinds)
        self.assertIn("dangling", kinds)

    def test_entry_signals(self):
        pnpm = self.get("pnpm-preference.md")
        self.assertTrue(pnpm["global_candidate"])      # in a cross-project cluster
        roadmap = self.get("roadmap.md")
        self.assertTrue(roadmap["has_dangling_links"])  # [[gibt-es-nicht]]


class SafetyTests(unittest.TestCase):
    def test_sanitize_removes_block(self):
        dirty = "Hello​\U000e0041‮World !"
        clean, removed, had_block = safety.sanitize(dirty)
        self.assertTrue(had_block)
        self.assertNotIn("​", clean)
        self.assertNotIn("‮", clean)
        self.assertNotIn("\U000e0041", clean)
        self.assertIn("Hello", clean)
        self.assertIn("World", clean)
        # NBSP became a normal space
        self.assertIn("World !", clean)

    def test_clean_text_unflagged(self):
        self.assertEqual(safety.scan_text("Ganz normaler deutscher Text äöü ß."), [])
        self.assertFalse(safety.has_block("ASCII only"))

    def test_homoglyph_detected(self):
        # 'Аpple' starts with Cyrillic A.
        flags = safety.scan_text("This is Аpple mixed")
        self.assertTrue(any(f["reason"] == "homoglyph-mix" for f in flags))


class ResolverTests(unittest.TestCase):
    def test_embedded_dash_resolution(self):
        with tempfile.TemporaryDirectory() as d:
            base = Path(d)
            (base / "foo-bar" / "baz-qux").mkdir(parents=True)
            enc = "-foo-bar-baz-qux"
            resolved, ok = pathcodec.resolve(enc, root=base)
            self.assertTrue(ok)
            self.assertEqual(resolved, base / "foo-bar" / "baz-qux")

    def test_unresolved_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            resolved, ok = pathcodec.resolve("-does-not-exist-anywhere", root=Path(d))
            self.assertFalse(ok)

    def test_encode_roundtrip_naive(self):
        self.assertEqual(pathcodec.encode("/Users/x/y-z"), "-Users-x-y-z")


class ApplyTests(unittest.TestCase):
    """Stage/commit gate: no writes at stage, cherry-pick at commit, idempotent
    @import, settings.json hook merge preserving existing hooks, BLOCK-Unicode."""

    def _env(self, ops):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        claude = Path(tmp) / ".claude"
        mem = claude / "projects" / "-Users-demo-dev-proj" / "memory"
        write(mem / "MEMORY.md", "# Memory Index\n- [keep](keepme.md) — x\n- [kill](killme.md) — y\n")
        write(mem / "keepme.md", "---\nname: keepme\ntype: feedback\n---\n\nBehalte mich.\n")
        write(mem / "killme.md", "---\nname: killme\ntype: project\n---\n\nWeg damit.\n")
        write(claude / "CLAUDE.md", "# Prefs\n- be nice\n")
        write(claude / "settings.json", json.dumps(
            {"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
                {"type": "command", "command": "existing-ssh-guard", "timeout": 10}]}]}}, indent=2))
        run = Path(tmp) / "run"
        run.mkdir()
        inv, _ = scan.scan(claude)
        (run / "inventory.json").write_text(json.dumps(inv), encoding="utf-8")
        (run / "decisions.json").write_text(json.dumps({"schema_version": 1, "operations": ops}), encoding="utf-8")
        return claude, run

    def _std_ops(self):
        return [
            {"op": "promote", "source_ids": ["proj::keepme"], "target_topic": "myrule",
             "global_filename": "myrule.md", "translated_text": "Regel: sei gut.",
             "translated_text_source": "user", "keep_origin": "leave", "supersedes_global": None},
            {"op": "delete", "target_id": "proj::killme", "reason": "weg"},
            {"op": "harden_ack", "target_id": "proj::keepme", "suggestion_kind": "hook",
             "scope": "global", "decision": "harden",
             "hook": {"matcher": "Bash", "command": "new-hook-cmd", "timeout": 7}},
        ]

    def test_stage_writes_nothing_real(self):
        claude, run = self._env(self._std_ops())
        apply.Applier(claude, run).stage()
        self.assertFalse((claude / "rules" / "myrule.md").exists())
        self.assertTrue((claude / "projects" / "-Users-demo-dev-proj" / "memory" / "killme.md").exists())
        self.assertTrue((run / "manifest.json").exists())
        man = json.loads((run / "manifest.json").read_text())
        actions = {Path(c["path"]).name: c["action"] for c in man["changes"]}
        self.assertEqual(actions.get("myrule.md"), "create")
        self.assertEqual(actions.get("CLAUDE.md"), "modify")
        self.assertEqual(actions.get("settings.json"), "modify")
        self.assertEqual(actions.get("killme.md"), "delete")

    def test_cherry_pick_commit(self):
        claude, run = self._env(self._std_ops())
        apply.Applier(claude, run).stage()
        rule = str(claude / "rules" / "myrule.md")
        cm = str(claude / "CLAUDE.md")
        applied, _ = apply.Applier(claude, run).commit(only=[rule, cm])
        self.assertTrue((claude / "rules" / "myrule.md").exists())
        self.assertIn("@rules/myrule.md", (claude / "CLAUDE.md").read_text())
        # not confirmed → untouched
        self.assertTrue((claude / "projects" / "-Users-demo-dev-proj" / "memory" / "killme.md").exists())
        self.assertNotIn("new-hook-cmd", (claude / "settings.json").read_text())

    def test_commit_all_hook_merge_and_idempotent(self):
        claude, run = self._env(self._std_ops())
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        settings = (claude / "settings.json").read_text()
        self.assertIn("new-hook-cmd", settings)
        self.assertIn("existing-ssh-guard", settings)        # preserved
        self.assertFalse((claude / "projects" / "-Users-demo-dev-proj" / "memory" / "killme.md").exists())
        cm = (claude / "CLAUDE.md").read_text()
        self.assertEqual(cm.count("@rules/myrule.md"), 1)
        # second pass must add nothing
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        self.assertEqual((claude / "CLAUDE.md").read_text().count("@rules/myrule.md"), 1)
        self.assertEqual((claude / "settings.json").read_text().count("new-hook-cmd"), 1)

    def test_edit_global_and_guard(self):
        claude, run = self._env([])
        # edit CLAUDE.md (allowed) + a forbidden path (rejected)
        decisions = {"schema_version": 1, "operations": [
            {"op": "edit_global", "path": str(claude / "CLAUDE.md"), "new_content": "# Neu\n- nur das\n"},
            {"op": "edit_global", "path": str(claude.parent / "evil.txt"), "new_content": "pwned"},
        ]}
        (run / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")
        man = apply.Applier(claude, run).stage()
        paths = {Path(c["path"]).name: c for c in man["changes"]}
        self.assertIn("CLAUDE.md", paths)
        self.assertNotIn("evil.txt", paths)               # guard rejected it
        self.assertTrue(any("evil.txt" in str(s["target"]) for s in man["skipped"]))
        apply.Applier(claude, run).commit(commit_all=True)
        self.assertIn("nur das", (claude / "CLAUDE.md").read_text())
        self.assertFalse((claude.parent / "evil.txt").exists())

    def test_edit_settings_global_guard_and_validation(self):
        """edit_settings rewrites settings.json behind the gate: valid JSON only,
        only an allowed path, unrelated keys preserved, nothing written at stage."""
        claude, run = self._env([])
        orig = {
            "permissions": {"allow": ["Bash(npm test:*)"], "deny": [], "ask": ["Bash(ssh:*)", "Bash(scp:*)"]},
            "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
                {"type": "command", "command": "existing-ssh-guard", "timeout": 10}]}]},
            "model": "keep-me",  # unrelated key must survive the round-trip
        }
        (claude / "settings.json").write_text(json.dumps(orig, indent=2), encoding="utf-8")
        edited = json.loads(json.dumps(orig))
        edited["permissions"]["ask"] = ["Bash(scp:*)"]  # GUI deleted the ssh ask-rule
        decisions = {"schema_version": 1, "operations": [
            {"op": "edit_settings", "path": str(claude / "settings.json"), "new_content": json.dumps(edited, indent=2)},
            {"op": "edit_settings", "path": str(claude.parent / "evil.json"), "new_content": '{"x":1}'},  # forbidden path
            {"op": "edit_settings", "path": str(claude / "settings.json"), "new_content": "{bad json"},    # invalid JSON
        ]}
        (run / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")
        man = apply.Applier(claude, run).stage()
        self.assertIn("Bash(ssh:*)", (claude / "settings.json").read_text())  # stage writes nothing
        self.assertTrue(any("evil.json" in str(s["target"]) for s in man["skipped"]))  # path guarded
        apply.Applier(claude, run).commit(commit_all=True)
        out = (claude / "settings.json").read_text()
        json.loads(out)                            # still valid JSON
        self.assertNotIn("Bash(ssh:*)", out)       # ssh deleted
        self.assertIn("Bash(scp:*)", out)          # scp kept
        self.assertIn("existing-ssh-guard", out)   # hook preserved
        self.assertIn("keep-me", out)              # unrelated key preserved
        self.assertFalse((claude.parent / "evil.json").exists())  # guard held

    def test_promote_permission_project_to_global(self):
        """Promoting a project permission to global = two edit_settings ops (remove
        from the project file, add to the global file). Both pass the path guard,
        stage writes nothing, commit moves the rule across files."""
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        claude = Path(tmp) / ".claude"
        repo = Path(tmp) / "dev" / "myproj"
        write(claude / "settings.json", json.dumps(
            {"permissions": {"allow": ["Bash(npm test:*)"], "deny": [], "ask": ["Bash(scp:*)"]}}, indent=2))
        write(repo / ".claude" / "settings.json", json.dumps(
            {"permissions": {"allow": [], "deny": [], "ask": ["Bash(ssh:*)"]}}, indent=2))
        run = Path(tmp) / "run"
        run.mkdir()
        inv = {"schema_version": 3, "entries": [],
               "projects": [{"slug": "myproj", "path": str(repo), "path_resolved": True}]}
        (run / "inventory.json").write_text(json.dumps(inv), encoding="utf-8")
        # exactly what the GUI's promote composes: project loses ssh, global gains it
        proj_new = {"permissions": {"allow": [], "deny": [], "ask": []}}
        glob_new = {"permissions": {"allow": ["Bash(npm test:*)"], "deny": [], "ask": ["Bash(scp:*)", "Bash(ssh:*)"]}}
        ops = [
            {"op": "edit_settings", "path": str(repo / ".claude" / "settings.json"), "new_content": json.dumps(proj_new, indent=2)},
            {"op": "edit_settings", "path": str(claude / "settings.json"), "new_content": json.dumps(glob_new, indent=2)},
        ]
        (run / "decisions.json").write_text(json.dumps({"schema_version": 1, "operations": ops}), encoding="utf-8")
        man = apply.Applier(claude, run).stage()
        # stage writes nothing — both files untouched, both staged (project path accepted)
        self.assertIn("Bash(ssh:*)", (repo / ".claude" / "settings.json").read_text())
        self.assertNotIn("Bash(ssh:*)", (claude / "settings.json").read_text())
        settings_changes = [c for c in man["changes"] if Path(c["path"]).name == "settings.json"]
        self.assertEqual(len(settings_changes), 2)
        apply.Applier(claude, run).commit(commit_all=True)
        self.assertNotIn("Bash(ssh:*)", (repo / ".claude" / "settings.json").read_text())  # left the project
        out = (claude / "settings.json").read_text()
        self.assertIn("Bash(ssh:*)", out)   # arrived in global
        self.assertIn("Bash(scp:*)", out)   # global kept its own rule

    def test_drift_flag_when_file_changed_since_scan(self):
        """If the on-disk file changed after the scan the browser approved against,
        stage flags drift — the backstop that makes in-browser approval safe. The
        flag is informational; Claude reads it to stop and re-show the diff."""
        claude, run = self._env([])
        # the file changes on disk after the scan recorded its snapshot
        (claude / "settings.json").write_text(json.dumps(
            {"permissions": {"allow": ["Bash(whoami)"], "deny": [], "ask": []}}, indent=2), encoding="utf-8")
        (run / "decisions.json").write_text(json.dumps({"schema_version": 1, "operations": [
            {"op": "edit_settings", "path": str(claude / "settings.json"),
             "new_content": json.dumps({"permissions": {"allow": [], "deny": [], "ask": []}}, indent=2)}]}), encoding="utf-8")
        ch = [c for c in apply.Applier(claude, run).stage()["changes"] if Path(c["path"]).name == "settings.json"][0]
        self.assertTrue(ch["drift"])
        # untouched since scan → no drift
        claude2, run2 = self._env([])
        (run2 / "decisions.json").write_text(json.dumps({"schema_version": 1, "operations": [
            {"op": "edit_settings", "path": str(claude2 / "settings.json"),
             "new_content": json.dumps({"hooks": {}}, indent=2)}]}), encoding="utf-8")
        ch2 = [c for c in apply.Applier(claude2, run2).stage()["changes"] if Path(c["path"]).name == "settings.json"][0]
        self.assertFalse(ch2["drift"])

    def test_per_rule_edit_composes_via_edit_global(self):
        """A GUI per-rule delete = splice item lines out of the raw content and
        submit the full result as edit_global. Prove it stages/commits cleanly."""
        claude, run = self._env([])
        content = "# Stil\n- Regel A\n- Regel B\n- Regel C\n"
        (claude / "rules").mkdir()
        (claude / "rules" / "stil.md").write_text(content, encoding="utf-8")
        items = scan.decompose_markdown(content)
        target = [it for it in items if "Regel B" in it["content"]][0]
        lines = content.split("\n")
        spliced = "\n".join(lines[:target["line_start"] - 1] + lines[target["line_end"]:])
        decisions = {"schema_version": 1, "operations": [
            {"op": "edit_global", "path": str(claude / "rules" / "stil.md"), "new_content": spliced}]}
        (run / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        out = (claude / "rules" / "stil.md").read_text()
        self.assertNotIn("Regel B", out)
        self.assertIn("Regel A", out)
        self.assertIn("Regel C", out)

    def test_delete_global_unwires_import(self):
        claude, run = self._env([])
        # set up an existing promoted rule + its @import
        (claude / "rules").mkdir()
        (claude / "rules" / "x.md").write_text("# Regel X\n- tu x\n", encoding="utf-8")
        (claude / "CLAUDE.md").write_text(
            "# Prefs\n- be nice\n\n<!-- BEGIN memory-manager imports -->\n"
            "@rules/x.md\n<!-- END memory-manager imports -->\n", encoding="utf-8")
        decisions = {"schema_version": 1, "operations": [
            {"op": "delete_global", "path": str(claude / "rules" / "x.md")}]}
        (run / "decisions.json").write_text(json.dumps(decisions), encoding="utf-8")
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        self.assertFalse((claude / "rules" / "x.md").exists())
        self.assertNotIn("@rules/x.md", (claude / "CLAUDE.md").read_text())

    def test_blocked_promote_not_committed(self):
        ops = [{"op": "promote", "source_ids": ["proj::keepme"], "target_topic": "bad",
                "global_filename": "bad.md", "translated_text": "text \U000e0041 tag",
                "translated_text_source": "user", "keep_origin": "leave", "supersedes_global": None}]
        claude, run = self._env(ops)
        man = apply.Applier(claude, run).stage()
        rule_change = [c for c in man["changes"] if Path(c["path"]).name == "bad.md"][0]
        self.assertTrue(rule_change["blocked"])
        apply.Applier(claude, run).commit(commit_all=True)
        self.assertFalse((claude / "rules" / "bad.md").exists())

    def test_commit_writes_result_json(self):
        # the browser's result panel reads result.json: applied files (with
        # action+kind), skipped ones, and the backup dir
        claude, run = self._env(self._std_ops())
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        res = json.loads((run / "result.json").read_text())
        self.assertIn("backup_dir", res)
        names = {Path(a["path"]).name for a in res["applied"]}
        self.assertIn("myrule.md", names)
        self.assertIn("killme.md", names)
        for a in res["applied"]:
            self.assertIn("action", a)
            self.assertIn("kind", a)

    def test_result_json_merges_across_commits(self):
        # several commits in one cycle accumulate rather than clobber, and a path
        # written later drops out of "skipped"
        claude, run = self._env(self._std_ops())
        apply.Applier(claude, run).stage()
        rule = str(claude / "rules" / "myrule.md")
        apply.Applier(claude, run).commit(only=[rule])
        res1 = json.loads((run / "result.json").read_text())
        self.assertEqual({Path(a["path"]).name for a in res1["applied"]}, {"myrule.md"})
        self.assertIn("killme.md", {Path(s["path"]).name for s in res1["skipped"]})
        killme = str(claude / "projects" / "-Users-demo-dev-proj" / "memory" / "killme.md")
        apply.Applier(claude, run).commit(only=[killme])
        res2 = json.loads((run / "result.json").read_text())
        names = {Path(a["path"]).name for a in res2["applied"]}
        self.assertIn("myrule.md", names)   # kept from the first commit
        self.assertIn("killme.md", names)   # added by the second
        self.assertNotIn("killme.md", {Path(s["path"]).name for s in res2["skipped"]})


def _push_hook_command():
    """A representative PreToolUse hook of the kind Claude composes when hardening
    a 'never push autonomously' rule — modelled on the real ssh/scp Vorbild:
    jq reads .tool_input.command, grep matches, printf emits a JSON decision."""
    return (
        "cmd=$(jq -r '.tool_input.command // \"\"'); "
        "if printf '%s' \"$cmd\" | grep -qE 'git( .*)? push'; then "
        "printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\","
        "\"permissionDecision\":\"ask\",\"permissionDecisionReason\":"
        "\"Claude moechte git push ausfuehren. Pruefe Branch und Absicht.\"}}'; fi"
    )


def _fire_hook(hook_cmd, command):
    """Invoke a hook command exactly as Claude Code does: pipe the PreToolUse event
    JSON on stdin, capture stdout + exit code. Returns (returncode, stdout)."""
    payload = json.dumps({
        "hook_event_name": "PreToolUse", "tool_name": "Bash",
        "tool_input": {"command": command},
    })
    proc = subprocess.run(["bash", "-c", hook_cmd], input=payload,
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout


@unittest.skipUnless(shutil.which("jq"), "jq not installed — hardened hooks require jq")
class HookFiringTests(unittest.TestCase):
    """The hooks apply.py writes into settings.json must actually fire under Claude
    Code's PreToolUse contract (docs.claude.com/.../hooks): on a match, exit 0 with
    {hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision, reason}};
    on no match, stay silent (empty stdout) so the normal flow applies. Requires jq."""

    def test_composed_hook_fires_per_contract(self):
        hook = _push_hook_command()
        # match → structured JSON decision, exit 0
        rc, out = _fire_hook(hook, "git push origin main")
        self.assertEqual(rc, 0)
        payload = json.loads(out)  # must be valid JSON
        hso = payload["hookSpecificOutput"]
        self.assertEqual(hso["hookEventName"], "PreToolUse")
        self.assertIn(hso["permissionDecision"], ("ask", "deny"))
        self.assertTrue(hso["permissionDecisionReason"].strip())
        # no match → silent (no decision), exit 0 → normal permission flow
        rc2, out2 = _fire_hook(hook, "ls -la")
        self.assertEqual(rc2, 0)
        self.assertEqual(out2.strip(), "")

    def test_staged_harden_hook_fires_closed_loop(self):
        """Closed loop: run a harden op through Applier.stage(), then fire the hook
        command that actually landed in the staged settings.json. Binds the test to
        apply.py's real output, not a hand-written copy."""
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        claude = Path(tmp) / ".claude"
        mem = claude / "projects" / "-Users-demo-dev-proj" / "memory"
        write(mem / "MEMORY.md", "# Memory Index\n- [push](nopush.md) — x\n")
        write(mem / "nopush.md", "---\nname: nopush\ntype: feedback\n---\n\nNie autonom pushen.\n")
        write(claude / "CLAUDE.md", "# Prefs\n- be nice\n")
        write(claude / "settings.json", "{}\n")
        run = Path(tmp) / "run"
        run.mkdir()
        inv, _ = scan.scan(claude)
        (run / "inventory.json").write_text(json.dumps(inv), encoding="utf-8")
        (run / "decisions.json").write_text(json.dumps({"schema_version": 1, "operations": [
            {"op": "harden", "target_id": "proj::nopush", "scope": "global", "decision": "harden",
             "hook": {"matcher": "Bash", "command": _push_hook_command(), "timeout": 10}},
        ]}), encoding="utf-8")
        apply.Applier(claude, run).stage()
        apply.Applier(claude, run).commit(commit_all=True)
        data = json.loads((claude / "settings.json").read_text())
        cmds = [h["command"] for g in data["hooks"]["PreToolUse"] for h in g["hooks"]]
        self.assertEqual(len(cmds), 1)
        rc, out = _fire_hook(cmds[0], "git push --force")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["hookSpecificOutput"]["permissionDecision"], "ask")


class ServeTests(unittest.TestCase):
    """Persistent session server: status strip relay, result surfacing, close
    sentinel, and the --set-status write-and-exit CLI."""

    def _server(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        run = Path(tmp) / "run"; run.mkdir()
        gui = Path(tmp) / "gui"; gui.mkdir()
        write(gui / "index.html", "<!doctype html><title>mm</title>")
        (run / "inventory.json").write_text('{"ok":1}', encoding="utf-8")
        httpd = serve.make_server(str(run), str(gui), 0)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)   # LIFO: shutdown first, then close socket
        self.addCleanup(httpd.shutdown)
        base = "http://127.0.0.1:{}".format(httpd.server_address[1])
        return run, base

    @staticmethod
    def _get(base, path):
        with urllib.request.urlopen(base + path, timeout=5) as r:
            return r.status, r.read().decode("utf-8")

    @staticmethod
    def _post(base, path, body=""):
        data = body.encode("utf-8") if isinstance(body, str) else body
        req = urllib.request.Request(base + path, data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode("utf-8")

    def test_status_starts_curating(self):
        _, base = self._server()
        st, body = self._get(base, "/status")
        self.assertEqual(st, 200)
        d = json.loads(body)
        self.assertEqual(d["phase"], "curating")
        self.assertEqual(d["server"], "running")
        self.assertIsNone(d["result"])

    def test_post_decisions_submitted_and_no_shutdown(self):
        run, base = self._server()
        st, _ = self._post(base, "/decisions", json.dumps({"operations": [{"op": "ignore", "target_id": "x"}]}))
        self.assertEqual(st, 200)
        saved = json.loads((run / "decisions.json").read_text())
        self.assertEqual(len(saved["operations"]), 1)
        self.assertEqual(json.loads(self._get(base, "/status")[1])["phase"], "submitted")
        # server is still alive for the next cycle (the old version self-destructed)
        self.assertEqual(self._get(base, "/status")[0], 200)

    def test_result_surfaces_only_when_done(self):
        run, base = self._server()
        serve.write_status(str(run), "processing", "läuft")
        d = json.loads(self._get(base, "/status")[1])
        self.assertEqual(d["phase"], "processing")
        self.assertIsNone(d["result"])               # not done → hidden
        (run / "result.json").write_text(json.dumps(
            {"applied": [{"path": "/a", "action": "modify", "kind": "rule"}],
             "skipped": [], "backup_dir": "/b"}), encoding="utf-8")
        serve.write_status(str(run), "done", "fertig")
        d2 = json.loads(self._get(base, "/status")[1])
        self.assertEqual(d2["phase"], "done")
        self.assertEqual(d2["result"]["applied"][0]["path"], "/a")
        st, rb = self._get(base, "/result")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(rb)["backup_dir"], "/b")

    def test_close_drops_sentinel(self):
        run, base = self._server()
        st, _ = self._post(base, "/close")
        self.assertEqual(st, 200)
        self.assertTrue((run / "close.signal").is_file())
        self.assertEqual(json.loads(self._get(base, "/status")[1])["server"], "closing")

    def test_set_status_cli_writes_and_validates(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        run = Path(tmp) / "run"
        rc = serve.main(["--run-dir", str(run), "--set-status", "awaiting_terminal", "--message", "warte"])
        self.assertEqual(rc, 0)
        d = json.loads((run / "status.json").read_text())
        self.assertEqual(d["phase"], "awaiting_terminal")
        self.assertEqual(d["message"], "warte")
        self.assertEqual(serve.main(["--run-dir", str(run), "--set-status", "bogus"]), 2)

    def test_idle_watchdog_closes_session(self):
        run, base = self._server()
        httpd = serve.Handler.httpd
        serve.Handler.last_activity = time.monotonic() - 100   # pretend long idle
        serve._idle_watchdog(httpd, run, 1)                    # one tick → over threshold
        self.assertTrue((run / "close.signal").is_file())


class SandboxTests(unittest.TestCase):
    def test_synthetic_is_scannable(self):
        import sandbox
        with tempfile.TemporaryDirectory() as d:
            dest = sandbox.make_synthetic(Path(d) / "sb")
            inv, _ = scan.scan(dest)
            self.assertGreaterEqual(len(inv["projects"]), 3)
            self.assertTrue(any(c["project_count"] >= 2 for c in inv["clusters"]))
            self.assertFalse(inv["is_real_claude_dir"])

    def test_copy_only_reads_source(self):
        import sandbox
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "src"
            mem = src / "projects" / "-x-y" / "memory"
            write(mem / "a.md", "---\nname: a\ntype: feedback\n---\n\nhi\n")
            write(src / "CLAUDE.md", "# c\n")
            before = set(p.name for p in (src / "projects").iterdir())
            dest = sandbox.make_copy(src, Path(d) / "sb")
            self.assertTrue((dest / "CLAUDE.md").is_file())
            self.assertTrue((dest / "projects" / "-x-y" / "memory" / "a.md").is_file())
            # source unchanged
            self.assertEqual(before, set(p.name for p in (src / "projects").iterdir()))

    def test_cli_make_flag_copies_and_prints_path(self):
        # Regression: the documented `--make` invocation must be accepted and must
        # print a non-empty path to stdout (an empty value makes scan/apply silently
        # target the real ~/.claude).
        import sandbox, io
        from contextlib import redirect_stdout
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "src"
            write(src / "projects" / "-x-y" / "memory" / "a.md",
                  "---\nname: a\ntype: feedback\n---\n\nhi\n")
            out = Path(d) / "sb"
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = sandbox.main(["--make", "--source", str(src), "--out", str(out)])
            self.assertEqual(rc, 0)
            printed = buf.getvalue().strip()
            self.assertTrue(printed, "sandbox.py --make printed an empty path")
            self.assertTrue(Path(printed).is_dir())
            self.assertTrue((Path(printed) / "projects" / "-x-y" / "memory" / "a.md").is_file())


class ProjectRulesTests(unittest.TestCase):
    """read_project_rules: read-only discovery of a project's own rules."""

    def test_discovers_claude_md_and_dot_claude(self):
        with tempfile.TemporaryDirectory() as d:
            proj = Path(d) / "proj"
            write(proj / "CLAUDE.md", "# Projekt\n- regel a\n- regel b\n")
            write(proj / ".claude" / "rules" / "conv.md", "# Konv\n- x\n")
            res = scan.read_project_rules(str(proj), True, Path(d))
            sources = {r["source"] for r in res["rules"]}
            self.assertIn("CLAUDE.md", sources)
            self.assertIn(".claude/rules/conv.md", sources)
            cm = next(r for r in res["rules"] if r["source"] == "CLAUDE.md")
            self.assertEqual(cm["lines"], 3)
            self.assertFalse(cm["editable"])        # always view-only
            self.assertFalse(cm["truncated"])

    def test_settings_surfaces_patterns_and_hook_commands(self):
        with tempfile.TemporaryDirectory() as d:
            proj = Path(d) / "proj"
            settings = {
                "permissions": {"allow": ["Bash(ls)"], "deny": ["Bash(rm)"], "ask": ["Bash(ssh:*)"]},
                "hooks": {"PreToolUse": [{"matcher": "Bash",
                                          "hooks": [{"type": "command", "command": "guard.sh"}]}]},
            }
            write(proj / ".claude" / "settings.json", json.dumps(settings))
            s = scan.read_project_rules(str(proj), True, Path(d))["settings"]
            self.assertIsNotNone(s)
            self.assertEqual(s["hook_count"], 1)
            self.assertEqual(s["permission_count"], 3)
            self.assertEqual(s["permissions"]["allow"], ["Bash(ls)"])
            self.assertEqual(s["permissions"]["ask"], ["Bash(ssh:*)"])
            self.assertEqual(s["hooks"][0]["event"], "PreToolUse")
            self.assertEqual(s["hooks"][0]["matcher"], "Bash")
            self.assertEqual(s["hooks"][0]["commands"], ["guard.sh"])
            self.assertTrue(s["parse_ok"])

    def test_global_settings_surfaced(self):
        with tempfile.TemporaryDirectory() as d:
            claude = Path(d) / ".claude"
            mem = claude / "projects" / "-Users-demo-dev-x" / "memory"
            write(mem / "a.md", "---\nname: a\ntype: feedback\n---\n\nhi\n")
            write(claude / "settings.json", json.dumps(
                {"permissions": {"ask": ["Bash(ssh:*)"]}}))
            inv, _ = scan.scan(claude)
            gs = inv["global"]["settings"]
            self.assertIsNotNone(gs)
            self.assertEqual(gs["permissions"]["ask"], ["Bash(ssh:*)"])

    def test_malformed_settings_marked_not_ok(self):
        with tempfile.TemporaryDirectory() as d:
            proj = Path(d) / "proj"
            write(proj / ".claude" / "settings.json", "{ not json ")
            s = scan.read_project_rules(str(proj), True, Path(d))["settings"]
            self.assertIsNotNone(s)
            self.assertFalse(s["parse_ok"])

    def test_unresolved_path_reads_nothing(self):
        res = scan.read_project_rules("/does/not/exist", False, Path("/tmp"))
        self.assertEqual(res["rules"], [])
        self.assertIsNone(res["settings"])

    def test_scan_projects_always_carry_rule_keys(self):
        with tempfile.TemporaryDirectory() as d:
            claude = Path(d) / ".claude"
            mem = claude / "projects" / "-Users-demo-dev-x" / "memory"
            write(mem / "a.md", "---\nname: a\ntype: feedback\n---\n\nhi\n")
            inv, _ = scan.scan(claude)
            for p in inv["projects"]:
                self.assertIn("rules", p)
                self.assertIn("settings", p)
            self.assertEqual(inv["schema_version"], 3)


def _reassemble(content, items):
    """Rebuild a file from decomposed items, filling inter-item gaps with the
    original (blank) lines. Equality with the source proves the ranges tile the
    file with only blank-line gaps."""
    lines = content.split("\n")
    out = []
    pos = 1
    for it in items:
        while pos < it["line_start"]:
            out.append(lines[pos - 1]); pos += 1
        out.extend(lines[it["line_start"] - 1:it["line_end"]])
        pos = it["line_end"] + 1
    while pos <= len(lines):
        out.append(lines[pos - 1]); pos += 1
    return "\n".join(out)


class DecomposeTests(unittest.TestCase):
    def _check_invariant(self, content):
        items = scan.decompose_markdown(content)
        # 1-based inclusive, non-overlapping, ascending
        prev = 0
        for it in items:
            self.assertGreaterEqual(it["line_start"], 1)
            self.assertGreaterEqual(it["line_end"], it["line_start"])
            self.assertGreater(it["line_start"], prev)
            prev = it["line_end"]
            self.assertEqual(it["content"],
                             "\n".join(content.split("\n")[it["line_start"] - 1:it["line_end"]]))
        # every non-blank line covered exactly once
        covered = set()
        for it in items:
            for ln in range(it["line_start"], it["line_end"] + 1):
                covered.add(ln)
        for idx, line in enumerate(content.split("\n"), start=1):
            if line.strip():
                self.assertIn(idx, covered, "non-blank line %d uncovered" % idx)
        # lossless reassembly
        self.assertEqual(_reassemble(content, items), content)
        return items

    def test_empty(self):
        self.assertEqual(scan.decompose_markdown(""), [])

    def test_headings_bullets_paragraphs(self):
        md = ("# Titel\n\n## Git\n- Conventional Commits\n- Imperativ, <=72\n\n"
              "Ein Absatz hier.\n\n### Detail\n- nur ein punkt\n")
        items = self._check_invariant(md)
        types = [i["type"] for i in items]
        self.assertEqual(types.count("heading"), 3)
        self.assertEqual(types.count("bullet"), 3)
        self.assertEqual(types.count("paragraph"), 1)
        # bullets carry their enclosing heading
        gitb = [i for i in items if i["type"] == "bullet" and "Conventional" in i["content"]][0]
        self.assertEqual(gitb["heading"], "Git")

    def test_frontmatter_block(self):
        md = "---\nname: x\ntype: feedback\n---\n\n# H\n- a\n"
        items = self._check_invariant(md)
        self.assertEqual(items[0]["type"], "frontmatter")
        self.assertEqual(items[0]["line_start"], 1)
        self.assertEqual(items[0]["line_end"], 4)

    def test_nested_bullets_stay_together(self):
        md = "- parent\n  - child a\n  - child b\n- next\n"
        items = self._check_invariant(md)
        bullets = [i for i in items if i["type"] == "bullet"]
        self.assertEqual(len(bullets), 2)          # parent(+children) and next
        self.assertIn("child a", bullets[0]["content"])

    def test_global_md_round_trips(self):
        # real-world shapes via the scan fixtures
        for sample in (METADATA_BLOCK, TOP_LEVEL, "# Nur Titel\n", "Nur Prosa ohne alles\n"):
            self._check_invariant(sample)

    def test_matches_shared_fixture(self):
        """Anchor the Python side to the shared golden corpus. The TS port
        (gui/src/lib/decompose.ts) asserts against the SAME file in its vitest
        parity test, so both matching the fixture == Python↔TS parity. Editing
        either implementation requires regenerating the fixture and both tests
        going green again."""
        fx = Path(__file__).resolve().parent.parent / "gui" / "src" / "lib" / "decompose.fixture.json"
        cases = json.loads(fx.read_text("utf-8"))
        self.assertGreaterEqual(len(cases), 5)
        for idx, case in enumerate(cases):
            got = [{"type": it["type"], "line_start": it["line_start"], "line_end": it["line_end"]}
                   for it in scan.decompose_markdown(case["input"])]
            self.assertEqual(got, case["items"], "fixture case %d boundaries diverged" % idx)


class SemanticsTests(unittest.TestCase):
    def test_permission_categories_and_summary(self):
        cases = {
            ("Bash(ssh:*)", "ask"): ("Netzwerk", "Nachfragen"),
            ("Bash(pnpm test:*)", "allow"): ("Tests", "Ohne Nachfrage erlaubt"),
            ("Bash(git status)", "allow"): ("Git", None),
            ("Read(/etc/x)", "deny"): ("Dateien", "Verboten"),
            ("mcp__chrome__click", "allow"): ("MCP", None),
            ("WebFetch", "ask"): ("Netzwerk", None),
        }
        for (raw, action), (cat, prefix) in cases.items():
            p = scan.parse_permission(raw, action)
            self.assertEqual(p["category"], cat, raw)
            self.assertTrue(p["summary"], "summary must never be empty for " + raw)
            if prefix:
                self.assertTrue(p["summary"].startswith(prefix), raw + " → " + p["summary"])

    def test_permission_no_parens(self):
        p = scan.parse_permission("Bash", "allow")
        self.assertEqual(p["tool"], "Bash")
        self.assertEqual(p["target"], "")
        self.assertTrue(p["summary"])

    def test_hook_reason_extracted(self):
        cmd = ('cmd=$(jq -r \'.tool_input.command\'); if printf "%s" "$cmd" | '
               'grep -qwE \'ssh|scp\'; then printf \'%s\' '
               '\'{"hookSpecificOutput":{"permissionDecision":"ask",'
               '"permissionDecisionReason":"Claude moechte sich mit einem externen Server verbinden."}}\'; fi')
        h = scan.parse_hook("PreToolUse", "Bash", cmd)
        self.assertEqual(h["decision"], "ask")
        self.assertIn("externen Server", h["reason"])
        self.assertEqual(h["summary_source"], "reason")
        self.assertEqual(h["summary"], h["reason"])

    def test_hook_template_from_grep(self):
        cmd = ('grep -qE \'git .* push\' && echo \'{"permissionDecision":"deny"}\'')
        h = scan.parse_hook("PreToolUse", "Bash", cmd)
        self.assertEqual(h["summary_source"], "template")
        self.assertIn("git .* push", h["summary"])

    def test_hook_opaque_needs_claude(self):
        h = scan.parse_hook("PreToolUse", "Bash", "do_something_custom.sh")
        self.assertIsNone(h["summary"])
        self.assertEqual(h["summary_source"], "claude-please-summarize")

    def test_settings_carry_parsed(self):
        with tempfile.TemporaryDirectory() as d:
            proj = Path(d) / "proj"
            write(proj / ".claude" / "settings.json", json.dumps(
                {"permissions": {"allow": ["Bash(pnpm test:*)"], "ask": ["Bash(ssh:*)"]}}))
            s = scan.read_project_rules(str(proj), True, Path(d))["settings"]
            self.assertEqual(s["parsed"]["allow"][0]["category"], "Tests")
            self.assertEqual(s["parsed"]["ask"][0]["category"], "Netzwerk")


if __name__ == "__main__":
    unittest.main(verbosity=2)
