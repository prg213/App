import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');

describe('TV live OSD controls layout', () => {
  it('keeps TV controls out of the channel metadata row', () => {
    const infoBarRegion = source.slice(
      source.indexOf('{/* ── Live TV info bar'),
      source.indexOf('{/* Programme progress bar'),
    );

    expect(infoBarRegion).toContain('<View style={styles.infoTvControls}>');
    expect(infoBarRegion).toMatch(/!Platform\.isTV[\s\S]*backBtnSmall/);
    expect(infoBarRegion).toMatch(/infoTvControls[\s\S]*backBtnSmall/);
  });

  it('allows the dedicated controls row to fit narrow TV viewports', () => {
    expect(source).toContain('flexWrap: \'wrap\'');
    expect(source).toContain('maxWidth: 180');
    expect(source).toContain('numberOfLines={1} ellipsizeMode="tail"');
  });

  it('keeps the Firestick remote inside fullscreen controls until BACK dismisses them', () => {
    expect(source).toContain('useState(() => !hasPersistentNativeSurfaceHandoff)');
    expect(source).toContain('showTvLiveControlsRef.current()');
    expect(source).toContain('const showTvLiveControls = useCallback');
    expect(source).toContain('showInfoBar(true)');
    expect(source).toContain('requestTvFocus(tvLiveChannelControlRef.current)');
    expect(source).toContain('ref={tvLiveChannelControlRef}');
    expect(source).toContain('ref={tvLiveAudioControlRef}');
    expect(source).toContain('ref={tvLiveCcControlRef}');
    expect(source).toContain('ref={tvLiveBackControlRef}');

    for (const direction of ['nextFocusLeft', 'nextFocusRight', 'nextFocusUp', 'nextFocusDown']) {
      expect(source).toContain(direction);
    }

    const liveBackStart = source.indexOf('// ── Android hardware back button (live TV only)');
    const liveBack = source.slice(liveBackStart, source.indexOf('// ── Wire TV scrubber', liveBackStart));
    expect(liveBackStart).toBeGreaterThan(-1);
    expect(liveBack.indexOf('if (showInfoRef.current)')).toBeLessThan(liveBack.indexOf('handleBackLive()'));
    expect(liveBack).toContain('dismissInfoBar()');

    const remoteStart = source.indexOf('useTVRemote({');
    const remote = source.slice(remoteStart, source.indexOf('// ── Channel menu:', remoteStart));
    expect(remote).toContain('select: ({ eventKeyAction })');
    expect(remote).toContain('if (showInfoRef.current || showChannelMenuRef.current');
  });
});