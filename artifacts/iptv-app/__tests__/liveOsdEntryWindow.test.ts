/**
 * Regression guard: the live TV OSD info bar must stay visible when the user
 * manually opens it (OK press) during the automatic 5-second entry window.
 *
 * Root cause
 * ──────────
 * The nested `setTimeout(() => setShowInfo(false), 420)` inside the 5-second
 * entry timer was not stored in any ref, so `showInfoBar()` could not cancel
 * it.  If the user pressed OK during the 5-second window, `showInfoBar(true)`
 * set `showInfo = true`, but the orphaned 420 ms timer fired shortly after
 * t=5 s and set it back to `false` — collapsing the bar the user just opened.
 *
 * The fix stores every dismiss timer in `dismissTimerRef` so `showInfoBar()`
 * can always cancel it before re-showing the bar.
 *
 * Test strategy
 * ─────────────
 * Two complementary layers:
 *
 * 1. Source-text assertions — verify the fix is present in player.tsx without
 *    requiring any native module mocks.
 *
 * 2. Pure-logic simulation with jest.useFakeTimers() — drive the exact timer
 *    sequence described in the task and assert on a local `showInfo` variable
 *    that mirrors the component's state, confirming the correctness of the fix.
 */

import * as fs from 'fs';
import * as path from 'path';

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Source-text assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('Source-text: entry-effect dismiss timer stored in dismissTimerRef', () => {
  /**
   * The entry useEffect for TV live TV schedules a 5-second auto-dismiss.
   * When it fires, it must store the 420 ms trailing hide timer in
   * `dismissTimerRef.current` so that `showInfoBar()` can cancel it.
   *
   * Locate the entry effect by its distinctive comment and verify that the
   * inner setTimeout assignment is `dismissTimerRef.current = setTimeout(`.
   */
  it('stores the 420 ms trailing hide timer in dismissTimerRef inside the 5s entry callback', () => {
    // The live TV entry effect is identified by its "Live TV entry:" comment.
    const entryIdx = player.indexOf('// Live TV entry:');
    expect(entryIdx).toBeGreaterThan(-1);

    // Grab the region from that comment to the closing `}, []);` of the effect.
    // The entry effect is relatively compact (~30 lines) so 1500 chars is enough.
    const entryRegion = player.slice(entryIdx, entryIdx + 1500);

    // The inner 420 ms timer must be assigned to dismissTimerRef.current.
    // Without the fix this was an anonymous `setTimeout(` with no ref assignment.
    expect(entryRegion).toMatch(/dismissTimerRef\.current\s*=\s*setTimeout/);
  });

  /**
   * `showInfoBar()` must clear `dismissTimerRef.current` before calling
   * `setShowInfo(true)` so any in-flight trailing hide cannot re-collapse
   * the bar the user just opened.
   */
  it('showInfoBar clears dismissTimerRef before setting showInfo to true', () => {
    const showInfoBarIdx = player.indexOf('const showInfoBar = useCallback(');
    expect(showInfoBarIdx).toBeGreaterThan(-1);

    // Read the body of showInfoBar (up to ~1 500 chars covers the whole function).
    const fnRegion = player.slice(showInfoBarIdx, showInfoBarIdx + 1500);

    // The ref must be cleared (pattern: clearTimeout(dismissTimerRef.current)).
    expect(fnRegion).toMatch(/clearTimeout\(\s*dismissTimerRef\.current\s*\)/);

    // The clear must appear BEFORE setShowInfo(true).
    const clearPos    = fnRegion.search(/clearTimeout\(\s*dismissTimerRef\.current\s*\)/);
    const setShowPos  = fnRegion.search(/setShowInfo\(\s*true\s*\)/);
    expect(clearPos).toBeLessThan(setShowPos);
  });

  /**
   * The 5-second entry timer must guard against the user-invoked flag before
   * scheduling any dismiss — this is the primary gate that prevents the timer
   * from even starting when the user has pinned the bar with OK.
   */
  it('entry-effect 5s callback checks infoBarUserInvokedRef before scheduling the dismiss', () => {
    const entryIdx = player.indexOf('// Live TV entry:');
    const entryRegion = player.slice(entryIdx, entryIdx + 1500);

    // The guard: `if (!infoBarUserInvokedRef.current) {`
    expect(entryRegion).toMatch(/!\s*infoBarUserInvokedRef\.current/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — Pure-logic fake-timer simulation
// ─────────────────────────────────────────────────────────────────────────────

describe('Fake-timer simulation: OSD stays visible when opened at t=2s within 5s entry window', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  /**
   * Simulate the timing sequence from player.tsx without mounting the component:
   *
   *  t=0       Entry effect fires on TV: showInfo=true, 5s auto-dismiss scheduled.
   *  t=2 000   User presses OK → showInfoBar(true): dismissTimerRef cleared,
   *              showInfo=true, infoBarUserInvokedRef=true, infoTimer cancelled.
   *  t=5 420   Without the fix the orphaned 420ms timer would set showInfo=false.
   *              With the fix it was either never scheduled (guard) or was
   *              cancelled by showInfoBar.  Either way showInfo must still be true.
   *  post      dismissInfoBar() schedules its own 320ms trailing timer.
   *  +320ms    setShowInfo(false) fires — the bar correctly goes away.
   */
  it('showInfo remains true at t=5420ms and becomes false only after explicit dismissInfoBar()', () => {
    // ── Local state / refs (mirror player.tsx) ──────────────────────────────
    let showInfo = false;
    const setShowInfo = (v: boolean) => { showInfo = v; };

    const infoBarUserInvokedRef = { current: false };
    const dismissTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const infoTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    // ── Simulate TV entry effect (t=0) ──────────────────────────────────────
    infoBarUserInvokedRef.current = false;
    setShowInfo(true);
    // infoOpacity.setValue(1) — not simulated (Animated is irrelevant here)

    infoTimer.current = setTimeout(() => {
      // Guard: only dismiss if the user hasn't pinned the bar.
      if (!infoBarUserInvokedRef.current) {
        // Fade-out animation not simulated.
        // THE FIX: store the trailing hide timer in dismissTimerRef.
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          setShowInfo(false);
        }, 420);
      }
    }, 5000);

    // Sanity: bar is visible at t=0.
    expect(showInfo).toBe(true);

    // ── t=2 000 ms: user presses OK → showInfoBar(true) ────────────────────
    jest.advanceTimersByTime(2000);

    // Mirrors showInfoBar(userInvoked=true) in player.tsx:
    infoBarUserInvokedRef.current = true;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setShowInfo(true);
    // User-invoked: also cancel the auto-dismiss so bar stays pinned.
    if (infoTimer.current) {
      clearTimeout(infoTimer.current);
      infoTimer.current = null;
    }

    expect(showInfo).toBe(true); // still visible right after OK press

    // ── t=5 420 ms: the orphaned timer would have fired ─────────────────────
    // The 5s entry timer fires at t=5000 but infoBarUserInvokedRef=true so it
    // does not schedule the 420ms dismiss.  Even if it had, showInfoBar() above
    // already cleared dismissTimerRef, so the trailing timer cannot fire.
    jest.advanceTimersByTime(3000 + 420); // 2000 + 3000 + 420 = t=5420

    // The OSD must still be visible — the bug would have set showInfo=false here.
    expect(showInfo).toBe(true);

    // ── Verify dismissInfoBar() does correctly hide the bar ─────────────────
    // Mirrors dismissInfoBar() in player.tsx:
    infoBarUserInvokedRef.current = false;
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setShowInfo(false);
    }, 320);

    // Bar is still visible during the fade-out window.
    jest.advanceTimersByTime(319);
    expect(showInfo).toBe(true);

    // Bar collapses after the 320ms trailing timer fires.
    jest.advanceTimersByTime(1);
    expect(showInfo).toBe(false);
  });

  /**
   * Edge-case: what if the user presses OK just as the 5s timer fires?
   * showInfoBar() runs concurrently with the entry timer's callback — in JS
   * both run synchronously in the same event-loop turn when fake timers are
   * advanced past 5000 ms.  Even in this worst case, dismissTimerRef must not
   * hold an orphaned timer after showInfoBar() completes.
   */
  it('dismissTimerRef is null after showInfoBar(true) regardless of prior 5s timer scheduling', () => {
    const infoBarUserInvokedRef = { current: false };
    const dismissTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const infoTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    let showInfo = true;
    const setShowInfo = (v: boolean) => { showInfo = v; };

    // Entry effect
    infoTimer.current = setTimeout(() => {
      // Worst case: guard passes (user hasn't pressed OK yet in this scenario)
      if (!infoBarUserInvokedRef.current) {
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          setShowInfo(false);
        }, 420);
      }
    }, 5000);

    // Advance to exactly t=5000 so the outer timer has fired and scheduled
    // the 420ms dismiss timer, but the 420ms has NOT elapsed yet.
    jest.advanceTimersByTime(5000);

    // dismissTimerRef.current is now set (the 420ms timer is live).
    expect(dismissTimerRef.current).not.toBeNull();

    // Now the user presses OK — showInfoBar(true) runs.
    infoBarUserInvokedRef.current = true;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setShowInfo(true);
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }

    // The 420ms dismiss timer must have been cancelled.
    expect(dismissTimerRef.current).toBeNull();

    // Advance past the 420ms window — showInfo must still be true.
    jest.advanceTimersByTime(420);
    expect(showInfo).toBe(true);
  });
});
