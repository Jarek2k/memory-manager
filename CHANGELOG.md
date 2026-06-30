# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format lose an
[Keep a Changelog](https://keepachangelog.com/) angelehnt; Versionierung nach
[SemVer](https://semver.org/).

## [0.5.3] — 2026-06-30

### Changed
- **Überblick-Pfad hart auf drei Schritte reduziert und deterministisch gemacht.**
  Der Auf-mach-Ablauf in der SKILL.md ist jetzt genau **Step A scan → Step B Server
  starten → Step C Browser öffnen** — sonst nichts. Ausdrücklich verboten: vor/nach
  dem Öffnen `inventory.json` parsen oder eine Memory-Zusammenfassung (Counts,
  Tabellen, Cluster, Flags, Budget) ausgeben, und das Inventar-Schema raten — das ist
  Aufgabe der GUI. Damit fallen die Extra-Bash-Aufrufe (= Extra-Permission-Popups)
  weg, über die sich der Nutzer zu Recht beschwert hat.
- **Run-Verzeichnis wird über eine feste Pointer-Datei durchgereicht**
  (`$TMPDIR/cc-memory-manager/.current-run`). Jeder Schritt liest `RUN` daraus,
  statt sich auf zwischen Bash-Aufrufen *nicht* persistente Shell-Variablen zu
  verlassen. Behebt den Bug, dass ein erneut via `date`/`$$` berechnetes `RUN` auf
  ein frisches, leeres Verzeichnis zeigte und der Scan wiederholt werden musste.

## [0.5.2] — 2026-06-30

### Fixed
- **Überblick öffnet wieder die GUI.** Der Read-only-Zweig der SKILL.md hatte „der Nutzer
  hat *nur* einen Überblick verlangt" als Auslöser für den Text-only-Pfad — dadurch ging
  bei „zeig mir einen Überblick" der Server **nicht** auf, obwohl genau das der Haupt-Trigger
  der GUI ist. Text-only gilt jetzt nur noch bei aktivem Plan-Mode oder wenn der Nutzer
  **ausdrücklich** „nur Text / ohne Browser" verlangt; jeder normale Überblicks-/Kurations-
  Wunsch startet die Live-GUI.
- **`sandbox.py --make` funktioniert wieder.** Der in SKILL.md/README dokumentierte
  `--make`-Aufruf war kein gültiges Flag → `$(…)` lieferte einen leeren Pfad, und scan/apply
  fielen still auf das echte `~/.claude` zurück (genau das Gegenteil des Sandbox-Versprechens).
  `--make` ist jetzt ein akzeptierter Alias für den Copy-Modus (Default), plus Regressionstest
  und ein Docstring-Hinweis, den ausgegebenen Pfad vor Gebrauch auf nicht-leer zu prüfen.

## [0.5.1] — 2026-06-29

### Changed
- **Read-only/Plan-Mode-Zweig** in der SKILL.md: Wird der Skill in einer read-only Session
  (Plan-Mode) aufgerufen, startet er direkt den read-only Scan + Text-Überblick — ohne
  Server, ohne apply/commit und ohne Live-vs-readonly-Rückfrage. Die Live-GUI wird erst
  angeboten, sobald der Plan-Mode verlassen ist. Spart beim Überblick einen Extra-Turn.

## [0.5.0] — 2026-06-29

Erstes teilbares Release: als installierbares Claude-Code-Plugin paketiert.

### Added
- **Plugin-Paketierung:** `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`,
  installierbar per `claude plugin marketplace add` → `claude plugin install`.
- MIT-`LICENSE`, dieses `CHANGELOG.md`, `engines: node >=22.6` in `gui/package.json`.

### Changed
- SKILL.md löst seinen Pfad jetzt über `${CLAUDE_PLUGIN_ROOT}` auf (mit Fallback),
  statt über das im `bash -c`-Kontext unzuverlässige `dirname "$0"` — Voraussetzung
  dafür, dass das Plugin nach Install aus jedem Arbeitsverzeichnis funktioniert.
- Versionsangaben über SKILL.md und `gui/package.json` auf `0.5.0` vereinheitlicht.

### Vorher (Funktionsumfang, der in dieses Release einfließt)
- Cross-Projekt-Überblick, Kuration und **Befördern** von Auto-Memory in authored
  globale Regeln (`~/.claude/rules/*` + idempotenter `@import`).
- Read-only-Erfassung von Regeln/Permissions/Hooks; editierbare `settings.json`
  (global + Projekt) über den `edit_settings`-Op; `harden`-Op komponiert Hooks.
- In-Browser-Diff-Gate (semantische + Wort-Level-Diffs, Freigabe pro Datei);
  `apply.py` als einziger Writer mit Backup, Drift-Check und Audit-Log.
- Absicherungs-Pass: Hook-Firing-Test gegen den PreToolUse-Vertrag (jq-Guard) und
  Python↔TS-`decompose`-Paritätstest gegen ein gemeinsames Golden-Corpus.

[0.5.1]: https://github.com/Jarek2k/memory-manager/releases/tag/v0.5.1
[0.5.0]: https://github.com/Jarek2k/memory-manager/releases/tag/v0.5.0
