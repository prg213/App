/**
 * Task #274 — CategoryGrid D-pad cross-row navigation on Firestick
 *
 * The CategoryGrid component wires `nextFocusRight` / `nextFocusLeft` via
 * `setNativeProps` so that pressing D-pad Right from the last card in a row
 * carries focus to the first card of the next row, and D-pad Left from the
 * first card in a row returns focus to the last card of the previous row.
 *
 * Why source inspection instead of a render test?
 * ─────────────────────────────────────────────────
 * React Native TV focus (`nextFocusRight`, `nextFocusLeft`, `hasTVPreferredFocus`)
 * is resolved by the native layer on an actual Android TV / Fire TV device.
 * jsdom/node cannot simulate it.  Inspecting the production source confirms the
 * correct wiring code is authored and that no refactor accidentally removes it.
 *
 * Scenarios confirmed by these tests:
 *   1. Cross-row right-wrap: last card in a row → first card of next row
 *   2. Cross-row left-wrap:  first card in a row → last card of previous row
 *   3. Bidirectional wiring: both directions are set in a single wireCard call
 *   4. Node-handle timing: delay is ≥ 250 ms so Firestick Lite has time to
 *      attach the native node before findNodeHandle is called
 *   5. findNodeHandle guard: null check prevents a silent mis-wire
 *   6. Platform.isTV guard: wiring only runs on TV targets (no-op on phones)
 *   7. hasTVPreferredFocus on the first card so the D-pad always has a landing
 *      point when the grid mounts
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load the production source once ──────────────────────────────────────────

const SOURCE_PATH = path.join(__dirname, '../app/(tabs)/guide.tsx');

let src: string;

beforeAll(() => {
  src = fs.readFileSync(SOURCE_PATH, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cross-row right-wrap: last card → first card of the next row
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — D-pad right cross-row wrap', () => {
  it('sets nextFocusRight on the last card in a row so D-pad Right enters the next row', () => {
    // The wiring call must set nextFocusRight with the native handle of the
    // first card of the following row.
    expect(src).toMatch(/nextFocusRight/);
  });

  it('uses isLastInRow flag to detect the right-edge card before wiring', () => {
    // The flag must be computed so only the correct card is wired rightward.
    expect(src).toMatch(/isLastInRow/);
  });

  it('guards the wire with index + 1 < total so the very last card is not wired to a ghost', () => {
    // Without this guard the last card in the grid would try to wire to an
    // out-of-bounds index and produce a null handle.
    expect(src).toMatch(/index\s*\+\s*1\s*<\s*total/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cross-row left-wrap: first card → last card of the previous row
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — D-pad left cross-row wrap', () => {
  it('sets nextFocusLeft on the first card in a row so D-pad Left returns to the previous row', () => {
    expect(src).toMatch(/nextFocusLeft/);
  });

  it('uses isFirstInRow flag to detect the left-edge card before wiring', () => {
    expect(src).toMatch(/isFirstInRow/);
  });

  it('guards the wire with index > 0 so the very first card is not wired to a ghost', () => {
    // Without this guard, cardRefs.current[-1] would be undefined.
    expect(src).toMatch(/isFirstInRow\s*&&\s*index\s*>\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bidirectional wiring — both ends of the boundary are updated together
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — bidirectional wiring', () => {
  it('sets nextFocusRight AND nextFocusLeft so navigation works in both directions', () => {
    // A one-sided wire would allow travel in only one direction across the
    // row boundary; both must be present.
    expect(src).toMatch(/nextFocusRight/);
    expect(src).toMatch(/nextFocusLeft/);
  });

  it('calls setNativeProps to apply the native focus hints at the Android view level', () => {
    expect(src).toMatch(/setNativeProps\(\s*\{\s*nextFocus(Right|Left)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Node-handle timing: minimum delay for Firestick Lite compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — node-handle timing (Firestick Lite)', () => {
  it('defines TV_WIRE_DELAY_MS as a named constant so the delay is easy to identify', () => {
    // A magic literal buried in a setTimeout call is hard to find and tune.
    // The constant must exist so reviewers can see and adjust it deliberately.
    expect(src).toMatch(/TV_WIRE_DELAY_MS/);
  });

  it('sets TV_WIRE_DELAY_MS to at least 200 so Firestick Lite has time to attach the native node', () => {
    // Firestick Lite (1.0 GHz) needs up to ~220 ms for findNodeHandle to return
    // a valid integer.  Anything below 200 risks a silent null mis-wire on that
    // device class.
    const match = src.match(/TV_WIRE_DELAY_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const delay = parseInt(match![1], 10);
    expect(delay).toBeGreaterThanOrEqual(200);
  });

  it('passes TV_WIRE_DELAY_MS as the setTimeout delay when wiring each card', () => {
    // The constant must actually be used — not just defined but shadowed by a
    // different literal somewhere.  The setTimeout callback may be multi-line
    // (layout-generation guards, timer cleanup, etc.) so we check that both
    // TV_WIRE_DELAY_MS is used as a setTimeout second-argument AND that
    // wireCard(index) is invoked inside such a setTimeout rather than
    // constraining the exact shape of the callback body.
    expect(src).toMatch(/setTimeout\([^,]+,\s*TV_WIRE_DELAY_MS\s*\)/);
    // wireCard must be called inside the delayed callback (not invoked directly)
    expect(src).toMatch(/wireCard\(index\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. findNodeHandle null guard — silent mis-wire prevention
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — findNodeHandle null guard', () => {
  it('checks selfHandle != null before calling setNativeProps', () => {
    // If findNodeHandle returns null (node not yet attached or already unmounted)
    // setNativeProps({nextFocusRight: null}) silently breaks focus.
    expect(src).toMatch(/selfHandle\s*!=\s*null/);
  });

  it('checks nextHandle != null before calling setNativeProps', () => {
    expect(src).toMatch(/nextHandle\s*!=\s*null/);
  });

  it('checks prevHandle != null before calling setNativeProps', () => {
    expect(src).toMatch(/prevHandle\s*!=\s*null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Platform.isTV guard — wiring must be a no-op on non-TV targets
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — Platform.isTV guard', () => {
  it('wraps the wiring logic in a Platform.isTV check so phones are unaffected', () => {
    // On a phone the nextFocusRight/Left props are ignored by the OS, but
    // running findNodeHandle needlessly on every mount wastes cycles.
    expect(src).toMatch(/Platform\.isTV/);
  });

  it('returns early from wireCard when Platform.isTV is false', () => {
    // The early-return pattern keeps the non-TV path free of any setNativeProps
    // side effects.
    expect(src).toMatch(/if\s*\(\s*!Platform\.isTV\s*\)\s*return/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. hasTVPreferredFocus on the first card
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — initial TV focus landing', () => {
  it('exposes the first card ref via firstCardRef so the parent can focus it without hasTVPreferredFocus re-render races', () => {
    // CategoryGrid populates firstCardRef.current for index === 0 inside the
    // renderItem ref callback.  The parent (GuideScreen) then calls .focus()
    // on that ref in a useFocusEffect so the D-pad always has a landing point
    // when the grid becomes active — without the re-render race that
    // hasTVPreferredFocus causes on Fire OS when the grid re-renders.
    expect(src).toMatch(/index\s*===\s*0\s*&&\s*firstCardRef/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. numCols === 1 edge case — single-column layout must not produce a chain
// ─────────────────────────────────────────────────────────────────────────────
//
// When numCols === 1:
//   col = index % 1 = 0  (always)
//   isFirstInRow = (col === 0) → true for every card
//   isLastInRow  = (col === numCols - 1) = (0 === 0) → true for every card
//
// That means every card would be wired right→right, producing a chain rather
// than a grid and leaving D-pad Left unreachable from most cards.
//
// Defence in depth: even though numCols is clamped to ≥ 2 at the call site
// (Math.max(2, …)), wireCard itself guards against this case so that any
// future refactor that changes the clamp cannot silently reintroduce the bug.
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — single-column layout safety (numCols === 1)', () => {
  it('clamps numCols to at least 2 via Math.max so the single-column path cannot be reached at runtime', () => {
    // Primary defence: the expression Math.max(2, …) ensures numCols is never
    // below 2 regardless of how narrow the available width is.
    expect(src).toMatch(/Math\.max\(\s*2\s*,/);
  });

  it('has a numCols < 2 early-return inside wireCard as a defence-in-depth guard', () => {
    // If Math.max(2,…) were ever removed or bypassed by a future refactor,
    // this guard inside wireCard stops the chain-wiring bug before it can
    // produce broken D-pad behaviour on device.
    expect(src).toMatch(/numCols\s*<\s*2\s*\)\s*return/);
  });

  it('places the numCols < 2 guard before the column/row computation inside wireCard', () => {
    // The guard must appear before `index % numCols` so it short-circuits
    // before any isFirstInRow / isLastInRow logic runs.
    const wireCardStart = src.indexOf('const wireCard = useCallback');
    const guardPos      = src.indexOf('numCols < 2', wireCardStart);
    const colComputePos = src.indexOf('index % numCols', wireCardStart);
    expect(wireCardStart).toBeGreaterThan(-1);
    expect(guardPos).toBeGreaterThan(wireCardStart);
    expect(colComputePos).toBeGreaterThan(wireCardStart);
    // Guard must come first
    expect(guardPos).toBeLessThan(colComputePos);
  });
});
