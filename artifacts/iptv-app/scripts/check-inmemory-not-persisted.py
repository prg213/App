#!/usr/bin/env python3
"""
check-inmemory-not-persisted.py
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Guard: confirm that known in-memory-only state identifiers are never
referenced inside AsyncStorage write calls anywhere in the app source.

Unlike a line-oriented grep this script extracts the *full* call expression
(including multiline calls) by tracking parenthesis depth, so patterns like

    AsyncStorage.setItem(
      'some_key',
      JSON.stringify(channelIdx),   # ← identifier on different line
    );

or

    const rows = [['zap_index', JSON.stringify(zapIndex)]];
    AsyncStorage.multiSet(rows);    # ← rows already built above

...are detected reliably.  The script also catches common string-literal key
patterns so that even indirect references (e.g. a hard-coded string matching a
forbidden name) are flagged.

See docs/inmemory-only-state.md for the full catalogue and rationale.

Exit 0 = clean.  Exit 1 = violations found.
"""

import argparse
import os
import re
import sys

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_EXTS = {".ts", ".tsx", ".js", ".jsx"}


def _build_scan_dirs(override: str | None) -> list[str]:
    """Return the list of directories to scan.

    When *override* is given (via --scan-dir) only that directory is scanned —
    used by the self-test mode in check-inmemory-not-persisted.sh to scan the
    fixture directory without touching app source.
    """
    if override:
        return [os.path.abspath(override)]
    return [
        os.path.join(_ROOT, d)
        for d in ("app", "context", "hooks", "services", "components")
        if os.path.isdir(os.path.join(_ROOT, d))
    ]

# AsyncStorage write methods — matches both the canonical import name and the
# well-known dynamic-import alias used throughout this codebase:
#
#   import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
#     AS.setItem(...)
#   )
#
# If a new alias is introduced for AsyncStorage, add it here.
WRITE_METHOD_RE = re.compile(
    r"\b(?:AsyncStorage|AS)\s*\.\s*(setItem|mergeItem|multiSet|multiMerge)\s*\("
)

# ---------------------------------------------------------------------------
# Known in-memory-only identifier and key patterns, grouped by category.
# Each entry is matched as a whole word (\b...\b) against the full text of the
# extracted call expression.
# ---------------------------------------------------------------------------
FORBIDDEN: dict[str, list[str]] = {
    # 1. EPG scroll offsets — services/epgScrollState.ts
    #    Must reset to 0,0 on every cold-start.
    "EPG scroll offsets": [
        "_epgScrollX", "_epgScrollY",
        "epgScrollX", "epgScrollY",
        "epgScroll", "epg_scroll",
    ],

    # 2. EPG filter state — services/epgFilterState.ts
    #    Category / fav-filter resets on each cold-start.
    "EPG filter state": [
        "_selectedCat", "_favFilterActive",
        "epgFilter", "epg_filter",
        "epgSelectedCat", "epgFavFilter",
        "fav_filter_active",
    ],

    # 3. Channel menu session state — components/LiveChannelMenu.tsx
    #    Menu position/search survives remounts within a session, not across launches.
    "Channel menu session state": [
        "_savedCat", "_savedSearch", "_savedScrollOffset", "_autoSelected",
        "savedCat", "savedSearch", "savedScrollOffset", "autoSelected",
        "channel_menu",
    ],

    # 4. OSD / player UI visibility — app/player.tsx (component useState)
    #    OSD must always start hidden after a relaunch.
    #    Actual state vars: showInfo, showControls, showChannelMenu.
    "OSD/player UI visibility": [
        "showInfo", "show_info",
        "showControls", "show_controls",
        "showChannelMenu", "show_channel_menu",
    ],

    # 5. Zap-list / channel index — app/player.tsx (component useState)
    #    Active channel index is initialised from navigation params each mount.
    "Zap-list/channel index": [
        "channelIdx", "channel_idx",
        "zapIndex", "zap_index",
        "zapPosition", "zap_position",
    ],

    # 6. In-memory caches — services/tmdb.ts, services/reminderUrlCache.ts
    #    trailerCache/posterCache: LRU-evicted (CACHE_MAX=200), not for disk.
    #    seriesTrailerUrlCache: unbounded Map, cleared on logout, not for disk.
    #    lastNetworkRefreshByCredential: TTL Map, not for disk.
    "In-memory caches": [
        "trailerCache", "trailer_cache",
        "posterCache", "poster_cache",
        "seriesTrailerUrlCache", "seriesTrailerUrl", "series_trailer",
        "lastNetworkRefreshByCredential", "networkRefreshByCredential",
        "reminder_url_cache", "lastNetworkRefresh",
    ],

    # 7. Session push-failure counter — services/favoritesSync.ts
    #    Resets to 0 on each login; must not carry over between sessions.
    "Session push-failure counter": [
        "_sessionPushFail", "sessionPushFail",
        "session_push_fail", "pushFailCount", "push_fail_count",
    ],
}

