#!/usr/bin/env python3
"""Deterministic scanner for Claude Code auto-memory.

Enumerates ``<claude-dir>/projects/*/memory/*.md`` across all projects, parses
each memory file (both frontmatter shapes), extracts display fields, and emits
flags (must-language, invisible Unicode, log-bloat split candidates). It also
computes cheap cross-project clusters and the always-loaded global budget, then
writes ``inventory.json``.

The script decides nothing that requires reading meaning. Semantic judgement
(confirming clusters, translating observation->instruction, choosing split
points, writing files) is left to Claude in the apply step.

Stdlib only, Python 3.9 compatible. Strictly read-only.
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pathcodec  # noqa: E402
import safety  # noqa: E402

SCHEMA_VERSION = 3
WARN_THRESHOLD_LINES = 150
SOFT_LIMIT_LINES = 200
STALE_DAYS = 180
PROJECT_RULE_MAX_CHARS = 40000

# --- frontmatter parsing ----------------------------------------------------


def parse_frontmatter(text):
    """Return (data, body, error). ``data`` may contain a nested 'metadata'.

    Handles both observed shapes: a top-level ``type:`` and a nested
    ``metadata:`` block whose first key is ``node_type: memory`` (the trap: a
    naive ``type:`` grep would read ``node_type`` and mislabel every file).
    Degrades gracefully: unparseable frontmatter yields an error string but the
    file is still reported.
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, text, "no_frontmatter"

    fm_lines = []
    i = 1
    closed = False
    while i < len(lines):
        if lines[i].strip() == "---":
            closed = True
            i += 1
            break
        fm_lines.append(lines[i])
        i += 1
    if not closed:
        return {}, text, "unterminated_frontmatter"

    body = "\n".join(lines[i:])
    data = {}
    meta = {}
    in_meta = False
    for ln in fm_lines:
        if not ln.strip():
            continue
        indented = ln[0] in (" ", "\t")
        key, sep, val = ln.strip().partition(":")
        if not sep:
            continue
        key = key.strip()
        val = _unquote(val.strip())
        if in_meta and indented:
            meta[key] = val
            continue
        in_meta = False
        if key == "metadata" and val == "":
            in_meta = True
            continue
        data[key] = val
    if meta:
        data["metadata"] = meta
    return data, body, None


def _unquote(val):
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
        return val[1:-1]
    return val


# --- body extraction --------------------------------------------------------

_SECTION_RE = re.compile(r"\*\*\s*([^*\n:]{1,40}?)\s*:\*\*")


def extract_sections(body):
    """Return an ordered dict-like list of (label, text) from ``**Label:**``."""
    markers = list(_SECTION_RE.finditer(body))
    sections = {}
    order = []
    for idx, m in enumerate(markers):
        label = m.group(1).strip()
        start = m.end()
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(body)
        sections[label] = body[start:end].strip()
        order.append(label)
    return sections, order


def first_paragraph(body):
    for para in re.split(r"\n\s*\n", body.strip()):
        cleaned = para.strip()
        if cleaned and not cleaned.startswith("**"):
            return _truncate(cleaned, 240)
    # fall back to first non-empty line
    for ln in body.split("\n"):
        if ln.strip():
            return _truncate(ln.strip(), 240)
    return ""


def _truncate(s, n):
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


# --- flags ------------------------------------------------------------------

_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")

_MUST_STRONG = (
    r"niemals|never|immer|always|muss|müssen|must\b|zwingend|verboten|"
    r"ausschließlich|nie\b|required"
)
_MUST_WEAK = r"kein\b|keine\b|nur wenn|hart\b|darf nicht"
_MUST_RE = re.compile(r"(?i)\b(?:" + _MUST_STRONG + r")", re.UNICODE)
_MUST_STRONG_RE = re.compile(r"(?i)\b(?:" + _MUST_STRONG + r")", re.UNICODE)
_MUST_ANY_RE = re.compile(
    r"(?i)(?:\b(?:" + _MUST_STRONG + r")|(?:" + _MUST_WEAK + r"))", re.UNICODE
)

