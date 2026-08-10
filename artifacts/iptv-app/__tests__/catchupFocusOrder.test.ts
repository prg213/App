/**
 * Task #259 — CatchupSheet D-pad focus order on Firestick
 *
 * Future programme rows are non-focusable (`focusable={canPlay}`) so that
 * D-pad navigation on the Firestick skips them cleanly.  This test suite
 * inspects the source to confirm:
 *
 *   1. Every programme row passes `focusable={canPlay}` to FocusablePressable
 *      so future rows are excluded from the TV focus chain.
 *   2. `canPlay` is defined as `isPast || isCurrent` — the currently-airing
 *      (NOW) programme is always playable and therefore always focusable.
 *   3. The close button carries `hasTVPreferredFocus` so focus lands on it
 *      (not in a void) when D-pad reaches the end of the list.
 *   4. The `isCurrent` flag is derived from the programme's start/end window
 *      straddling `nowTs`, guaranteeing that the NOW row is never omitted from
 *      the focus chain due to an off-by-one on the boundary condition.
 *
 * Why source inspection instead of a render test?
 * ─────────────────────────────────────────────────
 * React Native TV focus (hasTVPreferredFocus, focusable) is resolved by the
 * native layer on an actual device or Apple/Fire TV emulator — jsdom/node
 * cannot simulate it.  Inspecting the source guarantees the correct props are
 * authored and that no refactor accidentally drops them.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load the production source once ──────────────────────────────────────────

const SOURCE_PATH = path.join(
  __dirname,
  '../components/CatchupSheet.tsx',
);

let src: string;

beforeAll(() => {
  src = fs.readFileSync(SOURCE_PATH, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. focusable prop — future rows must be excluded from the TV focus chain
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — programme row focusability (#259)', () => {
  it('passes focusable={canPlay} to FocusablePressable so future rows are non-focusable', () => {
    // The render loop must set `focusable` equal to `canPlay`.
    // Acceptable spellings: `focusable={canPlay}` or `focusable = {canPlay}`.
    expect(src).toMatch(/focusable=\{canPlay\}/);
  });

  it('does NOT hard-code focusable={true} on programme rows (would re-enable future rows)', () => {
    // If someone changed it to always-true the future-skip would break.
    // The only acceptable hard-coded true is on non-programme UI (e.g. day pills,
    // close button), so we check the programme-list section specifically by
    // confirming `focusable={true}` does not appear immediately before a
    // progRow-related style reference.
    //
    // Simpler guard: the file must NOT contain `focusable={true}` at all — day
    // pills and the close button rely on the default (omitting the prop means
    // focusable by default), not an explicit `true`.
    expect(src).not.toMatch(/focusable=\{true\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. canPlay definition — NOW row must always be focusable
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — canPlay includes isCurrent (#259)', () => {
  it('defines canPlay as isPast || isCurrent so the NOW row is always playable', () => {
    // Matches: const canPlay = isPast || isCurrent;
    expect(src).toMatch(/canPlay\s*=\s*isPast\s*\|\|\s*isCurrent/);
  });

  it('defines isCurrent using start <= nowTs < end (boundary-inclusive on start)', () => {
    // The NOW window must include the exact start moment so a programme that
    // just started is immediately focusable.
    // Matches: prog.start.getTime() <= nowTs && nowTs < prog.end.getTime()
    expect(src).toMatch(/prog\.start\.getTime\(\)\s*<=\s*nowTs/);
    expect(src).toMatch(/nowTs\s*<\s*prog\.end\.getTime\(\)/);
  });

  it('defines isPast using prog.end < nowTs so finished programmes remain playable', () => {
    // Matches: prog.end.getTime() < nowTs
    expect(src).toMatch(/prog\.end\.getTime\(\)\s*<\s*nowTs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. hasTVPreferredFocus on close button — focus lands somewhere after list ends
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — close button TV focus (#259)', () => {
  it('sets hasTVPreferredFocus on the close button so focus is not lost after skipping future rows', () => {
    // When D-pad passes the last playable row and all remaining rows are Future,
    // the TV focus engine looks for hasTVPreferredFocus to decide where to jump.
    // The close button is the designated landing target.
    expect(src).toMatch(/hasTVPreferredFocus/);
  });

  it('hasTVPreferredFocus is on the close button FocusablePressable, not a programme row', () => {
    // There may be multiple hasTVPreferredFocus occurrences (e.g. the
    // day-change effect also uses it via setNativeProps).  We need at least
    // one occurrence whose ±300-char window overlaps the close button markup.
    const closeButtonPattern = /onClose|✕|closeIcon|closeTouchable/;
    let searchFrom = 0;
    let foundCloseButton = false;
    while (true) {
      const idx = src.indexOf('hasTVPreferredFocus', searchFrom);
      if (idx === -1) break;
      const window = src.slice(Math.max(0, idx - 300), idx + 300);
      if (closeButtonPattern.test(window)) {
        foundCloseButton = true;
        break;
      }
      searchFrom = idx + 1;
    }
    expect(foundCloseButton).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. nowTs — stable snapshot so focus classification doesn't shift mid-render
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — nowTs is a stable snapshot (#259)', () => {
  it('captures nowTs as a const before the programme map so all rows use the same timestamp', () => {
    // Must be assigned once via `Date.now()`, not called inside the map
    // callback where it could drift between rows and produce inconsistent focus.
    expect(src).toMatch(/const\s+nowTs\s*=\s*Date\.now\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. nextFocusDown anti-wrap guard (#270)
//    The last playable row must wire nextFocusDown to the first day-strip pill
//    so D-pad Down never wraps back to the close button or first row.
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — nextFocusDown anti-wrap guard (#270)', () => {
  it('computes lastPlayableIndex to identify which programme row gets the nextFocusDown wire', () => {
    // The variable must exist; it drives the ref callback on the last row.
    expect(src).toMatch(/lastPlayableIndex/);
  });

  it('creates a firstDayPillRef to serve as the nextFocusDown target', () => {
    // The ref must be created so the day-strip pill can receive focus after
    // the last programme row on D-pad Down.
    expect(src).toMatch(/firstDayPillRef/);
  });

  it('attaches firstDayPillRef to the first day-strip pill (i === 0)', () => {
    // Matches: ref={i === 0 ? firstDayPillRef : undefined}
    // or similar expressions assigning the ref only for index 0.
    expect(src).toMatch(/i\s*===\s*0.*firstDayPillRef|firstDayPillRef.*i\s*===\s*0/);
  });

  it('uses setNativeProps with nextFocusDown on the last playable row to prevent wrap', () => {
    // The setNativeProps call that sets nextFocusDown is the mechanism that
    // stops D-pad Down from cycling back to the header.
    expect(src).toMatch(/setNativeProps\(\s*\{\s*nextFocusDown/);
  });

  it('derives the nextFocusDown handle from findNodeHandle so Fire OS gets a valid node reference', () => {
    // findNodeHandle converts the React ref to a native integer handle —
    // required on Android TV / Fire OS where refs are not accepted directly.
    expect(src).toMatch(/findNodeHandle\(firstDayPillRef/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Day-switch focus (#282)
//    When the user picks a different day in the strip, focus must move to the
//    first playable programme row for that day (or back to the day strip if
//    there are no playable rows), rather than staying on the close button or
//    being lost entirely.
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet — day-switch focus (#282)', () => {
  it('creates a firstPlayableRowRef to hold the first playable programme row', () => {
    // The ref is assigned inside the render loop and consumed by the
    // day-change effect to programmatically route focus.
    expect(src).toMatch(/firstPlayableRowRef/);
  });

  it('creates a dayChangedRef to skip the initial mount in the day-change effect', () => {
    // On the first render hasTVPreferredFocus handles initial focus placement.
    // dayChangedRef guards against the effect also firing at mount and
    // double-moving focus away from the natural initial landing spot.
    expect(src).toMatch(/dayChangedRef/);
  });

  it('sets hasTVPreferredFocus via setNativeProps in the day-change effect', () => {
    // After selectedDay changes, the effect programmatically moves focus by
    // calling setNativeProps({ hasTVPreferredFocus: true }) on the target.
    // This is the only reliable way to imperatively transfer TV focus in RN.
    expect(src).toMatch(/setNativeProps\(\s*\{\s*hasTVPreferredFocus\s*:\s*true/);
  });

  it('falls back to firstDayPillRef when there are no playable rows for the new day', () => {
    // When data hasn't loaded yet, the timeout branch checks
    // `focusPlacedOnDayPillRef.current` and, if true, routes focus to
    // firstDayPillRef so the user can pick another day.
    // The check and the target appear within the same else-if block
    // (allow up to 300 chars to accommodate comments between them).
    expect(src).toMatch(
      /focusPlacedOnDayPillRef\.current\)\s*\{[\s\S]{0,300}firstDayPillRef/,
    );
  });

  it('triggers the day-change effect when selectedDay changes', () => {
    // The useEffect dependency array must include selectedDay so the effect
    // re-runs every time the user picks a new day from the strip.
    expect(src).toMatch(/\[\s*selectedDay\s*\]/);
  });

  it('assigns firstPlayableRowRef only to the row at firstPlayableIndex', () => {
    // The ref callback in the render loop must check i === firstPlayableIndex
    // before storing the ref so that later rows do not overwrite it.
    expect(src).toMatch(/i\s*===\s*firstPlayableIndex[\s\S]{0,120}firstPlayableRowRef|firstPlayableRowRef[\s\S]{0,120}i\s*===\s*firstPlayableIndex/);
  });

  it('sets hasTVPreferredFocus on the first playable row via the prop on initial render', () => {
    // On first open hasTVPreferredFocus={Platform.isTV && i === firstPlayableIndex}
    // gives the TV focus engine a static hint so focus lands on the first
    // playable row without any imperative call.
    expect(src).toMatch(/hasTVPreferredFocus=\{Platform\.isTV\s*&&\s*i\s*===\s*firstPlayableIndex/);
  });

  it('uses a setTimeout delay in the day-change effect to let the list re-render before focusing', () => {
    // Without a short delay the new programme rows may not yet be mounted,
    // so setNativeProps would target a stale or unmounted node.
    // The effect must schedule focus via setTimeout (any positive delay is fine).
    expect(src).toMatch(/setTimeout[\s\S]{0,200}hasTVPreferredFocus/);
  });

  it('sets focusPlacedOnDayPillRef when falling back to the day pill due to loading', () => {
    // The flag lets the data-arrival effect know it should re-route focus
    // once the programme list populates.
    expect(src).toMatch(/focusPlacedOnDayPillRef/);
  });

  it('has a [firstPlayableIndex] effect that re-routes focus when data arrives after loading', () => {
    // The second effect triggers when firstPlayableIndex changes from -1 to a
    // valid value, completing the two-step slow-load focus journey.
    expect(src).toMatch(/\[\s*firstPlayableIndex\s*\]/);
  });

  it('the data-arrival effect guards on focusPlacedOnDayPillRef before moving focus', () => {
    // Without the guard the effect would re-route focus on every re-render
    // where firstPlayableIndex changes, even when the user hasn't switched days.
    expect(src).toMatch(/focusPlacedOnDayPillRef\.current.*return|return.*focusPlacedOnDayPillRef\.current/);
  });
});
