#!/usr/bin/env python3
"""Unicode / prompt-injection classifier and sanitizer.

Content that gets *promoted* into ``~/.claude/rules/`` (or imported into
``CLAUDE.md``) is loaded into every Claude Code session. That is exactly the
boundary attacked by the "Rules File Backdoor" technique: invisible Unicode
(zero-width chars, Unicode Tags, bidi overrides, homoglyphs) is invisible in
review but fully tokenized by the model.

This module is the single source of truth for both the scanner (to *flag*
existing entries for visibility) and the apply step (to *sanitize* before
writing). The existing memory corpus is already clean, so this acts as a
forward-looking guard at the promotion boundary, not a cleanup pass.

Two severities:
  * BLOCK  - smuggling vectors. Their presence aborts a promotion (don't write
             silently-cleaned content into an always-loaded file; surface it).
  * WARN   - suspicious but often benign (NBSP, soft hyphen, homoglyph mix).
             Stripped/normalized on write, reported.

Stdlib only, Python 3.9 compatible.
"""

import bisect
import re
import unicodedata

# --- BLOCK: invisible instruction-smuggling vectors -------------------------

_TAGS = (0xE0000, 0xE007F)            # Unicode Tags block
_BIDI = {                             # bidi overrides / isolates
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2066, 0x2067, 0x2068, 0x2069,
}
_ZERO_WIDTH = {                       # zero-width / invisible joiners & marks
    0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x180E,
}

# --- WARN: suspicious but frequently benign ---------------------------------

_SOFT_HYPHEN = 0x00AD
_EXOTIC_WS = {                        # non-standard whitespace -> normal space
    0x00A0, 0x2007, 0x202F, 0x2000, 0x2001, 0x2002, 0x2003,
    0x2004, 0x2005, 0x2006, 0x2008, 0x2009, 0x200A, 0x205F, 0x3000,
}

BLOCK = "block"
WARN = "warn"


def _codepoint_class(cp):
    """Return (severity, reason) for a single codepoint, or (None, None)."""
    if _TAGS[0] <= cp <= _TAGS[1]:
        return BLOCK, "unicode-tag"
    if cp in _BIDI:
        return BLOCK, "bidi-override"
    if cp in _ZERO_WIDTH:
        return BLOCK, "zero-width"
    if cp == _SOFT_HYPHEN:
        return WARN, "soft-hyphen"
    if cp in _EXOTIC_WS:
        return WARN, "exotic-whitespace"
    # Any remaining format char (category Cf) that we did not classify above.
    ch = chr(cp)
    if unicodedata.category(ch) == "Cf":
        return WARN, "format-char"
    return None, None


def _script(ch):
    """Coarse script of a letter, for homoglyph detection (heuristic)."""
    cp = ord(ch)
    if 0x0400 <= cp <= 0x04FF or 0x0500 <= cp <= 0x052F:
        return "Cyrillic"
    if 0x0370 <= cp <= 0x03FF and ch.isalpha():
        return "Greek"
    if ("a" <= ch <= "z") or ("A" <= ch <= "Z") or (0x00C0 <= cp <= 0x024F):
        return "Latin"
    return None


_WORD_RE = re.compile(r"[^\W_]{2,}", re.UNICODE)


def _homoglyph_flags(text):
    """Flag word tokens that mix Latin with Cyrillic/Greek letters."""
    flags = []
    locate = _line_index(text)
    for m in _WORD_RE.finditer(text):
        scripts = set()
        for ch in m.group(0):
            s = _script(ch)
            if s:
                scripts.add(s)
        if "Latin" in scripts and (scripts & {"Cyrillic", "Greek"}):
            ln, cl = locate(m.start())
            flags.append({
                "severity": WARN,
                "reason": "homoglyph-mix",
                "token": m.group(0),
                "line": ln,
                "col": cl,
            })
    return flags


def _line_index(text):
    """Return a function mapping a char offset to (line, col), both 1-based."""
    starts = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            starts.append(i + 1)

    def locate(offset):
        ln = bisect.bisect_right(starts, offset)  # 1-based line number
        return ln, offset - starts[ln - 1] + 1

    return locate


def scan_text(text):
    """Return a list of flag dicts for every suspicious codepoint / token.

    Each flag: {codepoint, char_name, severity, reason, line, col}.
    """
    flags = []
    line = 1
    col = 0
    for ch in text:
        if ch == "\n":
            line += 1
            col = 0
            continue
        col += 1
        cp = ord(ch)
        severity, reason = _codepoint_class(cp)
        if severity is not None:
            try:
                name = unicodedata.name(ch)
            except ValueError:
                name = "U+{:04X}".format(cp)
            flags.append({
                "codepoint": "U+{:04X}".format(cp),
                "char_name": name,
                "severity": severity,
                "reason": reason,
                "line": line,
                "col": col,
            })
    flags.extend(_homoglyph_flags(text))
    return flags


def has_block(text):
    """True if the text contains any BLOCK-severity codepoint."""
    for ch in text:
        severity, _ = _codepoint_class(ord(ch))
        if severity == BLOCK:
            return True
    return False


def sanitize(text):
    """Return (clean_text, removed, had_block).

    Removes BLOCK and invisible-WARN codepoints, converts exotic whitespace to
    a normal space, drops a leading BOM, and NFC-normalizes. Homoglyphs are
    *reported* (in ``removed`` with action ``flagged``) but never altered, as
    substituting them would corrupt content. ``had_block`` lets the caller
    abort a promotion instead of silently writing cleaned-but-tampered content.
    """
    had_block = has_block(text)
    removed = {}
    out = []
    for ch in text:
        cp = ord(ch)
        severity, reason = _codepoint_class(cp)
        if severity == BLOCK:
            _bump(removed, reason, "removed")
            continue
        if severity == WARN:
            if reason == "exotic-whitespace":
                out.append(" ")
                _bump(removed, reason, "to-space")
            else:  # soft-hyphen, other format chars
                _bump(removed, reason, "removed")
            continue
        out.append(ch)
    clean = "".join(out)
    # Drop a leading BOM if it survived (it is in _ZERO_WIDTH so it is already
    # gone, but normalize defensively) and NFC-normalize.
    clean = unicodedata.normalize("NFC", clean.lstrip("﻿"))

    removed_list = [
        {"reason": r, "action": a, "count": c}
        for (r, a), c in sorted(removed.items())
    ]
    for hg in _homoglyph_flags(clean):
        removed_list.append({
            "reason": "homoglyph-mix",
            "action": "flagged",
            "token": hg["token"],
        })
    return clean, removed_list, had_block


def _bump(d, reason, action):
    key = (reason, action)
    d[key] = d.get(key, 0) + 1


if __name__ == "__main__":
    import sys

    for path in sys.argv[1:]:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            content = fh.read()
        found = scan_text(content)
        if not found:
            print("{}: clean".format(path))
        for f in found:
            print("{}: {} {} {} L{}".format(
                path, f.get("severity"), f.get("reason"),
                f.get("codepoint", f.get("token", "")), f.get("line", "?")))