_DATED_HEADER_RE = re.compile(
    r"(?im)^\s{0,3}#{1,4}\s.*(?:20\d\d[-/.]\d\d[-/.]\d\d|\d\d\.\d\d\.20\d\d|"
    r"testlauf|durchgeführt|stand\b)"
)


def find_wiki_links(body, sibling_stems):
    links = []
    for m in _WIKILINK_RE.finditer(body):
        target = m.group(1).strip()
        stem = target.split("|")[0].strip()
        resolved = stem in sibling_stems
        links.append({"target": stem, "resolved": resolved})
    return links


def find_must_flags(text):
    flags = []
    for ln_no, ln in enumerate(text.split("\n"), start=1):
        for m in _MUST_ANY_RE.finditer(ln):
            flags.append({"phrase": m.group(0), "line": ln_no})
    enforceable = bool(_MUST_STRONG_RE.search(text))
    return flags, enforceable


def detect_split(body, total_lines):
    n = len(_DATED_HEADER_RE.findall(body))
    if total_lines > 60 and n >= 2:
        return True, "{} dated/log sections in {} lines".format(n, total_lines)
    return False, None


# --- clustering -------------------------------------------------------------

_STOP = set("""
the and for with this that from your you are not but has have was will can may
all any per via use using when then than only also into out off via more most
und der die das ein eine einen einem eines fuer für mit von den dem des auf ist
als auch nur nicht sich werden wird wurde sein seine bei nach beim vor zum zur
sind jedem jeder jede jeden oder aber wenn dann noch schon sowie etc bzw beim
muss müssen immer niemals nie kein keine keinen darf soll sollte zwingend always
never must should memory claude code feedback project projekt user nutzer
reference regel regeln datei dateien file files note notes stand mode workflow
später vorher nachher halten schreiben prüfen aktiv offen offener folgen lokal
stack todo scope default until ohne sowohl mehr weniger machen geben nehmen
""".split())

_TOKEN_RE = re.compile(r"[a-z0-9äöüß]+")


def _tokens_of(entry):
    raw = " ".join([
        entry["filename"], entry.get("name") or "", entry.get("description") or "",
    ]).lower()
    toks = set()
    for t in _TOKEN_RE.findall(raw):
        if len(t) >= 4 and t not in _STOP:
            toks.add(t)
    return toks


