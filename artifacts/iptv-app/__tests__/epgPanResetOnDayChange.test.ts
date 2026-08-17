/**
 * Tasks 457 & 460 — Grid pan position resets only on day changes, not on
 * category switches.
 *
 * `currentGridPanMs` is a module-level variable shared by all TVEpgRow
 * instances.  It persists across renders, so when the user switches to a
 * different day the old pan time must be cleared.  Otherwise newly mounted
 * rows for the new day apply the stale offset — which maps to a completely
 * different cell (or no cell) in the new day's programme data.
 *
 * A parallel risk: if the reset also fires on category changes (due to
 * component remounts or state interactions) the user's pan position would be
 * lost when they filter by category, which is unwanted.  The tests in section
 * 4 confirm the reset is strictly gated on dayStartMs, not on any
 * category-related state such as selectedCat or categoryIds.
 *
 * These tests use source-text inspection of guide.tsx so they remain fast
 * and environment-free (no React Native renderer required).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ── 1. The reset assignment exists ────────────────────────────────────────

describe('FullGuide — currentGridPanMs reset on day change', () => {
  it('assigns null to currentGridPanMs inside a useEffect', () => {
    // The reset must be an assignment inside a useEffect body.
    expect(src).toMatch(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*currentGridPanMs\s*=\s*null/s);
  });

  it('the reset useEffect depends on dayStartMs', () => {
    // The dependency array must contain dayStartMs so the effect fires on
    // every day switch and only on day switches (not on every render).
    expect(src).toMatch(
      /currentGridPanMs\s*=\s*null[\s\S]{0,200}\[\s*dayStartMs\s*\]/,
    );
  });
});

// ── 2. The reset appears inside FullGuide (after dayStartMs is declared) ──

describe('FullGuide — reset placement relative to dayStartMs declaration', () => {
  it('dayStartMs is declared before the reset useEffect', () => {
    const declIdx = src.indexOf('const dayStartMs = useMemo');
    // Find the day-change reset specifically (multi-line form with [dayStartMs]
    // dep array) rather than the first currentGridPanMs = null, which is the
    // unmount cleanup earlier in the file.
    const match = src.match(/currentGridPanMs\s*=\s*null;\s*\n\s*\},\s*\[\s*dayStartMs\s*\]/);
    const resetIdx = match ? src.indexOf(match[0]) : -1;
    expect(declIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    // The day-change reset useEffect must come AFTER the dayStartMs declaration.
    expect(resetIdx).toBeGreaterThan(declIdx);
  });

  it('the reset appears before the first TVEpgRow JSX usage of dayStartMs', () => {
    // TVEpgRow receives dayStartMs as a prop — the reset must be set up
    // before those rows are rendered so a day change is reflected immediately.
    const resetIdx  = src.indexOf('currentGridPanMs = null');
    // Find the first <TVEpgRow or TVEpgRow( usage after the declaration.
    const tvRowJsx  = src.indexOf('dayStartMs={dayStartMs}');
    expect(resetIdx).toBeGreaterThan(-1);
    expect(tvRowJsx).toBeGreaterThan(-1);
    expect(resetIdx).toBeLessThan(tvRowJsx);
  });
});

// ── 3. Mount alignment falls through to initialIdx when pan is null ────────

describe('TVEpgRow — mount effect falls through to initialIdx when currentGridPanMs is null', () => {
  it('checks currentGridPanMs !== null before applying the pan offset', () => {
    // The guard must be present so rows skip the pan-restore path when null.
    expect(src).toMatch(/currentGridPanMs\s*!==\s*null/);
  });

  it('the savedOffset null-check precedes the currentGridPanMs null-check', () => {
    // A saved offset from a previous day switch must always take precedence
    // over the (now-null) grid pan so the order must be preserved.
    const savedIdx = src.indexOf('savedOffset !== null');
    const panIdx   = src.indexOf('currentGridPanMs !== null');
    expect(savedIdx).toBeGreaterThan(-1);
    expect(panIdx).toBeGreaterThan(-1);
    expect(savedIdx).toBeLessThan(panIdx);
  });
});

// ── 4. Category switches must NOT reset the pan position ──────────────────
//
// These tests confirm that the `currentGridPanMs = null` reset in FullGuide
// and the `scrollOffsetRef.current = null` reset in TVEpgRow are both gated
// solely on dayStartMs.  If category-related identifiers appeared in either
// dependency array the user's pan position would be silently discarded
// whenever they filter by a different category — which is wrong.

describe('FullGuide — currentGridPanMs reset is NOT triggered by category changes', () => {
  // There are two `currentGridPanMs = null` assignments in guide.tsx:
  //   (A) the unmount cleanup:   `useEffect(() => () => { currentGridPanMs = null; }, []);`
  //   (B) the day-change reset:  `useEffect(() => {\n    currentGridPanMs = null;\n  }, [dayStartMs]);`
  //
  // We must inspect assignment (B) — the one with dayStartMs in its dep
  // array.  The distinguishing trait: (B) has a newline between `null;` and
  // the closing `},` whereas (A) keeps everything on one line.  The regex
  // below requires that newline, so it matches only (B).

  function extractPanResetDepArray(source: string): string {
    // Match: `currentGridPanMs = null;` followed by optional whitespace then
    // a newline, then optional whitespace, then `}, [<deps>]`.
    // The \n anchor skips the same-line unmount cleanup and lands on the
    // multi-line day-change reset.
    const match = source.match(
      /currentGridPanMs\s*=\s*null;\s*\n\s*\},\s*\[([^\]]*)\]/,
    );
    return match ? match[1] : '';
  }

  it('the day-change pan-reset useEffect is present (newline form)', () => {
    // Sanity-check: the extraction must find the block.  If this fails, the
    // assignment or formatting changed and all dep-array tests are moot.
    expect(extractPanResetDepArray(src)).not.toBe('');
  });

  it('dependency array of the pan-reset useEffect contains dayStartMs', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).toMatch(/dayStartMs/);
  });

  it('dependency array of the pan-reset useEffect does not contain selectedCat', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).not.toMatch(/selectedCat/);
  });

  it('dependency array of the pan-reset useEffect does not contain categoryIds', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).not.toMatch(/categoryIds/);
  });

  it('dependency array of the pan-reset useEffect does not contain categoryNameMap', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).not.toMatch(/categoryNameMap/);
  });

  it('dependency array of the pan-reset useEffect does not contain favFilterActive', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).not.toMatch(/favFilterActive/);
  });

  it('dependency array of the pan-reset useEffect does not contain epgFavFilterActive', () => {
    const deps = extractPanResetDepArray(src);
    expect(deps).not.toMatch(/epgFavFilterActive/);
  });
});

describe('TVEpgRow — scrollOffsetRef reset is NOT triggered by category changes', () => {
  // There is one `scrollOffsetRef.current = null` in guide.tsx (TVEpgRow,
  // day-change reset).  We use the same newline-anchored pattern for
  // consistency and to stay robust if a same-line cleanup is ever added.

  function extractScrollResetDepArray(source: string): string {
    const match = source.match(
      /scrollOffsetRef\.current\s*=\s*null;\s*\n\s*\},\s*\[([^\]]*)\]/,
    );
    return match ? match[1] : '';
  }

  it('the day-change scrollOffsetRef-reset useEffect is present (newline form)', () => {
    expect(extractScrollResetDepArray(src)).not.toBe('');
  });

  it('dependency array of the scrollOffsetRef-reset useEffect contains dayStartMs', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).toMatch(/dayStartMs/);
  });

  it('dependency array of the scrollOffsetRef-reset useEffect does not contain selectedCat', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).not.toMatch(/selectedCat/);
  });

  it('dependency array of the scrollOffsetRef-reset useEffect does not contain categoryIds', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).not.toMatch(/categoryIds/);
  });

  it('dependency array of the scrollOffsetRef-reset useEffect does not contain categoryNameMap', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).not.toMatch(/categoryNameMap/);
  });

  it('dependency array of the scrollOffsetRef-reset useEffect does not contain favFilterActive', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).not.toMatch(/favFilterActive/);
  });

  it('dependency array of the scrollOffsetRef-reset useEffect does not contain epgFavFilterActive', () => {
    const deps = extractScrollResetDepArray(src);
    expect(deps).not.toMatch(/epgFavFilterActive/);
  });
});

// ── 5. The TVEpgGrid unmount cleanup uses an empty dep array ───────────────
//
// `useEffect(() => () => { currentGridPanMs = null; }, [])` in FullGuide/TVEpgGrid
// clears the module-level pan variable only when the entire grid unmounts —
// not when a filter toggle causes a re-render inside it.  An empty dep array
// `[]` is the source-code guarantee of that.  If favFilterActive or any other
// state crept into that array the cleanup would fire on every toggle, wiping
// the pan position the user just set.

describe('TVEpgGrid unmount cleanup — empty dep array guarantees no filter-toggle side-effect', () => {
  it('the unmount-cleanup useEffect exists with an empty dependency array', () => {
    // The cleanup form is:  useEffect(() => () => { currentGridPanMs = null; }, [])
    // The empty `[]` means it registers only at mount and cleans up only at unmount.
    expect(src).toMatch(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*currentGridPanMs\s*=\s*null;\s*\}\s*,\s*\[\s*\]\s*\)/,
    );
  });

  it('favFilterActive does not appear in the unmount-cleanup dep array', () => {
    // Extract the dep array of the inline-cleanup form specifically.
    // Pattern: `useEffect(() => () => { currentGridPanMs = null; }, [<deps>])`
    const match = src.match(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*currentGridPanMs\s*=\s*null;\s*\}\s*,\s*\[([^\]]*)\]\s*\)/,
    );
    const deps = match ? match[1] : '';
    expect(deps).not.toMatch(/favFilterActive/);
  });

  it('epgFavFilterActive does not appear in the unmount-cleanup dep array', () => {
    const match = src.match(
      /useEffect\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*currentGridPanMs\s*=\s*null;\s*\}\s*,\s*\[([^\]]*)\]\s*\)/,
    );
    const deps = match ? match[1] : '';
    expect(deps).not.toMatch(/epgFavFilterActive/);
  });
});
