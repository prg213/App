/**
 * Task #282 — CatchupSheet day-switch focus: behavioral tests
 *
 * Tests the two-effect state machine in CatchupSheet that governs TV D-pad
 * focus placement when the user switches days:
 *
 *   Effect A ([selectedDay])
 *     – Synchronously sets focusPlacedOnDayPillRef (before the timeout) so
 *       the data-arrival effect can see the flag even if data resolves within
 *       the 100 ms mount delay.
 *     – After the 100 ms delay, focuses the first playable row if data was
 *       already available, or the day pill if still loading — BUT only if
 *       focusPlacedOnDayPillRef is still true (data-arrival effect may have
 *       cleared it and already moved focus to the row).
 *
 *   Effect B ([firstPlayableIndex])
 *     – Fires whenever firstPlayableIndex changes.
 *     – If focusPlacedOnDayPillRef is true and firstPlayableIndex is valid,
 *       clears the flag and focuses the first playable row.
 *
 * Why simulate instead of render?
 * ────────────────────────────────
 * React Native TV focus (hasTVPreferredFocus, setNativeProps) is resolved by
 * the native layer on an actual device — jsdom/node cannot drive it.
 * The simulation mirrors the exact conditional logic from CatchupSheet.tsx.
 * Fake timers let us control the 100 ms delay to reproduce both orderings of
 * the data-arrival / timeout race.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeViewMock() {
  return { setNativeProps: jest.fn() };
}

interface SimRefs {
  firstPlayableRowRef: { current: ReturnType<typeof makeViewMock> | null };
  firstDayPillRef: { current: ReturnType<typeof makeViewMock> | null };
  dayChangedRef: { current: boolean };
  focusPlacedOnDayPillRef: { current: boolean };
}

function makeRefs(): SimRefs {
  return {
    firstPlayableRowRef: { current: makeViewMock() },
    firstDayPillRef: { current: makeViewMock() },
    dayChangedRef: { current: false },
    focusPlacedOnDayPillRef: { current: false },
  };
}

/**
 * Mirror of the [selectedDay] useEffect body from CatchupSheet.tsx.
 *
 * Returns a cleanup function (like the real effect) so the caller can cancel
 * the pending timeout.  Call `jest.runAllTimers()` to advance time past the
 * 100 ms delay.
 */
function runDaySwitchEffect(
  refs: SimRefs,
  firstPlayableIndex: number,
): (() => void) | 'skipped-initial-mount' {
  if (!refs.dayChangedRef.current) {
    refs.dayChangedRef.current = true;
    return 'skipped-initial-mount';
  }

  // Synchronous sentinel — must happen before the timeout (race-safe).
  if (firstPlayableIndex !== -1) {
    refs.focusPlacedOnDayPillRef.current = false;
  } else {
    refs.focusPlacedOnDayPillRef.current = true;
  }

  const id = setTimeout(() => {
    if (firstPlayableIndex !== -1) {
      refs.firstPlayableRowRef.current?.setNativeProps({ hasTVPreferredFocus: true });
    } else if (refs.focusPlacedOnDayPillRef.current) {
      // Only focus day pill if data-arrival effect hasn't already cleared the flag.
      refs.firstDayPillRef.current?.setNativeProps({ hasTVPreferredFocus: true });
    }
    // else: data-arrival effect already moved focus; nothing to do.
  }, 100);

  return () => clearTimeout(id);
}

/**
 * Mirror of the [firstPlayableIndex] useEffect body from CatchupSheet.tsx.
 *
 * Returns a cleanup function.  Call `jest.runAllTimers()` to advance past the
 * 100 ms delay inside this effect too.
 */
