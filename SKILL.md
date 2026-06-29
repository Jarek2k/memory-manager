---
name: memory-manager
description: >
  Use when the user wants to review, curate, or clean up Claude Code's
  per-project auto-memory across all projects in one place — and especially to
  PROMOTE recurring project learnings into authored global rules under
  ~/.claude/rules/. Triggers include: "manage my memory", "review claude
  memory", "memory overview", "promote a learning to global", "curate
  memories", "Memory aufräumen", "globale Regel aus Memory machen",
  "Memory-Überblick". Opens a local browser GUI for curation; Claude applies
  the chosen changes to the files with diffs.
version: 0.5.0
allowed-tools: [Bash, Read, Edit, Write]
---

# Memory Manager

Cross-project overview and curation for Claude Code auto-memory. A deterministic
scanner builds an inventory, a **persistent** localhost session lets the user
curate in repeated cycles, and **you (Claude) apply the resulting decisions to the
files with diffs**. The browser never writes files; it shows your live progress and
the result of each apply, and the user decides when to stop.

Pipeline (looped): `scan.py → inventory.json → GUI → decisions.json → you apply →
result.json → re-scan → …` until the user clicks „Fertig".

## Key facts you must respect

- Auto-memory lives at `<claude-dir>/projects/<encoded>/memory/`. The encoded
  name is the project path with `/`→`-`. It is machine-local, per-project. There
  is **no** global auto-memory.
- "Global" rules are *authored* files under `~/.claude/rules/<topic>.md`, wired
  into `~/.claude/CLAUDE.md` via `@rules/<topic>.md` imports. These load **every
  session**, so keep them lean (warn ≥150 lines, soft limit 200).
- Promoting is a **translation**, not a copy: turn a past-tense observation
  ("User hat pnpm bevorzugt") into a deliberate imperative rule ("Immer pnpm
  statt npm verwenden").
- Hard "must/never" rules belong in deterministic enforcement (hooks /
  permissions / CI), not soft memory. The scanner flags these; on a `harden` op
  you compose the hook and `apply.py` writes it to `settings.json` — but ONLY
  through the diff-gate (stage → per-file confirm → commit), never silently.
- Per-project dedup/cleanup is handled natively by AutoDream; do not replicate
  it. This tool's job is the cross-project overview and promotion.
- The scan also surfaces **rules & enforcement read-only**: a project's own
  `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/*` under `projects[].rules`,
  and both project and global `settings.json` *content* — the actual permission
  patterns (allow/deny/ask) and hook commands — under `projects[].settings` and
  `global.settings` (inventory `schema_version` 2; settings carry `raw` so the GUI
  can edit + re-serialize losslessly). The GUI orders Global by enforcement power
  (**Hooks → Permissions → Regeln → Über mich**) and colors every concept type the
  same everywhere (hook=violet, permission=teal, rule=gold, memory=blue), so a hook
  and a rule are distinguishable at a glance. **soft rules** (prose, loaded as
  context) vs **hard enforcement** (permissions + hooks, mechanical) stay distinct.
  Hooks & permissions are **editable** (delete an entry, drag a permission between
  allow/ask/deny) for **both global and project** `settings.json` via the
  `edit_settings` op — the GUI builds the new file text, `apply.py` validates it as
  JSON + path-guards it, and it is written ONLY through the diff-gate. Project prose
  rules stay read-only (the only project write is `settings.json` and `MEMORY.md`).

**Safety invariant (non-negotiable, confirmed by the user):** NOTHING is ever
written automatically — not memory, not `rules/`, not `CLAUDE.md`, not
`settings.json`. The **diff-gate now lives in the browser**: "Prüfen & freigeben"
shows every staged change as a domain-aware **semantic** summary plus an expandable
**word-level text diff**, approved per file; only approved changes are POSTed. The
browser still **never writes** — `apply.py` is the only writer, and stays the
**backstop**: `--stage` never writes and re-checks each file against the scan
snapshot the user approved against (flagging `drift` if it changed on disk),
`--commit` backs up then writes only the approved, non-drifted, non-blocked files.

**Safe trying-out:** to experiment without risking real projects, build a
throwaway sandbox first and point everything at it:
```bash
SANDBOX=$(python3 "$SKILL_DIR/scripts/sandbox.py" --make)        # copy of ~/.claude
# or: --synthetic for fully fake data
```
Then use `--claude-dir "$SANDBOX"` in scan/apply below. The GUI shows a SANDBOX
banner whenever it isn't pointed at the real `~/.claude`.

## Step 1 — set up paths and the run directory

```bash
SKILL_DIR="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")" && pwd)}"   # plugin: ${CLAUDE_PLUGIN_ROOT}; else dir of this SKILL.md
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
RUN="${TMPDIR:-/tmp}/cc-memory-manager/$(date +%s)-$$"
mkdir -p "$RUN/backup"
echo "RUN=$RUN  CLAUDE_DIR=$CLAUDE_DIR"
```

`${CLAUDE_PLUGIN_ROOT}` is set when this runs as an installed plugin and points at
the plugin folder. If you run this as a manual (non-plugin) skill that variable is
unset and the `dirname "$0"` fallback is unreliable inside `bash -c` — so set
`SKILL_DIR` explicitly to the absolute path of the folder you read this SKILL.md
from. Either way `scripts/` and `gui/` are siblings of this file.

## Step 2 — scan (deterministic, read-only)

```bash
python3 "$SKILL_DIR/scripts/scan.py" --claude-dir "$CLAUDE_DIR" --out "$RUN/inventory.json"
```

Read the one-line summary it prints (projects, memories, clusters, flags,
budget). If 0 memories, tell the user there's nothing to curate and stop.

### Step 2b — plain-German summaries for opaque hooks (optional)

`scan.py` already produces a German `summary` for every permission and for any
hook that embeds a `permissionDecisionReason` or matches a known pattern. Only
genuinely opaque hooks are left with `summary: null` and
`summary_source: "claude-please-summarize"`. If (and only if) any exist, read
those hooks' raw `command` strings from `inventory.json` and write a one-sentence
German `summary` back into each such hook's `parsed[]` entry **in
`inventory.json` itself** (display metadata only — never touch `settings.json`).
Skip this step entirely when there are none (the common case). This is the only
place Claude edits the inventory; it changes nothing in the write path.

## Step 3 — start the session server (background) and open it

The GUI is a prebuilt static Vite app under `gui/dist/`. If it's missing (fresh
clone), build it once: `cd "$SKILL_DIR/gui" && npm install && npm run build`
(needs Node; only required to build, not to run).

