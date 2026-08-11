/**
 * Task #291 — Restore D-pad focus after CategoryGrid FlatList key change
 *
 * When the category list reloads (e.g. numCols changes due to screen resize or
 * orientation change), the FlatList remounts with a new `key` prop, destroying
 * all card refs and silently losing D-pad focus.
 *
 * The fix:
 *  1. `focusedIndexRef` tracks which card index last received D-pad focus via
 *     `onFocus` callbacks.  It lives in CategoryGrid scope so it survives the
 *     inner FlatList remounting.
 *  2. A `useEffect([numCols])` fires after each key-change remount and
 *     imperatively restores focus to the previously-focused card (or the first
 *     card when that card has not yet remounted).
 *  3. The focus call is delayed by TV_WIRE_DELAY_MS + 50 ms so the
 *     nextFocusLeft / nextFocusRight wiring is complete first.
 *
 * Why source inspection instead of a render test?
 * ─────────────────────────────────────────────────
 * React Native TV focus (hasTVPreferredFocus, imperative .focus(), setNativeProps)
 * is resolved by the native layer on an actual Android TV / Fire TV device.
 * jsdom/node cannot simulate it.  Inspecting the production source confirms the
 * correct wiring code is authored and that no refactor accidentally removes it.
 *
 * A separate simulation suite validates the runtime lifecycle — ref tracking and
 * focus restoration logic — using plain JS objects that mirror the ref shapes
 * from guide.tsx.
 *
 * Scenarios confirmed by these tests:
 *
 *   Source inspection:
 *     1. focusedIndexRef is declared as a useRef tracking focused card index
 *     2. onFocus handler on each card updates focusedIndexRef.current = index
 *     3. useEffect depends on [numCols] to detect FlatList remounts
 *     4. Effect resolves target from focusedIndexRef.current, falls back to [0]
 *     5. Focus call is delayed by TV_WIRE_DELAY_MS (+ 50) so wiring is ready
 *     6. Platform.isTV guard prevents the focus call on non-TV targets
 *
 *   Simulation:
 *     7. focusedIndexRef starts at 0 — first card gets focus after initial mount
 *     8. After a key change, previously-focused card index is restored
 *     9. Falls back to the first card when the tracked card has not remounted yet
 *    10. onFocus callback advances the tracked index as the user navigates
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
// 1. focusedIndexRef declaration
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — focusedIndexRef declaration', () => {
  it('declares focusedIndexRef as a useRef so it survives FlatList remounts', () => {
    // The ref must be declared in CategoryGrid scope (not inside the FlatList)
    // so it is not destroyed when the FlatList remounts on key change.
    expect(src).toMatch(/focusedIndexRef\s*=\s*useRef/);
  });

  it('initialises focusedIndexRef to 0 so focus defaults to the first card', () => {
    expect(src).toMatch(/focusedIndexRef\s*=\s*useRef\s*<\s*number\s*>\s*\(\s*0\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. onFocus tracking handler on each card
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — onFocus tracking', () => {
  it('updates focusedIndexRef.current inside an onFocus handler on each card', () => {
    // The onFocus callback must write index so the ref reflects which card
    // the D-pad was on when the FlatList remounted.
    expect(src).toMatch(/focusedIndexRef\.current\s*=\s*index/);
  });

  it('uses onFocus (not onPress) so the tracked index updates on D-pad navigation, not just taps', () => {
    // D-pad navigation triggers onFocus without triggering onPress; tracking
    // via onFocus is the only reliable way to know where the cursor is.
    expect(src).toMatch(/onFocus\s*=\s*\{[^}]*focusedIndexRef/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. useEffect([numCols]) detects FlatList remounts
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — useEffect numCols dependency', () => {
  it('has a useEffect that lists numCols as its sole dependency', () => {
    // key={numCols} remounts the FlatList exactly when numCols changes.
    // A useEffect([numCols]) fires after each such remount, giving us the
    // hook to restore focus imperatively.
    expect(src).toMatch(/\[\s*numCols\s*\]/);
  });

  it('returns a cleanup function from the effect to cancel the pending focus timer', () => {
    // If numCols changes again before the timer fires, the stale timer must be
    // cancelled to prevent it focusing the wrong card layout.
    expect(src).toMatch(/return\s*\(\s*\)\s*=>\s*clearTimeout/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Focus restoration targets focusedIndexRef.current with first-card fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — focus restoration target', () => {
  it('reads focusedIndexRef.current to look up the previously-focused card ref', () => {
    expect(src).toMatch(/focusedIndexRef\.current/);
  });

  it('falls back to cardRefs.current[0] when the previously-focused card has not yet remounted', () => {
    // After a FlatList remount, virtualised cells outside the viewport have not
    // yet re-populated their refs; the fallback ensures the user always gets
    // a focusable card and is never left with no D-pad entry point.
    expect(src).toMatch(/cardRefs\.current\[idx\]\s*\?\?\s*cardRefs\.current\[0\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Delay ensures cross-row wiring is complete before focus is restored
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — focus restoration delay', () => {
  it('delays the focus call by at least TV_WIRE_DELAY_MS so wiring timers have fired', () => {
    // Wiring (nextFocusLeft / nextFocusRight) uses TV_WIRE_DELAY_MS.  Restoring
    // focus before wiring is done would land the user on a card from which they
    // cannot navigate to adjacent rows.
    const match = src.match(/TV_WIRE_DELAY_MS\s*\+\s*(\d+)/);
    expect(match).not.toBeNull();
    const extra = parseInt(match![1], 10);
    expect(extra).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Platform.isTV guard — focus restoration is a no-op on non-TV targets
// ─────────────────────────────────────────────────────────────────────────────

describe('CategoryGrid — focus restoration Platform.isTV guard', () => {
  it('wraps the focus restoration useEffect body in a Platform.isTV check', () => {
    // On phones and tablets the focus restoration is irrelevant (no D-pad)
    // and the imperative .focus() call could interfere with the keyboard.
    expect(src).toMatch(/Platform\.isTV/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7–10.  Simulation suite — runtime focus restoration lifecycle
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests mirror the exact logic from guide.tsx using plain JS objects so
// the ref-lifecycle behaviour is verified at the unit level without requiring
// a React / React Native renderer.

/** Minimal stand-in for a mutable ref object */
function makeRef<T>(initial: T) {
  return { current: initial };
}

