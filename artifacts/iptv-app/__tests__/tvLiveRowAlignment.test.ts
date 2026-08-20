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

  it('does not move categories when the channel list scrolls', () => {
    expect(SOURCE).not.toMatch(/const syncCategoryScroll\s*=\s*useCallback/);
    expect(SOURCE).not.toMatch(/onScroll=\{syncCategoryScroll\}/);
    expect(SOURCE).not.toMatch(/catListRef\.current\?\.scrollToOffset/);
  });

  it('does not start an animated list scroll for every rapid channel focus event', () => {
    const start = SOURCE.indexOf('const handleChFocus');
    const end = SOURCE.indexOf('const renderChannel', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(SOURCE.slice(start, end)).not.toMatch(/scrollToIndex/);
    expect(SOURCE.slice(start, end)).not.toMatch(/animated:\s*true/);
  });

  it('coalesces channel-highlight redraws while D-pad focus moves rapidly', () => {
    expect(SOURCE).toMatch(/const CHANNEL_HIGHLIGHT_COMMIT_DELAY_MS\s*=\s*90/);
    expect(SOURCE).toMatch(/const updateHighlightedChannel\s*=\s*useCallback/);
    expect(SOURCE).toMatch(/setTimeout\([\s\S]*CHANNEL_HIGHLIGHT_COMMIT_DELAY_MS/);
    const start = SOURCE.indexOf('const handleChFocus');
    const end = SOURCE.indexOf('const renderChannel', start);
    expect(SOURCE.slice(start, end)).toMatch(/updateHighlightedChannel\(ch\.id,\s*true\)/);
  });

  it('keeps the TV grid inside the viewport and constrains the guide height', () => {
    expect(SOURCE).toMatch(/paddingLeft:\s*Math\.max\(insets\.left,\s*12\)/);
    expect(SOURCE).toMatch(/paddingRight:\s*Math\.max\(insets\.right,\s*12\)/);
    expect(SOURCE).toMatch(/minWidth:\s*0/);
    expect(SOURCE).toMatch(/style=\{\{ flex: 1, minHeight: 0 \}\}/);
    expect(SOURCE).toMatch(/contentContainerStyle=\{\{ paddingBottom: 4 \}\}/);
  });
});