function runDataArrivalEffect(
  refs: SimRefs,
  firstPlayableIndex: number,
): (() => void) | 'skipped' {
  if (!refs.focusPlacedOnDayPillRef.current) return 'skipped';
  if (firstPlayableIndex === -1) return 'skipped';

  refs.focusPlacedOnDayPillRef.current = false;

  const id = setTimeout(() => {
    refs.firstPlayableRowRef.current?.setNativeProps({ hasTVPreferredFocus: true });
  }, 100);

  return () => clearTimeout(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect A — [selectedDay] effect (with fake timers)
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet effect A [selectedDay] — data already loaded (#282)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('skips focus on the initial mount', () => {
    const refs = makeRefs();
    const result = runDaySwitchEffect(refs, 2);
    jest.runAllTimers();
    expect(result).toBe('skipped-initial-mount');
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('sets dayChangedRef on the initial mount so subsequent calls are not skipped', () => {
    const refs = makeRefs();
    runDaySwitchEffect(refs, 2);
    expect(refs.dayChangedRef.current).toBe(true);
  });

  it('focuses the first playable row after 100 ms when data is available', () => {
    const refs = makeRefs();
    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, 3); // real day switch, data loaded

    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled(); // before timer

    jest.runAllTimers();

    expect(refs.firstPlayableRowRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('sets focusPlacedOnDayPillRef=false synchronously when data is already loaded', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true; // simulate prior fallback
    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, 2); // day switch, data available
    // Must be cleared synchronously, before the timer fires.
    expect(refs.focusPlacedOnDayPillRef.current).toBe(false);
  });

  it('sets focusPlacedOnDayPillRef=true synchronously when data is not yet loaded', () => {
    const refs = makeRefs();
    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, -1); // day switch, loading
    // Must be set synchronously, before the timer fires.
    expect(refs.focusPlacedOnDayPillRef.current).toBe(true);
  });

  it('focuses the day pill after 100 ms when data has not loaded', () => {
    const refs = makeRefs();
    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, -1); // day switch, loading

    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled(); // before timer

    jest.runAllTimers();

    expect(refs.firstDayPillRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('skips day-pill focus in the timeout if data-arrival effect already cleared the flag', () => {
    // Simulate: flag was set synchronously, then data-arrival cleared it
    // before the 100 ms timeout fired.
    const refs = makeRefs();
    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, -1); // day switch, loading → sets flag=true

    // Simulate data-arrival effect clearing the flag before the timeout fires.
    refs.focusPlacedOnDayPillRef.current = false;

    jest.runAllTimers(); // timeout fires, but flag is false — must skip day pill

    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('cancels the timeout on cleanup (effect teardown before timer fires)', () => {
    const refs = makeRefs();
    runDaySwitchEffect(refs, 0); // initial mount
    const cleanup = runDaySwitchEffect(refs, -1);
    if (typeof cleanup === 'function') cleanup(); // simulate React tearing down the effect

    jest.runAllTimers(); // timer was cancelled — nothing should fire

    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Effect B — [firstPlayableIndex] data-arrival effect (with fake timers)
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet effect B [firstPlayableIndex] — data-arrival (#282)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does nothing when focusPlacedOnDayPillRef is false', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = false;
    const result = runDataArrivalEffect(refs, 2);
    jest.runAllTimers();
    expect(result).toBe('skipped');
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('does nothing when firstPlayableIndex is still -1 (data still loading)', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true;
    const result = runDataArrivalEffect(refs, -1);
    jest.runAllTimers();
    expect(result).toBe('skipped');
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('clears focusPlacedOnDayPillRef synchronously before the timeout', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true;
    runDataArrivalEffect(refs, 1);
    // Flag must be cleared before runAllTimers to be race-safe.
    expect(refs.focusPlacedOnDayPillRef.current).toBe(false);
  });

  it('focuses the first playable row after 100 ms when data arrives', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true;
    runDataArrivalEffect(refs, 1);

    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled(); // before timer

    jest.runAllTimers();

    expect(refs.firstPlayableRowRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
  });

  it('does not fire again if firstPlayableIndex changes a second time (flag already cleared)', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true;
    runDataArrivalEffect(refs, 1); // first arrival — clears flag
    jest.runAllTimers();

    jest.clearAllMocks();
    const result = runDataArrivalEffect(refs, 1); // same index — flag is false
    jest.runAllTimers();
    expect(result).toBe('skipped');
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('cancels the timeout on cleanup', () => {
    const refs = makeRefs();
    refs.focusPlacedOnDayPillRef.current = true;
    const cleanup = runDataArrivalEffect(refs, 1);
    if (typeof cleanup === 'function') cleanup();

    jest.runAllTimers();

    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Race scenario A: data arrives AFTER the 100 ms timeout fires (normal slow load)
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet slow-load: data arrives AFTER the 100 ms timeout (#282)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('day pill gets focus during loading, then row gets focus when data arrives', () => {
    const refs = makeRefs();

    // Initial mount (skipped).
    runDaySwitchEffect(refs, 0);

    // User switches to a past day; data not yet loaded.
    runDaySwitchEffect(refs, -1); // sets flag=true synchronously
    expect(refs.focusPlacedOnDayPillRef.current).toBe(true);

    // 100 ms passes — day pill receives focus (data still not here).
    jest.runAllTimers();
    expect(refs.firstDayPillRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();

    // Data arrives — data-arrival effect fires with firstPlayableIndex = 2.
    jest.clearAllMocks();
    runDataArrivalEffect(refs, 2); // clears flag, schedules row focus
    expect(refs.focusPlacedOnDayPillRef.current).toBe(false);
    jest.runAllTimers();
    expect(refs.firstPlayableRowRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Race scenario B: data arrives BEFORE the 100 ms timeout fires (fast query)
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet fast-load: data arrives BEFORE the 100 ms timeout (#282)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('data-arrival effect moves focus to the row; timeout skips day-pill because flag is cleared', () => {
    const refs = makeRefs();

    // Initial mount (skipped).
    runDaySwitchEffect(refs, 0);

    // User switches to a past day; data not yet loaded.
    runDaySwitchEffect(refs, -1); // sets flag=true synchronously
    expect(refs.focusPlacedOnDayPillRef.current).toBe(true);

    // Data resolves before the 100 ms timer fires.
    // Data-arrival effect runs: flag cleared, row focus scheduled at +100 ms.
    runDataArrivalEffect(refs, 3);
    expect(refs.focusPlacedOnDayPillRef.current).toBe(false);

    // Advance time — the data-arrival timeout fires (row gets focus).
    // The day-switch timeout also fires but flag is false so it skips day pill.
    jest.runAllTimers();

    expect(refs.firstPlayableRowRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    // Day pill must NOT have been focused — data-arrival handled it cleanly.
    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();
  });

  it('day has no playable rows even after data arrives — focus stays on day pill', () => {
    const refs = makeRefs();

    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, -1); // day switch, loading → flag=true

    // Data arrives but the day has zero playable programmes.
    const result = runDataArrivalEffect(refs, -1); // still -1 — skipped
    expect(result).toBe('skipped');
    expect(refs.focusPlacedOnDayPillRef.current).toBe(true); // flag still set

    jest.runAllTimers(); // day-switch timeout fires — day pill gets focus
    expect(refs.firstDayPillRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Data-already-cached path: no loading state at all
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet cached data path: data available immediately (#282)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('focuses row directly; data-arrival effect is a no-op afterward', () => {
    const refs = makeRefs();

    runDaySwitchEffect(refs, 0); // initial mount
    runDaySwitchEffect(refs, 4); // switch to cached day — flag=false, row focus scheduled

    expect(refs.focusPlacedOnDayPillRef.current).toBe(false);

    jest.runAllTimers();
    expect(refs.firstPlayableRowRef.current!.setNativeProps).toHaveBeenCalledWith({
      hasTVPreferredFocus: true,
    });
    expect(refs.firstDayPillRef.current!.setNativeProps).not.toHaveBeenCalled();

    // Data-arrival fires (e.g., TanStack re-fetches and index stays 4) — no-op.
    jest.clearAllMocks();
    const result = runDataArrivalEffect(refs, 4);
    jest.runAllTimers();
    expect(result).toBe('skipped');
    expect(refs.firstPlayableRowRef.current!.setNativeProps).not.toHaveBeenCalled();
  });
});
