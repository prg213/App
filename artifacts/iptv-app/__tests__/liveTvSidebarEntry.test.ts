/**
 * Fire TV Live TV sidebar entry contract.
 *
 * Pressing OK on the Live TV sidebar item must open the category and channel
 * panels together with All Channels selected and receiving remote focus. It
 * must not restore a stale channel row or fall back to Favourites.
 */

import * as fs from 'fs';
import * as path from 'path';

const TAB_LAYOUT = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/_layout.tsx'), 'utf8');
const LIVE_TV = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
const TV_LAYOUT = fs.readFileSync(path.resolve(__dirname, '../components/TVLiveLayout.tsx'), 'utf8');

describe('Fire TV Live TV sidebar entry', () => {
  it('emits an All Channels entry intent before navigating from the Live TV sidebar item', () => {
    expect(TAB_LAYOUT).toMatch(/route\.name === 'index'[\s\S]*?setPrefLiveCat\('__all__'\)[\s\S]*?emit\('live:open-all'\)/);
    expect(TAB_LAYOUT).toMatch(/emit\('live:open-all'\)[\s\S]*?navigation\.navigate\(route\.name\)/);
  });

  it('defaults the TV Live screen to All Channels and renders it first', () => {
    expect(LIVE_TV).toMatch(/useState<string>\(ALL_CAT_ID\)/);
    const categories = LIVE_TV.match(/const allCategories:[\s\S]*?\],\n    \[rawCategories\],/);
    expect(categories?.[0]).toMatch(/\{ id: ALL_CAT_ID, name: 'All Channels' \}[\s\S]*?\{ id: FAVS_CAT_ID/);
  });

  it('selects All Channels and clears the old preview on the entry event', () => {
    const entryHandler = LIVE_TV.match(/addListener\('live:open-all'[\s\S]*?\n    \}\);/);
    expect(entryHandler?.[0]).toContain('setSelectedCatId(ALL_CAT_ID)');
    expect(entryHandler?.[0]).toContain('setSelectedChannel(null)');
    expect(entryHandler?.[0]).toContain('tvLiveEntryResetRef.current?.()');
  });

  it('clears remembered channel focus before useFocusRestore runs', () => {
    expect(TV_LAYOUT).toContain('entryResetCallbackRef');
    expect(TV_LAYOUT).toMatch(/const resetEntryFocus = \(\) => \{[\s\S]*?clearFocus\(\)/);
    expect(TV_LAYOUT).toMatch(/catRefMap\.current\.get\('__all__'\) \?\? firstCatRef\.current/);
  });
});