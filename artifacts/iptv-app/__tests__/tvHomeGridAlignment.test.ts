/**
 * TV Home's three main rails form one visual grid. They must share card
 * geometry and use identical, immediate focus scrolling so column edges never
 * drift as focus moves horizontally.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  computeTvGridCardHeight,
  computeTvRailFocusOffset,
} from '../lib/tvHomeLayout';

const source = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
const recentRailSource = fs.readFileSync(
  path.resolve(__dirname, '../components/RecentChannelsRail.tsx'),
  'utf8',
);

describe('TV Home grid alignment', () => {
  it('measures one shared card height and derives one shared width', () => {
    expect(source).toMatch(/const \[tvCardHeight, setTvCardHeight\] = useState<number \| null>\(null\)/);
    expect(source).toMatch(/const tvCardWidth = tvCardHeight[\s\S]*?Math\.round\(tvCardHeight \* BANNER_W \/ BANNER_H\)/);
    expect(source).toMatch(/\[styles\.tvBannerOuter, \{ width: tvCardWidth, height: tvCardHeight \}\]/);
  });

  it('uses the same deterministic item layout for every TV content rail', () => {
    expect((source.match(/getItemLayout=\{tvItemStride \? getTvItemLayout : undefined\}/g) ?? [])).toHaveLength(3);
    expect((source.match(/onLayout=\{handleTvRailLayout\}/g) ?? [])).toHaveLength(3);
  });

  it('keeps Movies and Series four-across when optional top rows are empty', () => {
    const twoRowBody = 240;
    const twoAcrossHeight = computeTvGridCardHeight(twoRowBody, 2, 2);
    const fourAcrossHeight = computeTvGridCardHeight(twoRowBody, 2, 4);

    expect(fourAcrossHeight).toBeLessThan(twoAcrossHeight);
    expect(source).toMatch(
      /const tvCardLayoutSlots = actualTVSectionCount > 2 \? actualTVSectionCount : TV_HOME_GRID_COLUMNS/,
    );
    expect(source).toMatch(/computeTvGridCardHeight\(\s*bodyHeight/);
  });

  it('keeps the shared TV card geometry while giving each rail its own scroll position', () => {
    expect(source).toMatch(/const actualTVSectionCount =[\s\S]*recentChannelCount > 0/);
    expect(source).toMatch(/onTvItemCountChange=\{setRecentChannelCount\}/);
    expect(recentRailSource).toMatch(/tvCardStyle\?: any/);
    expect(recentRailSource).toMatch(/onTvRailLayout\?: \(event: any\) => void/);
    expect(recentRailSource).toMatch(/onTvItemCountChange\?: \(count: number\) => void/);
    expect(recentRailSource).toMatch(/contentContainerStyle=\{isTvGrid \? styles\.tvList : styles\.list\}/);
    expect(source).toMatch(/const scrollFocusedRowToIndex = useCallback/);
    expect(source).toMatch(/scrollFocusedRowToIndex\(cwListRef, index\)/);
    expect(source).toMatch(/scrollFocusedRowToIndex\(movieListRef, index\)/);
    expect(source).toMatch(/scrollFocusedRowToIndex\(seriesListRef, index\)/);
    expect(source).not.toContain('scrollAllContentRows');
    expect(source).not.toContain('tvSharedColumnCount');
    expect(recentRailSource).not.toContain('onTvCardFocus');
    expect(recentRailSource).not.toContain('tvSharedColumnCount');
  });

  it('does not pad a short rail with empty cards from another row', () => {
    expect(source).not.toContain('renderTvTrailingSpacer');
    expect(source).not.toContain('ListFooterComponent');
    expect(recentRailSource).not.toContain('computeTvRailTrailingSpacerWidth');
  });

  it('reserves and shares a visible focus ring across every TV rail', () => {
    expect(source).toMatch(/tvBannerOuter:[\s\S]*borderWidth: 3[\s\S]*borderColor: 'transparent'/);
    expect(source).toMatch(/tvBannerFocused:[\s\S]*borderColor: '#00E5FF'/);
    expect(source).toMatch(/focusedStyle=\{Platform\.isTV \? styles\.tvBannerFocused : styles\.bannerFocused\}/);
    expect(recentRailSource).toMatch(/focusedStyle=\{Platform\.isTV \? styles\.tvCardFocused : undefined\}/);
    expect(recentRailSource).toMatch(/tvCardFocused:[\s\S]*borderColor: '#00E5FF'/);
  });

  it('holds the first four cards and advances only on the fifth card', () => {
    const stride = 208;
    expect(computeTvRailFocusOffset(0, stride)).toBe(0);
    expect(computeTvRailFocusOffset(1, stride)).toBe(0);
    expect(computeTvRailFocusOffset(2, stride)).toBe(0);
    expect(computeTvRailFocusOffset(3, stride)).toBe(0);
    expect(computeTvRailFocusOffset(4, stride)).toBe(stride);
    expect(computeTvRailFocusOffset(5, stride)).toBe(stride * 2);
    expect(source).toContain('computeTvRailFocusOffset(index, tvItemStrideRef.current)');
    expect(recentRailSource).toContain('computeTvRailFocusOffset(index, tvItemStride ?? CARD_STRIDE)');
  });

  it('pins Recently Watched RIGHT before the final card can receive focus', () => {
    expect(recentRailSource).toMatch(
      /if \(el && isLast\) tvRowNav\.pinRightEdge\('recent', index\)/,
    );
    expect(recentRailSource).toMatch(
      /tvRowNav\.focused\('recent', index, \{ pinRightEdge: index === recent\.length - 1 \}\)/,
    );
  });
});