The server is **persistent**: it stays up across many submit→apply cycles so the
user can keep curating without a restart. It self-closes after 30 min idle, or when
the user clicks **„Fertig"** (which drops `$RUN/close.signal` and stops it).

```bash
python3 "$SKILL_DIR/scripts/serve.py" --run-dir "$RUN" --gui-dir "$SKILL_DIR/gui/dist" \
  --port 0 --idle-timeout 1800 --pidfile "$RUN/server.pid" > "$RUN/server.log" 2>&1 &
```

Run this with `run_in_background`. Then read the chosen URL and open it:

```bash
sleep 1
URL=$(grep -m1 '^URL ' "$RUN/server.log" | awk '{print $2}')
echo "$URL"
open "$URL"     # macOS; use xdg-open on Linux
```

Tell the user: the overview is open in their browser; curate there and click
**„Prüfen & freigeben ▶"** to hand a batch to you. While you apply it the browser
shows a live status strip; afterwards a result panel with **„Weiter bearbeiten"**
(keep going — no restart) and **„Fertig"** (end the session). A topbar **„Beenden"**
button can stop the session at any time, not only from the result panel.

## Step 4 — the session loop (wait for the next submission)

From here on you **loop**: wait for a submission, apply it (Steps 5–7b), report the
result, then wait again — until the user finishes. Run this **foreground**; it
blocks until something lands (max 30 min):

```bash
ready=
for i in $(seq 1 1800); do
  [ -f "$RUN/close.signal" ]   && { ready=close; break; }
  [ -f "$RUN/decisions.json" ] && { ready=cycle; break; }
  sleep 1
done
echo "${ready:-idle}"
```

- `cycle` → a fresh submission is waiting in `$RUN/decisions.json`. Do **one** apply
  cycle (Steps 5–7b), then run this wait again for the next batch.
- `close` → the user clicked „Fertig" (or the idle watchdog dropped `close.signal`).
  Leave the loop → Step 8 (end the session).
- `idle` → 30 min with no submission. Treat like `close`.

At the **start of each cycle**, clear the previous result and flip the browser's
status strip to "processing":