def _jaccard(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / float(len(a | b))


def cluster_entries(entries):
    """Cheap cross-project candidate clustering: one theme group per shared,
    not-too-generic token that spans >=2 projects.

    Deliberately NOT transitive (no union-find): chaining A-B via 'commit' and
    B-C via 'docs' would merge everything into one blob. Instead each seed
    token yields its own small group, an entry may belong to several, and
    groups whose members are a subset of a larger group are dropped. These are
    *hints* for Claude and the user to confirm semantically, not final answers.
    """
    n = len(entries)
    for e in entries:
        e["cluster_hint_ids"] = []
    if n == 0:
        return []
    toks = [_tokens_of(e) for e in entries]

    inv = defaultdict(list)
    for i, ts in enumerate(toks):
        for t in ts:
            inv[t].append(i)

    max_df = 8  # a token in >8 of ~44 entries is too generic to be a theme
    min_members = 3  # a theme worth promoting recurs in 3+ memories
    raw = []  # list of (frozenset(member_idx), token)
    for t, idxs in inv.items():
        if len(idxs) < min_members or len(idxs) > max_df:
            continue
        projects = set(entries[i]["project_encoded"] for i in idxs)
        if len(projects) < 2:
            continue
        raw.append((frozenset(idxs), t))

    # Merge groups with identical membership (different tokens, same entries);
    # drop a group whose members are a subset of a larger group's members.
    by_members = {}
    for members, token in raw:
        by_members.setdefault(members, set()).add(token)
    member_sets = sorted(by_members.keys(), key=lambda m: (-len(m), sorted(m)))
    kept = []
    for members in member_sets:
        if any(members < bigger for bigger in (k for k, _ in kept)):
            continue
        kept.append((members, by_members[members]))

    clusters = []
    for cid, (members, tokens) in enumerate(kept, start=1):
        hint = "c_{}".format(cid)
        midx = sorted(members)
        projects = set(entries[m]["project_encoded"] for m in midx)
        labels = sorted(tokens, key=lambda t: (-len(inv[t]), t))[:3]
        for m in midx:
            entries[m]["cluster_hint_ids"].append(hint)
        clusters.append({
            "cluster_hint_id": hint,
            "label_guess": " / ".join(labels),
            "member_ids": [entries[m]["id"] for m in midx],
            "member_count": len(midx),
            "project_count": len(projects),
            "basis": "shared tokens: " + ", ".join(sorted(tokens)),
        })
    clusters.sort(key=lambda c: (-c["project_count"], -c["member_count"]))
    return clusters


# --- budget -----------------------------------------------------------------


def compute_budget(claude_dir, home):
    files = []
    total_lines = 0
    total_chars = 0

    def add(p):
        nonlocal total_lines, total_chars
        if p.is_file():
            text = p.read_text(encoding="utf-8", errors="replace")
            lines = line_count(text)
            files.append({
                "path": _display(p, home),
                "lines": lines,
                "chars": len(text),
            })
            total_lines += lines
            total_chars += len(text)

    add(claude_dir / "CLAUDE.md")
    rules_dir = claude_dir / "rules"
    if rules_dir.is_dir():
        for r in sorted(rules_dir.glob("*.md")):
            add(r)
    return {
        "always_loaded_files": files,
        "current_lines": total_lines,
        "current_chars": total_chars,
        "warn_threshold_lines": WARN_THRESHOLD_LINES,
        "soft_limit_lines": SOFT_LIMIT_LINES,
        "projected_after_pending_lines": total_lines,
    }


def _content_hash(text):
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


_H_RE = re.compile(r"^(#{1,6})\s")
_BULLET_RE = re.compile(r"^(\s*)(?:[-*+]|\d+\.)\s")


def decompose_markdown(content):
    """Segment a markdown rule file into individually addressable items, each
    with a 1-based inclusive line range, so the GUI can show/edit/delete a
    single rule while the raw .md stays the source of truth.

    Item types: ``frontmatter``, ``heading``, ``bullet`` (one per top-level
    bullet incl. its indented continuation), ``paragraph``. Blank lines belong
    to no item. Invariant (tested): the items tile the file in order with only
    blank lines as gaps — i.e. every non-blank line is covered by exactly one
    item and reassembly reproduces the original byte-for-byte.
    """
    items = []
    if not content:
        return items
    lines = content.split("\n")
    n = len(lines)
    i = 0
    cur_heading = None

    if lines and lines[0].strip() == "---":
        j = 1
        while j < n and lines[j].strip() != "---":
            j += 1
        if j < n:  # closing fence found at j
            j += 1  # include the closing ---
            items.append({
                "type": "frontmatter", "line_start": 1, "line_end": j,
                "content": "\n".join(lines[0:j]), "heading": None, "level": None,
            })
            i = j

    while i < n:
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        hm = _H_RE.match(ln)
        if hm:
            level = len(hm.group(1))
            items.append({
                "type": "heading", "line_start": i + 1, "line_end": i + 1,
                "content": ln, "heading": ln[level:].strip(), "level": level,
            })
            if level <= 3:
                cur_heading = ln[level:].strip()
            i += 1
            continue
        if _BULLET_RE.match(ln):
            base_indent = len(ln) - len(ln.lstrip())
            j = i + 1
            while j < n:
                nxt = lines[j]
                if not nxt.strip() or _H_RE.match(nxt):
                    break
                if _BULLET_RE.match(nxt):
                    indent = len(nxt) - len(nxt.lstrip())
                    if indent > base_indent:
                        j += 1
                        continue
                    break
                if nxt.startswith((" ", "\t")):  # indented continuation prose
                    j += 1
                    continue
                break
            items.append({
                "type": "bullet", "line_start": i + 1, "line_end": j,
                "content": "\n".join(lines[i:j]), "heading": cur_heading, "level": None,
            })
            i = j
            continue
        # paragraph: a run of plain non-blank lines
        j = i + 1
        while j < n and lines[j].strip() and not _H_RE.match(lines[j]) and not _BULLET_RE.match(lines[j]):
            j += 1
        items.append({
            "type": "paragraph", "line_start": i + 1, "line_end": j,
            "content": "\n".join(lines[i:j]), "heading": cur_heading, "level": None,
        })
        i = j
    return items


# --- permission / hook semantics (deterministic facts + plain-German) -------

_PERM_RE = re.compile(r"^([A-Za-z_][\w]*)\((.*)\)$")
_ACTION_VERB = {"allow": "Erlaubt", "deny": "Verboten", "ask": "Nachfragen"}
_NET_WORDS = ("ssh", "scp", "rsync", "sftp", "curl", "wget", "nc")


def _perm_category(tool, target):
    if tool.startswith("mcp__"):
        return "MCP"
    t = target.strip().lower()
    head = re.split(r"[\s:()]+", t)[0] if t else ""  # leading command, sans glob/args
    if head in _NET_WORDS or tool in ("WebFetch", "WebSearch"):
        return "Netzwerk"
    if head == "git":
        return "Git"
    if any(w in t for w in ("test", "pytest", "jest", "vitest", "e2e", "playwright")):
        return "Tests"
    if tool in ("Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit"):
        return "Dateien"
    if tool == "Bash":
        return "Shell"
    return "Sonstiges"


def _perm_what(tool, target, category):
    tgt = " `{}`".format(target) if target else ""
    if category == "MCP":
        parts = tool.split("__")
        server = parts[1] if len(parts) > 1 else "?"
        toolname = parts[2] if len(parts) > 2 else (target or "?")
        return "MCP-Tool „{}“ von „{}“".format(toolname, server)
    if category == "Netzwerk":
        return "Netzwerk-/Server-Zugriff" + tgt
    if category == "Git":
        return "Git-Befehl" + tgt
    if category == "Tests":
        return "Test-Befehl" + tgt
    if category == "Dateien":
        return "{}: Dateien".format(tool) + (" ({})".format("`" + target + "`") if target else "")
    if category == "Shell":
        return "Shell-Befehl" + tgt
    return tool + tgt


def parse_permission(raw, action):
    """Turn a raw permission pattern into structured facts + a plain-German
    one-liner. Display metadata only — never affects writes."""
    raw = str(raw)
    m = _PERM_RE.match(raw.strip())
    if m:
        tool, target = m.group(1), m.group(2).strip()
    else:
        tool, target = raw.strip(), ""
    mode = "exact" if (target and "*" not in target and not target.endswith(":*")) else "glob"
    category = _perm_category(tool, target)
    what = _perm_what(tool, target, category)
    if action == "allow":
        summary = "Ohne Nachfrage erlaubt: " + what + "."
    elif action == "deny":
        summary = "Verboten: " + what + "."
    else:
        summary = "Nachfragen vor: " + what + "."
    return {"raw": raw, "tool": tool, "target": target, "mode": mode,
            "category": category, "action": action, "summary": summary}


def _hook_template(decision, patterns):
    if not patterns:
        return None
    act = {"ask": "Fragt nach", "deny": "Blockiert", "allow": "Erlaubt"}.get(decision or "", "Prüft")
    return "{} bei Befehlen mit: {}.".format(act, " / ".join(patterns))


def parse_hook(event, matcher, command):
    """Extract decision/reason/patterns from a hook command and produce a
    plain-German summary. Precedence: embedded permissionDecisionReason →
    template from grep patterns → null (Claude fills opaque ones)."""
    command = str(command)
    md = re.search(r'"permissionDecision"\s*:\s*"(\w+)"', command)
    decision = md.group(1) if md else None
    mr = re.search(r'"permissionDecisionReason"\s*:\s*"([^"]+)"', command)
    reason = mr.group(1) if mr else None
    grep_patterns = re.findall(r"grep\s+[^'\"]*['\"]([^'\"]+)['\"]", command)
    if reason:
        summary, source = reason, "reason"
    else:
        tmpl = _hook_template(decision, grep_patterns)
        summary, source = (tmpl, "template") if tmpl else (None, "claude-please-summarize")
    return {"event": event, "matcher": matcher, "command": command,
            "decision": decision, "reason": reason, "grep_patterns": grep_patterns,
            "summary": summary, "summary_source": source}


def read_global(claude_dir, home):
    """The always-loaded global content, with bodies, for the Global view.

    Returns {claude_md: {...content}, rules: [{...content, imported}]}.
    `imported` = whether CLAUDE.md references @rules/<file> (so the rule
    actually loads).
    """
    cm = claude_dir / "CLAUDE.md"
    cm_text = cm.read_text(encoding="utf-8", errors="replace") if cm.is_file() else ""
    claude_md = {
        "path": _display(cm, home),
        "exists": cm.is_file(),
        "content": cm_text,
        "lines": line_count(cm_text),
        "chars": len(cm_text),
        "items": decompose_markdown(cm_text),
        "content_hash": _content_hash(cm_text),
    }
    rules = []
    rules_dir = claude_dir / "rules"
    if rules_dir.is_dir():
        for r in sorted(rules_dir.glob("*.md")):
            text = r.read_text(encoding="utf-8", errors="replace")
            rules.append({
                "filename": r.name,
                "path": _display(r, home),
                "content": text,
                "lines": line_count(text),
                "chars": len(text),
                "imported": ("@rules/" + r.name) in cm_text,
                "items": decompose_markdown(text),
                "content_hash": _content_hash(text),
            })
    settings = _read_settings(
        claude_dir / "settings.json", "~/.claude/settings.json", home)
    return {"claude_md": claude_md, "rules": rules, "settings": settings}


def _read_settings(fp, rel_path, home):
    """Read-only view of a settings.json: the actual permission patterns and
    hook commands (not just counts). Used for both project and global settings.
    Returns None if the file does not exist."""
    if not fp.is_file():
        return None
    out = {
        "path": _display(fp, home), "rel_path": rel_path, "parse_ok": True,
        "raw": "",
        "permissions": {"allow": [], "deny": [], "ask": []},
        "parsed": {"allow": [], "deny": [], "ask": []}, "hooks": [],
        "permission_count": 0, "hook_count": 0,
    }
    try:
        raw = fp.read_text(encoding="utf-8", errors="replace")
    except OSError:
        out["parse_ok"] = False
        return out
    out["raw"] = raw  # full source, so the GUI can edit + re-serialize losslessly
    try:
        d = json.loads(raw)
    except ValueError:
        out["parse_ok"] = False
        return out
    if not isinstance(d, dict):
        out["parse_ok"] = False
        return out

    perm = d.get("permissions", {})
    if isinstance(perm, dict):
        for key in ("allow", "deny", "ask"):
            v = perm.get(key)
            if isinstance(v, list):
                out["permission_count"] += len(v)
                raws = [str(x) for x in v[:200]]
                out["permissions"][key] = raws
                out["parsed"][key] = [parse_permission(x, key) for x in raws]

    h = d.get("hooks", {})
    if isinstance(h, dict):
        for event, arr in h.items():
            if not isinstance(arr, list):
                continue
            for matcher in arr:
                if not isinstance(matcher, dict):
                    continue
                cmds = []
                hk = matcher.get("hooks")
                if isinstance(hk, list):
                    for entry in hk:
                        if isinstance(entry, dict) and entry.get("command"):
                            cmds.append(str(entry["command"]))
                ev, mt = str(event), str(matcher.get("matcher", ""))
                out["hooks"].append({
                    "event": ev,
                    "matcher": mt,
                    "commands": cmds,
                    "parsed": [parse_hook(ev, mt, c) for c in cmds],
                })
                out["hook_count"] += len(cmds)
    return out


def read_project_rules(project_path, resolved, home):
    """Read-only discovery of a project's OWN rule files (live in the repo).

    Finds CLAUDE.md, .claude/CLAUDE.md and .claude/rules/*.md plus a
    settings.json indicator. Strictly view-only: content is surfaced so you
    can see what a project already enforces, but it is never edited — writing
    into a project repo is deliberately out of scope. Returns
    {"rules": [...], "settings": {...}|None}.
    """
    out = {"rules": [], "settings": None}
    if not resolved or not project_path:
        return out
    base = Path(project_path)
    if not base.is_dir():
        return out

    candidates = []
    cm = base / "CLAUDE.md"
    if cm.is_file():
        candidates.append((cm, "CLAUDE.md"))
    dot_cm = base / ".claude" / "CLAUDE.md"
    if dot_cm.is_file():
        candidates.append((dot_cm, ".claude/CLAUDE.md"))
    dot_rules = base / ".claude" / "rules"
    if dot_rules.is_dir():
        for r in sorted(dot_rules.glob("*.md")):
            candidates.append((r, ".claude/rules/" + r.name))

    for fp, source in candidates:
        try:
            text = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        truncated = len(text) > PROJECT_RULE_MAX_CHARS
        shown = text[:PROJECT_RULE_MAX_CHARS]
        out["rules"].append({
            "filename": fp.name,
            "source": source,
            "path": _display(fp, home),
            "rel_path": source,
            "content": shown,
            "truncated": truncated,
            "lines": line_count(text),
            "chars": len(text),
            "unicode_flags": safety.scan_text(shown),
            "editable": False,
            "items": decompose_markdown(shown),
            "content_hash": _content_hash(shown),
        })

    out["settings"] = _read_settings(
        base / ".claude" / "settings.json", ".claude/settings.json", home)
    return out


def compute_insights(entries, budget, global_obj):
    """Deterministic, surface-level observations for the Insights panel.

    Each: {kind, severity: info|warn, message, entry_ids?}. Claude can add
    curated insights on top; these are the cheap, always-available ones.
    """
    def mem(n):
        return "1 Memory" if n == 1 else "{} Memories".format(n)

    out = []
    cur = budget["current_lines"]
    if cur > budget["soft_limit_lines"]:
        out.append({"kind": "budget", "severity": "warn",
                    "message": "Globales Budget über Limit ({}/{} Zeilen) — Befolgung leidet.".format(
                        cur, budget["soft_limit_lines"])})
    elif cur >= budget["warn_threshold_lines"]:
        out.append({"kind": "budget", "severity": "warn",
                    "message": "Globales Budget nähert sich dem Limit ({}/{} Zeilen).".format(
                        cur, budget["soft_limit_lines"])})

    enf = [e["id"] for e in entries if e["enforceable_candidate"]]
    if enf:
        out.append({"kind": "enforceable", "severity": "info",
                    "message": "Harte-Regel-Verdacht: {} — evtl. besser als Hook/Permission.".format(mem(len(enf))),
                    "entry_ids": enf[:50]})

    stale = [e["id"] for e in entries if e.get("stale")]
    if stale:
        out.append({"kind": "stale", "severity": "info",
                    "message": "{} älter als {} Tage — prüfen, ob noch aktuell.".format(mem(len(stale)), STALE_DAYS),
                    "entry_ids": stale[:50]})

    dangling = [e["id"] for e in entries if e.get("has_dangling_links")]
    if dangling:
        out.append({"kind": "dangling", "severity": "info",
                    "message": "{} mit verwaisten [[…]]-Verweisen auf nicht (mehr) existierende Einträge.".format(mem(len(dangling))),
                    "entry_ids": dangling[:50]})

    big = [e["id"] for e in entries if e["split_candidate"]]
    if big:
        out.append({"kind": "split", "severity": "info",
                    "message": "Split-Kandidaten: {} mit Dauerregel + Log-Ballast.".format(mem(len(big))),
                    "entry_ids": big})

    parse = [e["id"] for e in entries if e["parse_error"]]
    if parse:
        word = "1 Datei" if len(parse) == 1 else "{} Dateien".format(len(parse))
        out.append({"kind": "parse_error", "severity": "warn",
                    "message": "{} mit Frontmatter-Problemen.".format(word),
                    "entry_ids": parse})
    return out


def read_declined(claude_dir):
    """Read the audit log; return set of target_ids with a declined promotion."""
    log = claude_dir / "memory-manager" / "audit.jsonl"
    declined = set()
    if log.is_file():
        for ln in log.read_text(encoding="utf-8", errors="replace").split("\n"):
            ln = ln.strip()
            if not ln:
                continue
            try:
                rec = json.loads(ln)
            except ValueError:
                continue
            if rec.get("op") == "ignore" and rec.get("scope") == "promotion":
                declined.add(rec.get("target_id"))
            if rec.get("op") == "promote" and rec.get("decision") == "declined":
                declined.add(rec.get("target_id"))
    return declined


def _display(p, home):
    s = str(p)
    hs = str(home)
    if s.startswith(hs):
        return "~" + s[len(hs):]
    return s


# --- main scan --------------------------------------------------------------


def line_count(text):
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def scan(claude_dir):
    home = Path.home()
    projects_root = claude_dir / "projects"
    projects = []
    entries = []

    encoded_dirs = []
    if projects_root.is_dir():
        for child in sorted(projects_root.iterdir()):
            if (child / "memory").is_dir():
                encoded_dirs.append(child)

    used_slugs = {}
    for proj_dir in encoded_dirs:
        encoded = proj_dir.name
        resolved_path, resolved = pathcodec.resolve(encoded)
        base_slug = pathcodec.slug(encoded, resolved_path if resolved else None)
        proj_slug = base_slug
        if proj_slug in used_slugs:
            used_slugs[proj_slug] += 1
            proj_slug = "{}-{}".format(base_slug, used_slugs[base_slug])
        else:
            used_slugs[proj_slug] = 1

        memory_dir = proj_dir / "memory"
        md_files = sorted(memory_dir.glob("*.md"))
        sibling_stems = set(f.stem for f in md_files if f.name != "MEMORY.md")
        has_index = (memory_dir / "MEMORY.md").is_file()

        entry_count = 0
        for f in md_files:
            if f.name == "MEMORY.md":
                continue
            entry = build_entry(
                f, encoded, proj_slug, str(resolved_path), sibling_stems
            )
            entries.append(entry)
            entry_count += 1

        proj_rules = read_project_rules(str(resolved_path), resolved, home)
        projects.append({
            "encoded": encoded,
            "slug": proj_slug,
            "path": str(resolved_path),
            "path_resolved": resolved,
            "memory_dir": str(memory_dir),
            "has_index": has_index,
            "entry_count": entry_count,
            "rules": proj_rules["rules"],
            "settings": proj_rules["settings"],
        })

    declined = read_declined(claude_dir)
    for e in entries:
        e["previously_declined_promotion"] = e["id"] in declined

    clusters = cluster_entries(entries)
    for e in entries:
        e["global_candidate"] = bool(e["cluster_hint_ids"])
    budget = compute_budget(claude_dir, home)
    global_obj = read_global(claude_dir, home)
    insights = compute_insights(entries, budget, global_obj)

    n_rule_files = sum(len(p["rules"]) for p in projects)
    n_rule_projects = sum(1 for p in projects if p["rules"])
    if n_rule_files:
        f_word = "1 eigene Regeldatei" if n_rule_files == 1 else "{} eigene Regeldateien".format(n_rule_files)
        p_word = "1 Projekt" if n_rule_projects == 1 else "{} Projekten".format(n_rule_projects)
        insights.append({
            "kind": "project_rules", "severity": "info",
            "message": "{} in {} gefunden (nur lesbar — siehe Regeln-Ansicht).".format(f_word, p_word),
        })

    flag_count = sum(
        1 for e in entries
        if e["unicode_flags"] or e["enforceable_candidate"] or e["split_candidate"]
    )

    is_real = str(claude_dir) == str(home / ".claude")
    inventory = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "claude_dir": str(claude_dir),
        "is_real_claude_dir": is_real,
        "budget": budget,
        "global": global_obj,
        "insights": insights,
        "clusters": clusters,
        "projects": projects,
        "entries": entries,
    }
    summary = (
        "{} Projekte, {} Memories, {} Cluster, {} Flags, Budget {}/{} Zeilen".format(
            len(projects), len(entries), len(clusters), flag_count,
            budget["current_lines"], budget["soft_limit_lines"],
        )
    )
    return inventory, summary


