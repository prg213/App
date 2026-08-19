/**
 * Fire TV Live TV category navigation contract.
 *
 * Category actions are not left to spatial-navigation heuristics:
 * - LEFT/BACK returns to the active sidebar item,
 * - OK selects, previews, and focuses the first channel,
 * - RIGHT always targets the first row of the active channel list.
 */

import * as fs from 'fs';
import * as path from 'path';

const LIVE_TV = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
const TV_LAYOUT = fs.readFileSync(path.resolve(__dirname, '../components/TVLiveLayout.tsx'), 'utf8');

describe('Fire TV category navigation', () => {
  it('returns BACK from a focused category to the active Live TV sidebar item', () => {
    expect(LIVE_TV).toMatch(/const categoryFocusedRef = useRef\(false\)/);
    expect(LIVE_TV).toMatch(
      /Platform\.isTV && categoryFocusedRef\.current[\s\S]*?sidebarNav\.focus\(\)[\s\S]*?return true/,
    );
  });

  it('wires category LEFT to the active sidebar item and tracks category focus', () => {
    expect(TV_LAYOUT).toMatch(/props\.nextFocusLeft = sidebarNav\.handle/);
    expect(TV_LAYOUT).toMatch(/onCategoryFocusChange\?\.\(true\)/);
    expect(TV_LAYOUT).toMatch(/onBlur=\{\(\) => \{\s*onCategoryFocusChange\?\.\(false\)/);
  });

  it('selects, previews, and focuses the first available channel after category OK', () => {
    expect(TV_LAYOUT).toMatch(/pendingCategoryActivationRef\.current = item\.id/);
    expect(TV_LAYOUT).toMatch(/onCatSelect\(item\.id\)/);
    expect(TV_LAYOUT).toMatch(/const firstChannel = channels\[0\]/);
    expect(TV_LAYOUT).toMatch(/onChannelSelect\(firstChannel\)/);
    expect(TV_LAYOUT).toMatch(/requestTvFocus\(chRefMap\.current\.get\(firstChannel\.id\) \?\? firstChRef\.current\)/);
  });

  it('rewires category RIGHT to the first channel when the list mounts', () => {
    expect(TV_LAYOUT).toMatch(/const wireCategoryToFirstChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/setNativeProps\?\.\(\{ nextFocusRight: firstChannelHandle \}\)/);
    expect(TV_LAYOUT).toMatch(/wireCategoryToFirstChannel\(\);\s*\n  \}, \[channels, wireCategoryToFirstChannel\]\)/);
  });

  it('returns channel LEFT and BACK to that channel’s category without clearing preview state', () => {
    expect(TV_LAYOUT).toMatch(/const categoryForChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/const focusCategoryForHighlightedChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/focusHighlightedChCategoryRef\.current = focusCategoryForHighlightedChannel/);
    expect(TV_LAYOUT).toMatch(/const channelCategory = categoryForChannel\(item\)/);
    expect(LIVE_TV).toMatch(/focusHighlightedChCategoryRef\.current\?\.\(\)/);
  });

  it('stops playback only when category focus exits to the Live TV sidebar', () => {
    expect(TV_LAYOUT).toMatch(/sidebarNav\.focusedRoute === 'index'.*?onExitToSidebar/s);
    expect(LIVE_TV).toMatch(/const handleExitToSidebar = useCallback[\s\S]*?setPlayingChannel\(null\)[\s\S]*?setSelectedChannel\(null\)/);
    expect(LIVE_TV).toMatch(/categoryFocusedRef\.current[\s\S]*?handleExitToSidebar\(\)[\s\S]*?sidebarNav\.focus\(\)/);
  });
});