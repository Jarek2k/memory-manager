import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, ShieldQuestion, ShieldX, Webhook } from "lucide-react";
import type { ParsedHook, ParsedPermission, PermAction, SettingsFile } from "../types";

const ACTION_META: Record<PermAction, { label: string; cls: string; Icon: any }> = {
  deny: { label: "Verboten", cls: "deny", Icon: ShieldX },
  ask: { label: "Nachfragen", cls: "ask", Icon: ShieldQuestion },
  allow: { label: "Ohne Nachfrage erlaubt", cls: "allow", Icon: ShieldCheck },
};

function HookRow({ p }: { p: ParsedHook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sset-row hook">
      <Webhook size={14} className="sset-ico" />
      <div className="sset-body">
        <div className="sset-summary">
          {p.summary || <span className="sset-opaque">Eigener Hook — noch keine Klartext-Zusammenfassung (Befehl ansehen).</span>}
        </div>
        <div className="sset-sub mono">{p.event}{p.matcher ? " · " + p.matcher : ""}{p.decision ? " · " + p.decision : ""}</div>
        <button className="sset-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Befehl {open ? "verbergen" : "anzeigen"}
        </button>
        {open && <pre className="sset-cmd">{p.command}</pre>}
      </div>
    </div>
  );
}

function PermCategory({ cat, perms, defaultOpen }: { cat: string; perms: ParsedPermission[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sset-cat">
      <button className="sset-cat-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {cat} <span className="dim">{perms.length}</span>
      </button>
      {open && perms.map((p, i) => (
        <div key={i} className="sset-row perm">
          <span className="sset-summary">{p.summary}</span>
          <code className="perm-raw">{p.raw}</code>
        </div>
      ))}
    </div>
  );
}

function PermActionGroup({ action, list }: { action: PermAction; list: ParsedPermission[] }) {
  const meta = ACTION_META[action];
  const byCat: Record<string, ParsedPermission[]> = {};
  list.forEach((p) => (byCat[p.category] = byCat[p.category] || []).push(p));
  return (
    <div className="sset-action">
      <div className={"sset-action-head " + meta.cls}><meta.Icon size={13} /> {meta.label} <span className="dim">· {list.length}</span></div>
      {Object.entries(byCat).sort().map(([cat, perms]) => (
        <PermCategory key={cat} cat={cat} perms={perms} defaultOpen={action !== "allow"} />
      ))}
    </div>
  );
}

/** Plain-German summary of a settings.json: hooks (mechanical, with extracted
 * reason) and permissions grouped by deny/ask/allow then category. Raw form
 * stays one click away. Display only — read-only. */
export function SettingsSummary({ s, only }: { s: SettingsFile; only?: "hooks" | "permissions" }) {
  const hooks = s.hooks.flatMap((h) => h.parsed);
  const showHooks = only !== "permissions";
  const showPerms = only !== "hooks";
  const nHooks = showHooks ? hooks.length : 0;
  const nPerms = showPerms ? s.permission_count : 0;
  if (nHooks + nPerms === 0) {
    const msg = !s.parse_ok ? "Datei nicht lesbar (ungültiges JSON)."
      : only === "hooks" ? "Keine Hooks hinterlegt."
      : only === "permissions" ? "Keine Permissions hinterlegt."
      : "Keine Hooks oder Permissions hinterlegt.";
    return <div className="sb-empty">{msg}</div>;
  }
  return (
    <div className="settings-summary">
      {showHooks && hooks.length > 0 && (only === "hooks"
        ? hooks.map((p, i) => <HookRow key={i} p={p} />)
        : (
          <div className="sset-action">
            <div className="sset-action-head hook"><Webhook size={13} /> Hooks <span className="dim">· {hooks.length}</span></div>
            {hooks.map((p, i) => <HookRow key={i} p={p} />)}
          </div>
        ))}
      {showPerms && (["deny", "ask", "allow"] as PermAction[]).map((a) =>
        s.parsed[a].length > 0 ? <PermActionGroup key={a} action={a} list={s.parsed[a]} /> : null
      )}
    </div>
  );
}
