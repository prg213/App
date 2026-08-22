/**
 * Fire TV Live TV category navigation contract.
 *
 * Category actions are not left to spatial-navigation heuristics:
 * - LEFT/BACK returns to the active sidebar item,
 * - Category OK focuses the first channel without starting it,
 * - LEFT/RIGHT/BACK moves between directly aligned category and channel rows.
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

  it('wires category RIGHT to the channel in the directly aligned row', () => {
    expect(TV_LAYOUT).toMatch(/const wireCategoryToOppositeChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/const oppositeChannel = channels\[categoryIndex\]/);
    expect(TV_LAYOUT).toMatch(/nextFocusRight: oppositeChannelHandle/);
    expect(TV_LAYOUT).toMatch(/focusedCategoryIndexRef\.current = index/);
    expect(TV_LAYOUT).toMatch(/wireCategoryToOppositeChannel\(index, node\)/);
    expect(TV_LAYOUT).toMatch(/chScrollOffsetRef\.current = catScrollOffsetRef\.current/);
  });

  it('returns channel LEFT and BACK to the directly aligned category without clearing preview state', () => {
    expect(TV_LAYOUT).toMatch(/const categoryForChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/const focusCategoryAtIndex = useCallback/);
    expect(TV_LAYOUT).toMatch(/const focusChannelAtIndex = useCallback/);
    expect(TV_LAYOUT).toMatch(/const focusCategoryForHighlightedChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/focusHighlightedChCategoryRef\.current = focusCategoryForHighlightedChannel/);
    expect(TV_LAYOUT).toMatch(/focusCategoryAtIndex\(channelIndex\)/);
    expect(TV_LAYOUT).toMatch(/const alignedCategory = allCategories\[index\]/);
    expect(TV_LAYOUT).toMatch(/focusedChannelIndexRef\.current = index/);
    expect(TV_LAYOUT).toMatch(/left: \(event\)[\s\S]*?focusCategoryAtIndex\(index\)/);
    expect(TV_LAYOUT).toMatch(/right: \(event\)[\s\S]*?focusChannelAtIndex\(index\)/);
    expect(TV_LAYOUT).toMatch(/catScrollOffsetRef\.current = chScrollOffsetRef\.current/);
    expect(LIVE_TV).toMatch(/focusHighlightedChCategoryRef\.current\?\.\(\)/);
  });

  it('returns preview, Catch-up, and mini-guide LEFT/BACK to the playing channel', () => {
    expect(TV_LAYOUT).toMatch(/const focusPlayingChannel = useCallback/);
    expect(TV_LAYOUT).toMatch(/focusPlayingChannelRef\.current = focusPlayingChannel/);
    expect(TV_LAYOUT).toMatch(/nextFocusLeft=\{playingChHandle \?\? leftReturnProxyHandle \?\? undefined\}/);
    expect(TV_LAYOUT).toMatch(/const setPlayingChannelHandle = useCallback/);
    expect(TV_LAYOUT).toMatch(/item\.id === selectedChannel\?\.id[\s\S]*?setPlayingChannelHandle\(nodeHandle\(node\)\)/);
    expect(TV_LAYOUT).toMatch(/guideFocusedRef\.current = true/);
    expect(TV_LAYOUT).toMatch(/focusPlayingChannel\(\)/);
    expect(LIVE_TV).toMatch(/const focusPlayingChannelRef = useRef/);
    expect(LIVE_TV).toMatch(/previewFocusedRef\.current \|\| catchupFocusedRef\.current \|\| guideFocusedRef\.current/);
    expect(LIVE_TV).toMatch(/focusPlayingChannelRef\.current\?\.\(\)/);
  });

  it('shows the focused channel guide while browsing without changing playback', () => {
    expect(TV_LAYOUT).toMatch(/const \[guideChannelId, setGuideChannelId\] = useState<string \| null>/);
    expect(TV_LAYOUT).toMatch(/const guideChannel = useMemo\(/);
    expect(TV_LAYOUT).toMatch(/setGuideChannelId\(\(current\) => current === ch\.id \? current : ch\.id\)/);
    expect(TV_LAYOUT).toMatch(/const key = guideChannel\.epgId \?\? guideChannel\.id/);
    expect(TV_LAYOUT).toMatch(/TV GUIDE\{guideChannel \? ` · \$\{guideChannel\.name\}` : ''\}/);
    expect(TV_LAYOUT).toMatch(/guideHasCatchup/);
    expect(TV_LAYOUT).toMatch(/onChannelSelect\(item\)/);
  });

  it('keeps live surface handoffs silent on TV while retaining stream errors', () => {
    expect(TV_LAYOUT).toMatch(/\{isBuffering && !Platform\.isTV && \(/);
    expect(TV_LAYOUT).toMatch(/\{hasError && !isBuffering && \(/);
    const returnStart = LIVE_TV.indexOf('const returnedChannel = consumePendingLivePlayerReturn()');
    const returnBlock = LIVE_TV.slice(returnStart, returnStart + 900);
    expect(returnStart).toBeGreaterThan(-1);
    expect(returnBlock).toContain('setIsBuffering(false)');
    expect(returnBlock).toContain('setPlayingChannel(returnedChannel)');
    expect(returnBlock).toContain('setSelectedChannel(returnedChannel)');
  });

  it('restores the currently zapped fullscreen channel to its TV list row on BACK', () => {
    const PLAYER = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');

    expect(PLAYER).toMatch(/const currentEntry = channelList\[channelIdx\]/);
    expect(PLAYER).toMatch(/groupTitle: currentEntry\?\.groupTitle \?\? params\.groupTitle \?\? ''/);
    expect(PLAYER).toMatch(/setPendingLivePlayerReturn\(returnChannel\)[\s\S]*?DEE\.emit\('live:setPlayingChannel', returnChannel\)/);
    expect(PLAYER).toMatch(/DEE\.emit\('live:setPlayingChannel', returnChannel\)[\s\S]*?triggerCollapse\(\(\) => router\.back\(\)\)/);
    expect(LIVE_TV).toMatch(
      /focusPlayingChannelRef\.current\?\.\(\)[\s\S]*?requestTvFocus\(miniPlayerRef\.current\)/,
    );
  });

  it('uses the BACK resolver when LEFT cannot directly target an unmounted playing row', () => {
    expect(TV_LAYOUT).toMatch(/const \[leftReturnProxyHandle, setLeftReturnProxyHandle\] = useState<number \| null>\(null\)/);
    expect(TV_LAYOUT).toMatch(/ref=\{setLeftReturnProxyRef as any\}/);
    expect(TV_LAYOUT).toMatch(/onFocus=\{\(\) => \{ focusPlayingChannel\(\); \}\}/);
    expect(TV_LAYOUT).toMatch(/nextFocusLeft: playingOrReturnProxy/);
    expect(TV_LAYOUT).toMatch(/nextFocusLeft=\{playingChHandle \?\? leftReturnProxyHandle \?\? undefined\}/);
  });

  it('redirects a category that Fire OS incorrectly focuses from the preview panel back to the playing channel', () => {
    expect(TV_LAYOUT).toMatch(/const previewPanelReturnPendingRef = useRef\(false\)/);
    expect(TV_LAYOUT).toMatch(/previewPanelReturnPendingRef\.current = true/);
    expect(TV_LAYOUT).toMatch(
      /if \(Platform\.isTV && previewPanelReturnPendingRef\.current\) \{[\s\S]*?focusPlayingChannel\(\);[\s\S]*?return;/,
    );
    expect(TV_LAYOUT).toMatch(/previewPanelReturnPendingRef\.current = false;[\s\S]*?handleChFocus/);
  });

  it('creates an explicit preview-to-controls DOWN chain instead of relying on spatial focus', () => {
    expect(TV_LAYOUT).toMatch(/const firstGuideRowRef = useRef<View \| null>\(null\)/);
    expect(TV_LAYOUT).toMatch(
      /nextFocusDown: nodeHandle\(catchupNode\) \?\? nodeHandle\(firstGuideNode\) \?\? previewH/,
    );
    expect(TV_LAYOUT).toMatch(
      /nextFocusUp: previewH,[\s\S]*?nextFocusDown: nodeHandle\(firstGuideNode\) \?\? nodeHandle\(catchupNode\)/,
    );
    expect(TV_LAYOUT).toMatch(/guideRowRefMap\.current\.forEach/);
  });

  it('keeps restoring the selected channel until FlatList remounts its row', () => {
    expect(TV_LAYOUT).toMatch(/const retryFocusPlayingNode = \(attemptsRemaining: number\)/);
    expect(TV_LAYOUT).toMatch(/PLAYING_CHANNEL_FOCUS_RETRY_ATTEMPTS = 6/);
    expect(TV_LAYOUT).toMatch(/PLAYING_CHANNEL_FOCUS_RETRY_DELAY_MS = 80/);
    expect(TV_LAYOUT).toMatch(/retryFocusPlayingNode\(attemptsRemaining - 1\)/);
  });

  it('uses each list’s current offset so UP moves through visible rows before scrolling', () => {
    expect(TV_LAYOUT).toMatch(/const catScrollOffsetRef = useRef\(0\)/);
    expect(TV_LAYOUT).toMatch(/const chScrollOffsetRef = useRef\(0\)/);
    expect(TV_LAYOUT).toMatch(
      /computeTvVerticalFocusOffset\(\s*index,\s*CAT_ITEM_H,\s*catViewportHeightRef\.current,\s*catScrollOffsetRef\.current/,
    );
    expect(TV_LAYOUT).toMatch(
      /computeTvVerticalFocusOffset\(\s*index,\s*CH_ITEM_H,\s*chViewportHeightRef\.current,\s*chScrollOffsetRef\.current/,
    );
    expect(TV_LAYOUT).toMatch(/catScrollOffsetRef\.current = event\.nativeEvent\.contentOffset\.y/);
    expect(TV_LAYOUT).toMatch(/chScrollOffsetRef\.current = event\.nativeEvent\.contentOffset\.y/);
  });

  it('drops a recycled native LEFT target when FlatList unmounts the playing row', () => {
    const channelStart = TV_LAYOUT.indexOf('const renderChannel');
    const channelRefStart = TV_LAYOUT.indexOf('ref={(node: View | null) => {', channelStart);
    const channelRefEnd = TV_LAYOUT.indexOf('accessible', channelRefStart);
    expect(channelRefStart).toBeGreaterThan(-1);
    expect(channelRefEnd).toBeGreaterThan(channelRefStart);
    const channelRef = TV_LAYOUT.slice(channelRefStart, channelRefEnd);
    expect(channelRef).toMatch(
      /else \{[\s\S]*?chRefMap\.current\.delete\(item\.id\);[\s\S]*?item\.id === selectedChannel\?\.id[\s\S]*?setPlayingChannelHandle\(null\)/,
    );
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