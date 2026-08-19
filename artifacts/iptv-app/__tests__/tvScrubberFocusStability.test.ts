/**
 * Regression coverage for Fire TV VOD/catch-up/series scrubber focus.
 *
 * LEFT/RIGHT routes through invisible focus-bounce targets. Without a visual
 * focus latch, the anchor's normal onBlur removes its cyan border and enlarged
 * thumb for the ~70 ms handoff, making both flash on every seek.
 */

import * as fs from 'fs';
import * as path from 'path';

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const playerSource = fs.readFileSync(PLAYER_PATH, 'utf-8');

describe('TV scrubber visual focus stability', () => {
  it('keeps a dedicated visual-focus state during D-pad seek bounces', () => {
    expect(playerSource).toMatch(/const \[tvScrubFocused, setTvScrubFocused\] = useState\(false\)/);
    expect(playerSource).toMatch(/const holdTvScrubFocus = useCallback/);
    expect(playerSource).toMatch(/const deferTvScrubFocusClear = useCallback/);
  });

  it('delays visual focus removal long enough for the focus handoff to return', () => {
    const clearBlock = playerSource.match(/const deferTvScrubFocusClear[\s\S]*?\n  }, \[\]\);/);
    expect(clearBlock?.[0]).toContain('setTimeout');
    expect(clearBlock?.[0]).toContain('140');
    expect(clearBlock?.[0]).toContain('setTvScrubFocused(false)');
  });

  it('uses the latched state for the anchor border and thumb', () => {
    expect(playerSource).toContain('(focused || tvScrubFocused) && styles.tvScrubAnchorFocused');
    expect(playerSource).toContain('tvScrubFocused && styles.tvScrubThumbFocused');
  });

  it('animates the TV rail and thumb to each seek target', () => {
    expect(playerSource).toMatch(/const tvScrubProgress = useRef\(new Animated\.Value\(0\)\)\.current/);
    expect(playerSource).toMatch(/Animated\.timing\(tvScrubProgress,[\s\S]*?duration: 180/);
    expect(playerSource).toMatch(/useNativeDriver: false/);
    expect(playerSource).toContain('<Animated.View');
    expect(playerSource).toMatch(/tvScrubProgress\.interpolate\(\{ inputRange: \[0, 100\]/);
  });

  it('updates the visual target immediately when a TV seek step begins', () => {
    expect(playerSource).toMatch(/const seekTvStep = useCallback/);
    expect(playerSource).toMatch(/setCurrentTime\(next\);[\s\S]*?seek\(delta\);/);
    expect(playerSource).toMatch(/seekTvStep\(-10\)/);
    expect(playerSource).toMatch(/seekTvStep\(\+10\)/);
  });

  it('holds the visual focus state before both invisible seek targets change time', () => {
    const seekBack = playerSource.match(/ref=\{tvSeekBackRef as any\}[\s\S]*?\/>/);
    const seekForward = playerSource.match(/ref=\{tvSeekFwdRef as any\}[\s\S]*?\/>/);

    expect(seekBack?.[0]).toMatch(/holdTvScrubFocus\(\);[\s\S]*?seekTvStep\(-10\)/);
    expect(seekForward?.[0]).toMatch(/holdTvScrubFocus\(\);[\s\S]*?seekTvStep\(\+10\)/);
  });
});