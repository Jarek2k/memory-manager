import type { PermAction } from "../types";

/** Pure helpers that edit a settings.json *text* losslessly: parse → mutate the
 * permissions/hooks → re-serialize. Other keys are preserved. The browser only
 * produces the new text; apply.py validates + writes it behind the diff-gate. */

type Hook = { type?: string; command?: string; timeout?: number; [k: string]: unknown };
type HookGroup = { matcher?: string; hooks?: Hook[]; [k: string]: unknown };
type SettingsObj = {
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[]; [k: string]: unknown };
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
};

export function parseSettings(working: string): SettingsObj {
  try {
    const o = JSON.parse(working || "{}");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function serializeSettings(o: SettingsObj): string {
  return JSON.stringify(o, null, 2) + "\n";
}

function perms(o: SettingsObj) {
  if (!o.permissions || typeof o.permissions !== "object") o.permissions = {};
  return o.permissions as Record<PermAction, string[]>;
}

/** Remove one permission pattern from a given action list. */
export function deletePermission(working: string, action: PermAction, raw: string): string {
  const o = parseSettings(working);
  const p = perms(o);
  p[action] = (p[action] ?? []).filter((x) => x !== raw);
  return serializeSettings(o);
}

/** Add one permission pattern to an action list (no-op if already present). */
export function addPermission(working: string, action: PermAction, raw: string): string {
  const o = parseSettings(working);
  const p = perms(o);
  if (!(p[action] ?? []).includes(raw)) p[action] = [...(p[action] ?? []), raw];
  return serializeSettings(o);
}

/** Move one permission pattern from one action list to another (idempotent on no-op). */
export function movePermission(working: string, from: PermAction, to: PermAction, raw: string): string {
  if (from === to) return working;
  const o = parseSettings(working);
  const p = perms(o);
  p[from] = (p[from] ?? []).filter((x) => x !== raw);
  if (!(p[to] ?? []).includes(raw)) p[to] = [...(p[to] ?? []), raw];
  return serializeSettings(o);
}

/** Remove one hook (by event/matcher/command); drops a group left with no hooks. */
export function deleteHook(working: string, event: string, matcher: string, command: string): string {
  const o = parseSettings(working);
  const hooks = o.hooks;
  const arr = hooks?.[event];
  if (Array.isArray(arr)) {
    hooks![event] = arr
      .map((grp) =>
        grp && typeof grp === "object" && String(grp.matcher ?? "") === matcher && Array.isArray(grp.hooks)
          ? { ...grp, hooks: grp.hooks.filter((h) => String(h?.command ?? "") !== command) }
          : grp,
      )
      .filter((grp) => !(grp && Array.isArray(grp.hooks) && grp.hooks.length === 0));
  }
  return serializeSettings(o);
}

/** Find the full hook object (with type/timeout/…) for an event/matcher/command. */
export function findHook(working: string, event: string, matcher: string, command: string): Hook | null {
  const arr = parseSettings(working).hooks?.[event];
  if (!Array.isArray(arr)) return null;
  for (const grp of arr) {
    if (String(grp?.matcher ?? "") !== matcher) continue;
    for (const h of grp?.hooks ?? []) if (String(h?.command ?? "") === command) return h;
  }
  return null;
}

/** Add a hook object under event/matcher, merging into an existing matcher group;
 * skips an exact-command duplicate. Used to lift (promote) a project hook to global. */
export function addHook(working: string, event: string, matcher: string, hook: Hook): string {
  const o = parseSettings(working);
  if (!o.hooks || typeof o.hooks !== "object") o.hooks = {};
  const arr = Array.isArray(o.hooks[event]) ? o.hooks[event]! : (o.hooks[event] = []);
  let grp = arr.find((g) => g && typeof g === "object" && String(g.matcher ?? "") === matcher);
  if (!grp) { grp = { matcher, hooks: [] }; arr.push(grp); }
  if (!Array.isArray(grp.hooks)) grp.hooks = [];
  if (!grp.hooks.some((h) => String(h?.command ?? "") === String(hook.command ?? ""))) grp.hooks.push(hook);
  return serializeSettings(o);
}

/** Current grouping of permission patterns by action, read from the working text. */
export function currentPerms(working: string): Record<PermAction, string[]> {
  const p = perms(parseSettings(working));
  return {
    deny: Array.isArray(p.deny) ? p.deny : [],
    ask: Array.isArray(p.ask) ? p.ask : [],
    allow: Array.isArray(p.allow) ? p.allow : [],
  };
}

/** Current hooks as flat rows read from the working text. */
export function currentHooks(working: string): { event: string; matcher: string; command: string }[] {
  const o = parseSettings(working);
  const out: { event: string; matcher: string; command: string }[] = [];
  const hooks = o.hooks;
  if (hooks && typeof hooks === "object") {
    for (const [event, arr] of Object.entries(hooks)) {
      if (!Array.isArray(arr)) continue;
      for (const grp of arr) {
        const matcher = String(grp?.matcher ?? "");
        for (const h of grp?.hooks ?? []) {
          if (h?.command) out.push({ event, matcher, command: String(h.command) });
        }
      }
    }
  }
  return out;
}
