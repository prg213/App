/**
 * TV Home's three main rails form one visual grid. They must share card
 * geometry and use identical, immediate focus scrolling so column edges never
 * drift as focus moves horizontally.
 */

import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/home.tsx'), 'utf8');

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

  it('does not animate synchronized focus scrolling', () => {
    const syncScroll = source.slice(
      source.indexOf('const scrollAllContentRows'),
      source.indexOf('// ── Watch history'),
    );
    expect(syncScroll).toContain('animated: false');
    expect(syncScroll).not.toContain('animated: true');
  });
});