# ---------------------------------------------------------------------------
# Source parsing helpers
# ---------------------------------------------------------------------------

def _skip_line_comment(src: str, i: int) -> int:
    """Advance past a // line comment.  i points at the first /."""
    while i < len(src) and src[i] != "\n":
        i += 1
    return i


def _skip_block_comment(src: str, i: int) -> int:
    """Advance past a /* ... */ block comment.  i points at the /."""
    i += 2  # skip /*
    while i < len(src) - 1:
        if src[i] == "*" and src[i + 1] == "/":
            return i + 2
        i += 1
    return len(src)


def _skip_string(src: str, i: int) -> int:
    """
    Advance past a single- or double-quoted string literal.
    i points at the opening quote.  Handles backslash escapes.
    """
    q = src[i]
    i += 1
    while i < len(src):
        c = src[i]
        if c == "\\":
            i += 2
            continue
        if c == q:
            return i + 1
        i += 1
    return i


def _skip_template(src: str, i: int) -> int:
    """
    Advance past a backtick template literal (including embedded ${...}).
    i points at the opening backtick.
    """
    i += 1
    depth = 0
    while i < len(src):
        c = src[i]
        if c == "\\" and depth == 0:
            i += 2
            continue
        if c == "`" and depth == 0:
            return i + 1
        if c == "$" and i + 1 < len(src) and src[i + 1] == "{":
            depth += 1
            i += 2
            continue
        if c == "}" and depth > 0:
            depth -= 1
            i += 1
            continue
        i += 1
    return i


def extract_call_body(src: str, paren_start: int) -> str:
    """
    Given `src` and the index of the opening '(' of an AsyncStorage write
    call, return the full text of the parenthesised argument list (from
    '(' through the matching ')'), respecting string literals, template
    literals, and nested parens / brackets.

    The function skips comments and strings so that a ')' inside a string
    does not prematurely terminate collection.
    """
    depth = 0
    i = paren_start
    while i < len(src):
        c = src[i]

        # Comments
        if c == "/" and i + 1 < len(src):
            if src[i + 1] == "/":
                i = _skip_line_comment(src, i)
                continue
            if src[i + 1] == "*":
                i = _skip_block_comment(src, i)
                continue

        # String literals
        if c in ('"', "'"):
            i = _skip_string(src, i)
            continue

        # Template literals
        if c == "`":
            i = _skip_template(src, i)
            continue

        # Parens / brackets — track depth
        if c in ("(", "[", "{"):
            depth += 1
        elif c in (")", "]", "}"):
            depth -= 1
            if depth == 0:
                return src[paren_start : i + 1]

        i += 1

    # Unbalanced source — return everything from the opening paren
    return src[paren_start:]


# ---------------------------------------------------------------------------
# Bounded one-level data-flow helpers
# ---------------------------------------------------------------------------

# Bare identifier: not preceded by '.' or word char, not followed by '(' or '.'
# This extracts candidate variable names that were passed to a write call.
_BARE_IDENT_RE = re.compile(r"(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)(?!\s*[.(])")

