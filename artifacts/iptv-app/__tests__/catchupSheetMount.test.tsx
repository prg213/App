/**
 * Task #515 — Regression guard: CatchupSheet mounts without "Maximum update
 * depth exceeded"
 *
 * The crash was triggered by rendering many FocusablePressable elements at
 * once (day pills + programme rows) when `setRefs` was an inline function —
 * each render produced a new function reference, causing React to null-then-
 * reattach every ref on every render cycle, cascading past the 50-update limit.
 *
 * This test mounts CatchupSheet with `visible=true` and mock EPG data
 * (so it renders day pills AND programme rows simultaneously) and asserts that
 * no "Maximum update depth exceeded" console.error is emitted during the mount
 * cycle.  If the `useCallback([], [])` fix in FocusablePressable is ever
 * reverted, this test will catch the regression.
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
  const ActivityIndicator = (props: any) =>
    React.createElement('div', props);
  const Pressable = ({ children, onPress, ...r }: any) =>
    React.createElement('div', { ...r, onClick: onPress },
      typeof children === 'function' ? children({ pressed: false }) : children);

  const makeAnim = (): any => ({
    setValue: jest.fn(),
    interpolate: jest.fn(() => makeAnim()),
    addListener: jest.fn(() => 'id'),
    removeListener: jest.fn(),
    stopAnimation: jest.fn(),
  });
  const Animated = {
    Value: jest.fn(() => makeAnim()),
    View,
    timing: jest.fn(() => ({ start: (cb?: any) => cb?.({ finished: true }) })),
    sequence: jest.fn(() => ({ start: (cb?: any) => cb?.({ finished: true }) })),
    loop: jest.fn(() => ({ start: jest.fn() })),
  };

  return {
    View,
    Text,
    ScrollView,
    ActivityIndicator,
    Pressable,
    Animated,
    Modal: ({ children, visible }: any) =>
      visible ? React.createElement('div', { 'data-modal': true }, children) : null,
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
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    },
    DeviceEventEmitter: {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      emit: jest.fn(),
    },
    findNodeHandle: jest.fn(() => 42),
    useColorScheme: jest.fn(() => 'dark'),
    useWindowDimensions: jest.fn(() => ({ width: 390, height: 844 })),
  };
});

// ── Expo / third-party mocks ──────────────────────────────────────────────────

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useIsFocused: jest.fn(() => true),
  useFocusEffect: jest.fn(),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    refetch: jest.fn(),
  })),
}));

// ── Internal mocks ────────────────────────────────────────────────────────────

jest.mock('@/components/FocusablePressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return {
    FocusablePressable: React.forwardRef(
      ({ children, onPress, ...r }: any, ref: any) =>
        React.createElement('div', { ...r, onClick: onPress, ref }, children),
    ),
  };
});

jest.mock('@/components/Toast', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return {
    Toast: ({ visible, message }: any) =>
      visible ? React.createElement('div', {}, message) : null,
  };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#000',
    foreground: '#fff',
    mutedForeground: '#888',
    border: '#333',
    primary: '#00E5FF',
    secondary: '#111',
    card: '#111',
  }),
}));

jest.mock('@/services/xtreamApi', () => ({
  getXtreamCatchupEpg: jest.fn(async () => []),
  getXtreamCatchupUrls: jest.fn(() => ['http://example.com/catchup.ts']),
}));

jest.mock('@/lib/tvFocus', () => ({
  requestTvFocus: jest.fn(),
}));

jest.mock('@/hooks/useBackHandler', () => ({
  useBackHandler: jest.fn(),
}));

jest.mock('@/hooks/useTVRemote', () => ({
  useTVRemote: jest.fn(),
}));

// ── Imports (AFTER mocks) ─────────────────────────────────────────────────────

import React from 'react';
import { act, create } from 'react-test-renderer';
import { CatchupSheet } from '../components/CatchupSheet';
import type { Channel, EpgProgram } from '../types';

// @ts-ignore — required by React 19 in non-jsdom environments
global.IS_REACT_ACT_ENVIRONMENT = true;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_CHANNEL: Channel = {
  id: 'ch1',
  name: 'Test Channel',
  groupTitle: 'Sports',
  streamUrl: 'http://example.com/live.ts',
  epgId: 'ch1',
  tvArchive: 1,
  tvArchiveDuration: 3,
};

const MOCK_CREDS = {
  host: 'http://example.com',
  username: 'user',
  password: 'pass',
};

/** Build a minimal EpgProgram that finished in the past (so it's playable). */
function makePastProgram(offsetHours: number): EpgProgram {
  const now = Date.now();
  const start = new Date(now - (offsetHours + 1) * 3_600_000);
  const end   = new Date(now - offsetHours * 3_600_000);
  return {
    channelId: 'ch1',
    title: `Programme ${offsetHours}h ago`,
    description: '',
    start,
    end,
  } as EpgProgram;
}

