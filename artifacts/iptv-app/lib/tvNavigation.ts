export type TvPanel = 'sidebar' | 'categories' | 'channels' | 'preview' | 'guide';
export type TvDirection = 'up' | 'down' | 'left' | 'right' | 'select';

export interface TvFocusState {
  panel: TvPanel;
  categoryIndex: number;
  channelIndex: number;
}

export interface TvNavigationInput {
  state: TvFocusState;
  direction: TvDirection;
  categoryCount: number;
  channelCount: number;
}

export interface TvNavigationResult {
  state: TvFocusState;
  changed: boolean;
  shouldSelect: boolean;
  scrollCategories: boolean;
  scrollChannels: boolean;
}

/**
 * Deterministic Fire TV navigation model.
 *
 * This module deliberately contains no FlatList refs, timers or native focus
 * calls. It only decides which panel owns the next focus event. The UI layer
 * is responsible for mounting/scrolling that destination and then calling
 * requestTvFocus() on the exact row.
 *
 * Categories and channels are independent lists: vertical movement in one
 * panel never changes the scroll position or index of the other panel.
 */
export function navigateTv({
  state,
  direction,
  categoryCount,
  channelCount,
}: TvNavigationInput): TvNavigationResult {
  const next: TvFocusState = { ...state };
  let changed = false;
  let shouldSelect = false;
  let scrollCategories = false;
  let scrollChannels = false;

  const moveIndex = (index: number, count: number, delta: number) => {
    if (count <= 0) return index;
    return Math.max(0, Math.min(count - 1, index + delta));
  };

  switch (state.panel) {
    case 'categories':
      if (direction === 'up') {
        const value = moveIndex(state.categoryIndex, categoryCount, -1);
        changed = value !== state.categoryIndex;
        next.categoryIndex = value;
        scrollCategories = changed;
      } else if (direction === 'down') {
        const value = moveIndex(state.categoryIndex, categoryCount, 1);
        changed = value !== state.categoryIndex;
        next.categoryIndex = value;
        scrollCategories = changed;
      } else if (direction === 'right') {
        next.panel = channelCount > 0 ? 'channels' : 'categories';
        changed = next.panel !== state.panel;
      } else if (direction === 'left') {
        next.panel = 'sidebar';
        changed = true;
      } else if (direction === 'select') {
        shouldSelect = categoryCount > 0;
      }
      break;

    case 'channels':
      if (direction === 'up') {
        const value = moveIndex(state.channelIndex, channelCount, -1);
        changed = value !== state.channelIndex;
        next.channelIndex = value;
        scrollChannels = changed;
      } else if (direction === 'down') {
        const value = moveIndex(state.channelIndex, channelCount, 1);
        changed = value !== state.channelIndex;
        next.channelIndex = value;
        scrollChannels = changed;
      } else if (direction === 'left') {
        next.panel = 'categories';
        changed = true;
      } else if (direction === 'right') {
        next.panel = 'preview';
        changed = true;
      } else if (direction === 'select') {
        shouldSelect = channelCount > 0;
      }
      break;

    case 'preview':
      if (direction === 'left') {
        next.panel = 'channels';
        changed = channelCount > 0;
      } else if (direction === 'down') {
        next.panel = 'guide';
        changed = true;
      } else if (direction === 'select') {
        shouldSelect = true;
      }
      break;

    case 'guide':
      if (direction === 'up') {
        next.panel = 'preview';
        changed = true;
      } else if (direction === 'left') {
        next.panel = 'channels';
        changed = channelCount > 0;
      }
      break;

    case 'sidebar':
      if (direction === 'right') {
        next.panel = 'categories';
        changed = categoryCount > 0;
      }
      break;
  }

  return {
    state: next,
    changed,
    shouldSelect,
    scrollCategories,
    scrollChannels,
  };
}