# Common JS/TS keywords and built-ins to skip when looking for variable refs
_JS_KEYWORDS: frozenset[str] = frozenset([
    "if", "else", "for", "while", "do", "return", "const", "let", "var",
    "true", "false", "null", "undefined", "new", "await", "async", "function",
    "class", "import", "export", "from", "of", "in", "try", "catch", "throw",
    "switch", "case", "break", "continue", "typeof", "instanceof", "void",
    "delete", "this", "super", "JSON", "Array", "String", "Number", "Object",
    "Promise", "Map", "Set", "Error", "Math", "Date", "Boolean", "Symbol",
])


def _extract_rhs(src: str, start: int) -> str:
    """
    Starting at *start* (the character immediately after '=' in an assignment),
    collect the right-hand side until a ';' or unmatched ')'/']'/'}' is found
    at depth 0.  Respects strings, templates, and comments.
    Returns the collected text (may be empty).
    """
    depth = 0
    i = start
    while i < len(src):
        c = src[i]
        if c in ('"', "'"):
            i = _skip_string(src, i)
            continue
        if c == "`":
            i = _skip_template(src, i)
            continue
        if c == "/" and i + 1 < len(src):
            if src[i + 1] == "/":
                i = _skip_line_comment(src, i)
                continue
            if src[i + 1] == "*":
                i = _skip_block_comment(src, i)
                continue
        if c in ("(", "[", "{"):
            depth += 1
        elif c in (")", "]", "}"):
            if depth == 0:
                break
            depth -= 1
        elif c == ";" and depth == 0:
            return src[start:i]
        i += 1
    return src[start:i]


def find_precomputed_violations(
    src: str,
    call_body: str,
    call_start: int,
    compiled: "dict[str, list[re.Pattern[str]]]",
    max_lines: int = 30,
) -> "list[tuple[str, str, str]]":
    """
    One-level data-flow check: for each bare identifier in *call_body*,
    look backward in *src* from *call_start* (up to *max_lines* lines) for an
    assignment statement (`[const|let|var] IDENT = RHS`).  If the RHS contains
    a forbidden identifier, report (category, matched_identifier, rhs_snippet).

    This catches the pre-computed-payload pattern:

        const rows = [['key', JSON.stringify(channelIdx)]];
        AS.multiSet(rows);   ← `channelIdx` is in rows' definition, not the body

    Limitations (documented in docs/inmemory-only-state.md):
    - Only one level of indirection is traced (direct variable → assignment).
    - Multi-level chains (rows → subArray → channelIdx) are not detected.
    - The forbidden identifier must appear literally in the assignment expression.
    """
    # Collect bare identifier names from the call body (skip keywords/built-ins)
    candidates: set[str] = {
        m.group(1)
        for m in _BARE_IDENT_RE.finditer(call_body)
        if m.group(1) not in _JS_KEYWORDS and len(m.group(1)) > 1
    }
    if not candidates:
        return []

    # Compute the source window we'll search backward through
    lines_before = src[:call_start].split("\n")
    window_start_line = max(0, len(lines_before) - max_lines)
    # Character offset of the start of that line
    window_start_pos = sum(len(l) + 1 for l in lines_before[:window_start_line])

    violations: list[tuple[str, str, str]] = []

    for ident in candidates:
        # Find the last `[const|let|var] IDENT =` assignment before the call
        # The pattern allows an optional TypeScript type annotation between the
        # identifier and '=', e.g.: const rows: [string, string][] = [...]
        # The annotation is `: something` that does not itself contain '='.
        assign_pat = re.compile(
            r"(?:(?:const|let|var)\s+)?\b" + re.escape(ident) + r"\b\s*(?::[^=]*?)?\s*=(?!=)",
            re.MULTILINE,
        )
        last_assign: "re.Match[str] | None" = None
        for am in assign_pat.finditer(src, window_start_pos, call_start):
            last_assign = am

        if not last_assign:
            continue

        rhs = _extract_rhs(src, last_assign.end())

        for category, patterns in compiled.items():
            for pat in patterns:
                hit = pat.search(rhs)
                if hit:
                    violations.append((category, hit.group(), rhs.strip()[:250]))
                    break  # one hit per category per variable

    return violations


