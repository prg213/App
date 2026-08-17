/**
 * Task 457 — Grid pan position resets when the user switches days.
 *
 * `currentGridPanMs` is a module-level variable shared by all TVEpgRow
 * instances.  It persists across renders, so when the user switches to a
 * different day the old pan time must be cleared.  Otherwise newly mounted
 * rows for the new day apply the stale offset — which maps to a completely
 * different cell (or no cell) in the new day's programme data.
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
    const declIdx  = src.indexOf('const dayStartMs = useMemo');
    const resetIdx = src.indexOf('currentGridPanMs = null');
    expect(declIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(-1);
    // The reset must come AFTER the dayStartMs declaration.
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