def build_entry(path, encoded, proj_slug, proj_path, sibling_stems):
    content = path.read_text(encoding="utf-8", errors="replace")
    data, body, fm_error = parse_frontmatter(content)
    meta = data.get("metadata", {}) if isinstance(data.get("metadata"), dict) else {}

    entry_type = meta.get("type") or data.get("type") or "unknown"
    name = data.get("name") or path.stem
    description = data.get("description") or ""
    origin = meta.get("originSessionId") or data.get("originSessionId") or ""
    node_type = meta.get("node_type") or ""

    sections, order = extract_sections(body)
    why = sections.get("Why") or ""
    how = sections.get("How to apply") or sections.get("How") or ""

    lc = line_count(content)
    must_flags, enforceable = find_must_flags(body)
    split_candidate, split_reason = detect_split(body, lc)
    unicode_flags = safety.scan_text(content)
    wiki = find_wiki_links(body, sibling_stems)

    stat = path.stat()
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    age_days = (datetime.now(timezone.utc) - mtime).days

    has_dangling = any(not w["resolved"] for w in wiki)

    return {
        "id": "{}::{}".format(proj_slug, path.stem),
        "project_encoded": encoded,
        "project_slug": proj_slug,
        "project_path": proj_path,
        "file": str(path),
        "filename": path.name,
        "frontmatter_shape": "metadata_block" if meta else (
            "top_level" if data else "none"),
        "parse_error": fm_error,
        "name": name,
        "description": description,
        "type": entry_type,
        "node_type": node_type,
        "origin_session_id": origin,
        "lines": lc,
        "chars": len(content),
        "mtime": mtime.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "age_days": age_days,
        "why": _truncate(why, 400) if why else "",
        "how": _truncate(how, 400) if how else "",
        "snippet": first_paragraph(body),
        "sections": order,
        "wiki_links": wiki,
        "must_flags": must_flags,
        "enforceable_candidate": enforceable,
        "unicode_flags": unicode_flags,
        "split_candidate": split_candidate,
        "split_reason": split_reason,
        "stale": age_days > STALE_DAYS,
        "has_dangling_links": has_dangling,
        "global_candidate": False,  # set after clustering
        "cluster_hint_ids": [],
    }


def resolve_claude_dir(arg):
    if arg:
        return Path(arg).expanduser()
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".claude"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Scan Claude Code auto-memory.")
    parser.add_argument("--claude-dir", default=None,
                        help="Path to the .claude config dir (default: ~/.claude "
                             "or $CLAUDE_CONFIG_DIR).")
    parser.add_argument("--out", default=None,
                        help="Where to write inventory.json (default: stdout).")
    args = parser.parse_args(argv)

    claude_dir = resolve_claude_dir(args.claude_dir)
    if not claude_dir.is_dir():
        sys.stderr.write("claude dir not found: {}\n".format(claude_dir))
        return 2

    inventory, summary = scan(claude_dir)
    payload = json.dumps(inventory, ensure_ascii=False, indent=2)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(out.suffix + ".tmp")
        tmp.write_text(payload, encoding="utf-8")
        os.replace(str(tmp), str(out))
        sys.stderr.write(summary + "\n")
        print(summary)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
