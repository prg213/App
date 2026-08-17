/**
 * sidebarNav.focus retry loop — unit tests
 *
 * The Sidebar's useEffect installs sidebarNav.focus with a ≤5 attempt, 80 ms
 * retry loop.  Fire TV can silently ignore a requestTvFocus call during a
 * sidebar animation, so the loop retries unconditionally rather than stopping
 * as soon as the ref is present.
 *
 * The retry timer lives in the effect closure so it can be cancelled by the
 * effect cleanup when the Sidebar unmounts.
 *
 * Why simulate instead of render?
 * ────────────────────────────────
 * Native TV focus (hasTVPreferredFocus / setNativeProps) is resolved by the
 * native layer on an actual device.  The simulation mirrors the exact
 * conditional logic from the _layout.tsx Sidebar useEffect so we can drive
 * it deterministically with fake timers.
 */

// ── Simulation helpers ────────────────────────────────────────────────────────

function makeNode() {
  return { focus: jest.fn(), setNativeProps: jest.fn() };
}

/**
 * Mirror of the requestTvFocus helper (lib/tvFocus.ts).
 * On TV it also toggles hasTVPreferredFocus via setNativeProps; we model that
 * to make the call counts realistic.
 */
function requestTvFocus(node: ReturnType<typeof makeNode> | null) {
  if (!node) return;
  node.focus();
  node.setNativeProps({ hasTVPreferredFocus: true });
  // The real helper clears the flag after 250 ms — not relevant to these tests.
}

/**
 * Mirror of the Sidebar useEffect body.
 *
 * Returns:
 *  - `register(ref)` — installs sidebarNav.focus pointing at the given ref.
 *  - `cleanup()` — simulates React tearing down the effect (unmount).
 *  - `focusFn()` — the installed sidebarNav.focus function.
 */
function makeEffectSim() {
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let focusFn!: () => void;
  let refCurrent: ReturnType<typeof makeNode> | null = null;

  // Simulates the ref object the Pressable writes to.
  const firstNavRef = { get current() { return refCurrent; } };

  // Install (mirrors the useEffect body).
  focusFn = () => {
    if (retryTimer !== undefined) { clearTimeout(retryTimer); retryTimer = undefined; }

    let attempts = 0;
    const tryFocus = () => {
      requestTvFocus(firstNavRef.current);
      if (++attempts < 5) retryTimer = setTimeout(tryFocus, 80);
    };
    tryFocus();
  };

  const cleanup = () => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
  };

  return {
    focusFn,
    cleanup,
    setRef(node: ReturnType<typeof makeNode> | null) { refCurrent = node; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sidebarNav.focus retry loop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls requestTvFocus immediately on the first attempt', () => {
    const node = makeNode();
    const sim = makeEffectSim();
    sim.setRef(node);

    sim.focusFn();

    // Attempt 0 fires synchronously.
    expect(node.focus).toHaveBeenCalledTimes(1);
  });

  it('retries up to 5 times, 80 ms apart', () => {
    const node = makeNode();
    const sim = makeEffectSim();
    sim.setRef(node);

    sim.focusFn();
    expect(node.focus).toHaveBeenCalledTimes(1); // attempt 0

    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(2); // attempt 1

    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(3); // attempt 2

    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(4); // attempt 3

    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(5); // attempt 4

    // No 6th attempt — loop stops at 5.
    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(5);
  });

  it('retries even when the ref is null (handles late mount)', () => {
    const sim = makeEffectSim();
    sim.setRef(null); // ref not yet populated

    // Should not throw; requestTvFocus(null) is a no-op.
    expect(() => sim.focusFn()).not.toThrow();

    // The node mounts while the retry loop is running.
    const node = makeNode();
    sim.setRef(node);

    jest.advanceTimersByTime(80);
    expect(node.focus).toHaveBeenCalledTimes(1); // caught by attempt 1
  });

  it('cancels the in-flight retry when focusFn is called a second time', () => {
    const node = makeNode();
    const sim = makeEffectSim();
    sim.setRef(node);

    sim.focusFn(); // starts retry sequence A
    jest.advanceTimersByTime(80); // attempt 1 of A fires
    expect(node.focus).toHaveBeenCalledTimes(2); // attempt 0 + attempt 1

    // Second call: cancels remaining A retries, starts fresh sequence B.
    jest.clearAllMocks();
    sim.focusFn();
    expect(node.focus).toHaveBeenCalledTimes(1); // attempt 0 of B

    jest.advanceTimersByTime(80 * 4);
    // B runs 4 more attempts (1–4), for a total of 5.  A's remaining 3 attempts
    // must not fire.
    expect(node.focus).toHaveBeenCalledTimes(5);
  });

  it('cancels the pending retry timer when the effect is cleaned up (unmount)', () => {
    const node = makeNode();
    const sim = makeEffectSim();
    sim.setRef(node);

    sim.focusFn();
    jest.advanceTimersByTime(80); // attempt 1 fires
    expect(node.focus).toHaveBeenCalledTimes(2);

    // Simulate Sidebar unmount — effect cleanup runs.
    sim.cleanup();

    jest.clearAllMocks();
    jest.advanceTimersByTime(80 * 10); // advance well past remaining attempts

    // No further focus calls after unmount.
    expect(node.focus).not.toHaveBeenCalled();
  });

  it('does not fire at all after unmount if cleanup runs before any retry', () => {
    const node = makeNode();
    const sim = makeEffectSim();
    sim.setRef(node);

    sim.focusFn();          // attempt 0 fires synchronously
    sim.cleanup();          // unmount immediately after

    jest.clearAllMocks();
    jest.advanceTimersByTime(80 * 10);

    expect(node.focus).not.toHaveBeenCalled();
  });
});
