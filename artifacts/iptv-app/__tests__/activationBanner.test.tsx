/**
 * Component-level tests for the admin-removal banner in ActivationScreen.
 *
 * Renders the REAL app/activation.tsx component; only external dependencies
 * (native modules, expo packages, context) are mocked so the component's own
 * useEffect / useState logic runs verbatim.
 *
 * Covers:
 *   - Banner is visible when consumeLogoutReason resolves to 'deactivated'
 *   - Banner is absent when consumeLogoutReason resolves to null
 *   - consumeLogoutReason is called exactly once on mount (never on re-renders)
 *   - Banner disappears after the dismiss (✕) button is pressed
 *   - Crash-lingering key: banner shows on re-launch
 *   - No banner on second launch after a clean consume
 */

// ── react-native: pure-JS mock (no native modules) ────────────────────────
// Must appear before ANY import that pulls in react-native, including
// react-test-renderer.
jest.mock('react-native', () => {
  // Import React inside the factory so the module graph stays consistent.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');

  const View = ({ children, ...rest }: any) =>
    React.createElement('View', rest, children);
  const Text = ({ children, ...rest }: any) =>
    React.createElement('Text', rest, children);
  const TouchableOpacity = ({ children, onPress, hitSlop, activeOpacity, disabled, ...rest }: any) =>
    React.createElement('TouchableOpacity', { ...rest, onClick: onPress, 'data-disabled': disabled }, children);
  const Pressable = ({ children, onPress, hitSlop, ...rest }: any) =>
    React.createElement('Pressable', { ...rest, onClick: onPress }, typeof children === 'function' ? children(false) : children);
  const ScrollView = ({ children, contentContainerStyle, showsVerticalScrollIndicator, ...rest }: any) =>
    React.createElement('ScrollView', rest, children);
  const ActivityIndicator = (props: any) =>
    React.createElement('ActivityIndicator', props);

  // Minimal Animated that runs callbacks synchronously so act() drains them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeAnim: () => any = () => ({
    setValue: jest.fn(),
    interpolate: jest.fn(() => makeAnim()),
    addListener: jest.fn(() => 'id'),
    removeListener: jest.fn(),
    stopAnimation: jest.fn(),
  });
  const AnimValue = jest.fn(() => makeAnim());
  const animOp = jest.fn(() => ({ start: (cb?: any) => cb?.({ finished: true }) }));
  const Animated = {
    Value: AnimValue,
    View,
    timing:   animOp,
    sequence: animOp,
    loop: jest.fn(() => ({ start: jest.fn() })),
  };

  const StyleSheet = { create: (s: any) => s, flatten: (s: any) => s };
  const Platform   = { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default };
  const AppState   = {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  };

  return {
    View,
    Text,
    TouchableOpacity,
    Pressable,
    ScrollView,
    ActivityIndicator,
    Animated,
    StyleSheet,
    Platform,
    AppState,
  };
});

// ── Expo / third-party mocks ──────────────────────────────────────────────
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));

jest.mock('expo-haptics', () => ({
  impactAsync:       jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle:      { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// useQuery: never fetches; returns stable no-op so the MAC-polling loop
// doesn't interfere with the banner assertions.
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({ data: undefined, isFetching: false, refetch: jest.fn() })),
}));

// AppContext: minimal stable values; device is not activated so useQuery
// would try to poll — we've already short-circuited that above.
jest.mock('@/context/AppContext', () => ({
  useAppContext: jest.fn(() => ({
    deviceMac:    'AA:BB:CC:DD:EE:FF',
    setActivated: jest.fn(),
    isActivated:  false,
  })),
}));

// StorageService: we control consumeLogoutReason per test.
// The `satisfies` annotation makes TypeScript verify that every key in this
// object actually exists on the real StorageService — if a method is renamed
// or removed the compiler will flag the stale mock key immediately.
jest.mock('@/services/storage', () => ({
  StorageService: {
    consumeLogoutReason: jest.fn(async () => null),
  } satisfies Partial<typeof import('@/services/storage').StorageService>,
}));

// ── Imports (AFTER mocks) ─────────────────────────────────────────────────
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { StorageService } from '../services/storage';
import ActivationScreen   from '../app/activation';

const consumeLogoutReason =
  StorageService.consumeLogoutReason as jest.MockedFunction<typeof StorageService.consumeLogoutReason>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Render ActivationScreen and flush all async effects (useEffect + microtasks).
 * Returns the renderer so callers can inspect or update the tree.
 */
async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<ActivationScreen />);
  });
  // One extra flush to catch Promise-resolved state updates.
  await act(async () => {});
  return renderer;
}

