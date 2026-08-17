/**
 * Task 458 — Grid pan position is not forgotten when the user fast-scrolls
 * between categories.
 *
 * Switching channel category unmounts and remounts all TVEpgRow instances,
 * tearing down and re-creating every epg:syncScroll listener.  If the switch
 * happens within the 80 ms debounce window, the trailing-debounced emitter may
 * not have fired yet, so newly mounted rows would see `currentGridPanMs === null`
 * and fall back to `initialIdx` (the current-time programme) rather than the
 * user's actual pan position.
 *
 * The fix: write `currentGridPanMs` immediately (non-debounced) on every user
 * scroll event, before the trailing-debounce timer is armed.  The timer still
 * fires after 80 ms and broadcasts to peer rows, but the module-level variable
 * always carries the latest pan position so newly mounted rows align correctly.
 *
 * These tests use source-text inspection of guide.tsx so they remain fast and
 * environment-free (no React Native renderer required).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ── 1. Immediate (non-debounced) write in the onScroll handler ─────────────

describe('TVEpgRow — currentGridPanMs is written immediately on every user scroll', () => {
  it('assigns currentGridPanMs outside (before) the emitTimerRef setTimeout in onScroll', () => {
    // The assignment must appear between the syncApplyingRef guard (which
    // returns early for programmatic scrolls) and the setTimeout that arms the
    // debounced broadcast.  This guarantees the value is always current even
    // when the category switches within the 80 ms window.
    expect(src).toMatch(
      /syncApplyingRef\.current[\s\S]{0,800}currentGridPanMs\s*=\s*immediateMs[\s\S]{0,400}emitTimerRef\.current\s*=\s*setTimeout/,
    );
  });

  it('converts the raw scroll offset to a time value for the immediate write', () => {
    // The immediate write must use offsetToTimeMs (not a raw pixel value) so
    // the stored position is time-based and portable across rows with different
    // programme widths.
    expect(src).toMatch(/const\s+immediateMs\s*=\s*offsetToTimeMs\s*\(\s*x\s*\)/);
  });

  it('guards the immediate write with a null check', () => {
    // offsetToTimeMs can return null (e.g. no programmes loaded yet), so the
    // write must be conditional to avoid overwriting a valid value with null.
    expect(src).toMatch(/if\s*\(\s*immediateMs\s*!=\s*null\s*\)\s*currentGridPanMs\s*=\s*immediateMs/);
  });
});

// ── 2. Debounced emitter still writes currentGridPanMs after the pan settles ─

describe('TVEpgRow — debounced emitter still writes currentGridPanMs after settling', () => {
  it('assigns currentGridPanMs inside the emitTimerRef setTimeout callback', () => {
    // The trailing-debounce timer still writes the final, settled value and
    // broadcasts it to peer rows.  Both writes (immediate + debounced) must exist.
    expect(src).toMatch(
      /emitTimerRef\.current\s*=\s*setTimeout[\s\S]{0,300}currentGridPanMs\s*=\s*targetMs/,
    );
  });
});

// ── 3. Mount effect reads currentGridPanMs for newly mounted rows ───────────

describe('TVEpgRow — mount effect aligns to currentGridPanMs after category switch', () => {
  it('checks currentGridPanMs !== null in the mount timer callback', () => {
    // When no saved offset exists (first mount after a category switch),
    // the mount effect must read currentGridPanMs to align immediately.
    expect(src).toMatch(/currentGridPanMs\s*!==\s*null/);
  });

  it('converts currentGridPanMs to a pixel offset via timeMsToOffsetRef.current', () => {
    // Time→pixel conversion must use the always-fresh ref so stale closures
    // do not produce wrong offsets for the newly loaded channel set.
    expect(src).toMatch(/timeMsToOffsetRef\.current\s*\(\s*currentGridPanMs/);
  });

  it('scrolls the newly mounted row to the derived pan offset', () => {
    // The mount alignment actually applies the scroll — not just computes it.
    expect(src).toMatch(/panOffset[\s\S]{0,200}scrollToOffset[\s\S]{0,100}panOffset/);
  });

  it('savedOffset check precedes the currentGridPanMs check so an explicit user scroll always wins', () => {
    // savedOffset !== null takes priority: if the user scrolled this row
    // before the category switch its position must be restored, not the
    // shared grid pan.
    const savedIdx = src.indexOf('savedOffset !== null');
    const panIdx   = src.indexOf('currentGridPanMs !== null');
    expect(savedIdx).toBeGreaterThan(-1);
    expect(panIdx).toBeGreaterThan(-1);
    expect(savedIdx).toBeLessThan(panIdx);
  });
});

// ── 4. epg:syncScroll listener still updates currentGridPanMs ──────────────

describe('TVEpgRow — epg:syncScroll listener keeps currentGridPanMs up to date', () => {
  it('updates currentGridPanMs inside the addListener callback', () => {
    expect(src).toMatch(
      /addListener\s*\(\s*['"]epg:syncScroll['"][\s\S]*?currentGridPanMs\s*=\s*targetMs/,
    );
  });
});
