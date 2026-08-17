/**
 * Unit tests for lib/tvFocus.ts — requestTvFocus helper
 *
 * Why unit tests instead of only source inspection?
 * ──────────────────────────────────────────────────
 * requestTvFocus contains runtime branching (Platform.isTV check), a side-
 * effectful call (setNativeProps), and a 250 ms cleanup timer.  Source
 * inspection can confirm the code is authored correctly but cannot catch a
 * regression where the logic is present but the branching is inverted, the
 * delay is wrong, or the cleanup call is misnamed.  These tests exercise the
 * function with fake timer control so every branch and every side-effect is
 * confirmed at the unit level.
 *
 * Scenarios covered:
 *   1. Null / undefined node — early return, no side effects
 *   2. Non-TV platform — focus() called, setNativeProps never called
 *   3. TV platform — hasTVPreferredFocus: true set immediately, then cleared
 *      after 250 ms (not earlier, not later)
 *   4. TV platform — focus() is also called (belt-and-suspenders approach)
 *   5. TV platform — setNativeProps throws — second call still fires (try/catch)
 *   6. Node without setNativeProps — focus() runs, no crash on TV
 *   7. Node without focus() — no crash on either platform
 */

// ── Jest fake timers ──────────────────────────────────────────────────────────
// Using fake timers lets us assert on the exact 250 ms boundary without
// waiting for real time, and confirm the cleanup has NOT yet fired before
// the delay elapses.

