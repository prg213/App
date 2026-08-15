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


def _extract_first_arg(body: str) -> str:
    """
    Given a call body starting with '(' (as returned by extract_call_body),
    return the text of the first argument, stripped of leading/trailing
    whitespace.  Handles nested brackets, strings, template literals, and
    comments so that the first top-level comma terminates collection.
    """
    i = 1  # skip the opening '('
    while i < len(body) and body[i] in " \t\n\r":
        i += 1
    start = i
    depth = 0
    while i < len(body):
        c = body[i]
        if c in ('"', "'"):
            i = _skip_string(body, i)
            continue
        if c == "`":
            i = _skip_template(body, i)
            continue
        if c == "/" and i + 1 < len(body):
            if body[i + 1] == "/":
                i = _skip_line_comment(body, i)
                continue
            if body[i + 1] == "*":
                i = _skip_block_comment(body, i)
                continue
        if c in ("(", "[", "{"):
            depth += 1
        elif c in (")", "]", "}"):
            if depth == 0:
                return body[start:i].strip()
            depth -= 1
        elif c == "," and depth == 0:
            return body[start:i].strip()
        i += 1
    return body[start:].strip()


def _is_string_literal(text: str) -> bool:
    """
    True iff *text* is exactly one plain single- or double-quoted string literal.

    Validates the entire content — not just the endpoints — so expressions like
    ``'prefix-' + variable + '-suffix'`` (which start and end with a quote but
    are not a single literal) are correctly rejected.  Backslash escapes inside
    the literal are handled so that ``'it\\'s fine'`` does not confuse the
    closing-quote detection.
    """
    t = text.strip()
    if len(t) < 2:
        return False
    q = t[0]
    if q not in ('"', "'"):
        return False
    i = 1
    while i < len(t):
        c = t[i]
        if c == "\\":
            i += 2  # skip escaped character
            continue
        if c == q:
            # The closing quote must be the very last character
            return i == len(t) - 1
        i += 1
    return False  # no closing quote found — malformed literal


def _extract_array_body(src: str, bracket_start: int) -> str:
    """
    Given *src* and the index of an opening '[', return the full text from
    that '[' to its matching ']' (inclusive), respecting strings, templates,
    nested brackets, and comments.
    """
    depth = 0
    i = bracket_start
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
            depth -= 1
            if depth == 0:
                return src[bracket_start : i + 1]
        i += 1
    return src[bracket_start:]


def _first_element_of_array(body: str) -> str:
    """
    Given a '[...]' body, return the text of the first element (stripped).
    Handles nested structures, strings, templates, and comments.
    """
    i = 1  # skip opening '['
    while i < len(body) and body[i] in " \t\n\r":
        i += 1
    start = i
    depth = 0
    while i < len(body):
        c = body[i]
        if c in ('"', "'"):
            i = _skip_string(body, i)
            continue
        if c == "`":
            i = _skip_template(body, i)
            continue
        if c == "/" and i + 1 < len(body):
            if body[i + 1] == "/":
                i = _skip_line_comment(body, i)
                continue
            if body[i + 1] == "*":
                i = _skip_block_comment(body, i)
                continue
        if c in ("(", "[", "{"):
            depth += 1
        elif c in (")", "]", "}"):
            if depth == 0:
                return body[start:i].strip()
            depth -= 1
        elif c == "," and depth == 0:
            return body[start:i].strip()
        i += 1
    return body[start:].strip()


def check_dynamic_key(method: str, body: str) -> "str | None":
    """
    Inspect an AsyncStorage write call for a dynamic (non-literal) key.

    ``setItem`` / ``mergeItem``:
        The key is the first positional argument.  A plain single- or
        double-quoted literal is safe; anything else (template literal,
        variable, concatenation, computed expression …) is flagged.

    ``multiSet`` / ``multiMerge``:
        The argument must be an inline array of ``[key, value]`` pairs.
        Every key must be a plain string literal.  The following are flagged:
        * Non-array argument (variable, function call, spread, …) →
          key positions are opaque and cannot be verified.
        * Spread elements inside the outer array (``[...x, [k, v]]``).
        * Any pair whose first element is not a plain string literal
          (template literal, variable, expression, …).

    Returns a short problem description, or ``None`` when the call is safe.
    """
    if method in ("setItem", "mergeItem"):
        key_arg = _extract_first_arg(body)
        if not key_arg:
            return None  # malformed — other checks will catch it
        if _is_string_literal(key_arg):
            return None  # safe: plain quoted literal
        snippet = key_arg[:80].replace("\n", " ")
        if key_arg.lstrip().startswith("`"):
            return f"template-literal key: {snippet}"
        return f"non-literal key expression: {snippet}"

    elif method in ("multiSet", "multiMerge"):
        arr_arg = _extract_first_arg(body)
        if not arr_arg:
            return None
        stripped = arr_arg.strip()

        # Not an inline array literal → key positions are opaque
        if not stripped.startswith("["):
            snippet = stripped[:80]
            return (
                f"non-array argument to {method} — "
                f"key positions unverifiable: {snippet}"
            )

        # Walk the outer array and validate each inner [key, value] pair
        i = 1  # skip opening '['
        while i < len(stripped):
            c = stripped[i]
            if c in " \t\n\r":
                i += 1
                continue
            if c == "]":
                break  # end of outer array
            if c == ",":
                i += 1
                continue
            # Spread operator → opaque
            if stripped[i : i + 3] == "...":
                return f"spread element in {method} array — key positions unverifiable"
            # Each element must be a '[key, value]' sub-array
            if c != "[":
                snippet = stripped[i : i + 40].replace("\n", " ")
                return f"non-pair element in {method} array: {snippet}"

            pair_text = _extract_array_body(stripped, i)
            key_text = _first_element_of_array(pair_text)
            if not _is_string_literal(key_text):
                snippet = key_text[:80].replace("\n", " ")
                if key_text.lstrip().startswith("`"):
                    return f"template-literal key in {method} pair: {snippet}"
                return f"non-literal key in {method} pair: {snippet}"

            i += len(pair_text)

        return None

    return None


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

            # ── Pass 3: dynamic-key detection ────────────────────────────────
            # Flag any write call whose key argument is not a plain string
            # literal.  A template literal (`sv_${name}`) or a variable
            # cannot be verified against the in-memory-only catalogue, so
            # the guard would silently miss a violation.  All writes must
            # use literal keys (or go through StorageService's typed
            # wrappers, which enforce this at the call site).
            #
            # services/storage.ts is excluded: it IS the authorised
            # direct-write location.  Its writes use KEYS.XYZ property
            # lookups — compile-time string constants — which are safe but
            # would otherwise look like "non-literal key expressions".
            _is_storage_ts = relpath.replace("\\", "/").endswith("services/storage.ts")
            if not _is_storage_ts:
                dynamic_issue = check_dynamic_key(method, body)
                if dynamic_issue:
                    display = body.replace("\n", " ").strip()
                    if len(display) > 300:
                        display = display[:297] + "..."
                    failures.append(
                        f"  [Dynamic-key writes]\n"
                        f"  File  : {relpath}:{lnum}\n"
                        f"  Call  : {m.group().split('(')[0]}(...)\n"
                        f"  Issue : {dynamic_issue}\n"
                        f"  Body  : {display}\n"
                    )

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
