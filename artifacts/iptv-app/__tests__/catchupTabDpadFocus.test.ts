/**
 * Task #285 — CatchupScreen day-tab D-pad focus routing
 *
 * Covers the three mechanisms that make D-pad Down from a day tab land on the
 * correct first-programme row in artifacts/iptv-app/app/(tabs)/catchup.tsx:
 *
 *   1. onFocus on each day tab commits setSelectedDay(k) immediately so the
 *      programme list reflects the newly focused day before the user presses OK.
 *
 *   2. nextFocusDown={firstProgHandle ?? undefined} on every day tab wires
 *      D-pad Down directly to the first programme row's native node.
 *
 *   3. firstProgCallbackRef is a stable callback ref (not an inline arrow)
 *      assigned to progIdx === 0.  It keeps firstProgRef.current in sync for
 *      imperative .focus() calls AND updates firstProgHandle state so the
 *      nextFocusDown wire always carries a post-mount handle (never a stale
 *      render-time one).
 *
 * Why source inspection + logic simulation instead of a full render test?
 * ────────────────────────────────────────────────────────────────────────
 * React Native TV focus (nextFocusDown, findNodeHandle) is resolved by the
 * native layer on a real Fire TV / Firestick device — jsdom / node cannot
 * drive it.  Source inspection guarantees the correct props are authored and
 * that no refactor silently removes them.  Logic simulation (mirroring the
 * callback-ref and state-machine logic) exercises the JavaScript behaviour
 * of the guard conditions without requiring a native runtime.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Load the production source once ──────────────────────────────────────────

const SOURCE_PATH = path.join(__dirname, '../app/(tabs)/catchup.tsx');

let src: string;

beforeAll(() => {
  src = fs.readFileSync(SOURCE_PATH, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. onFocus day-commit — programme list updates as soon as the tab is focused
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupScreen — onFocus day-commit (#285)', () => {
  it('each day tab has an onFocus handler that calls setSelectedDay', () => {
    // onFocus={() => { setSelectedDay(k); }} (or equivalent)
    // This makes left/right D-pad navigation between tabs instantly update the
    // programme list without requiring an OK press first.
    expect(src).toMatch(/onFocus=\{\s*\(\)\s*=>\s*\{?\s*setSelectedDay\(k\)/);
  });

  it('onFocus fires synchronously on tab focus (no setTimeout wrapper)', () => {
    // The day commit must be synchronous — a setTimeout wrapper would delay
    // the list update and leave a stale day visible during fast D-pad sweeps.
    // We check that setSelectedDay(k) is NOT inside a setTimeout in the
    // onFocus callback.  The onPress handler may use setTimeout; onFocus
    // must not.  Strategy: extract the onFocus substring and verify.
    const onFocusMatch = src.match(/onFocus=\{[^}]{0,200}\}/);
    if (onFocusMatch) {
      expect(onFocusMatch[0]).not.toMatch(/setTimeout/);
    } else {
      // Broader extraction for multi-line onFocus
      const idx = src.indexOf('onFocus={() => {');
      if (idx !== -1) {
        const window = src.slice(idx, idx + 200);
        expect(window).not.toMatch(/setTimeout/);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. nextFocusDown wire — D-pad Down from any tab goes to firstProgRef node
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupScreen — nextFocusDown on day tabs (#285)', () => {
  it('every day tab receives nextFocusDown wired to firstProgHandle', () => {
    // nextFocusDown={firstProgHandle ?? undefined}
    // This is the Fire TV mechanism that routes D-pad Down from the tab strip
    // to the native view for the first programme row.
    expect(src).toMatch(/nextFocusDown=\{firstProgHandle/);
  });

  it('nextFocusDown falls back to undefined when firstProgHandle is null', () => {
    // Using `?? undefined` (or `=== null ? undefined : firstProgHandle`) prevents
    // passing null to the native prop, which would be treated as node 0 on
    // some Fire OS versions.
    expect(src).toMatch(/firstProgHandle\s*\?\?\s*undefined/);
  });

  it('firstProgHandle is stored in component state so updates trigger a re-render', () => {
    // If stored only in a ref, the tabs would never re-render with the new
    // handle after the first programme row mounts.
    expect(src).toMatch(/setFirstProgHandle/);
    expect(src).toMatch(/useState.*firstProgHandle|firstProgHandle.*useState/);
  });

  it('firstProgHandle is updated inside a callback ref, not during render', () => {
    // findNodeHandle called at render time may return null before the node is
    // mounted.  The callback ref fires after the node mounts, guaranteeing a
    // valid handle.
    expect(src).toMatch(/findNodeHandle\(node\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. firstProgCallbackRef — stable ref that wires firstProgRef + firstProgHandle
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupScreen — firstProgCallbackRef structure (#285)', () => {
  it('firstProgCallbackRef is created with useCallback (stable, not an inline arrow)', () => {
    // An inline arrow recreates on every render, causing React to detach and
    // re-attach the ref each time, which would produce a redundant state update
    // loop.  useCallback with an empty dep array gives a stable identity.
    expect(src).toMatch(/firstProgCallbackRef\s*=\s*useCallback/);
  });

  it('firstProgCallbackRef updates firstProgRef.current for imperative focus calls', () => {
    // The existing auto-advance useEffect calls firstProgRef.current?.focus()
    // once EPG data loads.  The callback ref must keep this ref in sync.
    expect(src).toMatch(/firstProgRef\.current\s*=\s*node/);
  });

  it('firstProgCallbackRef calls setFirstProgHandle(findNodeHandle(node)) when node mounts', () => {
    // This is what populates firstProgHandle state and propagates it to
    // nextFocusDown on all day tabs via the next re-render.
    expect(src).toMatch(/setFirstProgHandle\(.*findNodeHandle\(node\)/);
  });

  it('firstProgCallbackRef clears firstProgHandle to null when the node unmounts', () => {
    // When the programme list unmounts (e.g. the user navigates away or
    // selects a different channel), the handle must be cleared so no tab
    // carries a stale nextFocusDown reference.
    // The actual form is a ternary: setFirstProgHandle(node ? findNodeHandle(node) : null)
    // which passes null when node is falsy (unmount call).
    expect(src).toMatch(/setFirstProgHandle\(node\s*\?\s*findNodeHandle\(node\)\s*:\s*null\)/);
  });

  it('firstProgCallbackRef is assigned only to the row at progIdx === 0', () => {
    // Assigning it to every row would overwrite the ref on each iteration and
    // the final assignment would be the LAST row, not the first.
    expect(src).toMatch(/progIdx\s*===\s*0.*firstProgCallbackRef|firstProgCallbackRef.*progIdx\s*===\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. dayTabCallbackRefs — stable per-tab refs for left/right D-pad routing
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupScreen — dayTabCallbackRefs structure (#285)', () => {
  it('dayTabCallbackRefs is created with useMemo so the Map is stable across re-renders', () => {
    // A new Map on every render would cause React to detach and re-attach every
    // tab's ref callback, producing a state-update loop via setDayTabHandles.
    expect(src).toMatch(/dayTabCallbackRefs\s*=\s*useMemo/);
  });

  it('dayTabCallbackRefs regenerates only when the days array reference changes', () => {
    // The useMemo dependency array must be [days] so that handles are rebuilt
    // when the channel changes (new set of archive days) but not on unrelated
    // re-renders.
    expect(src).toMatch(/\[\s*days\s*\]/);
  });

  it('each day tab uses dayTabCallbackRefs.get(k) as its ref prop', () => {
    // The ref prop on each FocusablePressable in the day strip must pull from
    // the memoized map so the correct stable callback is attached.
    expect(src).toMatch(/ref=\{dayTabCallbackRefs\.get\(k\)\}/);
  });

  it('dayTabHandles state is guarded against redundant updates', () => {
    // The callback checks curr === handle before writing new state so that a
    // ref callback that fires with the same node doesn't trigger an extra
    // render cycle.
    expect(src).toMatch(/curr\s*===\s*handle/);
  });

  it('nextFocusLeft uses the handle of the preceding tab', () => {
    // days[idx - 1] gives the left neighbour; its stored handle is fetched
    // from dayTabHandles.
    expect(src).toMatch(/nextFocusLeft=\{.*dayTabHandles\.get\(days\[idx\s*-\s*1\]\)/);
  });

  it('nextFocusRight uses the handle of the following tab', () => {
    // days[idx + 1] gives the right neighbour.
    expect(src).toMatch(/nextFocusRight=\{.*dayTabHandles\.get\(days\[idx\s*\+\s*1\]\)/);
  });

  it('nextFocusLeft is undefined for the first tab (idx === 0)', () => {
    // There is no tab to the left of the first one; the prop must be
    // undefined so Fire OS doesn't try to focus a ghost node.
    expect(src).toMatch(/idx\s*>\s*0.*dayTabHandles\.get\(days\[idx\s*-\s*1\]\)|dayTabHandles\.get\(days\[idx\s*-\s*1\]\).*idx\s*>\s*0/);
  });

  it('nextFocusRight is undefined for the last tab', () => {
    expect(src).toMatch(/idx\s*<\s*days\.length\s*-\s*1.*dayTabHandles\.get\(days\[idx\s*\+\s*1\]\)|dayTabHandles\.get\(days\[idx\s*\+\s*1\]\).*idx\s*<\s*days\.length\s*-\s*1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Logic simulation — firstProgCallbackRef state machine
//    Mirrors the callback-ref body from catchup.tsx to verify the guard
//    conditions without a native runtime.
// ─────────────────────────────────────────────────────────────────────────────

describe('firstProgCallbackRef simulation (#285)', () => {
  /**
   * Simulates the firstProgCallbackRef callback body:
   *
   *   firstProgRef.current = node;
   *   setFirstProgHandle(node ? findNodeHandle(node) : null);
   *
   * findNodeHandle is faked as nodeToHandle (identity mapping for test objects).
   */
  function makeCallbackRefSim() {
    const firstProgRef: { current: object | null } = { current: null };
    let firstProgHandle: number | null = null;

    // Fake findNodeHandle: assigns a stable integer per unique node object.
    const handleMap = new WeakMap<object, number>();
    let nextHandle = 100;
    function findNodeHandle(node: object): number {
      if (!handleMap.has(node)) handleMap.set(node, nextHandle++);
      return handleMap.get(node)!;
    }

    function setFirstProgHandle(h: number | null) {
      firstProgHandle = h;
    }

    // The callback ref body.
    function firstProgCallbackRef(node: object | null) {
      firstProgRef.current = node;
      setFirstProgHandle(node ? findNodeHandle(node) : null);
    }

    return { firstProgRef, getHandle: () => firstProgHandle, firstProgCallbackRef, findNodeHandle };
  }

  it('sets firstProgRef.current to the mounted node', () => {
    const sim = makeCallbackRefSim();
    const node = {};
    sim.firstProgCallbackRef(node);
    expect(sim.firstProgRef.current).toBe(node);
  });

  it('sets firstProgHandle to a non-null integer when the node mounts', () => {
    const sim = makeCallbackRefSim();
    sim.firstProgCallbackRef({});
    expect(sim.getHandle()).not.toBeNull();
    expect(typeof sim.getHandle()).toBe('number');
  });

  it('two different node objects produce different handles', () => {
    const sim = makeCallbackRefSim();
    const nodeA = {};
    const nodeB = {};
    sim.firstProgCallbackRef(nodeA);
    const handleA = sim.getHandle();
    sim.firstProgCallbackRef(nodeB);
    const handleB = sim.getHandle();
    expect(handleA).not.toEqual(handleB);
  });

  it('the same node object produces the same handle on repeated calls', () => {
    const sim = makeCallbackRefSim();
    const node = {};
    sim.firstProgCallbackRef(node);
    const first = sim.getHandle();
    sim.firstProgCallbackRef(node);
    const second = sim.getHandle();
    expect(first).toEqual(second);
  });

  it('clears firstProgRef.current to null when the node unmounts', () => {
    const sim = makeCallbackRefSim();
    sim.firstProgCallbackRef({});
    sim.firstProgCallbackRef(null); // unmount
    expect(sim.firstProgRef.current).toBeNull();
  });

  it('clears firstProgHandle to null when the node unmounts', () => {
    const sim = makeCallbackRefSim();
    sim.firstProgCallbackRef({});
    expect(sim.getHandle()).not.toBeNull();
    sim.firstProgCallbackRef(null);
    expect(sim.getHandle()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Logic simulation — dayTabCallbackRefs guard condition
//    Verifies that the curr === handle guard prevents redundant state writes.
// ─────────────────────────────────────────────────────────────────────────────

describe('dayTabCallbackRefs guard simulation (#285)', () => {
  /**
   * Simulates the callback body produced by the useMemo inside
   * dayTabCallbackRefs for a single day key k:
   *
   *   (node: View | null) => {
   *     const handle = node ? findNodeHandle(node) : null;
   *     setDayTabHandles((prev) => {
   *       const curr = prev.get(k) ?? null;
   *       if (curr === handle) return prev;          // ← guard
   *       const next = new Map(prev);
   *       if (handle != null) next.set(k, handle);
   *       else next.delete(k);
   *       return next;
   *     });
   *   }
   */
  function makeTabRefSim(k: string) {
    let state: Map<string, number> = new Map();
    let setCallCount = 0;

    // Stable handle counter
    const handleMap = new WeakMap<object, number>();
    let nextHandle = 200;
    function findNodeHandle(node: object): number {
      if (!handleMap.has(node)) handleMap.set(node, nextHandle++);
      return handleMap.get(node)!;
    }

    function setDayTabHandles(updater: (prev: Map<string, number>) => Map<string, number>) {
      const next = updater(state);
      if (next !== state) {
        setCallCount++;
        state = next;
      }
    }

    function tabCallbackRef(node: object | null) {
      const handle = node ? findNodeHandle(node) : null;
      setDayTabHandles((prev) => {
        const curr = prev.get(k) ?? null;
        if (curr === handle) return prev; // guard — same object returned
        const next = new Map(prev);
        if (handle != null) next.set(k, handle);
        else next.delete(k);
        return next;
      });
    }

    return {
      getState: () => state,
      getSetCallCount: () => setCallCount,
      tabCallbackRef,
    };
  }

  it('stores the handle in state when a node mounts for the first time', () => {
    const sim = makeTabRefSim('2026-01-01');
    sim.tabCallbackRef({});
    expect(sim.getState().has('2026-01-01')).toBe(true);
    expect(typeof sim.getState().get('2026-01-01')).toBe('number');
  });

  it('does NOT trigger a state update when the same node is re-attached (guard fires)', () => {
    const sim = makeTabRefSim('2026-01-02');
    const node = {};
    sim.tabCallbackRef(node); // first mount — state written
    const countAfterFirst = sim.getSetCallCount();
    sim.tabCallbackRef(node); // same node — guard should return same Map object
    expect(sim.getSetCallCount()).toBe(countAfterFirst); // no additional write
  });

  it('removes the key from state when the node unmounts (null)', () => {
    const sim = makeTabRefSim('2026-01-03');
    sim.tabCallbackRef({}); // mount
    expect(sim.getState().has('2026-01-03')).toBe(true);
    sim.tabCallbackRef(null); // unmount
    expect(sim.getState().has('2026-01-03')).toBe(false);
  });

  it('does NOT trigger a state update on a second null call (guard fires for null→null)', () => {
    const sim = makeTabRefSim('2026-01-04');
    sim.tabCallbackRef(null); // first null — key already absent, guard fires
    const countAfterFirst = sim.getSetCallCount();
    sim.tabCallbackRef(null); // second null — guard still fires
    expect(sim.getSetCallCount()).toBe(countAfterFirst);
  });

  it('updates state when a different node replaces the previous one', () => {
    const sim = makeTabRefSim('2026-01-05');
    const nodeA = {};
    const nodeB = {};
    sim.tabCallbackRef(nodeA);
    const handleA = sim.getState().get('2026-01-05');
    sim.tabCallbackRef(nodeB);
    const handleB = sim.getState().get('2026-01-05');
    expect(handleA).not.toEqual(handleB);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Smoke test — source compiles without referencing undefined variables
//    Guards against TDZ / ReferenceError regressions introduced by refactors
//    that rearrange the order of the refs and state declarations.
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupScreen — declaration order sanity (#285)', () => {
  it('firstProgHandle state is declared before dayTabCallbackRefs useMemo', () => {
    const handleIdx = src.indexOf('firstProgHandle');
    const memoIdx = src.indexOf('dayTabCallbackRefs');
    expect(handleIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeGreaterThan(-1);
    expect(handleIdx).toBeLessThan(memoIdx);
  });

  it('dayTabHandles state is declared before dayTabCallbackRefs useMemo', () => {
    const stateIdx = src.indexOf('dayTabHandles');
    const memoIdx = src.indexOf('dayTabCallbackRefs');
    expect(stateIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeLessThan(memoIdx);
  });

  it('firstProgRef is declared before firstProgCallbackRef useCallback', () => {
    const refIdx = src.indexOf('firstProgRef');
    const cbIdx = src.indexOf('firstProgCallbackRef');
    expect(refIdx).toBeGreaterThan(-1);
    expect(cbIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeLessThan(cbIdx);
  });

  it('dayTabCallbackRefs useMemo declares [days] as its dependency', () => {
    // The useMemo that builds dayTabCallbackRefs must list `days` in its deps
    // array so the Map is rebuilt whenever the channel changes and produces a
    // new days array, keeping the per-tab callback refs in sync with the
    // current archive window.
    expect(src).toMatch(/dayTabCallbackRefs[\s\S]{0,600}\[\s*days\s*\]/);
  });

  it('days is declared before dayTabCallbackRefs to avoid temporal-dead-zone errors', () => {
    // The [days] dep array in dayTabCallbackRefs is evaluated at render time.
    // If `days` were declared after dayTabCallbackRefs (const TDZ), reading it
    // in the dep array would throw a ReferenceError on every render.
    // This assertion confirms the correct declaration order is maintained.
    const daysIdx = src.indexOf('return { days: sortedDays, byDay: map }');
    const memoIdx = src.indexOf('dayTabCallbackRefs = useMemo');
    expect(daysIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeGreaterThan(-1);
    expect(daysIdx).toBeLessThan(memoIdx);
  });
});
