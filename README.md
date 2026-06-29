# Claude Memory Manager

Projektübergreifender Überblick und Kuration für das **Auto-Memory von Claude
Code** — und vor allem das **Befördern** wiederkehrender Projekt-Lernungen in
bewusste, globale Regeln.

Claude Code schreibt sich pro Projekt ein Auto-Memory unter
`~/.claude/projects/<encoded>/memory/`. Das ist maschinen-lokal und pro Repo —
es gibt **keinen** nativen projektübergreifenden Überblick und **kein** globales
Auto-Memory. Dieses Tool schließt genau diese Lücke.

## Was es macht

- **Überblick:** alle Memories aus allen Projekten an einem Ort, mit Typ, Alter,
  Größe, `Why/How`, Wiki-Links und Flags.
- **Verwalten:** einzelne Einträge bearbeiten, löschen oder lange Log-Dateien
  splitten (Dauerregel behalten, Logs auslagern).
- **Befördern:** ausgewählte Lernungen als *authored* Regel nach
  `~/.claude/rules/<thema>.md` schreiben und per `@import` in `~/.claude/CLAUDE.md`
  einbinden — das ist die „globale Memory", die es nativ nicht gibt.
- **Vier Helfer:** Cross-Projekt-**Cluster** (gleiche Vorliebe in mehreren
  Projekten), globaler **Budget-Meter** (Zeilen, die jede Session laden),
  **Enforcement-Erkennung** (muss/nie/immer → besser ein Hook), **Unicode-/
  Injection-Scan** vor dem Befördern.

## Architektur

```
scan.py  →  inventory.json  →  GUI (localhost)  →  decisions.json  →  Claude wendet an
(Fakten)      (Anzeige)        (du kuratierst)       (Absichten)        (Urteil + Diffs)
```

Der **Browser schreibt nie Dateien.** Er POSTet nur die Entscheidungen an einen
kurzlebigen localhost-Server; **Claude Code** wendet sie an — mit Diffs, einem
Backup und idempotentem `@import`. Kein MCP, keine Datenbank, zustandslos.

| Datei | Rolle |
|---|---|
| `scripts/scan.py` | deterministischer Scanner (stdlib, Python 3.9) |
| `scripts/serve.py` | 127.0.0.1-Server, liefert die GUI + nimmt `POST /decisions` an |
| `scripts/apply.py` | Stage→Commit-Gate, Backup, `@import`, Hook-Merge, Audit |
| `scripts/safety.py` | Unicode/Injection-Klassifizierer + Sanitizer |
| `scripts/pathcodec.py` | dekodiert kodierte Projektnamen (filesystem-geerdet) |
| `scripts/sandbox.py` | Wegwerf-Kopie von `~/.claude` (oder synthetisch) zum Testen |
| `gui/` | Vite + React SPA (build → `gui/dist/`, von `serve.py` geliefert) |
| `SKILL.md` | Orchestrierung für Claude Code |

## Installation als Plugin (empfohlen)

Im Terminal — funktioniert **überall**, auch in den VS-Code-/JetBrains-Erweiterungen:

```bash
claude plugin marketplace add Jarek2k/memory-manager
claude plugin install memory-manager@memory-manager
```

> Die Slash-Variante `/plugin marketplace add …` bzw. `/plugin install …` gibt es **nur
> im Terminal-TUI** von Claude Code, **nicht** in den IDE-Erweiterungen — dort die
> `claude plugin …`-CLI oben nutzen und danach das Fenster neu laden.

Das Plugin heißt `memory-manager` und liegt im gleichnamigen Marketplace-Katalog, daher die
Schreibweise `memory-manager@memory-manager`. Danach im Chat danach fragen, z. B. *„zeig mir
einen Überblick über meine Memories"* oder *„mach das zu einer globalen Regel"*. Das gebaute
`gui/dist/` ist im Plugin enthalten — **Endnutzer brauchen kein Node**.

## Für Mitwirkende

Repo klonen und gefahrlos in einer Wegwerf-Sandbox ausprobieren (**nie das echte
`~/.claude`**):

```bash
SANDBOX=$(python3 scripts/sandbox.py --make)        # oder --synthetic für Fake-Daten
python3 scripts/scan.py --claude-dir "$SANDBOX" --out /tmp/run/inventory.json
python3 scripts/serve.py --run-dir /tmp/run --gui-dir ./gui/dist --port 0 &
# URL aus der Server-Ausgabe öffnen; die GUI zeigt ein SANDBOX-Banner
```

GUI neu bauen (nur nötig, wenn du `gui/src/` änderst — braucht Node ≥ 22.6):

```bash
cd gui && npm install && npm run build   # → gui/dist/
```

Optionen: `--claude-dir` oder `$CLAUDE_CONFIG_DIR`, falls die Config nicht unter
`~/.claude` liegt.

## Sicherheit & Grenzen

- Server bindet nur `127.0.0.1`, single-user, ephemer.
- Vor dem Befördern wird Inhalt auf unsichtbares Unicode geprüft (Tags, Bidi,
  Zero-Width) — BLOCK-Funde brechen die Beförderung ab.
- Globale Regeln laden jede Session → schlank halten (Warnung ab 150, Limit 200
  Zeilen). Der Budget-Meter zeigt das live.
- **Nichts wird je automatisch geschrieben** — weder Memory, `rules/`, `CLAUDE.md`
  noch `settings.json`. Schreiben passiert nur über Knöpfe (Warenkorb → „Übernehmen")
  und das Datei-für-Datei-Diff-Gate (`apply.py --stage` schreibt nie; nur
  `--commit --only <bestätigt>` schreibt die bestätigten Dateien).
- Per-Projekt-Deduplizierung übernimmt Claude Codes „AutoDream" — wird hier
  bewusst nicht nachgebaut.
- Gehärtete Hooks (`settings.json`) inspizieren den Befehl mit `jq` — ohne
  installiertes `jq` greift der Hook nicht. `jq` ist also Laufzeit-Voraussetzung
  fürs Härten (der Hook-Firing-Test überspringt sich, wenn `jq` fehlt).

## Tests

```bash
python3 tests/test_scan.py        # Scanner, Resolver, Safety, Apply, Server, Hook-Firing, decompose
cd gui && npm test                # Python↔TS-decompose-Parität (braucht Node ≥ 22.6, kein Framework)
```

`decompose` existiert doppelt — in Python (`scan.py`) und TS
(`gui/src/lib/decompose.ts`) — und beide **müssen identische Item-Grenzen**
liefern, sonst kann ein Per-Regel-Edit eine Datei zerschießen (die GUI spleißt
ein Item über die TS-Grenzen zurück in die rohe `.md`). Beide Tests prüfen gegen
dasselbe Golden-Corpus `gui/src/lib/decompose.fixture.json`: wer eine der beiden
`decompose`-Implementierungen ändert, muss das Fixture neu erzeugen und **beide**
Tests wieder grün bekommen.

## Status

v0.5.0 — erstes teilbares Release (als Plugin paketiert). Spätere Stufen:
CCO-artige Voll-Verwaltung (Massen-Verschieben), „Diff seit letztem Lauf" aus dem
Audit-Log, generierte Hook-Snippets, Multi-Maschinen-Sharing.

## Lizenz

MIT — siehe [LICENSE](LICENSE). Quelle: <https://github.com/Jarek2k/memory-manager>