/**
 * Walk the react-test-renderer tree and return the first Text string that
 * contains `needle`, or null if not found.
 */
function findText(node: ReactTestInstance | ReactTestInstance[], needle: string): string | null {
  const nodes = Array.isArray(node) ? node : [node];
  for (const n of nodes) {
    // Check direct string children.
    if (n.children) {
      for (const child of n.children) {
        if (typeof child === 'string' && child.includes(needle)) return child;
      }
      // Recurse into child instances.
      const found = findText(
        n.children.filter((c): c is ReactTestInstance => typeof c !== 'string'),
        needle,
      );
      if (found) return found;
    }
  }
  return null;
}

/**
 * Walk the tree and return the first node whose `onClick` prop is set and
 * whose subtree contains the glyph `✕`.
 */
function findDismissButton(root: ReactTestInstance): ReactTestInstance | null {
  function walk(node: ReactTestInstance): ReactTestInstance | null {
    if (node.props.onClick) {
      // Does this subtree contain the dismiss glyph?
      if (findText(node, '✕') !== null) return node;
    }
    for (const child of node.children) {
      if (typeof child !== 'string') {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(root);
}

// ── Test setup ────────────────────────────────────────────────────────────

// React 19 requires this flag in non-jsdom environments so act() works without
// noisy "not configured to support act()" warnings.
// @ts-ignore — global not in lib
global.IS_REACT_ACT_ENVIRONMENT = true;

// Silence the "react-test-renderer is deprecated" deprecation notice; it is a
// known React 19 warning that doesn't affect the test results.
const originalConsoleError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    originalConsoleError.call(console, ...args);
  });
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});

beforeEach(() => {
  jest.clearAllMocks();
  consumeLogoutReason.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ActivationScreen — admin-removal banner', () => {

  test('banner is NOT shown when no logout reason is stored', async () => {
    consumeLogoutReason.mockResolvedValue(null);

    const renderer = await renderScreen();
    const text = findText(renderer.root, 'removed by an administrator');

    expect(text).toBeNull();
  });

  test('banner IS shown when logout reason is "deactivated"', async () => {
    consumeLogoutReason.mockResolvedValue('deactivated');

    const renderer = await renderScreen();
    const text = findText(renderer.root, 'removed by an administrator');

    expect(text).not.toBeNull();
  });

  test('consumeLogoutReason is called exactly once on mount (not on re-renders)', async () => {
    consumeLogoutReason.mockResolvedValue('deactivated');

    const renderer = await renderScreen();

    // Trigger re-render by flushing a no-op state update cycle.
    await act(async () => {});

    expect(consumeLogoutReason).toHaveBeenCalledTimes(1);
  });

  test('banner disappears after the dismiss (✕) button is pressed', async () => {
    consumeLogoutReason.mockResolvedValue('deactivated');

    const renderer = await renderScreen();

    // Confirm banner is visible before dismissal.
    expect(findText(renderer.root, 'removed by an administrator')).not.toBeNull();

    const dismissBtn = findDismissButton(renderer.root);
    expect(dismissBtn).not.toBeNull(); // sanity — button must exist while banner shows

    await act(async () => {
      dismissBtn!.props.onClick();
    });

    // After pressing ✕ the banner must be gone.
    expect(findText(renderer.root, 'removed by an administrator')).toBeNull();
  });

  test('crash-lingering key: banner shows on re-launch', async () => {
    // The app previously crashed before activation.tsx could call
    // consumeLogoutReason; the key is still in storage.
    consumeLogoutReason.mockResolvedValue('deactivated');

    const renderer = await renderScreen();

    expect(findText(renderer.root, 'removed by an administrator')).not.toBeNull();
    // consumeLogoutReason must have been called (which clears the key).
    expect(consumeLogoutReason).toHaveBeenCalledTimes(1);
  });

  test('no banner on second launch after a clean consume', async () => {
    // First launch — reason present; component consumes and clears it.
    consumeLogoutReason.mockResolvedValueOnce('deactivated');
    const first = await renderScreen();
    expect(findText(first.root, 'removed by an administrator')).not.toBeNull();

    // Second launch — key is gone; component receives null.
    consumeLogoutReason.mockResolvedValueOnce(null);
    const second = await renderScreen();
    expect(findText(second.root, 'removed by an administrator')).toBeNull();
  });

  test('dismiss button is not present when no reason was stored', async () => {
    consumeLogoutReason.mockResolvedValue(null);

    const renderer = await renderScreen();

    // No banner → no dismiss button with ✕.
    const dismissBtn = findDismissButton(renderer.root);
    expect(dismissBtn).toBeNull();
  });
});
