import { navigateTv, type TvFocusState } from '@/lib/tvNavigation';

describe('deterministic Fire TV navigation', () => {
  const base = (panel: TvFocusState['panel']): TvFocusState => ({
    panel,
    categoryIndex: 2,
    channelIndex: 4,
  });

  test('categories scroll independently from channels', () => {
    const result = navigateTv({
      state: base('categories'),
      direction: 'down',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.categoryIndex).toBe(3);
    expect(result.state.channelIndex).toBe(4);
    expect(result.scrollCategories).toBe(true);
    expect(result.scrollChannels).toBe(false);
  });

  test('channels scroll independently from categories', () => {
    const result = navigateTv({
      state: base('channels'),
      direction: 'down',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.channelIndex).toBe(5);
    expect(result.state.categoryIndex).toBe(2);
    expect(result.scrollChannels).toBe(true);
    expect(result.scrollCategories).toBe(false);
  });

  test('categories route right to channels without changing indices', () => {
    const result = navigateTv({
      state: base('categories'),
      direction: 'right',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.panel).toBe('channels');
    expect(result.state.categoryIndex).toBe(2);
    expect(result.state.channelIndex).toBe(4);
  });

  test('channels route left to categories without changing indices', () => {
    const result = navigateTv({
      state: base('channels'),
      direction: 'left',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.panel).toBe('categories');
    expect(result.state.categoryIndex).toBe(2);
    expect(result.state.channelIndex).toBe(4);
  });

  test('channels route right to preview', () => {
    const result = navigateTv({
      state: base('channels'),
      direction: 'right',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.panel).toBe('preview');
    expect(result.changed).toBe(true);
  });

  test('preview routes left back to channels', () => {
    const result = navigateTv({
      state: base('preview'),
      direction: 'left',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.panel).toBe('channels');
  });

  test('preview routes down to guide', () => {
    const result = navigateTv({
      state: base('preview'),
      direction: 'down',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(result.state.panel).toBe('guide');
  });

  test('OK selects category or channel but does not change focus', () => {
    const category = navigateTv({
      state: base('categories'),
      direction: 'select',
      categoryCount: 10,
      channelCount: 20,
    });
    const channel = navigateTv({
      state: base('channels'),
      direction: 'select',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(category.shouldSelect).toBe(true);
    expect(channel.shouldSelect).toBe(true);
    expect(category.state.panel).toBe('categories');
    expect(channel.state.panel).toBe('channels');
  });

  test('empty channel lists do not route categories into a dead channel panel', () => {
    const result = navigateTv({
      state: base('categories'),
      direction: 'right',
      categoryCount: 10,
      channelCount: 0,
    });

    expect(result.state.panel).toBe('categories');
    expect(result.changed).toBe(false);
  });

  test('vertical movement clamps at list boundaries', () => {
    const top = navigateTv({
      state: { ...base('channels'), channelIndex: 0 },
      direction: 'up',
      categoryCount: 10,
      channelCount: 20,
    });
    const bottom = navigateTv({
      state: { ...base('channels'), channelIndex: 19 },
      direction: 'down',
      categoryCount: 10,
      channelCount: 20,
    });

    expect(top.state.channelIndex).toBe(0);
    expect(bottom.state.channelIndex).toBe(19);
    expect(top.scrollChannels).toBe(false);
    expect(bottom.scrollChannels).toBe(false);
  });
});
