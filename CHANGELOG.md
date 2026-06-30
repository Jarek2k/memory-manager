# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format lose an
[Keep a Changelog](https://keepachangelog.com/) angelehnt; Versionierung nach
[SemVer](https://semver.org/).

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
