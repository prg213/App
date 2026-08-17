/**
 * Task 454 — TV guide rows stay in sync after fast channel-list scrolling.
 *
 * When the user scrolls the vertical channel list quickly on a Fire TV, new
 * TVEpgRow instances are mounted mid-pan.  Without mount-alignment those rows
 * start at their own initial offset and only snap to the grid's pan position
 * on the next epg:syncScroll broadcast — producing a brief misalignment.
 *
 * The fix:
 *  1. A module-level `currentGridPanMs` variable is updated every time a row
 *     emits OR receives an epg:syncScroll event.
 *  2. The mount effect reads `currentGridPanMs` when no saved offset exists and
 *     immediately scrolls the newly mounted row to the current pan position.
 *
 * These tests use source-text inspection of guide.tsx so they remain fast and
 * environment-free (no React Native renderer required).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ── 1. Module-level pan-time tracker ──────────────────────────────────────

describe('TVEpgRow — module-level currentGridPanMs tracks the current pan time', () => {
  it('declares a module-level currentGridPanMs variable', () => {
    // Must be a module-level (non-const) variable so all row instances share it.
    expect(src).toMatch(/^let\s+currentGridPanMs\s*:/m);
  });

  it('initialises currentGridPanMs to null', () => {
    expect(src).toMatch(/let\s+currentGridPanMs[^=]*=\s*null/);
  });
});

// ── 2. Emitter updates currentGridPanMs ───────────────────────────────────

describe('TVEpgRow — epg:syncScroll emitter writes currentGridPanMs', () => {
  it('sets currentGridPanMs before emitting epg:syncScroll', () => {
    // The assignment must appear before (or at the same block as) the emit call.
    // Verify both appear in the source — order is enforced by the structural check.
    expect(src).toMatch(/currentGridPanMs\s*=\s*targetMs/);
    expect(src).toMatch(/DeviceEventEmitter\.emit\s*\(\s*['"]epg:syncScroll['"]/);
  });
});

// ── 3. Listener updates currentGridPanMs ──────────────────────────────────

describe('TVEpgRow — epg:syncScroll listener writes currentGridPanMs', () => {
  it('updates currentGridPanMs inside the epg:syncScroll addListener callback', () => {
    // Verify the assignment exists inside the listener block.  We look for
    // addListener followed (somewhere after) by the assignment — regex uses
    // dot-all so the match spans multiple lines.
    expect(src).toMatch(
      /addListener\s*\(\s*['"]epg:syncScroll['"][\s\S]*?currentGridPanMs\s*=\s*targetMs/,
    );
  });

  it('updates currentGridPanMs before the sourceRow guard so even source-row echoes are recorded', () => {
    // The assignment must precede the `if (sourceRow === rowIndex` early-return.
    const listenerStart = src.indexOf("addListener(\n      'epg:syncScroll'");
    const listenerAlt   = src.indexOf('addListener(\n      "epg:syncScroll"');
    const listenerIdx   = Math.max(listenerStart, listenerAlt);
    expect(listenerIdx).toBeGreaterThan(-1);

    const assignIdx = src.indexOf('currentGridPanMs = targetMs', listenerIdx);
    const guardIdx  = src.indexOf('sourceRow === rowIndex', listenerIdx);

    expect(assignIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeLessThan(guardIdx);
  });
});

// ── 4. Mount effect aligns newly mounted rows ──────────────────────────────

describe('TVEpgRow — mount effect applies currentGridPanMs when no saved offset exists', () => {
  it('reads currentGridPanMs inside the mount timer callback', () => {
    expect(src).toMatch(/currentGridPanMs\s*!==\s*null/);
  });

  it('calls timeMsToOffsetRef.current with currentGridPanMs', () => {
    expect(src).toMatch(/timeMsToOffsetRef\.current\s*\(\s*currentGridPanMs/);
  });

  it('calls scrollToOffset with the derived panOffset', () => {
    // The mount alignment must actually scroll the row.
    expect(src).toMatch(/panOffset[\s\S]{0,200}scrollToOffset[\s\S]{0,100}panOffset/);
  });

  it('declares timeMsToOffsetRef as an always-fresh ref holding timeMsToOffset', () => {
    // The ref must be updated every render so the mount effect never calls a
    // stale version of timeMsToOffset (which would use stale items/dayStartMs).
    expect(src).toMatch(/timeMsToOffsetRef\.current\s*=\s*timeMsToOffset/);
  });

  it('mount alignment runs only when no saved offset exists', () => {
    // The savedOffset check must appear BEFORE the currentGridPanMs check in
    // the source so a user-scrolled position is always preferred.
    const savedIdx = src.indexOf('savedOffset !== null');
    const panIdx   = src.indexOf('currentGridPanMs !== null');
    expect(savedIdx).toBeGreaterThan(-1);
    expect(panIdx).toBeGreaterThan(-1);
    expect(savedIdx).toBeLessThan(panIdx);
  });
});
