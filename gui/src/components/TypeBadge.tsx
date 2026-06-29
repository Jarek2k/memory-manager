import type { ReactNode } from "react";
import { Zap, ShieldCheck, FileText, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The concept-type axis: WHAT a thing is (not where it applies — that's ScopeBadge). */
export type ConceptType = "hook" | "permission" | "rule" | "memory";

export const TYPE_META: Record<ConceptType, { label: string; Icon: LucideIcon; cls: string; what: string }> = {
  hook: {
    label: "Hook",
    Icon: Zap,
    cls: "hook",
    what: "Kleines Programm, das vor einem Tool-Aufruf läuft und ihn erlauben, blockieren oder nachfragen kann. Mechanisch — läuft immer.",
  },
  permission: {
    label: "Permission",
    Icon: ShieldCheck,
    cls: "perm",
    what: "Erlaubnis-Liste: feste Muster → erlaubt / nachfragen / verboten. Stures Matching gegen jeden Tool-Aufruf. Mechanisch.",
  },
  rule: {
    label: "Regel",
    Icon: FileText,
    cls: "rule",
    what: "Klartext-Anweisung aus CLAUDE.md / rules/, jede Session geladen. Weich — Claude liest & befolgt sie, erzwungen ist sie nicht.",
  },
  memory: {
    label: "Memory",
    Icon: UserRound,
    cls: "mem",
    what: "Kontext: wer du bist, entdeckte Vorlieben, Projekt-Notizen. Beeinflusst Claude, erzwingt nichts.",
  },
};

/** Solid colored icon tile — the strong anchor that makes a type pop on the dark bg. */
export function TypeTile({ type, size = 26 }: { type: ConceptType; size?: number }) {
  const m = TYPE_META[type];
  const icon = Math.round(size * 0.56);
  return (
    <span className={"type-tile " + m.cls} style={{ width: size, height: size }} aria-hidden>
      <m.Icon size={icon} strokeWidth={2.3} />
    </span>
  );
}

/** Tile + label pill. The one marker reused across every view. */
export function TypeChip({ type, label }: { type: ConceptType; label?: string }) {
  const m = TYPE_META[type];
  return (
    <span className={"type-chip " + m.cls}>
      <TypeTile type={type} size={20} />
      {label ?? m.label}
    </span>
  );
}

/** Colored section header with the type's icon tile — used for the Global sections. */
export function TypeSectionHead({ type, title, meta, right }: { type: ConceptType; title: string; meta?: string; right?: ReactNode }) {
  return (
    <div className={"group-head type " + TYPE_META[type].cls}>
      <TypeTile type={type} size={22} />
      <h3>{title}</h3>
      {meta && <span className="meta">{meta}</span>}
      {right}
      <span className="line" />
    </div>
  );
}

/** Compact colored H·P·R counts, always in hardness order (hooks → perms → rules). */
export function TypeCounts({ hooks, perms, rules }: { hooks: number; perms: number; rules: number }) {
  return (
    <span className="type-counts">
      <span className="tc hook" title="Hooks">{hooks}H</span>
      <span className="sep">·</span>
      <span className="tc perm" title="Permissions">{perms}P</span>
      <span className="sep">·</span>
      <span className="tc rule" title="Regeldateien">{rules}R</span>
    </span>
  );
}

/** Count chip with a colored dot, for the inspector "gilt hier" section. */
export function TypeCountChip({ type, label, n }: { type: ConceptType; label: string; n: number }) {
  return (
    <span className={"insp-chip type " + TYPE_META[type].cls}>
      <span className="tc-dot" /> {label} <b>{n}</b>
    </span>
  );
}
