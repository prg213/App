/**
 * Catch-up category/channel grid alignment.
 *
 * Both columns are independent FlatLists, so their row geometry must be
 * explicitly identical.  Otherwise wrapping category names and optional
 * channel archive subtitles create cumulative drift while scrolling.
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/catchup.tsx'),
  'utf8',
);

describe('CatchupScreen category/channel grid alignment', () => {
  it('uses one fixed row height for both grids', () => {
    expect(SOURCE).toMatch(/const CATCHUP_GRID_ROW_H\s*=\s*58/);
    expect(SOURCE).toMatch(/height:\s*CATCHUP_GRID_ROW_H/);
  });

  it('uses matching getItemLayout geometry for both FlatLists', () => {
    const layouts = SOURCE.match(
      /length:\s*CATCHUP_GRID_ROW_H,\s*offset:\s*CATCHUP_GRID_ROW_H\s*\*\s*i,\s*index:\s*i/g,
    ) ?? [];
    expect(layouts).toHaveLength(2);
  });

  it('keeps category text within the fixed row instead of changing row height', () => {
    expect(SOURCE).toMatch(/numberOfLines=\{1\}/);
    expect(SOURCE).toMatch(/justifyContent:\s*'center'/);
  });

  it('matches the Live TV column proportions and header geometry', () => {
    expect(SOURCE).toMatch(/catCol:\s*\{\s*width:\s*'20%'/);
    expect(SOURCE).toMatch(/chCol:\s*\{\s*width:\s*'30%'/);
    expect(SOURCE).toMatch(/paddingHorizontal:\s*12,\s*paddingVertical:\s*8/);
    expect(SOURCE).toMatch(/borderBottomWidth:\s*StyleSheet\.hairlineWidth/);
  });

  it('mirrors channel scrolling into the category grid', () => {
    expect(SOURCE).toMatch(/const syncCategoryScroll\s*=\s*useCallback/);
    expect(SOURCE).toMatch(/categoryListRef\.current\?\.scrollToOffset\(\{ offset, animated: false \}\)/);
    expect(SOURCE).toMatch(/ref=\{categoryListRef\}/);
    expect(SOURCE).toMatch(/onScroll=\{syncCategoryScroll\}/);
  });
});