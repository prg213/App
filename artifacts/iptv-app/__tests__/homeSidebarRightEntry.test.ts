/**
 * Fire TV Home entry should remain on the sidebar after OK. RIGHT enters the
 * highest-priority available rail instead of auto-focusing a content card.
 */

import * as fs from 'fs';
import * as path from 'path';

const home = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.resolve(__dirname, '../lib/sidebarNav.ts'), 'utf8');

describe('Home sidebar RIGHT entry on TV', () => {
  it('does not auto-focus Home content without returning from a detail screen', () => {
    expect(home).toMatch(/if \(!row\) return;/);
    expect(home).not.toContain('firstItemRef');
  });

  it('prioritises Recently Watched, then Continue Watching, then Latest Movies', () => {
    const priority = sidebar.slice(
      sidebar.indexOf('const target ='),
      sidebar.indexOf('try {', sidebar.indexOf('const target =')),
    );

    expect(priority).toMatch(
      /homeRightCandidates\.get\('recent'\)[\s\S]*?homeRightCandidates\.get\('cw'\)[\s\S]*?homeRightCandidates\.get\('movies'\)/,
    );
  });

  it('registers each possible first card as a Home RIGHT destination', () => {
    expect(home).toContain("setHomeRightCandidate('recent', node)");
    expect(home).toContain("setHomeRightCandidate('cw', el)");
    expect(home).toContain("setHomeRightCandidate('movies', el)");
  });
});