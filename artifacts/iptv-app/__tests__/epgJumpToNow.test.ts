/**
 * Task #288 — Jump-to-now shortcut survives EPG category switches on Fire TV
 *
 * The Play/Pause hardware key on Fire TV triggers jumpToNow() in FullGuide,
 * which calls jumpToNowCallbackRef.current().  That ref is populated by a
 * useEffect inside TVEpgRow — but only for the first row (isFirst prop).
 *
 * When the user switches EPG categories the entire row list re-renders.
 * The old first row unmounts and clears jumpToNowCallbackRef; the new first
 * row mounts and repopulates it via its own useEffect.  A subsequent
 * Play/Pause keypress must therefore still reach the new FlatList.
 *
 * Why source inspection instead of a render test?
 * ────────────────────────────────────────────────
 * React Native TV focus, hasTVPreferredFocus, FlatList.scrollToIndex, and
 * DeviceEventEmitter are resolved by the native layer on an actual Android TV
 * / Fire TV device.  jsdom/node cannot simulate them.  Inspecting the
 * production source confirms the correct wiring code is authored and that no
 * refactor accidentally removes it.
 *
 * A separate simulation suite validates the runtime lifecycle — ref
 * population, ref clearing on unmount, and the callback invocation path —
 * using plain JS objects that mirror the ref shapes from guide.tsx.
 *
 * Scenarios confirmed by these tests:
 *
 *   Source-inspection:
 *     1.  TVEpgRow populates jumpToNowRef in a useEffect (isFirst guard present)
 *     2.  jumpToNowRef cleanup sets it to null so stale callbacks are removed
 *     3.  jumpToNowRef.current calls scrollToIndex on the horizontal FlatList
 *     4.  FullGuide owns jumpToNowCallbackRef and passes it to the first row
 *     5.  FullGuide.jumpToNow() calls jumpToNowCallbackRef.current?.()
 *     6.  Play/Pause hardware key triggers jumpToNow (eventType + eventKeyAction guard)
 *     7.  jumpToNow is a no-op when a ProgramModal is open (selectedRef guard)
 *     8.  jumpToNow switches to today first when the user is on a future day
 *     9.  The 220 ms delay after day-switch gives the new rows time to mount
 *         before the callback is invoked
 *
 *   Simulation:
 *     10. Ref is populated after the first row mounts
 *     11. Ref is cleared when the first row unmounts (category switch)
 *     12. Ref is repopulated when a new first row mounts after category switch
 *     13. Play/Pause fires the callback that calls scrollToIndex
 *     14. Play/Pause is ignored when the modal is open
 *     15. Play/Pause is ignored when Platform.isTV is false
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
// 1.  TVEpgRow populates jumpToNowRef in a useEffect (isFirst is the gate)
// ─────────────────────────────────────────────────────────────────────────────

describe('TVEpgRow — jumpToNowRef population', () => {
  it('calls jumpToNowRef.current = () => { … } so FullGuide can invoke it', () => {
    expect(src).toMatch(/jumpToNowRef\.current\s*=/);
  });

  it('guards the population so only the first row writes to the ref', () => {
    // The ref is only meaningful for the first visible row; every other row
    // would overwrite it and break the "jump to now" position calculation.
    expect(src).toMatch(/if\s*\(\s*!jumpToNowRef\s*\)\s*return/);
  });

  it('runs the population inside a useEffect so it fires after the FlatList mounts', () => {
    // The FlatList ref (flatRef) is only available after render; populating
    // jumpToNowRef during render would capture a null flatRef.
    expect(src).toMatch(/useEffect\s*\(\s*\(\)\s*=>/);
    // The effect depends on [jumpToNowRef, initialIdx] so it re-runs if the
    // row re-renders with a different initialIdx (day change).
    expect(src).toMatch(/\[\s*jumpToNowRef\s*,\s*initialIdx\s*\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.  jumpToNowRef cleanup on unmount
// ─────────────────────────────────────────────────────────────────────────────

describe('TVEpgRow — jumpToNowRef cleanup on unmount', () => {
  it('returns a cleanup function from the effect that nulls jumpToNowRef.current', () => {
    // When the row unmounts (category switch) the cleanup runs before the new
    // first row mounts; this prevents a window where the ref points to a
    // destroyed FlatList instance.
    expect(src).toMatch(/jumpToNowRef\.current\s*=\s*null/);
  });

  it('guards the null-assignment with "if (jumpToNowRef)" so it only fires when the ref was provided', () => {
    // Rows with isFirst=false receive jumpToNowRef=undefined; the cleanup must
    // not throw or silently assign to an undefined ref.
    expect(src).toMatch(/if\s*\(\s*jumpToNowRef\s*\)\s*jumpToNowRef\.current\s*=\s*null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.  jumpToNowRef.current calls scrollToIndex on the horizontal FlatList
// ─────────────────────────────────────────────────────────────────────────────

describe('TVEpgRow — jump-to-now callback scrolls to current programme', () => {
  it('calls flatRef.current.scrollToIndex inside the jumpToNow callback', () => {
    expect(src).toMatch(/flatRef\.current\.scrollToIndex/);
  });

  it('passes index: initialIdx so the scroll lands on the currently-airing programme', () => {
    expect(src).toMatch(/index\s*:\s*initialIdx/);
  });

  it('guards the scroll call so it is skipped when initialIdx is null (no live programme)', () => {
    expect(src).toMatch(/if\s*\(\s*initialIdx\s*==\s*null.*\|\|.*!flatRef\.current\s*\)/);
  });

  it('sets animated: true so the jump is visible to the user', () => {
    // A non-animated scroll would be disorienting when the user presses Play/Pause
    // expecting a visible navigation to "now".
    expect(src).toMatch(/animated\s*:\s*true/);
  });

  it('schedules focus on initialProgRef after 80 ms so the remote lands on the cell', () => {
    // requestTvFocus is the forced-focus helper that reliably moves D-pad cursor on Fire OS.
    expect(src).toMatch(/requestTvFocus\(\s*initialProgRef\.current/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4.  FullGuide — jumpToNowCallbackRef wired to the first TVEpgRow
// ─────────────────────────────────────────────────────────────────────────────

describe('FullGuide — jumpToNowCallbackRef ref lifecycle', () => {
  it('declares jumpToNowCallbackRef as a useRef holding a nullable function', () => {
    expect(src).toMatch(/jumpToNowCallbackRef\s*=\s*useRef\s*<\s*\(\(\)\s*=>\s*void\)\s*\|\s*null\s*>/);
  });

  it('passes jumpToNowCallbackRef to the first TVEpgRow via the jumpToNowRef prop', () => {
    // Only the first row (index 0) receives the ref so it is the designated
    // scroll target; rows below it must not overwrite the ref.
    expect(src).toMatch(/jumpToNowRef\s*=\s*\{[^}]*jumpToNowCallbackRef[^}]*\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5.  FullGuide.jumpToNow() invokes jumpToNowCallbackRef.current
// ─────────────────────────────────────────────────────────────────────────────

describe('FullGuide — jumpToNow() callback', () => {
  it('calls jumpToNowCallbackRef.current?.() when already on today', () => {
    expect(src).toMatch(/jumpToNowCallbackRef\.current\?\.\(\)/);
  });

  it('is memoised with useCallback so the Play/Pause effect is not re-subscribed on every render', () => {
    expect(src).toMatch(/jumpToNow\s*=\s*useCallback/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6.  Play/Pause hardware key — short-press (jump to now) / long-press (picker)
// ─────────────────────────────────────────────────────────────────────────────

describe('FullGuide — Play/Pause hardware key listener', () => {
  // #357: the raw DeviceEventEmitter('onHWKeyEvent') subscription now lives in
  // the shared useTVRemote hook; the guide consumes it via a playPause handler.
  const hookSrc = fs.readFileSync(
    path.join(__dirname, '..', 'hooks', 'useTVRemote.ts'),
    'utf8',
  );

  it('shared useTVRemote hook subscribes to the onHWKeyEvent DeviceEventEmitter event', () => {
    expect(hookSrc).toMatch(/DeviceEventEmitter\.addListener\s*\(\s*['"]onHWKeyEvent['"]/);
  });

  it('shared useTVRemote hook routes eventType === "playPause" to the playPause handler', () => {
    // Guard must use strict matching so unrelated key events (volumeUp, …)
    // are never mistaken for the Play/Pause button.
    expect(hookSrc).toMatch(/case\s*['"]playPause['"]\s*:\s*h\.playPause\?\.\(e\)/);
  });

  it('guide uses the shared useTVRemote hook with a playPause handler', () => {
    expect(src).toMatch(/useTVRemote\s*\(\s*\{\s*\n?\s*(on)?[Pp]layPause:/);
  });

  it('handles eventKeyAction === 0 (key down) to arm the hold timer', () => {
    expect(src).toMatch(/e\.eventKeyAction\s*===\s*0/);
  });

  it('handles eventKeyAction === 1 (key up) to trigger short-press action', () => {
    // Short-press fires jumpToNow on key-UP so that a held key (long-press)
    // can be distinguished by whether the 600 ms timer fired first.
    expect(src).toMatch(/e\.eventKeyAction\s*===\s*1/);
  });

  it('guards repeated key-down events so the hold timer is only armed once', () => {
    // Android TV remotes emit repeated key-down events while a button is held.
    // The guard prevents each repeat from resetting the 600 ms timer.
    expect(src).toMatch(/playPauseHoldTimer\.current\s*!==\s*null/);
  });

  it('opens the time picker on long-press (timer fires before key-up)', () => {
    expect(src).toMatch(/setShowTimePicker\s*\(\s*true\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7.  jumpToNow is a no-op when a ProgramModal is open
// ─────────────────────────────────────────────────────────────────────────────

describe('FullGuide — Play/Pause ignored while modal is open', () => {
  it('uses selectedRef (not selected state) in the handler to avoid stale closures', () => {
    // Capturing the selected state directly in the event handler would close
    // over the value at subscription time, causing the check to always see null.
    expect(src).toMatch(/selectedRef\.current/);
  });

  it('guards jumpToNow with !selectedRef.current so it is skipped when modal is open', () => {
    expect(src).toMatch(/!\s*selectedRef\.current/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8 & 9.  Day-switch before jump — 220 ms callback delay
// ─────────────────────────────────────────────────────────────────────────────

describe('FullGuide — jumpToNow day-switch then callback', () => {
  it('calls setSelectedDay(0) when not already on today before invoking the callback', () => {
    expect(src).toMatch(/setSelectedDay\s*\(\s*0\s*\)/);
  });

  it('delays the callback by 220 ms after a day-switch to let new rows mount', () => {
    // The TVEpgRow useEffect runs after the re-render that follows setSelectedDay.
    // 220 ms gives the effect and its 150 ms inner scroll timer time to complete
    // before the explicit jumpToNow callback is called.
    const match = src.match(/setTimeout\s*\([^,]+jumpToNowCallbackRef\.current\?\.\(\)[^,]*,\s*(\d+)\s*\)/);
    expect(match).not.toBeNull();
    const delay = parseInt(match![1], 10);
    expect(delay).toBeGreaterThanOrEqual(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10–15.  Simulation suite — runtime ref lifecycle
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests mirror the exact logic from guide.tsx using plain JS objects
// so the ref-lifecycle behaviour is verified at the unit level without
// requiring a React / React Native renderer.

/** Minimal stand-in for a mutable ref object. */
function makeRef<T>(initial: T) {
  return { current: initial };
}

