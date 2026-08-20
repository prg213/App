/**
 * Catch-up replaces the shared player source. Returning to Live TV must restore
 * the pre-existing live mini-preview rather than leaving its panel empty.
 */

import * as fs from 'fs';
import * as path from 'path';

const LIVE_TV = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
const CATCHUP_SHEET = fs.readFileSync(path.resolve(__dirname, '../components/CatchupSheet.tsx'), 'utf8');

describe('Catch-up return restores the Live TV mini-preview', () => {
  it('records the live channel before the sheet opens the catch-up player', () => {
    expect(CATCHUP_SHEET).toMatch(
      /onStartPlayback\?\.\(channel\);\s*\n\s*onClose\(\);\s*\n\s*router\.push/,
    );
    expect(LIVE_TV).toMatch(/const catchupPreviewReturnRef = useRef<Channel \| null>\(null\)/);
    expect(LIVE_TV).toMatch(
      /const handleStartCatchupPlayback = useCallback\(\(channel: Channel\) => \{[\s\S]*?catchupPreviewReturnRef\.current = channel[\s\S]*?goingToPlayerRef\.current = true/,
    );
  });

  it('restores and reloads the live stream after backing out of Catch-up', () => {
    expect(LIVE_TV).toMatch(/const catchupPreviewToRestore = catchupPreviewReturnRef\.current/);
    expect(LIVE_TV).toMatch(/setSelectedChannel\(catchupPreviewToRestore\)/);
    expect(LIVE_TV).toMatch(/setPlayingChannel\(catchupPreviewToRestore\)/);
    expect(LIVE_TV).toMatch(/player\.replace\(catchupPreviewToRestore\.streamUrl\)/);
    expect(LIVE_TV).toMatch(/requestAnimationFrame\(\(\) => setVideoKey/);
  });

  it('uses the preservation callback from both TV and phone Catch-up sheets', () => {
    expect((LIVE_TV.match(/onStartPlayback=\{handleStartCatchupPlayback\}/g) ?? [])).toHaveLength(2);
  });
});