/**
 * Task #516 — Regression guard: EPG grid mounts without "Maximum update
 * depth exceeded" ref-churn crash
 *
 * The EPG grid renders hundreds of FocusablePressable programme cells
 * simultaneously — it is the highest-density screen in the app.  The
 * "Maximum update depth exceeded" crash was caused by `setRefs` being an
 * inline arrow function inside FocusablePressable: each render produced a
 * new function reference, causing React to null-then-reattach every ref on
 * every render cycle, cascading past React's 50-nested-update limit.
 *
 * The fix: `setRefs` is wrapped in `useCallback([], [])` so its identity
 * is stable after mount.
 *
 * This test mounts a realistic EPG grid density (10 channels × 24 programme
 * cells = 240 FocusablePressable elements rendered simultaneously) and
 * asserts that no "Maximum update depth exceeded" console.error is emitted
 * during the mount cycle.  If the `useCallback([], [])` fix in
 * FocusablePressable is ever reverted, this test will catch the regression
 * before it ships.
 *
 * Pattern: mirrors artifacts/iptv-app/__tests__/catchupSheetMount.test.tsx
 */

// ── react-native mock (must precede all imports) ──────────────────────────────

jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');

  const View = ({ children, ...r }: any) =>
    React.createElement('div', r, children);
  const Text = ({ children, ...r }: any) =>
    React.createElement('span', r, children);
  const ScrollView = ({ children, ...r }: any) =>
    React.createElement('div', r, children);
  const Pressable = ({ children, onPress, ...r }: any) =>
    React.createElement(
      'div',
      { ...r, onClick: onPress },
      typeof children === 'function' ? children({ pressed: false }) : children,
    );

  return {
    View,
    Text,
    ScrollView,
    Pressable,
    StyleSheet: {
      create: (s: any) => s,
      flatten: (s: any) => s,
      absoluteFill: {},
      absoluteFillObject: {},
    },
    Platform: {
      OS: 'android',
      isTV: false,
      select: (obj: any) => obj.android ?? obj.default,
    },
    useColorScheme: jest.fn(() => 'dark'),
    useWindowDimensions: jest.fn(() => ({ width: 1920, height: 1080 })),
    findNodeHandle: jest.fn(() => 42),
  };
});

// ── Imports (AFTER mocks) ─────────────────────────────────────────────────────

import React from 'react';
import { act, create } from 'react-test-renderer';
import { FocusablePressable } from '../components/FocusablePressable';

// @ts-ignore — required by React 19 in non-jsdom environments
global.IS_REACT_ACT_ENVIRONMENT = true;

// ─────────────────────────────────────────────────────────────────────────────
// Realistic EPG grid fixture
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_COUNT = 10;
const PROGRAMMES_PER_ROW = 24; // one per hour — matches the full-day guide

/**
 * MockEpgGrid renders a grid of FocusablePressable programme cells at the
 * same density as the real TV EPG guide.  Each row represents one channel;
 * each cell within a row represents one programme slot.
 *
 * This is the exact scenario that triggered the "Maximum update depth
 * exceeded" crash: many FocusablePressables mounting simultaneously causes
 * the unstable-setRefs ref-churn cascade if the fix is ever reverted.
 */
function MockEpgGrid({ channelCount = CHANNEL_COUNT, cellsPerRow = PROGRAMMES_PER_ROW }) {
  return (
    <div>
      {Array.from({ length: channelCount }, (_, rowIdx) => (
        <div key={rowIdx} data-testid={`row-${rowIdx}`}>
          {/* Channel label cell (non-interactive) */}
          <span>{'Channel ' + rowIdx}</span>

          {/* Programme cells — each uses FocusablePressable */}
          {Array.from({ length: cellsPerRow }, (__, cellIdx) => (
            <FocusablePressable
              key={cellIdx}
              onPress={jest.fn()}
              accessible
            >
              <span>{'Programme ' + rowIdx + '-' + cellIdx}</span>
            </FocusablePressable>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flush async effects / microtasks. */
const flush = () => act(async () => { await Promise.resolve(); });

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('EPG grid mount — no "Maximum update depth exceeded" crash', () => {
  // Collect any "Maximum update depth" errors emitted via console.error.
  const updateDepthErrors: string[] = [];
  const _origError = console.error;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = typeof args[0] === 'string' ? args[0] : String(args[0]);
      if (msg.includes('Maximum update depth')) {
        updateDepthErrors.push(msg);
      }
      // Suppress React 19 react-test-renderer deprecation noise.
      if (msg.includes('react-test-renderer is deprecated')) return;
      _origError.call(console, ...args);
    });
  });

  afterAll(() => {
    (console.error as jest.Mock).mockRestore?.();
  });

  beforeEach(() => {
    updateDepthErrors.length = 0;
  });

  it('mounts 10 channels × 24 programme cells (240 FocusablePressables) without triggering Maximum update depth', async () => {
    // 10 rows × 24 cells = 240 FocusablePressable elements rendered at once.
    // This is the peak density the EPG grid reaches when the user opens the
    // full-day guide view — the scenario the ref-churn crash first appeared in.
    let renderer: any;
    await act(async () => {
      renderer = create(<MockEpgGrid />);
    });

    await flush();
    await flush();

    // The critical assertion: the stable-setRefs fix must prevent React from
    // exceeding its nested-update limit even when hundreds of cells mount
    // simultaneously.
    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });

  it('mounts at maximum observed density (20 channels × 24 cells = 480 FocusablePressables) without crashing', async () => {
    // Stress test at twice the typical channel count to confirm the fix holds
    // even beyond the normal density.
    let renderer: any;
    await act(async () => {
      renderer = create(<MockEpgGrid channelCount={20} cellsPerRow={24} />);
    });

    await flush();
    await flush();

    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });

  it('survives a prop-driven re-render of the full grid without triggering Maximum update depth', async () => {
    // Simulates the guide refreshing EPG data in the background: the grid
    // re-renders with the same structure but different programme data.
    // Before the fix, every re-render would re-churn all 240 refs.
    let renderer: any;
    await act(async () => {
      renderer = create(<MockEpgGrid channelCount={10} cellsPerRow={24} />);
    });

    await flush();

    // Trigger a full re-render (simulates a state update in the parent screen,
    // e.g. the EPG data query returning new results).
    await act(async () => {
      renderer.update(<MockEpgGrid channelCount={10} cellsPerRow={24} />);
    });

    await flush();
    await flush();

    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });

  it('mounts a single FocusablePressable row (minimum density) without crashing', async () => {
    // Baseline: even a single row must work.
    let renderer: any;
    await act(async () => {
      renderer = create(<MockEpgGrid channelCount={1} cellsPerRow={5} />);
    });

    await flush();

    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });
});