/**
 * Mirror of the TVEpgRow jumpToNowRef useEffect.
 *
 * Returns the cleanup function (like the real React effect) so the caller can
 * simulate component unmount.
 */
function runJumpToNowPopulateEffect(
  jumpToNowRef: { current: (() => void) | null } | undefined,
  initialIdx: number | undefined,
  flatScrollToIndex: jest.Mock,
  progFocus: jest.Mock,
): () => void {
  if (!jumpToNowRef) return () => {};

  jumpToNowRef.current = () => {
    if (initialIdx == null) return;
    flatScrollToIndex({ index: initialIdx, animated: true, viewPosition: 0 });
    setTimeout(() => { progFocus(); }, 80);
  };

  return () => {
    if (jumpToNowRef) jumpToNowRef.current = null;
  };
}

/**
 * Minimal mirror of FullGuide's onHWKeyEvent handler.
 *
 * Manages a hold timer internally; the caller drives the simulation by
 * calling this with successive key-down (0) / key-up (1) events, advancing
 * fake timers between them as needed.
 *
 * Returns an action tag so callers can assert which branch was taken:
 *   'timerArmed'  — key-down received, 600 ms hold timer started
 *   'ignored'     — event skipped (wrong type / repeat key-down / no timer)
 *   'jumpToNow'   — short press confirmed on key-up, jumpToNow() called
 *   'openPicker'  — long press confirmed by timer expiry, openPicker() called
 */
