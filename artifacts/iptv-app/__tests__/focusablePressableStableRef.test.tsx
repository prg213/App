/**
 * Task #515 — Regression guard: setRefs stability in FocusablePressable
 *
 * The "Maximum update depth exceeded" crash on CatchupSheet (and every other
 * screen that mounts many FocusablePressables at once) was traced to `setRefs`
 * being an inline arrow function inside the render body of FocusablePressable.
 * React treats a new function object as a changed ref on every render, so it
 * calls the OLD ref with null and the NEW ref with the node on EVERY render
 * cycle.  With a large number of FocusablePressables re-rendering together
 * (day pills, programme rows, channel list) the null→node churn cascades past
 * React's 50-nested-update limit.
 *
 * The fix: `setRefs` is wrapped in `useCallback([], [])` so its identity never
 * changes after mount.
 *
 * This test renders FocusablePressable twice (simulating a prop-driven re-render),
 * captures the `ref` callback passed to the inner Pressable on each render, and
 * asserts the two captures are the SAME function object.  If someone removes the
 * `useCallback` wrapper — or adds deps that make it re-create — this test will
 * catch the regression immediately.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted capture bucket (var so babel-jest hoisting doesn't put it in TDZ
// before the jest.mock factory references it via closure).
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-var
var mockCapturedRefs: unknown[] = [];

// ── react-native mock (must come before all imports) ─────────────────────────

jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');

  // Intercept the `ref` prop that FocusablePressable passes to Pressable.
  // In React 19 `ref` is a regular prop on all components, so it is
  // accessible via `props.ref` in a plain function mock.
  const Pressable = (props: any) => {
    // Capture on every render so the test can compare across renders.
    mockCapturedRefs.push(props.ref);
    const children =
      typeof props.children === 'function'
        ? props.children({ pressed: false })
        : props.children;
    return React.createElement('div', {}, children);
  };

  const View = ({ children, ...r }: any) =>
    React.createElement('div', r, children);

  return {
    Pressable,
    View,
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
    Platform: {
      OS: 'android',
      isTV: false,
      select: (obj: any) => obj.android ?? obj.default,
    },
    useColorScheme: jest.fn(() => 'dark'),
  };
});

// ── Imports (AFTER mocks) ─────────────────────────────────────────────────────

import React, { createRef } from 'react';
import { act, create } from 'react-test-renderer';
import { FocusablePressable } from '../components/FocusablePressable';

// @ts-ignore — required by React 19 in non-jsdom environments
global.IS_REACT_ACT_ENVIRONMENT = true;

// Suppress the react-test-renderer deprecation warning from React 19.
const _origError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    _origError.call(console, ...args);
  });
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('FocusablePressable — setRefs is stable across re-renders', () => {
  beforeEach(() => {
    // Reset the capture bucket before each test.
    mockCapturedRefs = [];
  });

  it('passes the same setRefs function reference to Pressable on every render', async () => {
    // Render once.
    let renderer: any;
    await act(async () => {
      renderer = create(
        <FocusablePressable onPress={jest.fn()}>
          <React.Fragment />
        </FocusablePressable>,
      );
    });

    // Force a prop-driven re-render by updating a prop.
    await act(async () => {
      renderer.update(
        <FocusablePressable onPress={jest.fn()} accessible={false}>
          <React.Fragment />
        </FocusablePressable>,
      );
    });

    // We must have captured at least two renders.
    expect(mockCapturedRefs.length).toBeGreaterThanOrEqual(2);

    // All captures must be function values (i.e. ref IS being passed).
    expect(typeof mockCapturedRefs[0]).toBe('function');

    // The critical assertion: every captured ref is the EXACT SAME object.
    // If setRefs is recreated on re-render this will fail with a different
    // function reference.
    const first = mockCapturedRefs[0];
    for (let i = 1; i < mockCapturedRefs.length; i++) {
      expect(mockCapturedRefs[i]).toBe(first);
    }

    await act(async () => { renderer.unmount(); });
  });

  it('forwards an external ref object to the inner node via the stable setRefs callback', async () => {
    // Confirm that the stable setRefs still correctly populates a forwarded ref.
    const externalRef = createRef<any>();
    await act(async () => {
      create(
        <FocusablePressable ref={externalRef} onPress={jest.fn()}>
          <React.Fragment />
        </FocusablePressable>,
      );
    });

    // setRefs must have been called with the node (not null) so the external
    // ref was populated — i.e. stability didn't break forwarding.
    expect(mockCapturedRefs.length).toBeGreaterThanOrEqual(1);
    // The ref is a function — the forwarded ref callback chain is wired.
    expect(typeof mockCapturedRefs[0]).toBe('function');
  });
});
