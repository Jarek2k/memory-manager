#!/usr/bin/env python3
"""Build a throwaway sandbox Claude config dir for safe experimentation.

No flag (or `--make`) copies the real
`~/.claude/{CLAUDE.md, settings.json, projects/*/memory}` into
`$TMPDIR/cc-memory-manager/sandbox-claude/`. `--synthetic` generates fully fake
data instead (no private content). Either way you then run scan/serve/apply with
`--claude-dir <printed path>` so EVERY write lands in the copy and the real
`~/.claude` is never touched.

The printed path goes to **stdout** (capture it with `$(...)`); progress goes to
stderr. Always check the captured path is non-empty before using it as
`--claude-dir` — an empty value makes scan/apply silently target the real
`~/.claude`.

The source is only ever READ from. Stdlib only, Python 3.9 compatible.
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def sandbox_base():
    return Path(os.environ.get("TMPDIR", "/tmp")) / "cc-memory-manager"


def _fresh(dest):
    base = sandbox_base().resolve()
    d = dest.resolve()
    # Safety: only ever remove inside our tmp base.
    if d == base or base in d.parents:
        if d.exists():
            shutil.rmtree(str(d))
    d.mkdir(parents=True, exist_ok=True)
    return d


def make_copy(source, dest):
    dest = _fresh(dest)
    for name in ("CLAUDE.md", "settings.json"):
        s = source / name
        if s.is_file():
            shutil.copy2(str(s), str(dest / name))
    proj = source / "projects"
    if proj.is_dir():
        for child in sorted(proj.iterdir()):
            mem = child / "memory"
            if mem.is_dir():
                d = dest / "projects" / child.name / "memory"
                d.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(str(mem), str(d))
    return dest


_SYNTH = {
    "-Users-demo-dev-shop": {
        "MEMORY.md": "# Memory Index\n- [pnpm](feedback_pnpm.md) — pnpm statt npm\n"
                     "- [commit](feedback_commit.md) — Commit-Stil\n",
        "feedback_pnpm.md": "---\nname: pnpm-preference\ndescription: Immer pnpm\n"
                            "metadata:\n  type: feedback\n---\n\nNutzer bevorzugt pnpm.\n\n"
                            "**Why:** Lockfile.\n**How to apply:** Niemals npm, immer pnpm.\n",
        "feedback_commit.md": "---\nname: commit-style\ndescription: Subject-only Commits\n"
                              "metadata:\n  type: feedback\n---\n\nCommit nur Subject-Line, kein Body.\n",
    },
    "-Users-demo-dev-api": {
        "MEMORY.md": "# Memory Index\n- [pnpm](feedback_pnpm.md) — pnpm\n- [log](project_log.md) — Log\n",
        "feedback_pnpm.md": "---\nname: pnpm-too\ndescription: pnpm im Backend\n"
                            "metadata:\n  type: feedback\n---\n\nAuch hier pnpm. Siehe [[fehlt-nicht]].\n",
        "project_log.md": "---\nname: api-log\ntype: project\n---\n\nDauerregel: API v2.\n\n"
                          + "## Testlauf 2026-01-05 durchgeführt\n" + "".join(
                              "- log {}\n".format(i) for i in range(40))
                          + "## Testlauf 2026-02-10 durchgeführt\n" + "".join(
                              "- log {}\n".format(i) for i in range(40)),
    },
    "-Users-demo-dev-mobile": {
        "MEMORY.md": "# Memory Index\n- [pnpm](feedback_pnpm.md) — pnpm\n",
        "feedback_pnpm.md": "---\nname: pnpm-mobile\ndescription: pnpm mobil\n"
                            "metadata:\n  type: feedback\n---\n\nDrittes Projekt: pnpm. Niemals npm verwenden.\n",
    },
}


def make_synthetic(dest):
    dest = _fresh(dest)
    (dest / "CLAUDE.md").write_text(
        "# Persönliche Präferenzen (synthetisch)\n- Antworte knapp.\n- pnpm statt npm.\n",
        encoding="utf-8")
    (dest / "settings.json").write_text(json.dumps({
        "permissions": {
            "allow": [
                "Bash(git status:*)", "Bash(git diff:*)", "Bash(pnpm test:*)",
                "mcp__playwright__browser_navigate", "mcp__playwright__browser_click",
            ],
            "ask": ["Bash(ssh:*)", "Bash(scp:*)", "Bash(rm:*)"],
            "deny": ["Bash(curl:*)"],
        },
        "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
            {"type": "command", "command": "demo-existing-guard", "timeout": 10}]}]},
    }, indent=2), encoding="utf-8")
    for enc, files in _SYNTH.items():
        mem = dest / "projects" / enc / "memory"
        mem.mkdir(parents=True, exist_ok=True)
        for fn, content in files.items():
            (mem / fn).write_text(content, encoding="utf-8")
    return dest


def main(argv=None):
    p = argparse.ArgumentParser(description="Build a throwaway sandbox Claude dir.")
    p.add_argument("--make", action="store_true",
                   help="copy real ~/.claude into the sandbox (this is the default mode; "
                        "accepted explicitly so the documented `--make` invocation works)")
    p.add_argument("--synthetic", action="store_true",
                   help="generate fake data instead of copying real ~/.claude")
    p.add_argument("--source", default=None, help="source claude dir (default ~/.claude)")
    p.add_argument("--out", default=None, help="sandbox path (default $TMPDIR/cc-memory-manager/sandbox-claude)")
    args = p.parse_args(argv)

    dest = Path(args.out).expanduser() if args.out else (sandbox_base() / "sandbox-claude")
    if args.synthetic:
        dest = make_synthetic(dest)
        kind = "synthetisch"
    else:
        source = Path(args.source).expanduser() if args.source else (Path.home() / ".claude")
        if not source.is_dir():
            sys.stderr.write("source not found: {}\n".format(source))
            return 2
        dest = make_copy(source, dest)
        kind = "Kopie von {}".format(source)
    n = len(list((dest / "projects").glob("*/memory"))) if (dest / "projects").is_dir() else 0
    sys.stderr.write("Sandbox ({}) angelegt: {} Projekte mit Memory\n".format(kind, n))
    print(str(dest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
