/**
 * Regression: mounting LiveChannelMenu with a REAL @tanstack/react-query
 * QueryClientProvider (not a mocked useQuery) and Xtream credentials must not
 * throw. The reset test mocks useQuery entirely, so it cannot catch crashes
 * introduced by real query behaviour (e.g. the live-categories query added for
 * category name resolution).
 */

// ── react-native: pure-JS mock (must precede all imports) ─────────────────────
jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');

  const View = ({ children, ...r }: any) => React.createElement('View', r, children);
  const Text = ({ children, ...r }: any) => React.createElement('Text', r, children);
  const TextInput = (props: any) => React.createElement('TextInput', props);
  const FlatList = ({ data, renderItem, ...r }: any) =>
    React.createElement('FlatList', r, (data ?? []).map((item: any, i: number) =>
      renderItem({ item, index: i }),
    ));
  const ActivityIndicator = (props: any) => React.createElement('ActivityIndicator', props);

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
    View, Text, TextInput, FlatList, ActivityIndicator, Animated,
    StyleSheet: { create: (s: any) => s, flatten: (s: any) => s, absoluteFill: {}, absoluteFillObject: {} },
    Platform: { OS: 'android', isTV: false, select: (obj: any) => obj.android ?? obj.default },
    AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Keyboard: { dismiss: jest.fn() },
    TouchableOpacity: ({ children, onPress, ...r }: any) => React.createElement('TouchableOpacity', { ...r, onClick: onPress }, children),
    Pressable: ({ children, onPress, ...r }: any) => React.createElement('Pressable', { ...r, onClick: onPress }, children),
    ScrollView: ({ children, ...r }: any) => React.createElement('ScrollView', r, children),
    Image: (props: any) => React.createElement('Image', props),
    useColorScheme: jest.fn(() => 'dark'),
    useWindowDimensions: jest.fn(() => ({ width: 390, height: 844 })),
    Dimensions: { get: jest.fn(() => ({ width: 390, height: 844 })) },
  };
});

jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return { Image: (props: any) => React.createElement('Image', props) };
});

jest.mock('@/components/FocusablePressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return {
    FocusablePressable: ({ children, onPress, ...r }: any) =>
      React.createElement('TouchableOpacity', { ...r, onClick: onPress }, children),
  };
});

// AppContext: mock the hook directly with Xtream credentials.
jest.mock('@/context/AppContext', () => ({
  useAppContext: () => ({
    credentials: { type: 'xtream', host: 'http://example.com', username: 'u', password: 'p' },
  }),
}));

jest.mock('@/services/storage', () => ({
  StorageService: {
    getFavorites: jest.fn(async () => []),
    getRecentChannels: jest.fn(async () => []),
  },
}));

const mockStreams = jest.fn(async () => [
  { id: '1', name: 'Chan One', streamUrl: 'http://x/1.ts', groupTitle: '204', num: 1 },
  { id: '2', name: 'Chan Two', streamUrl: 'http://x/2.ts', groupTitle: '321', num: 2 },
]);
const mockCats = jest.fn(async () => [
  { id: '204', name: 'EFL League One' },
  { id: '321', name: 'Sports' },
]);
jest.mock('@/services/xtreamApi', () => ({
  getXtreamLiveStreams: (...a: any[]) => (mockStreams as any)(...a),
  getXtreamLiveCategories: (...a: any[]) => (mockCats as any)(...a),
}));
jest.mock('@/services/m3uParser', () => ({
  fetchAndParseM3U: jest.fn(async () => ({ channels: [], categories: [] })),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveChannelMenu } from '../components/LiveChannelMenu';

// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await Promise.resolve(); });

describe('LiveChannelMenu mount with real react-query', () => {
  it('mounts without crashing and resolves category names', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let tree: any;
    await act(async () => {
      tree = create(
        <QueryClientProvider client={qc}>
          <LiveChannelMenu
            currentChannelId="1"
            epgMap={undefined as any}
            onSelectChannel={jest.fn()}
            onClose={jest.fn()}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    await flush();

    const json = JSON.stringify(tree!.toJSON());
    // Category sidebar must show resolved names, not raw IDs.
    expect(json).toContain('EFL League One');
    expect(json).toContain('Sports');

    await act(async () => { tree!.unmount(); });
  });
});