```bash
rm -f "$RUN/result.json"
python3 "$SKILL_DIR/scripts/serve.py" --run-dir "$RUN" --set-status processing \
  --message "Claude bereitet die Änderungen vor …"
```

## Step 5 — judgement: fill in the decisions

Read `$RUN/decisions.json`. **Nothing is written in this step.** First do the
work only you can do, writing the results back into the ops in `decisions.json`:

- **promote** with `translated_text_source:"claude-please-translate"` → translate
  the source memory/memories into a lean, present-tense, imperative rule and put
  it in `translated_text` (the applier *skips* empty translations on purpose).
  Run the duplicate check (grep `~/.claude/rules/*.md` + `~/.claude/CLAUDE.md`);
  if a rule already covers it, set `supersedes_global` and merge the wording.
- **split** with empty `keep_as_rule` → choose the durable-vs-log boundary and
  fill `keep_as_rule`.
- **harden_ack** with `decision:"harden"` → **compose the actual hook** and add a
  `hook` object to the op: `{"matcher":"Bash","command":"<jq inspection>","timeout":10}`.
  Model the command on the existing ssh/scp hook in `<claude-dir>/settings.json`:
  inspect `.tool_input.command`, grep a pattern derived from the rule (e.g.
  `git .* push` for "never push autonomously"), and emit a `permissionDecision`
  of `ask` (or `deny`) with a German reason. `scope` (`global`/`project`) picks
  the target settings.json. The memory itself is left intact (hardening ≠ delete).
  The composed command relies on `jq` at runtime — if `jq` is not on the user's
  PATH the hook silently won't fire, so warn them to install it when you harden.
- **request_user_summary** → no fields to fill; in this step **author a concise
  "about me" draft** from the user's memories + `CLAUDE.md` and turn it into an
  `edit_global` op writing `~/.claude/rules/about-me.md` (or a `type:user` memory),
  so it flows through the normal stage→confirm gate. Show the draft as a diff.
- **edit_global / delete_global** need no judgement — they carry the path and (for
  edit) the new content from the GUI; the applier handles them mechanically.
- **edit_settings** (global or project `settings.json`) also needs no judgement: the
  GUI sends the full new file text; `apply.py` rejects a non-allowed path or invalid
  JSON, sanitizes, and stages it for the diff-gate. Just show the diff like any file.

## Step 6 — stage (compute changes, still no writes)

```bash
python3 "$SKILL_DIR/scripts/apply.py" --claude-dir "$CLAUDE_DIR" --run-dir "$RUN" --stage
rm -f "$RUN/decisions.json"   # consumed — so the next POST is detected as fresh
```

`--stage` writes the proposed final content of every touched file to `$RUN/staged/`
and a `$RUN/manifest.json` describing each change (`create`/`modify`/`delete`,
kind, explanation, `blocked`, `drift`). `safety.sanitize()` runs here; a
BLOCK-Unicode file is marked `blocked` and must not be committed. Each settings/
global change is re-checked against the scan snapshot the user approved against;
if the file changed on disk since, the change is flagged `drift`. `--stage` is the
last step that reads `decisions.json`, so remove it now — the wait loop in Step 4
keys off a fresh one for the next cycle.

## Step 7 — the browser already gated; commit, re-confirm only the exceptions

The GUI submits **only the changes the user approved** in its in-browser diff gate
(semantic + exact word diff, per file). So do **not** re-run a full per-file text
gate. Read `$RUN/manifest.json` and split it:

- **Auto-committable** — changes with no `drift` and no `blocked` whose final
  content came straight from the GUI (`edit`, `delete`, `edit_global`,
  `delete_global`, `edit_settings`, and `promote`/`split` where the user supplied
  the text). Commit these directly — no per-file prompt; the user already approved
  them graphically. Give a one-line summary per file.
