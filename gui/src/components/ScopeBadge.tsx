import { Globe, Lock, Pencil } from "lucide-react";
import { Tooltip } from "./Tooltip";

export type Scope = "global" | "project-repo" | "memory";

const META: Record<Scope, { label: string; tip: string; cls: string; Icon: any }> = {
  global: {
    label: "gilt überall · editierbar",
    cls: "global",
    Icon: Globe,
    tip: "Liegt in ~/.claude, lädt jede Session, gehört nur dir — hier editierbar.",
  },
  "project-repo": {
    label: "im Repo · nur lesbar",
    cls: "repo",
    Icon: Lock,
    tip: "Liegt im Projekt-Repo (versioniert/geteilt). Das Tool zeigt es nur an und schreibt nie hinein.",
  },
  memory: {
    label: "lokal · editierbar",
    cls: "memory",
    Icon: Pencil,
    tip: "Auto-Memory dieses Projekts (~/.claude/projects/…). Maschinen-lokal, hier editier-/beförderbar.",
  },
};

/** One source of truth for scope wording + color, used across all views. */
export function ScopeBadge({ scope, compact = false }: { scope: Scope; compact?: boolean }) {
  const m = META[scope];
  return (
    <Tooltip text={m.tip}>
      <span className={"scope-badge " + m.cls}>
        <m.Icon size={11} />
        {!compact && m.label}
      </span>
    </Tooltip>
  );
}