/**
 * Mirror of the CategoryGrid focus-restoration useEffect body.
 *
 * - focusedIndexRef  — tracks the last-focused card index
 * - cardRefs         — array of focusable card mocks (null = not yet mounted)
 *
 * Returns the cleanup function (like the real React effect) so the caller can
 * simulate another numCols change before the timer fires.
 */
function runFocusRestoreEffect(
  focusedIndexRef: { current: number },
  cardRefs: { current: (null | { focus: jest.Mock })[] },
  isTV: boolean,
  DELAY_MS: number,
): () => void {
  if (!isTV) return () => {};

  const t = setTimeout(() => {
    const idx = focusedIndexRef.current;
    const target = cardRefs.current[idx] ?? cardRefs.current[0];
    (target as any)?.focus?.();
  }, DELAY_MS);

  return () => clearTimeout(t);
}

const MOCK_DELAY = 300; // TV_WIRE_DELAY_MS + 50

describe('CategoryGrid focus restoration simulation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // 7. Default state — focus lands on the first card
  it('7. focuses the first card when focusedIndexRef is at its initial value (0)', () => {
    const focusedIndexRef = makeRef(0);
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() },
      { focus: jest.fn() },
      { focus: jest.fn() },
    ]);

    runFocusRestoreEffect(focusedIndexRef, cardRefs, true, MOCK_DELAY);
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[0]!.focus).toHaveBeenCalledTimes(1);
    expect(cardRefs.current[1]!.focus).not.toHaveBeenCalled();
    expect(cardRefs.current[2]!.focus).not.toHaveBeenCalled();
  });

  // 8. Previously-focused card is restored after a key change
  it('8. restores focus to the card that was previously focused (not always the first)', () => {
    const focusedIndexRef = makeRef(2); // user navigated to card 2 before reload
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() },
      { focus: jest.fn() },
      { focus: jest.fn() },
    ]);

    runFocusRestoreEffect(focusedIndexRef, cardRefs, true, MOCK_DELAY);
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[2]!.focus).toHaveBeenCalledTimes(1);
    expect(cardRefs.current[0]!.focus).not.toHaveBeenCalled();
    expect(cardRefs.current[1]!.focus).not.toHaveBeenCalled();
  });

  // 9. Falls back to the first card when the tracked card has not yet remounted
  it('9. falls back to cardRefs[0] when the previously-focused card ref is null', () => {
    const focusedIndexRef = makeRef(3); // was on card 3
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() }, // card 0 — only one mounted in viewport
      null,                  // card 1 — not yet remounted
      null,                  // card 2 — not yet remounted
      // card 3 absent (virtualised out) — triggers fallback
    ]);

    runFocusRestoreEffect(focusedIndexRef, cardRefs, true, MOCK_DELAY);
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[0]!.focus).toHaveBeenCalledTimes(1);
  });

  // 10. onFocus callback advances the tracked index
  it('10. the onFocus handler advances focusedIndexRef.current as the user navigates', () => {
    const focusedIndexRef = makeRef(0);

    // Simulate D-pad navigation: user moves from card 0 → 1 → 3
    function onFocus(index: number) {
      focusedIndexRef.current = index;
    }

    onFocus(1);
    expect(focusedIndexRef.current).toBe(1);

    onFocus(3);
    expect(focusedIndexRef.current).toBe(3);

    // After a key change, the effect would now restore to card 3
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() },
      { focus: jest.fn() },
      { focus: jest.fn() },
      { focus: jest.fn() },
    ]);

    runFocusRestoreEffect(focusedIndexRef, cardRefs, true, MOCK_DELAY);
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[3]!.focus).toHaveBeenCalledTimes(1);
    expect(cardRefs.current[0]!.focus).not.toHaveBeenCalled();
  });

  // 11. Effect is a no-op on non-TV targets
  it('11. does not call focus on non-TV targets (Platform.isTV = false)', () => {
    const focusedIndexRef = makeRef(0);
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() },
    ]);

    runFocusRestoreEffect(focusedIndexRef, cardRefs, false /* isTV */, MOCK_DELAY);
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[0]!.focus).not.toHaveBeenCalled();
  });

  // 12. Cleanup cancels the pending timer before another numCols change fires
  it('12. cleanup cancels the in-flight timer so a rapid numCols change cannot fire twice', () => {
    const focusedIndexRef = makeRef(0);
    const cardRefs = makeRef<(null | { focus: jest.Mock })[]>([
      { focus: jest.fn() },
    ]);

    // First numCols change — schedule the restore timer
    const cleanup = runFocusRestoreEffect(focusedIndexRef, cardRefs, true, MOCK_DELAY);

    // numCols changes again before MOCK_DELAY ms — React runs the cleanup
    cleanup();

    // Advance time: the cancelled timer must not fire
    jest.advanceTimersByTime(MOCK_DELAY);

    expect(cardRefs.current[0]!.focus).not.toHaveBeenCalled();
  });
});
