# GUI Build Brief — Claude Memory Manager

**Register: this is a local PRODUCT / TOOL UI — a control panel for managing data. NOT a landing page, no marketing copy, no hero sections.** Think Linear / Figma side-panels / a browser-devtools inspector: dense, dark, fast, keyboard-friendly.

## Stack & runtime (hard constraints)
- **Vite + React** (TypeScript fine). Source in `gui/`, build to **`gui/dist/`** (static).
- **Must run fully offline**: system-font stack only (no Google Fonts / no CDN / no external network at runtime). Bundle any icon set locally (lucide-react is fine, it's bundled).
- Served by a tiny Python static server from `gui/dist/`. Same-origin API (below). SPA routing must work behind a catch-all that serves `index.html`.
- Dark theme. One restrained accent color. Tabular numerals for counts/budget.
- **UI language: German** (labels, tooltips). Code identifiers English.

## Data IN — `GET /inventory.json` (same origin)
A sample is bundled at `public/inventory.json` for `npm run dev`; at runtime the Python server overrides this route with live data. Shape:

```jsonc
{
  "schema_version": 2, "generated_at": "...", "claude_dir": "...",
  "is_real_claude_dir": true,              // false ⇒ show a prominent "SANDBOX" banner
  "budget": { "current_lines": 39, "current_chars": 2231,
              "warn_threshold_lines": 150, "soft_limit_lines": 200,
              "projected_after_pending_lines": 39,
              "always_loaded_files": [{"path":"~/.claude/CLAUDE.md","lines":39,"chars":2231}] },
  "global": {
    "claude_md": {"path":"~/.claude/CLAUDE.md","exists":true,"content":"<full md>","lines":39,"chars":2231},
    "rules": [{"filename":"commit-style.md","path":"~/.claude/rules/commit-style.md","content":"<md>","lines":6,"chars":120,"imported":true}],
    "settings": {"path":"~/.claude/settings.json","rel_path":"~/.claude/settings.json","parse_ok":true,  // or null
                 "permission_count":6,"hook_count":1,
                 "permissions":{"allow":["Bash(git status)"],"deny":[],"ask":["Bash(ssh:*)"]},
                 "hooks":[{"event":"PreToolUse","matcher":"Bash","commands":["<shell>"]}]}
  },
  "insights": [{"kind":"enforceable","severity":"info","message":"...","entry_ids":["..."]}],
  "clusters": [{"cluster_hint_id":"c_1","label_guess":"pnpm","member_ids":["shop::feedback_pnpm","api::feedback_pnpm"],"member_count":3,"project_count":3,"basis":"shared tokens: pnpm"}],
  "projects": [{
    "encoded":"-Users-...","slug":"shop","path":"/Users/.../shop","path_resolved":true,"memory_dir":"...","has_index":true,"entry_count":2,
    "rules":[{"filename":"CLAUDE.md","source":"CLAUDE.md","path":"/Users/.../shop/CLAUDE.md","rel_path":"CLAUDE.md","content":"<full md>","truncated":false,"lines":28,"chars":900,"unicode_flags":[],"editable":false}],  // project's OWN rules, in the repo — VIEW-ONLY
    "settings":{"path":"/Users/.../shop/.claude/settings.json","rel_path":".claude/settings.json","parse_ok":true,"permission_count":12,"hook_count":1,"permissions":{"allow":["Bash(pnpm test:*)"],"deny":[],"ask":[]},"hooks":[{"event":"PreToolUse","matcher":"Bash","commands":["<shell>"]}]}  // or null — VIEW-ONLY hard enforcement
  }],
  "entries": [{
    "id":"shop::feedback_pnpm",          // STABLE join key (= <project_slug>::<filename without .md>)
    "project_encoded":"...","project_slug":"shop","project_path":"...","file":"...","filename":"feedback_pnpm.md",
    "frontmatter_shape":"metadata_block","parse_error":null,
    "name":"pnpm-preference","description":"Immer pnpm","type":"feedback",  // type ∈ user|feedback|project|reference|unknown
    "node_type":"memory","origin_session_id":"abc","lines":9,"chars":612,"mtime":"...","age_days":54,
    "why":"...","how":"...","snippet":"...","sections":["Why","How to apply"],
    "wiki_links":[{"target":"roadmap","resolved":true}],
    "must_flags":[{"phrase":"niemals","line":6}],
    "enforceable_candidate":true, "unicode_flags":[],
    "split_candidate":false, "split_reason":null,
    "stale":false, "has_dangling_links":false, "global_candidate":true,
    "cluster_hint_ids":["c_1"], "previously_declined_promotion":false
  }]
}
```

## Data OUT — `POST /decisions` (same origin), only on "Übernehmen"
Body: `{ "schema_version":1, "submitted_at":"<ISO>", "operations":[ ... ] }`. Operation shapes (omit an entry entirely = keep):
- `{"op":"edit","target_id":"...","new_body":"...","new_description":null}`
- `{"op":"delete","target_id":"...","reason":"..."}`
- `{"op":"split","target_id":"...","keep_as_rule":"...","move_to_filename":"x-log.md","delete_moved":false}`
- `{"op":"promote","source_ids":["..."],"target_topic":"commit-style","global_filename":"commit-style.md","translated_text":"","translated_text_source":"user|claude-please-translate","keep_origin":"leave|annotate|delete","supersedes_global":null}`
- `{"op":"harden_ack","target_id":"...","suggestion_kind":"hook","scope":"global|project","decision":"harden|dismiss"}`
- `{"op":"edit_global","path":"~/.claude/CLAUDE.md","new_content":"<full md>"}`
- `{"op":"delete_global","path":"~/.claude/rules/x.md"}`
- `{"op":"request_user_summary"}`
- `{"op":"ignore","target_id":"...","scope":"promotion","reason":"..."}`

On 200, show "An Claude gesendet — zurück zum Terminal." The browser NEVER writes files; it only POSTs this once.

## ⚠ HARD RULE — no auto-save
Nothing is sent or written while editing. Every edit/delete/promote/split/harden/global-edit adds an entry to a **staged cart** (a visible, removable list). Only the single **„Übernehmen"** button POSTs the cart. Inline editors (e.g. editing CLAUDE.md text) update the cart entry, never the server. A live counter shows N staged changes.

## Views (left nav / tabs)
1. **Übersicht (Graph)** — default. A node graph: **global rules in the center**, project nodes around it, clusters as connecting/sub nodes. Node size ~ memory count. Budget meter prominent in header. Click a project node → Projekt view. (Use a bundled graph lib: React Flow or Cytoscape.)
2. **Projekt** — pick a project (or arrive from graph). Its memories grouped by cluster theme / type as **editable cards** (collapsible, not a dense flat list). Per card: type badge, age, size, why/how, wiki-links, signal badges, and actions `keep · edit · delete · promote · split` + „⚖ härten" (with global/projekt scope toggle). Each edit → cart.
3. **Global** — show the **content** of `CLAUDE.md` + each `rules/*` with the **budget meter** (green <150, amber 150–200, red >200 lines; show current → projected). Editable (textarea) → `edit_global`; delete a rule → `delete_global`; all via the cart.
4. **Über mich** — entries with `type:"user"`. If none, an empty-state with a button **„Zusammenfassen"** → adds `request_user_summary` to the cart.
5. **Regeln** — the rule landscape, distinct from memories. Two clearly separated scopes:
   - **Global (deine, editierbar)**: `global.claude_md` + each `global.rules[]` (machine-local, `~/.claude/…`). Same edit affordances as the Global view (`edit_global` / `delete_global` via cart), budget meter. `imported:false` on a rule → flag „nicht eingebunden (@import fehlt)".
   - **Pro Projekt (read-only)**: iterate `projects[]`; for each with `rules.length` or `settings`, show its `rules[]` (`source` tells where: `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/<f>`) with content preview, and a `settings` indicator (`hooks`/`permissions` counts). **No edit affordances here** — these live in the project repo; make read-only obvious (lock icon, „im Repo · nur lesbar" badge, no edit/delete buttons). Honor `truncated` and `unicode_flags` if present. Group by project; projects with neither rules nor settings can be omitted or shown as „keine eigenen Regeln".
   - Goal: at a glance, what's enforced **globally** vs **only in one project**. Good navigation between global and per-project scope is up to you — a scope switch / two-pane / grouped list, whatever reads cleanest as a tool.
- Plus an **Insights** panel (render `insights[]`, clickable to filter to the referenced entries) and a **Cluster/Themen** view (cross-project promotion candidates → „als 1 globale Regel" bulk action).

## Cross-cutting
- **Filter bar**: free-text search (over name/description/why/how) + **tri-state facet chips** (ist / ist nicht / egal) for `type`, signal (enforceable/split/unicode/stale/dangling/global_candidate), project, cluster → must support "ohne Signal X" and "ganz ohne Signale". Sort by age/size/project/type.
- **Signale** (renamed from "flags"), each with a tooltip: ⚖ *sollte erzwungen werden* (enforceable_candidate), ✂ *zu lang / Log-Ballast* (split_candidate), ⚠ *Sicherheitsprüfung* (unicode_flags), 🕸 *verwaiste Verweise* (has_dangling_links), 🕰 *alt* (stale), 🌐 *Global-Kandidat* (global_candidate).
- **Tooltips/explanations** on every action and filter (short German helper text).
- **SANDBOX banner** when `is_real_claude_dir === false`.
- Dimmed style for `previously_declined_promotion` entries.

Keep it calm, legible, and obviously a tool. No marketing tone anywhere.
