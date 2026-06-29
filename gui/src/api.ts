import type { CartItem, Inventory, Operation } from "./types";

export async function fetchInventory(): Promise<Inventory> {
  const res = await fetch("inventory.json", { cache: "no-store" });
  if (!res.ok) throw new Error("inventory.json: HTTP " + res.status);
  return res.json();
}

export type SessionPhase = "curating" | "submitted" | "processing" | "awaiting_terminal" | "done" | "closing";
export interface ApplyResultFile { path: string; action?: string; kind?: string; why?: string; }
export interface ApplyResult { generated_at: string; applied: ApplyResultFile[]; skipped: ApplyResultFile[]; backup_dir: string; }
export interface SessionStatus { phase: SessionPhase; message: string; server: "running" | "closing"; result: ApplyResult | null; }

/** Poll the live status the skill writes as it stages/commits in the terminal. */
export async function fetchStatus(): Promise<SessionStatus> {
  const res = await fetch("status", { cache: "no-store" });
  if (!res.ok) throw new Error("status: HTTP " + res.status);
  return res.json();
}

/** "Fertig" — ask the server to drop the close sentinel and shut the session. */
export async function postClose(): Promise<void> {
  await fetch("close", { method: "POST" });
}

export function cartToOperations(items: CartItem[]): Operation[] {
  const ops: Operation[] = [];
  for (const it of items) {
    switch (it.kind) {
      case "edit":
        ops.push({ op: "edit", target_id: it.id, new_body: it.new_body, new_description: null });
        break;
      case "delete":
        ops.push({ op: "delete", target_id: it.id, reason: it.reason });
        break;
      case "split":
        ops.push({ op: "split", target_id: it.id, keep_as_rule: it.keep_as_rule, move_to_filename: it.move_to_filename, delete_moved: it.delete_moved });
        break;
      case "promote":
        ops.push({
          op: "promote", source_ids: it.source_ids, target_topic: it.target_topic,
          global_filename: it.global_filename, translated_text: it.translated_text,
          translated_text_source: it.translated_text.trim() ? "user" : "claude-please-translate",
          keep_origin: it.keep_origin, supersedes_global: it.supersedes_global,
        });
        break;
      case "harden":
        ops.push({ op: "harden_ack", target_id: it.id, suggestion_kind: it.suggestion_kind, scope: it.scope, decision: "harden" });
        break;
      case "edit_global":
        ops.push({ op: "edit_global", path: it.path, new_content: it.new_content });
        break;
      case "delete_global":
        ops.push({ op: "delete_global", path: it.path });
        break;
      case "edit_settings":
        ops.push({ op: "edit_settings", path: it.path, new_content: it.new_content });
        break;
      case "user_summary":
        ops.push({ op: "request_user_summary" });
        break;
    }
  }
  // a promote that merges several sources supersedes individual ops on those ids
  const merged = new Set<string>();
  for (const it of items) if (it.kind === "promote" && it.source_ids.length > 1) it.source_ids.forEach((s) => merged.add(s));
  return ops.filter((o) => {
    if ((o.op === "edit" || o.op === "delete" || o.op === "split") && merged.has(o.target_id as string)) {
      // keep — an entry can be promoted-as-merge AND separately edited; only drop exact duplicates
    }
    return true;
  });
}

export async function postDecisions(items: CartItem[]): Promise<number> {
  const operations = cartToOperations(items);
  const payload = { schema_version: 1, submitted_at: new Date().toISOString(), operations };
  const res = await fetch("decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return operations.length;
}
