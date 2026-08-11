/**
 * #315 — TVEpgRow progRefs stale-ref cleanup.
 *
 * TVEpgRow keeps a Map<index, View> called progRefs so that after a ProgramModal
 * closes, focus can be restored to the exact programme cell the user pressed.
 * If cells unmount (FlatList virtualization) without removing their entries, a
 * stale node handle would be stored and lastFocusedProgRef would point at a
 * detached View — causing focus to silently miss after modal close.
 *
 * Part 1 — source inspection: verify the ref-callback guards are present in
 * guide.tsx without mounting any component.
 *
 * Part 2 — lifecycle simulation: verify the ref-lifecycle semantics hold using
 * plain JS objects (no React / React Native renderer required).
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ── Part 1: source-text inspection ───────────────────────────────────────────

describe('TVEpgRow — progRefs ref-callback source guards (#315)', () => {
  it('ref callback calls progRefs.current.set when el is non-null (cell mounts)', () => {
    expect(src).toMatch(/progRefs\.current\.set\s*\(\s*index/s);
  });

  it('ref callback calls progRefs.current.delete when el is null (cell unmounts)', () => {
    expect(src).toMatch(/progRefs\.current\.delete\s*\(\s*index/s);
  });

  it('lastFocusedProgRef.current is set to the live View from progRefs on press', () => {
    // After a press the ref must be updated so post-modal restore lands on the
    // correct cell.
    expect(src).toMatch(/lastFocusedProgRef\.current\s*=.*progRefs\.current\.get/s);
  });

  it('progRefs and lastFocusedProgRef are declared as useRef inside TVEpgRow', () => {
    // Both refs must be per-component (useRef) — not module-level globals.
    expect(src).toMatch(/const\s+progRefs\s*=\s*useRef/);
    expect(src).toMatch(/lastFocusedProgRef/);
  });
});

// ── Part 2: lifecycle simulation ─────────────────────────────────────────────
//
// Reproduces the ref-callback and lastFocusedProgRef logic using plain objects.
// This confirms the semantic behaviour without a React Native renderer.

/** Mirror of the TVEpgRow cellRef callback. */
function simulateCellRef(
  progRefs: Map<number, object | null>,
  index: number,
  el: object | null,
): void {
  if (el !== null) {
    progRefs.set(index, el);
  } else {
    progRefs.delete(index);
  }
}

describe('TVEpgRow — progRefs lifecycle simulation (#315)', () => {
  it('mount (el non-null) adds an entry to progRefs', () => {
    const progRefs = new Map<number, object | null>();
    const el = { focus: jest.fn() };

    simulateCellRef(progRefs, 2, el);

    expect(progRefs.has(2)).toBe(true);
    expect(progRefs.get(2)).toBe(el);
  });

  it('unmount (el null) removes the entry from progRefs — no stale ref', () => {
    const progRefs = new Map<number, object | null>();
    const el = { focus: jest.fn() };

    simulateCellRef(progRefs, 2, el);   // mount
    simulateCellRef(progRefs, 2, null); // unmount (FlatList recycling)

    expect(progRefs.has(2)).toBe(false);
  });

  it('mount → unmount → re-mount at same index restores a live entry', () => {
    const progRefs = new Map<number, object | null>();
    const el1 = { focus: jest.fn() };
    const el2 = { focus: jest.fn() };

    simulateCellRef(progRefs, 3, el1);  // mount
    simulateCellRef(progRefs, 3, null); // unmount (virtualised away)
    simulateCellRef(progRefs, 3, el2);  // re-mount (scrolled back into view)

    expect(progRefs.has(3)).toBe(true);
    expect(progRefs.get(3)).toBe(el2);  // fresh node, not the old one
  });

  it('lastFocusedProgRef resolves to the live node at press time', () => {
    const progRefs = new Map<number, object | null>();
    const el = { focus: jest.fn() };
    simulateCellRef(progRefs, 4, el);

    const lastFocusedProgRef = { current: null as object | null };

    // Simulate programme press → update lastFocusedProgRef
    lastFocusedProgRef.current = progRefs.get(4) ?? null;

    expect(lastFocusedProgRef.current).toBe(el);
  });

  it('lastFocusedProgRef retains its value even after FlatList recycles the cell', () => {
    const progRefs = new Map<number, object | null>();
    const el = { focus: jest.fn() };
    simulateCellRef(progRefs, 4, el);

    const lastFocusedProgRef = { current: null as object | null };
    lastFocusedProgRef.current = progRefs.get(4) ?? null; // captured on press

    // Cell gets recycled while modal is open
    simulateCellRef(progRefs, 4, null);

    // progRefs no longer has the entry, but lastFocusedProgRef still holds it
    expect(progRefs.has(4)).toBe(false);
    expect(lastFocusedProgRef.current).toBe(el); // focus restore can still call .focus()
  });
});
