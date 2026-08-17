/**
 * Task 459 — Pan position survives a day-tab switch the same way it survives
 * a category switch.
 *
 * Problem
 * -------
 * `currentGridPanMs` is a module-level variable (shared across all TVEpgRow
 * instances) that records the most-recent time position the EPG grid was
 * scrolled to.  When the user switches days the intended cleanup path is
 * FullGuide's `useEffect([dayStartMs])`, which resets `currentGridPanMs` to
 * null.
 *
 * However, React fires **child** effects before **parent** effects.  The
 * sequence on a day switch is:
 *
 *   1. `dayStartMs` changes.
 *   2. `items` (inside TVEpgRow) recomputes → `initialIdx` recomputes.
 *   3. TVEpgRow's scroll-offset reset (`useEffect([dayStartMs])`) runs — sets
 *      `scrollOffsetRef.current = null`.
 *   4. TVEpgRow's mount effect (`useEffect([initialIdx, isFirst, windowWidth])`)
 *      runs — AT THIS POINT `currentGridPanMs` still holds the old day's value!
 *   5. FullGuide's `useEffect([dayStartMs])` runs — sets `currentGridPanMs = null`.
 *
 * Without the fix, step 4 would scroll newly mounted rows to a nonsensical
 * time position derived from the previous day's pan offset.
 *
 * Fix
 * ---
 * In the mount effect, validate that `currentGridPanMs` falls within the new
 * `[dayStartMs, dayEndMs)` window before applying it.  A stale cross-day value
 * is silently skipped and the row falls through to `initialIdx` (current-time
 * programme) instead.
 *
 * These tests use source-text inspection of guide.tsx so they remain fast and
 * environment-free (no React Native renderer required).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ── 1. The bounds check exists in the mount effect ────────────────────────

describe('TVEpgRow mount effect — day-switch bounds check on currentGridPanMs', () => {
  it('guards currentGridPanMs with a dayStartMs lower-bound check', () => {
    // The fix must reject any pan value older than the start of the new day.
    expect(src).toMatch(/currentGridPanMs\s*>=\s*dayStartMs/);
  });

  it('guards currentGridPanMs with a dayEndMs upper-bound check', () => {
    // Symmetrically, values at or beyond the end of the day are also stale.
    expect(src).toMatch(/currentGridPanMs\s*<\s*dayEndMs/);
  });

  it('combines the null check with the bounds check in a single condition', () => {
    // All three conditions (not null, within day) should appear together so a
    // stale cross-day value is rejected without a separate branch.
    expect(src).toMatch(
      /currentGridPanMs\s*!==\s*null[\s\S]{0,120}currentGridPanMs\s*>=\s*dayStartMs[\s\S]{0,60}currentGridPanMs\s*<\s*dayEndMs/,
    );
  });
});

// ── 2. savedOffset still takes priority over the pan check ───────────────

describe('TVEpgRow mount effect — savedOffset precedes the day-bounded pan check', () => {
  it('savedOffset !== null check appears before the currentGridPanMs bounds check', () => {
    // A saved offset from an explicit user scroll on the current day must win
    // over the module-level pan position.  Order of the checks must be preserved.
    const savedIdx = src.indexOf('savedOffset !== null');
    // Find the bounds-check condition added by this fix.
    const boundsIdx = src.indexOf('currentGridPanMs >= dayStartMs');
    expect(savedIdx).toBeGreaterThan(-1);
    expect(boundsIdx).toBeGreaterThan(-1);
    expect(savedIdx).toBeLessThan(boundsIdx);
  });
});

// ── 3. FullGuide-level reset still present as backup ─────────────────────

describe('FullGuide — currentGridPanMs still reset to null on day change', () => {
  it('FullGuide resets currentGridPanMs inside a useEffect dependent on dayStartMs', () => {
    // The parent-level reset serves as a cleanup backstop for any other path
    // that might read currentGridPanMs after the day switch.
    expect(src).toMatch(
      /currentGridPanMs\s*=\s*null[\s\S]{0,200}\[\s*dayStartMs\s*\]/,
    );
  });
});

// ── 4. The race scenario is explained in a comment ────────────────────────

describe('TVEpgRow mount effect — day-switch race is documented in source', () => {
  it('mentions that child effects fire before parent effects in the comment', () => {
    // The comment must explain the React effect-ordering race so future
    // maintainers understand why the bounds check is necessary.
    expect(src).toMatch(/child effects.*before.*parent effects|parent effects.*child effects/i);
  });
});