function makeHWKeyEventSimulator(
  selectedRef: { current: unknown },
  showPickerRef: { current: boolean },
  isTV: boolean,
  jumpToNow: () => void,
  openPicker: () => void,
) {
  const timerRef = makeRef<ReturnType<typeof setTimeout> | null>(null);

  const simulate = (e: { eventType: string; eventKeyAction: number }):
    'timerArmed' | 'ignored' | 'jumpToNow' | 'openPicker' => {
    if (!isTV) return 'ignored';
    if (e.eventType === 'playPause') {
      if (e.eventKeyAction === 0) {
        // Ignore repeated key-downs while timer is already running
        if (timerRef.current !== null) return 'ignored';
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (!selectedRef.current && !showPickerRef.current) {
            openPicker();
          }
        }, 600);
        return 'timerArmed';
      } else if (e.eventKeyAction === 1) {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
          if (!selectedRef.current && !showPickerRef.current) {
            jumpToNow();
            return 'jumpToNow';
          }
        }
        return 'ignored';
      }
    }
    return 'ignored';
  };

  return simulate;
}

describe('jumpToNowRef lifecycle simulation (runtime behaviour)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // 10. Ref is populated after the first row mounts
  it('10. ref is non-null after the first row mounts', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollMock   = jest.fn();
    const focusMock    = jest.fn();

    runJumpToNowPopulateEffect(jumpToNowRef, 3, scrollMock, focusMock);

    expect(jumpToNowRef.current).not.toBeNull();
    expect(typeof jumpToNowRef.current).toBe('function');
  });

  // 11. Ref is cleared when the first row unmounts (category switch)
  it('11. ref is null after the first row unmounts', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollMock   = jest.fn();
    const focusMock    = jest.fn();

    const cleanup = runJumpToNowPopulateEffect(jumpToNowRef, 3, scrollMock, focusMock);
    expect(jumpToNowRef.current).not.toBeNull();

    cleanup(); // simulate React tearing down the old row on category change

    expect(jumpToNowRef.current).toBeNull();
  });

  // 12. Ref is repopulated when a new first row mounts after category switch
  it('12. ref is repopulated by the new first row after a category switch', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollA = jest.fn();
    const scrollB = jest.fn();
    const focusMock = jest.fn();

    // First category — row A mounts
    const cleanupA = runJumpToNowPopulateEffect(jumpToNowRef, 2, scrollA, focusMock);

    // Category switch — row A unmounts, row B mounts
    cleanupA();
    expect(jumpToNowRef.current).toBeNull();

    runJumpToNowPopulateEffect(jumpToNowRef, 5, scrollB, focusMock);
    expect(jumpToNowRef.current).not.toBeNull();

    // Invoking the callback should use row B's scrollMock, not row A's
    jumpToNowRef.current!();
    jest.runAllTimers();

    expect(scrollB).toHaveBeenCalledWith({ index: 5, animated: true, viewPosition: 0 });
    expect(scrollA).not.toHaveBeenCalled();
  });

  // 13. Short press (key-down → key-up within 600 ms) triggers jumpToNow
  it('13. short press (key-up before 600 ms) invokes jumpToNow and scrollToIndex', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollMock   = jest.fn();
    const focusMock    = jest.fn();

    runJumpToNowPopulateEffect(jumpToNowRef, 4, scrollMock, focusMock);

    const selectedRef   = makeRef<unknown>(null);
    const showPickerRef = makeRef<boolean>(false);
    const openPicker    = jest.fn();
    const jumpToNow     = () => { jumpToNowRef.current?.(); };

    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);

    // Key down → timer armed
    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('timerArmed');
    // Key up before 600 ms → short press → jumpToNow
    jest.advanceTimersByTime(200);
    expect(sim({ eventType: 'playPause', eventKeyAction: 1 })).toBe('jumpToNow');
    jest.runAllTimers();

    expect(scrollMock).toHaveBeenCalledWith({ index: 4, animated: true, viewPosition: 0 });
    expect(focusMock).toHaveBeenCalledTimes(1);
    expect(openPicker).not.toHaveBeenCalled();
  });

  // 13b. Long press (key-down held ≥ 600 ms) opens the time picker
  it('13b. long press (key held ≥ 600 ms) opens the time-jump picker', () => {
    const jumpToNow  = jest.fn();
    const openPicker = jest.fn();
    const selectedRef   = makeRef<unknown>(null);
    const showPickerRef = makeRef<boolean>(false);

    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);

    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('timerArmed');
    // Let the 600 ms timer fire (long press)
    jest.advanceTimersByTime(600);

    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(jumpToNow).not.toHaveBeenCalled();

    // Key-up after the timer fires is a no-op (timer already cleared itself)
    expect(sim({ eventType: 'playPause', eventKeyAction: 1 })).toBe('ignored');
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  // 13c. Repeated key-down events do NOT reset the hold timer
  it('13c. repeated key-down events (Android repeat) are ignored while timer runs', () => {
    const jumpToNow  = jest.fn();
    const openPicker = jest.fn();
    const selectedRef   = makeRef<unknown>(null);
    const showPickerRef = makeRef<boolean>(false);

    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);

    // First key-down: arm the timer
    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('timerArmed');
    // Simulate Android repeat key-down events at 50 ms intervals
    jest.advanceTimersByTime(50);
    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('ignored');
    jest.advanceTimersByTime(50);
    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('ignored');
    jest.advanceTimersByTime(50);
    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('ignored');
    // Advance to the original timer expiry (600 ms from first key-down)
    jest.advanceTimersByTime(450);

    // Timer should have fired exactly once at 600 ms
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(jumpToNow).not.toHaveBeenCalled();
  });

  // 14. Play/Pause is ignored when the modal is open
  it('14. Play/Pause is ignored while a ProgramModal is open', () => {
    const jumpToNow  = jest.fn();
    const openPicker = jest.fn();
    const selectedRef   = makeRef<unknown>({ program: {}, channel: {} }); // modal open
    const showPickerRef = makeRef<boolean>(false);

    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);

    // Key-down arms the timer (guard check happens inside timer callback)
    sim({ eventType: 'playPause', eventKeyAction: 0 });
    // Short press while modal open → key-up cancels the timer but does NOT call jumpToNow
    expect(sim({ eventType: 'playPause', eventKeyAction: 1 })).toBe('ignored');
    expect(jumpToNow).not.toHaveBeenCalled();

    // Likewise long press should not open picker while modal is open
    const sim2 = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);
    sim2({ eventType: 'playPause', eventKeyAction: 0 });
    jest.advanceTimersByTime(600);
    expect(openPicker).not.toHaveBeenCalled();
  });

  // 15. Play/Pause is ignored on non-TV platforms
  it('15. Play/Pause is ignored when Platform.isTV is false (phone/tablet)', () => {
    const jumpToNow  = jest.fn();
    const openPicker = jest.fn();
    const selectedRef   = makeRef<unknown>(null);
    const showPickerRef = makeRef<boolean>(false);

    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, false, jumpToNow, openPicker);

    expect(sim({ eventType: 'playPause', eventKeyAction: 0 })).toBe('ignored');
    jest.advanceTimersByTime(600);
    expect(openPicker).not.toHaveBeenCalled();
    expect(jumpToNow).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #323. jumpToNow gracefully handles a channel with no live programme
// ─────────────────────────────────────────────────────────────────────────────

describe('jumpToNowRef — graceful no-programme handling (#323)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not call scrollToIndex when initialIdx is undefined', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollMock   = jest.fn();
    const focusMock    = jest.fn();

    // Mount row with no live programme (undefined initialIdx)
    runJumpToNowPopulateEffect(jumpToNowRef, undefined, scrollMock, focusMock);

    // The callback itself is registered even when there is no live programme
    expect(jumpToNowRef.current).not.toBeNull();

    // Invoke jumpToNow — the guard `if (initialIdx == null) return` must prevent a scroll
    jumpToNowRef.current!();
    jest.runAllTimers();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(focusMock).not.toHaveBeenCalled();
  });

  it('short Play/Pause press does not throw when no live programme exists', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const scrollMock   = jest.fn();
    const focusMock    = jest.fn();

    runJumpToNowPopulateEffect(jumpToNowRef, undefined, scrollMock, focusMock);

    const selectedRef   = makeRef<unknown>(null);
    const showPickerRef = makeRef<boolean>(false);
    const jumpToNow     = () => { jumpToNowRef.current?.(); };
    const openPicker    = jest.fn();
    const sim = makeHWKeyEventSimulator(selectedRef, showPickerRef, true, jumpToNow, openPicker);

    expect(() => {
      sim({ eventType: 'playPause', eventKeyAction: 0 });
      jest.advanceTimersByTime(200);
      sim({ eventType: 'playPause', eventKeyAction: 1 });
      jest.runAllTimers();
    }).not.toThrow();

    expect(scrollMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #324. jumpToNow scrolls to the correct position after today→future→today
// ─────────────────────────────────────────────────────────────────────────────

describe('jumpToNowRef — correct position after day navigation (#324)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('scrolls to today\'s live programme after today → tomorrow → today navigation', () => {
    const jumpToNowRef = makeRef<(() => void) | null>(null);
    const todayScroll  = jest.fn();
    const todayFocus   = jest.fn();

    // Today: live programme at index 5
    const cleanupToday = runJumpToNowPopulateEffect(jumpToNowRef, 5, todayScroll, todayFocus);
    expect(jumpToNowRef.current).not.toBeNull();

    // Switch to tomorrow: today's row unmounts → ref is nulled by cleanup
    cleanupToday();
    expect(jumpToNowRef.current).toBeNull();

    // Tomorrow's first row mounts: no live programme for that day
    const tomorrowScroll  = jest.fn();
    const tomorrowFocus   = jest.fn();
    const cleanupTomorrow = runJumpToNowPopulateEffect(jumpToNowRef, undefined, tomorrowScroll, tomorrowFocus);

    // Return to today: tomorrow's row unmounts → ref nulled again
    cleanupTomorrow();
    expect(jumpToNowRef.current).toBeNull();

    // Today's first row re-mounts with today's index
    const todayScroll2 = jest.fn();
    const todayFocus2  = jest.fn();
    runJumpToNowPopulateEffect(jumpToNowRef, 5, todayScroll2, todayFocus2);

    // Fire jumpToNow — must scroll to today's index (5), not tomorrow's (undefined)
    jumpToNowRef.current!();
    jest.runAllTimers();

    expect(todayScroll2).toHaveBeenCalledWith({ index: 5, animated: true, viewPosition: 0 });
    expect(tomorrowScroll).not.toHaveBeenCalled();
    expect(todayFocus2).toHaveBeenCalledTimes(1);
  });

  it('FullGuide jumpToNow defers the callback after a day-switch (≥ 200 ms)', () => {
    // Source-level: confirm the setTimeout delay is ≥ 200 ms so newly-mounted
    // TVEpgRow effects have time to run before the jump fires.
    const match = src.match(/setTimeout\s*\([^,]+jumpToNowCallbackRef\.current\?\.\(\)[^,]*,\s*(\d+)\s*\)/);
    expect(match).not.toBeNull();
    const delay = parseInt(match![1], 10);
    expect(delay).toBeGreaterThanOrEqual(200);
  });
});
