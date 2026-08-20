/**
 * Fire TV Live TV category navigation contract.
 *
 * Category actions are not left to spatial-navigation heuristics:
 * - LEFT/BACK returns to the active sidebar item,
 * - Category OK focuses the first channel without starting it,
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

  it('focuses but does not play the first available channel after category OK', () => {
    expect(TV_LAYOUT).toMatch(/pendingCategoryActivationRef\.current = item\.id/);
    expect(TV_LAYOUT).toMatch(/onCatSelect\(item\.id\)/);
    expect(TV_LAYOUT).toMatch(/const firstChannel = channels\[0\]/);
    expect(TV_LAYOUT).toMatch(/const focusFirstChannel = useCallback/);
    expect(TV_LAYOUT).not.toMatch(/onChannelSelect\(firstChannel\)/);
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
    expect(TV_LAYOUT).toMatch(/useTVRemote\(\{[\s\S]*?left: \(event\)[\s\S]*?focusCategoryForHighlightedChannel\(\)/);
    expect(LIVE_TV).toMatch(/focusHighlightedChCategoryRef\.current\?\.\(\)/);
  });

  it('returns preview, Catch-up, and mini-guide LEFT/BACK to the playing channel', () => {
    expect(TV_LAYOUT).toMatch(/const focusPlayingChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/focusPlayingChannelRef\.current = focusPlayingChannel/);
    expect(TV_LAYOUT).toMatch(/nextFocusLeft=\{playingChHandle \?\? undefined\}/);
    expect(TV_LAYOUT).toMatch(/guideFocusedRef\.current = true/);
    expect(TV_LAYOUT).toMatch(/focusPlayingChannel\(\)/);
    expect(LIVE_TV).toMatch(/const focusPlayingChannelRef = useRef/);
    expect(LIVE_TV).toMatch(/previewFocusedRef\.current \|\| catchupFocusedRef\.current \|\| guideFocusedRef\.current/);
    expect(LIVE_TV).toMatch(/focusPlayingChannelRef\.current\?\.\(\)/);
  });

  it('keeps the preview playing while browsing categories or returning to the Live TV sidebar', () => {
    expect(TV_LAYOUT).toMatch(/sidebarNav\.focusedRoute === 'index'.*?onExitToSidebar/s);
    const sidebarExitStart = LIVE_TV.indexOf('const handleExitToSidebar = useCallback');
    const sidebarExitEnd = LIVE_TV.indexOf('// Hardware BACK:', sidebarExitStart);
    const sidebarExit = LIVE_TV.slice(sidebarExitStart, sidebarExitEnd);
    expect(sidebarExit).not.toMatch(/setPlayingChannel\(null\)|setSelectedChannel\(null\)/);

    const categorySelectStart = LIVE_TV.indexOf('const handleSelectCat = useCallback');
    const categorySelectEnd = LIVE_TV.indexOf('// ── Reorder mode handlers', categorySelectStart);
    const categorySelect = LIVE_TV.slice(categorySelectStart, categorySelectEnd);
    expect(categorySelect).toMatch(/if \(!Platform\.isTV\) setSelectedChannel\(null\)/);
    expect(categorySelect).not.toMatch(/setPlayingChannel\(null\)/);

    const openAllStart = LIVE_TV.indexOf(`DeviceEventEmitter.addListener('live:open-all'`);
    const openAllEnd = LIVE_TV.indexOf('// ── TV block/unblock confirm modal', openAllStart);
    const openAll = LIVE_TV.slice(openAllStart, openAllEnd);
    expect(openAll).not.toMatch(/setSelectedChannel\(null\)|setPlayingChannel\(null\)/);
    expect(LIVE_TV).toMatch(/categoryFocusedRef\.current[\s\S]*?handleExitToSidebar\(\)[\s\S]*?sidebarNav\.focus\(\)/);
  });
});