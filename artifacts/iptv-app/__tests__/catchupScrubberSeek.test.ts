/**
 * Catch-up streams are timeshift HLS URLs rather than seekable VOD assets.
 * Every scrubber input must rebuild the URL at the requested programme offset;
 * player.seekBy() alone is ignored by these streams.
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');

function blockFrom(anchor: string, length = 2400): string {
  const start = SOURCE.indexOf(anchor);
  if (start === -1) throw new Error(`Missing source anchor: ${anchor}`);
  return SOURCE.slice(start, start + length);
}

describe('catch-up scrubber seeking', () => {
  it('rebuilds a timeshift URL at a clamped programme offset', () => {
    const helper = blockFrom('const seekCatchupTo = useCallback');
    expect(helper).toContain('getXtreamCatchupUrls');
    expect(helper).toContain('const seekSecs = Math.floor(Math.max(');
    expect(helper).toContain('catchupSeekOffsetRef.current = seekSecs');
    expect(helper).toContain('catchupWallStartRef.current = Date.now() - seekSecs * 1000');
    expect(helper).toContain('player.replace(newUrl)');
    expect(helper).toContain('player.play()');
  });

  it('routes D-pad step seeks through the catch-up URL path before seekBy', () => {
    const seek = blockFrom('const seek = useCallback');
    expect(seek).toMatch(/isCatchup && seekCatchupTo\(target\)/);
    expect(seek.indexOf('seekCatchupTo(target)')).toBeLessThan(seek.indexOf('player.seekBy(delta)'));

    const tvStep = blockFrom('const seekTvStep = useCallback', 800);
    expect(tvStep).toContain('setCurrentTime(next)');
    expect(tvStep).toContain('seek(delta)');
  });

  it('uses the same catch-up path for touch scrubbing', () => {
    const touchScrubber = blockFrom('onSeek={(t) =>', 1100);
    expect(touchScrubber).toContain('if (!seekCatchupTo(t))');
    expect(touchScrubber).toContain('player.currentTime = t');
  });
});