# ---------------------------------------------------------------------------
# Source iteration helpers
# ---------------------------------------------------------------------------

def source_files():
    """Yield (file_path, relative_path) for all source files under SCAN_DIRS."""
    for d in SCAN_DIRS:
        for dirpath, _, names in os.walk(d):
            for name in names:
                if os.path.splitext(name)[1] in SOURCE_EXTS:
                    fp = os.path.join(dirpath, name)
                    yield fp, os.path.relpath(fp, _ROOT)


def line_number(src: str, pos: int) -> int:
    return src[:pos].count("\n") + 1


# ---------------------------------------------------------------------------
# Main scan
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Guard: in-memory-only state must not be written to AsyncStorage."
    )
    parser.add_argument(
        "--scan-dir",
        metavar="DIR",
        default=None,
        help=(
            "Override the default scan directories (used by the self-test to "
            "scan only the fixture directory)."
        ),
    )
    args = parser.parse_args()

    global SCAN_DIRS
    SCAN_DIRS = _build_scan_dirs(args.scan_dir)

    print("Checking that in-memory-only state is not written to AsyncStorage…")
    print()

    # Pre-compile forbidden patterns as whole-word regexes
    compiled: dict[str, list[re.Pattern[str]]] = {
        cat: [re.compile(r"\b" + re.escape(ident) + r"\b") for ident in idents]
        for cat, idents in FORBIDDEN.items()
    }

    failures: list[str] = []

    for fpath, relpath in source_files():
        try:
            with open(fpath, encoding="utf-8", errors="replace") as fh:
                src = fh.read()
        except OSError:
            continue

        for m in WRITE_METHOD_RE.finditer(src):
            # The regex ends with '\(', so m.end()-1 is the index of '('
            paren_pos = m.end() - 1
            body = extract_call_body(src, paren_pos)
            lnum = line_number(src, m.start())
            method = m.group(1)

            reported_categories: set[str] = set()

            # ── Pass 1: direct check — forbidden identifier inside call body ──
            for category, patterns in compiled.items():
                for pat in patterns:
                    hit = pat.search(body)
                    if hit:
                        display = body.replace("\n", " ").strip()
                        if len(display) > 300:
                            display = display[:297] + "..."
                        failures.append(
                            f"  [{category}]\n"
                            f"  File  : {relpath}:{lnum}\n"
                            f"  Call  : {m.group().split('(')[0]}(...)\n"
                            f"  Match : identifier '{hit.group()}' found directly in call body\n"
                            f"  Body  : {display}\n"
                        )
                        reported_categories.add(category)
                        break

            # ── Pass 2: one-level data-flow — identifier in a pre-computed var ──
            for category, ident, rhs in find_precomputed_violations(
                src, body, m.start(), compiled
            ):
                if category in reported_categories:
                    continue  # already reported via pass 1
                display_rhs = rhs.replace("\n", " ")
                if len(display_rhs) > 250:
                    display_rhs = display_rhs[:247] + "..."
                failures.append(
                    f"  [{category}]\n"
                    f"  File  : {relpath}:{lnum}\n"
                    f"  Call  : {m.group().split('(')[0]}(...)\n"
                    f"  Match : identifier '{ident}' found in pre-computed variable "
                    f"passed to write call\n"
                    f"  RHS   : {display_rhs}\n"
                )
                reported_categories.add(category)

    if failures:
        print("ERROR: In-memory-only identifiers found inside AsyncStorage write calls.")
        print("       These values must stay in-memory only and must never be persisted.")
        print("       See docs/inmemory-only-state.md for the rationale.")
        print()
        for f in failures:
            print(f)
        return 1

    print("OK — no in-memory-only state is written to AsyncStorage.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