/** EPG map with a few past programmes — causes CatchupSheet to render
 *  both day pills AND programme rows simultaneously, which is the
 *  scenario that triggered the "Maximum update depth exceeded" crash. */
const MOCK_EPG_MAP: Map<string, EpgProgram[]> = new Map([
  ['ch1', [makePastProgram(3), makePastProgram(2), makePastProgram(1)]],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flush async effects / microtasks. */
const flush = () => act(async () => { await Promise.resolve(); });

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CatchupSheet mount — no "Maximum update depth exceeded" crash', () => {
  // Track any "Maximum update depth" errors emitted via console.error.
  const updateDepthErrors: string[] = [];
  const _origError = console.error;

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = typeof args[0] === 'string' ? args[0] : String(args[0]);
      if (msg.includes('Maximum update depth')) {
        updateDepthErrors.push(msg);
      }
      // Suppress the react-test-renderer deprecation noise from React 19.
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

  it('mounts with visible=true and EPG data without triggering Maximum update depth', async () => {
    let renderer: any;
    await act(async () => {
      renderer = create(
        <CatchupSheet
          visible
          channel={MOCK_CHANNEL}
          creds={MOCK_CREDS}
          epgMap={MOCK_EPG_MAP}
          onClose={jest.fn()}
        />,
      );
    });

    // Drain async effects (e.g. the 60-second nowTs interval and query setup).
    await flush();
    await flush();

    // The critical assertion: the stable-setRefs fix must prevent React from
    // exceeding its nested-update limit.
    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });

  it('mounts with visible=true and no EPG data without throwing', async () => {
    // Confirm it also works in the loading state (no epgMap, no catchupPrograms).
    let renderer: any;
    await act(async () => {
      renderer = create(
        <CatchupSheet
          visible
          channel={MOCK_CHANNEL}
          creds={MOCK_CREDS}
          onClose={jest.fn()}
        />,
      );
    });

    await flush();

    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });

  it('transitions from hidden to visible without triggering Maximum update depth', async () => {
    // Simulates the real usage pattern: sheet is hidden initially, then
    // the user opens it.  This is the exact lifecycle that exposed the crash.
    let renderer: any;
    await act(async () => {
      renderer = create(
        <CatchupSheet
          visible={false}
          channel={MOCK_CHANNEL}
          creds={MOCK_CREDS}
          epgMap={MOCK_EPG_MAP}
          onClose={jest.fn()}
        />,
      );
    });

    // Open the sheet — this renders all day pills + programme rows at once.
    await act(async () => {
      renderer.update(
        <CatchupSheet
          visible
          channel={MOCK_CHANNEL}
          creds={MOCK_CREDS}
          epgMap={MOCK_EPG_MAP}
          onClose={jest.fn()}
        />,
      );
    });

    await flush();
    await flush();

    expect(updateDepthErrors).toHaveLength(0);

    await act(async () => { renderer?.unmount(); });
  });
});
