/**
 * #246: Sidebar scroll regression test.
 *
 * Verifies that the sidebar nav ScrollView in app/(tabs)/_layout.tsx does NOT
 * carry `scrollEnabled={false}`.  That prop was previously set on the sidebar
 * which prevented touch-based scrolling on phones — this test guards against
 * it being re-introduced.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Sidebar ScrollView (#246)', () => {
  let layoutSource: string;

  beforeAll(() => {
    const layoutPath = path.join(__dirname, '../app/(tabs)/_layout.tsx');
    layoutSource = fs.readFileSync(layoutPath, 'utf8');
  });

  it('keeps sidebar scrolling enabled on all devices, including TV', () => {
    expect(layoutSource).not.toContain('scrollEnabled={false}');
    expect(layoutSource).not.toContain('scrollEnabled={!Platform.isTV}');
    expect(layoutSource).toContain('scrollEnabled');
    expect(layoutSource).toContain('revealNavItem');
  });

  it('contains a ScrollView for the sidebar nav', () => {
    // Sanity check: confirm the file still renders a ScrollView (not removed).
    expect(layoutSource).toContain('<ScrollView');
  });
});
