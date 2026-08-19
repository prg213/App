/**
 * The category and channel panels are two synchronized vertical lists. Their
 * item heights must remain identical or the horizontal row boundaries drift
 * as soon as the viewer scrolls.
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../components/TVLiveLayout.tsx'),
  'utf8',
);

describe('TV Live category/channel row alignment', () => {
  it('defines one shared row height for both lists', () => {
    expect(SOURCE).toMatch(/const TV_LIST_ROW_H\s*=\s*58/);
    expect(SOURCE).toMatch(/const CAT_ITEM_H\s*=\s*TV_LIST_ROW_H/);
    expect(SOURCE).toMatch(/const CH_ITEM_H\s*=\s*TV_LIST_ROW_H/);
  });

  it('uses the matching heights for both FlatList layouts and item styles', () => {
    expect(SOURCE).toMatch(/length:\s*CAT_ITEM_H,\s*offset:\s*CAT_ITEM_H\s*\*\s*i/);
    expect(SOURCE).toMatch(/length:\s*CH_ITEM_H,\s*offset:\s*CH_ITEM_H\s*\*\s*i/);
    expect(SOURCE).toMatch(/height:\s*CAT_ITEM_H/);
    expect(SOURCE).toMatch(/height:\s*CH_ITEM_H/);
  });

  it('mirrors the channel scroll offset into the category grid', () => {
    expect(SOURCE).toMatch(/const syncCategoryScroll\s*=\s*useCallback/);
    expect(SOURCE).toMatch(/event\.nativeEvent\.contentOffset\.y/);
    expect(SOURCE).toMatch(/catListRef\.current\?\.scrollToOffset\(\{ offset, animated: false \}\)/);
    expect(SOURCE).toMatch(/onScroll=\{syncCategoryScroll\}/);
    expect(SOURCE).toMatch(/scrollEventThrottle=\{16\}/);
  });

  it('does not start an animated list scroll for every rapid channel focus event', () => {
    const start = SOURCE.indexOf('const handleChFocus');
    const end = SOURCE.indexOf('const syncCategoryScroll', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(SOURCE.slice(start, end)).not.toMatch(/scrollToIndex/);
    expect(SOURCE.slice(start, end)).not.toMatch(/animated:\s*true/);
  });

  it('keeps the TV grid inside the viewport and constrains the guide height', () => {
    expect(SOURCE).toMatch(/paddingLeft:\s*Math\.max\(insets\.left,\s*12\)/);
    expect(SOURCE).toMatch(/paddingRight:\s*Math\.max\(insets\.right,\s*12\)/);
    expect(SOURCE).toMatch(/minWidth:\s*0/);
    expect(SOURCE).toMatch(/style=\{\{ flex: 1, minHeight: 0 \}\}/);
    expect(SOURCE).toMatch(/contentContainerStyle=\{\{ paddingBottom: 4 \}\}/);
  });
});