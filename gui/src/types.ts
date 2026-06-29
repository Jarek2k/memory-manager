export type EntryType = "user" | "feedback" | "project" | "reference" | "unknown";

export interface WikiLink { target: string; resolved: boolean; }
export interface MustFlag { phrase: string; line: number; }
export interface UnicodeFlag { codepoint?: string; token?: string; severity: string; reason: string; line?: number; }

export interface Entry {
  id: string;
  project_encoded: string;
  project_slug: string;
  project_path: string;
  file: string;
  filename: string;
  frontmatter_shape: string;
  parse_error: string | null;
  name: string;
  description: string;
  type: EntryType;
  node_type: string;
  origin_session_id: string;
  lines: number;
  chars: number;
  mtime: string;
  age_days: number;
  why: string;
  how: string;
  snippet: string;
  sections: string[];
  wiki_links: WikiLink[];
  must_flags: MustFlag[];
  enforceable_candidate: boolean;
  unicode_flags: UnicodeFlag[];
  split_candidate: boolean;
  split_reason: string | null;
  stale: boolean;
  has_dangling_links: boolean;
  global_candidate: boolean;
  cluster_hint_ids: string[];
  previously_declined_promotion: boolean;
}

export interface ProjectRule {
  filename: string; source: string; path: string; rel_path: string;
  content: string; truncated: boolean; lines: number; chars: number;
  unicode_flags: UnicodeFlag[]; editable: false;
}
export type PermAction = "allow" | "deny" | "ask";
export interface ParsedPermission {
  raw: string; tool: string; target: string; mode: "glob" | "exact";
  category: string; action: PermAction; summary: string;
}
export interface ParsedHook {
  event: string; matcher: string; command: string;
  decision: string | null; reason: string | null; grep_patterns: string[];
  summary: string | null; summary_source: "reason" | "template" | "claude-please-summarize";
}
export interface SettingsHook { event: string; matcher: string; commands: string[]; parsed: ParsedHook[]; }
export interface SettingsPermissions { allow: string[]; deny: string[]; ask: string[]; }
export interface SettingsFile {
  path: string; rel_path: string; parse_ok: boolean;
  raw: string;
  permission_count: number; hook_count: number;
  permissions: SettingsPermissions;
  parsed: { allow: ParsedPermission[]; deny: ParsedPermission[]; ask: ParsedPermission[] };
  hooks: SettingsHook[];
}
export interface Project {
  encoded: string; slug: string; path: string; path_resolved: boolean;
  memory_dir: string; has_index: boolean; entry_count: number;
  rules: ProjectRule[]; settings: SettingsFile | null;
}

export interface Cluster {
  cluster_hint_id: string; label_guess: string; member_ids: string[];
  member_count: number; project_count: number; basis: string;
}

export interface Budget {
  always_loaded_files: { path: string; lines: number; chars: number }[];
  current_lines: number; current_chars: number;
  warn_threshold_lines: number; soft_limit_lines: number;
  projected_after_pending_lines: number;
}

export interface GlobalFile { path: string; content: string; lines: number; chars: number; exists?: boolean; }
export interface GlobalRuleFile extends GlobalFile { filename: string; imported: boolean; }
export interface GlobalSection { claude_md: GlobalFile; rules: GlobalRuleFile[]; settings: SettingsFile | null; }

export interface Insight { kind: string; severity: "info" | "warn"; message: string; entry_ids?: string[]; }

export interface Inventory {
  schema_version: number;
  generated_at: string;
  claude_dir: string;
  is_real_claude_dir: boolean;
  budget: Budget;
  global: GlobalSection;
  insights: Insight[];
  clusters: Cluster[];
  projects: Project[];
  entries: Entry[];
}

/* ---- decisions ---- */
export type KeepOrigin = "leave" | "annotate" | "delete";

export type CartItem =
  | { key: string; kind: "edit"; id: string; new_body: string }
  | { key: string; kind: "delete"; id: string; reason: string }
  | { key: string; kind: "split"; id: string; keep_as_rule: string; move_to_filename: string; delete_moved: boolean }
  | { key: string; kind: "promote"; id: string; source_ids: string[]; target_topic: string; global_filename: string; translated_text: string; keep_origin: KeepOrigin; supersedes_global: string | null }
  | { key: string; kind: "harden"; id: string; scope: "global" | "project"; suggestion_kind: string }
  | { key: string; kind: "edit_global"; path: string; new_content: string; estLines: number }
  | { key: string; kind: "delete_global"; path: string }
  | { key: string; kind: "edit_settings"; path: string; new_content: string; scope: "global" | "project"; summary: string }
  | { key: string; kind: "user_summary" };

export type Operation = Record<string, unknown> & { op: string };
