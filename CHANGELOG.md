# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format lose an
[Keep a Changelog](https://keepachangelog.com/) angelehnt; Versionierung nach
[SemVer](https://semver.org/).

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

[0.5.0]: https://github.com/Jarek2k/memory-manager/releases/tag/v0.5.0
