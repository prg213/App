import * as fs from 'fs';
import * as path from 'path';

const BACK_HANDLER = fs.readFileSync(
  path.resolve(__dirname, '../hooks/useBackHandler.ts'),
  'utf8',
);
const TAB_LAYOUT = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/_layout.tsx'),
  'utf8',
);

describe('sidebar-focused TV BACK handling', () => {
  it('consumes BACK before any screen-specific handler while a sidebar item is focused', () => {
    expect(BACK_HANDLER).toMatch(/import \{ sidebarNav \} from '@\/lib\/sidebarNav'/);
    expect(BACK_HANDLER).toMatch(
      /if \(Platform\.isTV && sidebarNav\.focusedRoute !== null\) return true/,
    );
  });

  it('also protects the global fallback handler', () => {
    const start = TAB_LAYOUT.indexOf(
      "BackHandler.addEventListener('hardwareBackPress'",
    );
    const end = TAB_LAYOUT.indexOf('return () => sub.remove()', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const globalHandler = TAB_LAYOUT.slice(start, end);
    expect(globalHandler).toMatch(
      /if \(Platform\.isTV && sidebarNav\.focusedRoute !== null\) return true/,
    );
    expect(globalHandler.indexOf('sidebarNav.focusedRoute')).toBeLessThan(
      globalHandler.indexOf('router.canGoBack()'),
    );
  });
});