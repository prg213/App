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
    // Extract the block containing hasTVPreferredFocus and confirm it also
    // contains the close icon (✕) — not a play chip or programme title.
    const idx = src.indexOf('hasTVPreferredFocus');
    expect(idx).toBeGreaterThan(-1);

    // Scan a window of ±300 chars around hasTVPreferredFocus
    const window = src.slice(Math.max(0, idx - 300), idx + 300);
    expect(window).toMatch(/onClose|✕|closeIcon|closeTouchable/);
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
