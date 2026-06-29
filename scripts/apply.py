#!/usr/bin/env python3
"""Two-phase applier for decisions.json — stage, then commit only what's confirmed.

Claude does the *judgement* (translating observations into rules, deciding
duplicate merges, composing hook commands) and fills those fields into
decisions.json. This script does the deterministic, safety-critical mechanics
and — crucially — never writes a real file until a per-file confirmation.

Phases:
  apply.py --stage   : compute the proposed final content of every touched file
                       into <run>/staged/ and <run>/manifest.json. NO real writes.
  apply.py --commit  : write staged->real for confirmed files only (--only PATH...
                       or --all), backing up originals first; append the audit log.

Reads <run>/inventory.json (id->file map) and <run>/decisions.json.
Stdlib only, Python 3.9 compatible.
"""

import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import safety  # noqa: E402

BEGIN = "<!-- BEGIN memory-manager imports -->"
END = "<!-- END memory-manager imports -->"
DELETED = None  # sentinel for "pending delete" in the virtual filesystem


def _today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _slug(path):
    return str(path).replace("/", "__").lstrip("_")


class Applier:
    """Builds a virtual set of file changes (the 'pending' map), then stages or
    commits them. Sequential ops compose because every op reads/writes through
    the pending map, so e.g. two deletes in one project both edit the same
    pending MEMORY.md."""

    def __init__(self, claude_dir, run_dir):
        self.claude_dir = Path(claude_dir)
        self.run_dir = Path(run_dir)
        self.staged_dir = self.run_dir / "staged"
        self.backup_dir = self.run_dir / "backup"
        self.inv = json.loads((self.run_dir / "inventory.json").read_text("utf-8"))
        self.by_id = {e["id"]: e for e in self.inv["entries"]}
        # virtual filesystem
        self.pending = {}            # path -> new content (str) or DELETED
        self.orig_exists = {}        # path -> bool (captured on first touch)
        self.kind = {}               # path -> kind label
        self.explain = defaultdict(list)
        self.blocked = {}            # path -> reason
        self.drift = {}              # path -> reason (changed on disk since scan)
        self.skipped = []            # (op, target, why)

    # -- virtual filesystem helpers ---------------------------------------
    def _touch(self, path, kind):
        p = str(path)
        if p not in self.orig_exists:
            self.orig_exists[p] = Path(p).is_file()
        self.kind.setdefault(p, kind)
        return p

    def _cur(self, path):
        p = str(path)
        if p in self.pending:
            return self.pending[p] or ""
        f = Path(p)
        return f.read_text("utf-8") if f.is_file() else ""

    def _set(self, path, content, kind, why):
        p = self._touch(path, kind)
        self.pending[p] = content
        self.explain[p].append(why)
        return p

    def _del(self, path, kind, why):
        p = self._touch(path, kind)
        self.pending[p] = DELETED
        self.explain[p].append(why)
        return p

    def _skip(self, op, why):
        tgt = op.get("target_id") or op.get("source_ids") or op.get("path")
        self.skipped.append((op.get("op"), tgt, why))

    @staticmethod
    def _norm(x):
        q = Path(x).expanduser()
        try:
            return str(q.resolve())
        except OSError:
            return os.path.normpath(str(q))

    def _snapshot(self, path):
        """Content recorded at scan time (what the browser diffed against), or None
        if untracked. Used only to flag drift — never to block mechanically."""
        target = self._norm(path)
        g = self.inv.get("global") or {}
        cm = g.get("claude_md") or {}
        if cm.get("path") and self._norm(cm["path"]) == target:
            return cm.get("content")
        s = g.get("settings") or {}
        if s.get("path") and self._norm(s["path"]) == target:
            return s.get("raw")
        for r in (g.get("rules") or []):
            if r.get("path") and self._norm(r["path"]) == target:
                return r.get("content")
        for proj in (self.inv.get("projects") or []):
            ps = proj.get("settings") or {}
            if ps.get("path") and self._norm(ps["path"]) == target:
                return ps.get("raw")
        return None

    def _check_drift(self, path):
        """Flag if the on-disk file no longer matches the scan snapshot the browser
        approved against — the backstop that makes in-browser approval safe."""
        snap = self._snapshot(path)
        if snap is not None and str(path) not in self.pending and self._cur(path) != snap:
            self.drift[str(path)] = "Datei seit dem Scan auf der Platte geändert — Freigabe war gegen eine ältere Fassung"

    @staticmethod
    def _split_frontmatter(text):
        lines = text.split("\n")
        if lines and lines[0].strip() == "---":
            for i in range(1, len(lines)):
                if lines[i].strip() == "---":
                    return "\n".join(lines[: i + 1]), "\n".join(lines[i + 1:])
        return "", text

    def _remove_bullet(self, memory_dir, filename):
        index = Path(memory_dir) / "MEMORY.md"
        if not (str(index) in self.pending or index.is_file()):
            return
        cur = self._cur(index)
        kept = [ln for ln in cur.split("\n")
                if not re.search(r"\(" + re.escape(filename) + r"\)", ln)]
        if kept != cur.split("\n"):
            self._set(index, "\n".join(kept), "index",
                      "Index-Eintrag für {} entfernt".format(filename))

    # -- operations (populate the pending map, no real writes) -------------
    def op_delete(self, op):
        e = self.by_id.get(op["target_id"])
        if not e:
            return self._skip(op, "unbekannte id")
        self._del(e["file"], "memory", "Memory gelöscht: {}".format(op.get("reason", "")))
        self._remove_bullet(Path(e["file"]).parent, e["filename"])

    def op_edit(self, op):
        e = self.by_id.get(op["target_id"])
        if not e:
            return self._skip(op, "unbekannte id")
        fm, _ = self._split_frontmatter(self._cur(e["file"]))
        clean, removed, had_block = safety.sanitize(op.get("new_body", ""))
        new = (fm + "\n\n" + clean.strip() + "\n") if fm else (clean.strip() + "\n")
        if op.get("new_description"):
            new = re.sub(r"(?m)^description:.*$",
                         "description: " + op["new_description"], new, count=1)
        why = "Body bearbeitet" + (" (+Unicode bereinigt)" if removed else "")
        p = self._set(e["file"], new, "memory", why)
        if had_block:
            self.blocked[p] = "BLOCK-Unicode im neuen Body"

    def op_split(self, op):
        e = self.by_id.get(op["target_id"])
        if not e:
            return self._skip(op, "unbekannte id")
        keep = (op.get("keep_as_rule") or "").strip()
        if not keep:
            return self._skip(op, "keep_as_rule leer — Claude muss die Grenze setzen")
        fm, body = self._split_frontmatter(self._cur(e["file"]))
        # rule file keeps `keep`; if keep already carries its own frontmatter use it as-is
        if keep.startswith("---"):
            self._set(e["file"], keep.rstrip("\n") + "\n", "memory", "Dauerregel behalten (Logs ausgelagert)")
        else:
            new = (fm + "\n\n" + keep + "\n") if fm else (keep + "\n")
            self._set(e["file"], new, "memory", "Dauerregel behalten (Logs ausgelagert)")
        if not op.get("delete_moved"):
            log_path = Path(e["file"]).parent / op["move_to_filename"]
            log_fm = "---\nname: {}\ntype: project\n---\n\n".format(
                op["move_to_filename"].replace(".md", ""))
            self._set(log_path, log_fm + body.strip() + "\n", "memory",
                      "Ausgelagerte Logs aus {}".format(e["filename"]))

    def op_promote(self, op):
        text = (op.get("translated_text") or "").strip()
        if not text:
            return self._skip(op, "translated_text leer — Claude muss übersetzen")
        clean, removed, had_block = safety.sanitize(text)
        sources = op.get("source_ids", [])
        prov = "<!-- promoted {} from: {} -->".format(_today(), ", ".join(sources))
        rule_text = clean.strip() + "\n\n" + prov + "\n"
        rule_path = self.claude_dir / "rules" / op["global_filename"]
        collide = op.get("supersedes_global") or rule_path.is_file() or str(rule_path) in self.pending
        why = "Globale Regel aus {} (lädt jede Session)".format(", ".join(s.split("::")[-1] for s in sources))
        if collide:
            why += " — KOLLISION: ersetzt bestehende Regel (Merge von Claude bestätigt)"
        p = self._set(rule_path, rule_text, "rule", why)
        if had_block:
            self.blocked[p] = "BLOCK-Unicode im Regeltext — Beförderung abgebrochen"
        self._wire_import(op["global_filename"])
        for sid in sources:
            self._handle_origin(sid, op.get("keep_origin", "leave"), op["global_filename"])

    def _wire_import(self, filename):
        import_line = "@rules/" + filename
        cm = self.claude_dir / "CLAUDE.md"
        text = self._cur(cm)
        if BEGIN in text and END in text:
            pre, rest = text.split(BEGIN, 1)
            block, post = rest.split(END, 1)
            existing = [l.strip() for l in block.split("\n") if l.strip().startswith("@")]
            if import_line in existing:
                return
            existing.append(import_line)
            new = pre + BEGIN + "\n" + "\n".join(existing) + "\n" + END + post
        else:
            blk = BEGIN + "\n" + import_line + "\n" + END + "\n"
            new = (text.rstrip("\n") + "\n\n" + blk) if text else blk
        self._set(cm, new, "import", "Bindet {} global ein (idempotent)".format(import_line))

    def _handle_origin(self, sid, mode, global_filename):
        e = self.by_id.get(sid)
        if not e or mode == "leave":
            return
        if mode == "annotate":
            cur = self._cur(e["file"])
            stamp = "<!-- promoted to ~/.claude/rules/{} on {} -->".format(global_filename, _today())
            if stamp not in cur:
                self._set(e["file"], cur.rstrip("\n") + "\n" + stamp + "\n", "memory",
                          "Rückverweis im Quell-Memory {}".format(sid.split("::")[-1]))
        elif mode == "delete":
            self._del(e["file"], "memory", "Quell-Memory {} nach Beförderung entfernt".format(sid.split("::")[-1]))
            self._remove_bullet(Path(e["file"]).parent, e["filename"])

    def op_harden(self, op):
        if op.get("decision") == "dismiss":
            return
        hook = op.get("hook")
        if not hook or not hook.get("command"):
            return self._skip(op, "hook-Block fehlt — Claude muss ihn komponieren")
        e = self.by_id.get(op["target_id"])
        scope = op.get("scope", "global")
        if scope == "project" and e and e.get("project_path"):
            settings_path = Path(e["project_path"]) / ".claude" / "settings.json"
        else:
            settings_path = self.claude_dir / "settings.json"
            scope = "global"
        cur = self._cur(settings_path)
        try:
            data = json.loads(cur) if cur.strip() else {}
        except ValueError:
            return self._skip(op, "settings.json nicht parsebar: {}".format(settings_path))
        if not isinstance(data, dict):
            return self._skip(op, "settings.json ist kein JSON-Objekt")
        hooks = data.setdefault("hooks", {})
        pre = hooks.setdefault("PreToolUse", [])
        entry = {
            "matcher": hook.get("matcher", "Bash"),
            "hooks": [{
                "type": "command",
                "command": hook["command"],
                "timeout": hook.get("timeout", 10),
            }],
        }
        # idempotency: skip if an identical command already present
        already = any(
            any(h.get("command") == hook["command"] for h in grp.get("hooks", []))
            for grp in pre if isinstance(grp, dict)
        )
        if already:
            self.explain[str(settings_path)].append("Hook bereits vorhanden — unverändert")
            self._touch(settings_path, "settings")
            return
        pre.append(entry)
        new = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        self._set(settings_path, new, "settings",
                  "Neuer PreToolUse-Hook ({}) aus Regel {}".format(scope, op["target_id"].split("::")[-1]))

    def _resolve_global(self, raw):
        """Expand+validate a global path. Returns (Path, kind) or (None, None).

        Only CLAUDE.md or files under <claude_dir>/rules/ are allowed — this is
        the guard that keeps edit_global/delete_global from touching arbitrary
        files."""
        p = Path(raw).expanduser()
        try:
            p = p.resolve()
        except OSError:
            p = Path(os.path.normpath(str(p)))
        cd = self.claude_dir.expanduser()
        try:
            cd = cd.resolve()
        except OSError:
            pass
        if p == cd / "CLAUDE.md":
            return p, "claude_md"
        try:
            rel = p.relative_to(cd / "rules")
        except ValueError:
            return None, None
        if len(rel.parts) == 1 and p.suffix == ".md":
            return p, "rule"
        return None, None

    def op_edit_global(self, op):
        p, kind = self._resolve_global(op.get("path", ""))
        if p is None:
            return self._skip(op, "Pfad nicht erlaubt (nur CLAUDE.md oder rules/*.md)")
        self._check_drift(p)
        clean, removed, had_block = safety.sanitize(op.get("new_content", ""))
        why = ("CLAUDE.md bearbeitet" if kind == "claude_md" else "Globale Regel bearbeitet") + \
              (" (+Unicode bereinigt)" if removed else "")
        path = self._set(p, clean.rstrip("\n") + "\n", kind, why)
        if had_block:
            self.blocked[path] = "BLOCK-Unicode im global geladenen Inhalt"

    def op_delete_global(self, op):
        p, kind = self._resolve_global(op.get("path", ""))
        if p is None or kind != "rule":
            return self._skip(op, "delete_global nur für rules/*.md (CLAUDE.md kann nicht gelöscht werden)")
        self._del(p, "rule", "Globale Regel gelöscht")
        self._unwire_import(p.name)

    def _unwire_import(self, filename):
        cm = self.claude_dir / "CLAUDE.md"
        text = self._cur(cm)
        if BEGIN not in text or END not in text:
            return
        pre, rest = text.split(BEGIN, 1)
        block, post = rest.split(END, 1)
        kept = [l for l in block.split("\n")
                if l.strip() and l.strip() != "@rules/" + filename]
        if not any(l.strip().startswith("@") for l in kept):
            # block now empty → drop the whole managed block
            new = (pre.rstrip("\n") + "\n" + post.lstrip("\n")).rstrip("\n") + "\n"
        else:
            new = pre + BEGIN + "\n" + "\n".join(kept) + "\n" + END + post
        if new != text:
            self._set(cm, new, "import", "@import für {} entfernt".format(filename))

    def _resolve_settings(self, raw):
        """Expand+validate a settings.json path. Returns (Path, scope) or (None, None).

        Only the global settings.json or a known project's .claude/settings.json is
        allowed — the guard that keeps edit_settings from touching arbitrary files."""
        p = Path(raw).expanduser()
        try:
            p = p.resolve()
        except OSError:
            p = Path(os.path.normpath(str(p)))
        cd = self.claude_dir.expanduser()
        try:
            cd = cd.resolve()
        except OSError:
            pass
        if p == cd / "settings.json":
            return p, "global"
        for proj in self.inv.get("projects", []):
            pp = proj.get("path")
            if not pp:
                continue
            try:
                base = Path(pp).expanduser().resolve()
            except OSError:
                base = Path(pp)
            if p == base / ".claude" / "settings.json":
                return p, "project"
        return None, None

    def op_edit_settings(self, op):
        p, scope = self._resolve_settings(op.get("path", ""))
        if p is None:
            return self._skip(op, "Pfad nicht erlaubt (nur globale oder bekannte Projekt-settings.json)")
        self._check_drift(p)
        new_content = op.get("new_content", "")
        # never write a broken settings.json: must parse to a JSON object
        try:
            json.loads(new_content) if new_content.strip() else {}
        except ValueError as ex:
            return self._skip(op, "settings.json wäre kein gültiges JSON: {}".format(ex))
        clean, removed, had_block = safety.sanitize(new_content)
        # re-validate after sanitize; if stripping invisibles broke JSON, keep raw
        try:
            data = json.loads(clean) if clean.strip() else {}
            if not isinstance(data, dict):
                return self._skip(op, "settings.json muss ein JSON-Objekt sein")
        except ValueError:
            data = json.loads(new_content) if new_content.strip() else {}
        norm = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        why = "settings.json bearbeitet ({})".format(scope) + (" (+Unicode bereinigt)" if removed else "")
        path = self._set(p, norm, "settings", why)
        if had_block:
            self.blocked[path] = "BLOCK-Unicode in settings.json"

    def op_ignore(self, op):
        self.skipped.append(("ignore", op.get("target_id"), op.get("reason", "")))

    # -- driver ------------------------------------------------------------
    def build(self):
        decisions = json.loads((self.run_dir / "decisions.json").read_text("utf-8"))
        ops = decisions.get("operations", [])
        # edit_global/delete_global run BEFORE promote so promote's @import
        # wiring composes on top of an edited CLAUDE.md instead of being clobbered.
        order = {"edit_global": 0, "delete_global": 1, "promote": 2, "split": 3,
                 "edit": 4, "delete": 5, "harden_ack": 6, "harden": 6,
                 "edit_settings": 6, "ignore": 7}
        ops = sorted(ops, key=lambda o: order.get(o.get("op"), 9))
        dispatch = {
            "delete": self.op_delete, "edit": self.op_edit, "split": self.op_split,
            "promote": self.op_promote, "harden_ack": self.op_harden,
            "harden": self.op_harden, "ignore": self.op_ignore,
            "edit_global": self.op_edit_global, "delete_global": self.op_delete_global,
            "edit_settings": self.op_edit_settings,
        }
        for op in ops:
            fn = dispatch.get(op.get("op"))
            if fn:
                fn(op)
            else:
                self._skip(op, "unbekannte Operation")

    def changes(self):
        out = []
        for p in sorted(self.pending.keys()):
            content = self.pending[p]
            if content is DELETED:
                action = "delete"
            elif not self.orig_exists.get(p):
                action = "create"
            else:
                action = "modify"
            out.append({
                "path": p,
                "action": action,
                "kind": self.kind.get(p, "memory"),
                "explanation": " / ".join(self.explain.get(p, [])),
                "blocked": self.blocked.get(p),
                "drift": self.drift.get(p),
                "content": content,
            })
        return out

    # -- stage / commit ----------------------------------------------------
    def stage(self):
        self.build()
        self.staged_dir.mkdir(parents=True, exist_ok=True)
        manifest = []
        for ch in self.changes():
            staged_name = _slug(ch["path"])
            if ch["action"] != "delete":
                (self.staged_dir / staged_name).write_text(ch["content"] or "", encoding="utf-8")
            manifest.append({
                "path": ch["path"],
                "action": ch["action"],
                "kind": ch["kind"],
                "explanation": ch["explanation"],
                "blocked": ch["blocked"],
                "drift": ch["drift"],
                "staged": staged_name if ch["action"] != "delete" else None,
            })
        man = {"generated_at": _now(), "changes": manifest,
               "skipped": [{"op": o, "target": t, "why": w} for (o, t, w) in self.skipped]}
        (self.run_dir / "manifest.json").write_text(
            json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
        return man

    def commit(self, only=None, commit_all=False):
        man = json.loads((self.run_dir / "manifest.json").read_text("utf-8"))
        only_set = set(only or [])
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        applied, skipped = [], []
        audit = []
        for ch in man["changes"]:
            path = ch["path"]
            if ch["blocked"]:
                skipped.append((path, "blocked: " + ch["blocked"]))
                audit.append({"ts": _now(), "op": ch["kind"], "target_id": path, "decision": "blocked"})
                continue
            if not commit_all and path not in only_set:
                skipped.append((path, "nicht bestätigt"))
                audit.append({"ts": _now(), "op": ch["kind"], "target_id": path, "decision": "declined"})
                continue
            self._backup(path)
            if ch["action"] == "delete":
                try:
                    os.remove(path)
                except OSError:
                    pass
            else:
                staged = self.staged_dir / ch["staged"]
                dst = Path(path)
                dst.parent.mkdir(parents=True, exist_ok=True)
                tmp = dst.with_suffix(dst.suffix + ".tmp")
                shutil.copy2(str(staged), str(tmp))
                os.replace(str(tmp), str(dst))
            applied.append((path, ch["action"], ch["kind"]))
            audit.append({"ts": _now(), "op": ch["kind"], "target_id": path, "decision": "applied"})
        if audit:
            mm = self.claude_dir / "memory-manager"
            mm.mkdir(parents=True, exist_ok=True)
            with (mm / "audit.jsonl").open("a", encoding="utf-8") as fh:
                for rec in audit:
                    fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._write_result(applied, skipped)
        return applied, skipped

    def _write_result(self, applied, skipped):
        """Persist what this cycle actually wrote, for the browser's result panel.
        Merges with an existing result.json so several commits in one cycle (e.g.
        mechanical auto-commit + a confirmed judgment op) accumulate rather than
        clobber. The skill removes result.json when it starts a new cycle."""
        out = self.run_dir / "result.json"
        prev = {}
        if out.is_file():
            try:
                prev = json.loads(out.read_text("utf-8"))
            except (ValueError, OSError):
                prev = {}
        by_path = {a["path"]: a for a in prev.get("applied", []) if isinstance(a, dict)}
        for (path, action, kind) in applied:
            by_path[path] = {"path": path, "action": action, "kind": kind}
        skip = {s["path"]: s for s in prev.get("skipped", []) if isinstance(s, dict)}
        for (path, why) in skipped:
            # a path written in this commit is no longer "skipped"
            if path in by_path:
                continue
            skip[path] = {"path": path, "why": why}
        for path in list(skip):
            if path in by_path:
                del skip[path]
        result = {
            "generated_at": _now(),
            "applied": list(by_path.values()),
            "skipped": list(skip.values()),
            "backup_dir": str(self.backup_dir),
        }
        tmp = Path(str(out) + ".tmp")
        tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(str(tmp), str(out))
        return result

    def _backup(self, path):
        p = Path(path)
        if p.is_file():
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(p), str(self.backup_dir / _slug(path)))


