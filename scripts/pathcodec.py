#!/usr/bin/env python3
"""Encode/decode Claude Code project directory names.

Claude Code stores per-project auto-memory under
``~/.claude/projects/<encoded>/memory/`` where ``<encoded>`` is the project's
absolute filesystem path with every ``/`` replaced by ``-`` (so the leading
slash becomes a leading dash). Example::

    /Users/alex/dev/projects/webshop
    -> -Users-alex-dev-projects-webshop

Decoding is *lossy*: a path component that itself contains a literal ``-``
(e.g. ``webshop-api``) is indistinguishable from a ``/`` boundary. We
therefore resolve against the real filesystem with a backtracking search,
preferring longer components first (which matches reality for dashed project
names). When no existing path matches we fall back to the naive decode and
flag it as unresolved.

Stdlib only, Python 3.9 compatible.
"""

from pathlib import Path


def encode(path):
    """Filesystem path -> encoded directory name."""
    p = str(path)
    return p.replace("/", "-")


def decode_naive(encoded):
    """Encoded name -> path, naive (lossy) ``-`` to ``/`` replacement."""
    return "/" + "/".join(_tokens(encoded))


def _tokens(encoded):
    """Split an encoded name into its ``-``-separated tokens.

    The encoded name starts with a leading ``-`` (from the root slash), so the
    first split element is empty and is dropped.
    """
    parts = encoded.split("-")
    if parts and parts[0] == "":
        parts = parts[1:]
    return parts


def resolve(encoded, root=None):
    """Resolve an encoded name to a real directory.

    Returns ``(Path, resolved: bool)``. ``resolved`` is True when an existing
    directory was found on disk, False when we fell back to the naive decode
    (e.g. the project was deleted or moved).
    """
    root = Path(root) if root is not None else Path("/")
    tokens = _tokens(encoded)
    if tokens:
        found = _dfs(root, tokens)
        if found is not None:
            return found, True
    return Path(decode_naive(encoded)), False


def _dfs(current, tokens):
    """Depth-first search for an existing path matching ``tokens``.

    At each level we try to consume the longest run of remaining tokens that
    forms an existing directory, then recurse on the rest. Returns the first
    complete existing directory path, or None.
    """
    if not tokens:
        return current if current.is_dir() else None
    for k in range(len(tokens), 0, -1):
        component = "-".join(tokens[:k])
        candidate = current / component
        if candidate.is_dir():
            result = _dfs(candidate, tokens[k:])
            if result is not None:
                return result
    return None


def slug(encoded, resolved_path=None):
    """Short, human-friendly project name (the last path component)."""
    if resolved_path is not None:
        return Path(resolved_path).name
    toks = _tokens(encoded)
    return toks[-1] if toks else encoded


if __name__ == "__main__":
    import sys

    for arg in sys.argv[1:]:
        p, ok = resolve(arg)
        print("{}\t{}\t{}".format(arg, p, "resolved" if ok else "UNRESOLVED"))