- **Needs your diff + an explicit yes** — any change flagged `drift` (file changed
  on disk since the approved scan) or `blocked` (BLOCK-Unicode), **and** any op where
  *you* composed the final text after submit (`promote` with empty `translated_text`,
  `harden`'s hook block, `request_user_summary`, `split` with no boundary). The
  browser couldn't show those final bytes — show `diff -u`, explain, and get a yes.

When (and only when) you need such a terminal confirmation, set the strip first so
the browser tells the user to look at the terminal — otherwise it just spins:

```bash
python3 "$SKILL_DIR/scripts/serve.py" --run-dir "$RUN" --set-status awaiting_terminal \
  --message "Claude wartet auf deine Bestätigung im Terminal."
diff -u "<original path>" "$RUN/staged/<staged name>"   # drift / judgment ops only
cat "$RUN/staged/<staged name>"                          # create (new file)
```

Then commit the auto-committable plus any user-confirmed paths (backs up originals
first, writes atomically, appends the audit log, and writes `$RUN/result.json`):

```bash
python3 "$SKILL_DIR/scripts/apply.py" --claude-dir "$CLAUDE_DIR" --run-dir "$RUN" \
  --commit --only "<path 1>" "<path 2>" ...
# or, if nothing is drift/blocked/judgment: --commit --all
```

If the whole batch is auto-committable (the common case — editing permissions,
hooks or rules), this is a single commit with a short summary and no back-and-forth.
`--commit` also writes `$RUN/result.json` (applied / skipped / backup dir); the
browser's result panel reads it. Several commits in one cycle accumulate into it.

## Step 7b — re-scan and close the cycle

After committing, refresh the inventory so „Weiter bearbeiten" shows the new state,
then flip the strip to `done` (the browser surfaces the result panel):

```bash
python3 "$SKILL_DIR/scripts/scan.py" --claude-dir "$CLAUDE_DIR" --out "$RUN/inventory.json"
python3 "$SKILL_DIR/scripts/serve.py" --run-dir "$RUN" --set-status done \
  --message "Übernommen — Ergebnis im Browser. Weiter bearbeiten oder Fertig."
```

Then **go back to Step 4** and wait for the next submission. (If new opaque hooks
appear, redo Step 2b on the fresh inventory; usually nothing to do.)

Operation semantics the applier implements (the contract): **edit** replaces the
body below the frontmatter; **delete** removes the file + its `MEMORY.md` bullet;
**split** keeps the durable rule and moves the dated logs to `move_to_filename`;
**promote** writes `~/.claude/rules/<file>` + idempotent `@import`; **harden**
merges a `PreToolUse` hook into the chosen settings.json; **edit_global** rewrites
`CLAUDE.md` or a `rules/*` file (path-guarded to those only); **delete_global**
removes a `rules/*` file and unwires its `@import` from `CLAUDE.md`; **edit_settings**
rewrites a `settings.json` (global or a known project's) from GUI-supplied text,
rejecting non-allowed paths and invalid JSON before staging.

### What the applier does for a promote (mechanical — done at `--stage`)

`apply.py` writes the rule text (your verbatim `translated_text`, sanitized) to
`~/.claude/rules/<global_filename>` with a `<!-- promoted YYYY-MM-DD from: ... -->`
provenance comment, wires `@rules/<file>` into `~/.claude/CLAUDE.md` **idempotently**
inside a `BEGIN/END memory-manager imports` block, and handles the origin per
`keep_origin` (`leave`/`annotate`/`delete`). Multiple `source_ids` collapse into
ONE rule file. Your job (Step 5) is only the judgement: the translation, the
duplicate check, and choosing the merge when a rule already exists.

### Safety sanitizer

`apply.py` runs `safety.sanitize()` on every promoted/edited body automatically:
it strips invisible Unicode, normalizes, and **aborts a promotion** whose text
contains BLOCK-class smuggling characters (Unicode Tags, bidi overrides, zero-
width) rather than writing tampered content into an always-loaded file. If you
want to pre-check a snippet by hand: `python3 "$SKILL_DIR/scripts/safety.py" <file>`.

## Step 8 — end the session (only on `close` / `idle`)

Reached when the Step 4 wait returned `close` or `idle`. The server already stopped
itself (it shuts down on `close.signal` and on idle-out). Make sure it's gone:

```bash
kill "$(cat "$RUN/server.pid")" 2>/dev/null || true
```

Leave `$RUN` in place — it holds the backups. Report its path.

## Step 9 — summary

`apply.py --commit` already appended the audit log
(`<claude-dir>/memory-manager/audit.jsonl`, one line per applied/declined/blocked
change — the next scan reads it to dim already-declined promotions).

Give a terse German summary covering **all cycles** of the session: what was
edited/deleted/split/promoted/hardened across the session, the new global budget
(lines vs. 200), the backup path, and any skipped/blocked files. Offer a commit if
the touched files are in a git repo (auto-memory under `~/.claude` usually is not).

## Re-runs

Stateless: every invocation re-scans from disk. Don't build a sync engine. The
audit log only annotates; it never gates what is shown.
