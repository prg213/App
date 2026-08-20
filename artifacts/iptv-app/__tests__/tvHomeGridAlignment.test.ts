/**
 * TV Home's three main rails form one visual grid. They must share card
 * geometry and use identical, immediate focus scrolling so column edges never
 * drift as focus moves horizontally.
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeTvRailTrailingSpacerWidth } from '../lib/tvHomeLayout';

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

  it('moves every content rail by one shared, immediate offset', () => {
    const syncScroll = source.slice(
      source.indexOf('const scrollAllContentRows'),
      source.indexOf('// ── Watch history'),
    );
    expect(syncScroll).toContain('tvItemStrideRef.current * index');
    expect(syncScroll).toContain('scrollToOffset');
    expect(syncScroll).toContain('animated: false');
    expect(syncScroll).not.toContain('animated: true');
  });

  it('gives shorter rails enough trailing width to realize the shared offset', () => {
    const stride = 208;
    const gap = 8;
    const longestRail = 30;
    const shortRail = 20;
    // A footer receives the FlatList gap before it; a final card does not.
    const shortRailExtent = shortRail * stride
      + computeTvRailTrailingSpacerWidth(shortRail, longestRail, stride, gap);
    const longRailExtent = longestRail * stride - gap;

    expect(shortRailExtent).toBe(longRailExtent);
    expect(computeTvRailTrailingSpacerWidth(shortRail, longestRail, stride, gap)).toBe(10 * stride - gap);
    expect(source).toMatch(/ListFooterComponent=\{renderTvTrailingSpacer\(continueWatchingItems\.length\)\}/);
    expect(source).toMatch(/ListFooterComponent=\{renderTvTrailingSpacer\(latestMovies\.length\)\}/);
    expect(source).toMatch(/ListFooterComponent=\{renderTvTrailingSpacer\(latestSeries\.length\)\}/);
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