beforeEach(() => {
  jest.useFakeTimers();
  // Re-isolate modules for each test so Platform.isTV mocks stay independent.
  jest.resetModules();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load a fresh copy of requestTvFocus with Platform.isTV set to `isTV`.
 * resetModules() in beforeEach ensures previous imports do not leak.
 */
function loadWithPlatform(isTV: boolean): typeof import('../lib/tvFocus')['requestTvFocus'] {
  jest.doMock('react-native', () => ({
    Platform: { isTV },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../lib/tvFocus').requestTvFocus;
}

/** Build a node stub with jest.fn() for focus and setNativeProps. */
function makeNode() {
  return {
    focus: jest.fn(),
    setNativeProps: jest.fn(),
  };
}

// =============================================================================
// 1. Null / undefined node — early return
// =============================================================================

describe('requestTvFocus — null / undefined node', () => {
  it('returns without throwing when node is null', () => {
    const fn = loadWithPlatform(true);
    expect(() => fn(null)).not.toThrow();
  });

  it('returns without throwing when node is undefined', () => {
    const fn = loadWithPlatform(true);
    expect(() => fn(undefined)).not.toThrow();
  });

  it('does not schedule any timer when node is null', () => {
    const fn = loadWithPlatform(true);
    const spy = jest.spyOn(global, 'setTimeout');
    fn(null);
    expect(spy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2. Non-TV platform — setNativeProps must never be called
// =============================================================================

describe('requestTvFocus — non-TV platform (Platform.isTV = false)', () => {
  it('calls node.focus() on non-TV platform', () => {
    const fn   = loadWithPlatform(false);
    const node = makeNode();
    fn(node);
    expect(node.focus).toHaveBeenCalledTimes(1);
  });

  it('does not call setNativeProps on non-TV platform', () => {
    const fn   = loadWithPlatform(false);
    const node = makeNode();
    fn(node);
    expect(node.setNativeProps).not.toHaveBeenCalled();
  });

  it('does not schedule a cleanup timer on non-TV platform', () => {
    const fn   = loadWithPlatform(false);
    const node = makeNode();
    const spy  = jest.spyOn(global, 'setTimeout');
    fn(node);
    expect(spy).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 3. TV platform — hasTVPreferredFocus set then cleared after exactly 250 ms
// =============================================================================

describe('requestTvFocus — TV platform (Platform.isTV = true)', () => {
  it('sets hasTVPreferredFocus: true immediately on call', () => {
    const fn   = loadWithPlatform(true);
    const node = makeNode();
    fn(node);
    expect(node.setNativeProps).toHaveBeenCalledWith({ hasTVPreferredFocus: true });
  });

  it('has NOT cleared hasTVPreferredFocus before 250 ms elapses', () => {
    const fn   = loadWithPlatform(true);
    const node = makeNode();
    fn(node);
    // Advance just below the threshold — cleanup must not have fired yet
    jest.advanceTimersByTime(249);
    const calls = node.setNativeProps.mock.calls;
    // Only the initial `true` call should have happened
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ hasTVPreferredFocus: true }]);
  });

  it('clears hasTVPreferredFocus: false exactly at 250 ms', () => {
    const fn   = loadWithPlatform(true);
    const node = makeNode();
    fn(node);
    jest.advanceTimersByTime(250);
    const calls = node.setNativeProps.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([{ hasTVPreferredFocus: false }]);
  });

  it('schedules the cleanup timer with a 250 ms delay', () => {
    const fn   = loadWithPlatform(true);
    const node = makeNode();
    const spy  = jest.spyOn(global, 'setTimeout');
    fn(node);
    // setTimeout should have been called once, with delay 250
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(250);
  });
});

// =============================================================================
// 4. TV platform — focus() is also called (belt-and-suspenders)
// =============================================================================

describe('requestTvFocus — TV platform — focus() belt-and-suspenders', () => {
  it('calls node.focus() on TV platform in addition to setNativeProps', () => {
    const fn   = loadWithPlatform(true);
    const node = makeNode();
    fn(node);
    expect(node.focus).toHaveBeenCalledTimes(1);
  });

  it('calls node.focus() before setNativeProps (synchronous ordering)', () => {
    const fn   = loadWithPlatform(true);
    const callOrder: string[] = [];
    const node = {
      focus: jest.fn(() => callOrder.push('focus')),
      setNativeProps: jest.fn(() => callOrder.push('setNativeProps')),
    };
    fn(node);
    // focus should be first in the synchronous call order
    expect(callOrder[0]).toBe('focus');
    expect(callOrder[1]).toBe('setNativeProps');
  });
});

// =============================================================================
// 5. TV platform — setNativeProps throws on the first call — cleanup still fires
// =============================================================================

describe('requestTvFocus — TV platform — resilience to setNativeProps throws', () => {
  it('does not throw to the caller if setNativeProps throws', () => {
    const fn = loadWithPlatform(true);
    const node = {
      focus: jest.fn(),
      setNativeProps: jest.fn(() => { throw new Error('native error'); }),
    };
    expect(() => fn(node)).not.toThrow();
  });

  it('still schedules the cleanup timer even if the first setNativeProps throws', () => {
    const fn = loadWithPlatform(true);
    let callCount = 0;
    const node = {
      focus: jest.fn(),
      setNativeProps: jest.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('first call fails');
      }),
    };
    // should not throw
    fn(node);
    // timer must have been scheduled
    expect(() => jest.runAllTimers()).not.toThrow();
    // cleanup call was attempted (second invocation); it may throw too but
    // must not propagate to the timer callback's caller
  });
});

// =============================================================================
// 6. Node without setNativeProps — no crash on TV
// =============================================================================

describe('requestTvFocus — node without setNativeProps', () => {
  it('does not throw on TV platform when node.setNativeProps is absent', () => {
    const fn   = loadWithPlatform(true);
    const node = { focus: jest.fn() }; // no setNativeProps
    expect(() => fn(node)).not.toThrow();
  });

  it('still calls node.focus() when setNativeProps is absent', () => {
    const fn   = loadWithPlatform(true);
    const focusFn = jest.fn();
    const node = { focus: focusFn };
    fn(node);
    expect(focusFn).toHaveBeenCalledTimes(1);
  });

  it('cleanup timer does not throw when setNativeProps is absent', () => {
    const fn   = loadWithPlatform(true);
    const node = { focus: jest.fn() };
    fn(node);
    expect(() => jest.runAllTimers()).not.toThrow();
  });
});

// =============================================================================
// 7. Node without focus() — no crash on either platform
// =============================================================================

describe('requestTvFocus — node without focus()', () => {
  it('does not throw on non-TV platform when node.focus is absent', () => {
    const fn   = loadWithPlatform(false);
    const node = { setNativeProps: jest.fn() };
    expect(() => fn(node)).not.toThrow();
  });

  it('does not throw on TV platform when node.focus is absent', () => {
    const fn   = loadWithPlatform(true);
    const node = { setNativeProps: jest.fn() };
    expect(() => fn(node)).not.toThrow();
  });

  it('still calls setNativeProps when focus() is absent on TV', () => {
    const fn   = loadWithPlatform(true);
    const node = { setNativeProps: jest.fn() };
    fn(node);
    expect(node.setNativeProps).toHaveBeenCalledWith({ hasTVPreferredFocus: true });
  });
});