def _print_manifest(man):
    print("Geplante Änderungen ({}):\n".format(len(man["changes"])))
    for ch in man["changes"]:
        mark = "⛔" if ch["blocked"] else {"create": "＋", "modify": "✎", "delete": "✕"}.get(ch["action"], "?")
        print("  {} [{}] {}".format(mark, ch["action"], ch["path"]))
        print("      {}".format(ch["explanation"]))
        if ch["blocked"]:
            print("      BLOCKIERT: {}".format(ch["blocked"]))
    if man["skipped"]:
        print("\nÜbersprungen:")
        for s in man["skipped"]:
            print("  - {} {}: {}".format(s["op"], s["target"], s["why"]))


def main(argv=None):
    p = argparse.ArgumentParser(description="Stage/commit decisions.json.")
    p.add_argument("--claude-dir", required=True)
    p.add_argument("--run-dir", required=True)
    p.add_argument("--stage", action="store_true", help="compute changes, write manifest, no real writes")
    p.add_argument("--commit", action="store_true", help="write confirmed changes")
    p.add_argument("--only", nargs="*", default=None, help="paths to commit")
    p.add_argument("--all", action="store_true", help="commit every non-blocked change")
    args = p.parse_args(argv)

    a = Applier(Path(args.claude_dir).expanduser(), Path(args.run_dir).expanduser())
    if args.commit:
        applied, skipped = a.commit(only=args.only, commit_all=args.all)
        print("Angewendet ({}):".format(len(applied)))
        for (path, action, kind) in applied:
            print("  {} {} ({})".format(action, path, kind))
        if skipped:
            print("\nNicht geschrieben ({}):".format(len(skipped)))
            for (path, why) in skipped:
                print("  {} — {}".format(path, why))
    else:  # default: stage
        man = a.stage()
        _print_manifest(man)
        print("\nManifest: {}".format(a.run_dir / "manifest.json"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
