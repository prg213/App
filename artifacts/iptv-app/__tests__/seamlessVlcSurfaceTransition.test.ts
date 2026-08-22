import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const fullscreenPlayer = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveContext = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const tvLayout = fs.readFileSync(path.resolve(appRoot, 'components/TVLiveLayout.tsx'), 'utf8');
const tabLayout = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/_layout.tsx'), 'utf8');
const androidNativePlayer = fs.readFileSync(path.resolve(appRoot, 'components/NativeStreamPlayer.android.tsx'), 'utf8');
const vlcAndroidPatch = fs.readFileSync(path.resolve(appRoot, '../../patches/react-native-vlc-media-player@1.0.98.patch'), 'utf8');

describe('Android live VLC container ownership', () => {
  it('coordinates the one persistent surface through a route-scoped handoff', () => {
    expect(liveContext).toContain("export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden'");
    expect(liveContext).toContain('beginNativeSurfaceHandoff');
    expect(liveContext).toContain('updateNativeSurfaceHandoffUrl');
    expect(liveContext).toContain('endNativeSurfaceHandoff');
    expect(liveContext).toContain('transitionNativeSurface');
    expect(liveContext).toContain('requestAnimationFrame(onComplete)');
  });

  it('keeps the transition state free of measured bounds and animated surface overlays', () => {
    for (const forbidden of [
      'measureInWindow',
      'rectToTransform',
      'animTranslate',
      'setOverlayVisible',
      'overlayHasVideo',
      '<VideoView',
      'Animated.',
      'screenW',
      'screenH',
    ]) {
      expect(liveContext).not.toContain(forbidden);
    }
  });

  it('mounts the Android VLC child inside the real phone mini-player control', () => {
    const controlStart = liveTab.indexOf('ref={miniPlayerRef as any}');
    const androidMountStart = liveTab.indexOf('{USES_NATIVE_VLC && isLivePreviewActive && (');
    const androidMount = liveTab.slice(controlStart, androidMountStart + 1300);

    expect(controlStart).toBeGreaterThan(-1);
    expect(androidMountStart).toBeGreaterThan(-1);
    expect(androidMount).toContain('ref={miniPlayerRef as any}');
    expect(androidMount).toContain('styles.nativeSurfaceHost');
    expect(androidMount).toContain('StyleSheet.absoluteFill');
    expect(androidMount).toContain('<NativeStreamPlayer');
    expect(androidMount).toContain('pointerEvents="none"');
    expect(androidMount).toContain('reloadKey={vlcReloadKey}');
  });

  it('mounts the Fire TV VLC child inside its real focusable preview control', () => {
    const tvVlcMounts = tvLayout.match(/<NativeStreamPlayer/g) ?? [];
    expect(tvVlcMounts).toHaveLength(1);
    expect(tvLayout).toContain('ref={miniPlayerRef as any}');
    expect(tvLayout).toContain('focusable={Platform.isTV ? isPlaybackActive && !!streamUrl : true}');
    expect(tvLayout).toContain('onPress={onWatchFullscreen}');
    expect(tvLayout).toContain('style={[styles.nativeSurfaceHost, StyleSheet.absoluteFill]}');
    expect(tvLayout).toContain('pointerEvents="none"');
  });

  it('uses a parent layout state for fullscreen while the native child remains an absolute-fill descendant', () => {
    expect(liveTab).toContain('nativeSurfaceFullscreen && styles.previewPanelFullscreen');
    expect(liveTab).toContain('nativeSurfaceFullscreen && styles.fullscreenVideoContainer');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.previewPanelFullscreen');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.fullscreenVideoContainer');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.rootFullscreen');

    for (const source of [liveTab, tvLayout]) {
      const ruleStart = source.indexOf('fullscreenVideoContainer:');
      const ruleBody = source.slice(ruleStart, source.indexOf('},', ruleStart));
      expect(ruleStart).toBeGreaterThan(-1);
      expect(ruleBody).toContain("width: '100%'");
      expect(ruleBody).not.toMatch(/position\s*:/);
      expect(ruleBody).not.toMatch(/top\s*:/);
      expect(ruleBody).not.toMatch(/left\s*:/);
      expect(ruleBody).not.toMatch(/right\s*:/);
      expect(ruleBody).not.toMatch(/bottom\s*:/);
    }

    const tvRuleStart = tvLayout.indexOf('fullscreenVideoContainer:');
    const tvRuleBody = tvLayout.slice(tvRuleStart, tvLayout.indexOf('},', tvRuleStart));
    expect(tvRuleBody).toContain('aspectRatio: 16 / 9');
    expect(tvRuleBody).toContain("maxHeight: '100%'");
  });

  it('does not use coordinate-driven VLC props or a second persistent decoder', () => {
    for (const forbidden of [
      'nativeSurfaceRootRef',
      'measureMiniPlayerInSurfaceRoot',
      'rebindPersistentVlcPreviewSurface',
      'vlcTop',
      'vlcLeft',
      'vlcWidth',
      'vlcHeight',
    ]) {
      expect(liveTab).not.toContain(forbidden);
      expect(tvLayout).not.toContain(forbidden);
    }

    const fullscreenMountStart = fullscreenPlayer.indexOf('videoMounted && !usesPersistentNativeSurface');
    const fullscreenMount = fullscreenPlayer.slice(fullscreenMountStart, fullscreenMountStart + 1100);
    expect(fullscreenMountStart).toBeGreaterThan(-1);
    expect(fullscreenMount).toContain('<NativeStreamPlayer');
    expect(fullscreenMount).toContain('!usesPersistentNativeSurface');
    expect(fullscreenPlayer).not.toContain('nativeSurfaceMode ===');
  });

  it('does not reapply VLC playback props for a parent-layout-only transition', () => {
    expect(androidNativePlayer).toContain('React.memo(NativeStreamPlayerAndroid)');
    expect(androidNativePlayer).toContain('const vlcSource = React.useMemo');
    expect(androidNativePlayer).toContain('}), [source]);');
    expect(androidNativePlayer).toContain('source={vlcSource}');
    expect(androidNativePlayer).toContain('key={`${source}:${reloadKey ?? 0}`}');
    expect(androidNativePlayer).not.toContain('nativeSurfaceMode');
    expect(liveTab).toContain('onPlaying={handlePersistentVlcPlaying}');
    expect(liveTab).toContain('onBuffering={handlePersistentVlcBuffering}');
    expect(liveTab).toContain('onError={handlePersistentVlcError}');
    expect(liveTab).not.toContain('reloadKey={USES_NATIVE_VLC ?');
  });

  it('keeps status overlays above the native child without intercepting its control', () => {
    const controlStart = liveTab.indexOf('ref={miniPlayerRef as any}');
    const phoneMountStart = liveTab.indexOf('{USES_NATIVE_VLC && isLivePreviewActive && (');
    const phoneMount = liveTab.slice(controlStart, phoneMountStart + 2200);
    expect(controlStart).toBeGreaterThan(-1);
    expect(phoneMount).toContain('pointerEvents="none"');
    expect(phoneMount).toContain('isBuffering && !hasError && nativeSurfaceMode === \'mini\'');
    expect(phoneMount).toContain('hasError && nativeSurfaceMode === \'mini\'');
    expect(phoneMount).toContain('onPress={handleMiniPlayerPress}');

    expect(tvLayout).toContain('previewFocused && !nativeSurfaceFullscreen');
    expect(tvLayout).toContain('styles.videoFocusRing');
    expect(tvLayout).toContain('focusable={!hideLiveChromeForFullscreen}');
  });

  it('hides Fire TV chrome while the persistent parent owns fullscreen', () => {
    expect(tvLayout).toContain("const hideLiveChromeForFullscreen = nativeSurfaceFullscreen && Platform.OS === 'android'");
    const pointerMatches =
      tvLayout.match(/pointerEvents=\{hideLiveChromeForFullscreen \? 'none' : 'auto'\}/g) ?? [];
    const opacityMatches =
      tvLayout.match(/hideLiveChromeForFullscreen && styles\.fullscreenChromeHidden/g) ?? [];

    expect(pointerMatches.length).toBeGreaterThanOrEqual(5);
    expect(opacityMatches.length).toBeGreaterThanOrEqual(5);
    expect(tvLayout).toContain('fullscreenChromeHidden: {');
    expect(tvLayout).toContain("display: 'none'");
    expect(tvLayout).toContain('rootFullscreen: {');
    expect(tvLayout).toContain("backgroundColor: '#000'");
  });

  it('releases the Fire TV tab shell so the persistent parent can fill the physical viewport', () => {
    expect(tabLayout).toContain('const { nativeSurfaceMode } = useLivePlayer()');
    expect(tabLayout).toContain(
      "const nativeSurfaceFullscreen = Platform.isTV && nativeSurfaceMode === 'fullscreen'",
    );
    expect(tabLayout).toContain('nativeSurfaceFullscreen ? null : <Sidebar {...props} />');
    expect(tabLayout).toContain('marginLeft: nativeSurfaceFullscreen ? 0 : SIDEBAR_W');
  });

  it('keeps the libVLC output buffer stable while the React Native parent expands', () => {
    const nativeVlcChange = vlcAndroidPatch.slice(
      vlcAndroidPatch.indexOf('ReactVlcPlayerView.java'),
    );
    expect(nativeVlcChange).toContain('Keep the libVLC output buffer stable');
    expect(nativeVlcChange).toContain('Allocate the output at the physical display size once');
    expect(nativeVlcChange).toMatch(/\+\s+vlcOut\.setWindowSize\(outputWidth, outputHeight\)/);
    expect(nativeVlcChange).toMatch(/-\s+vlcOut\.setWindowSize\(mVideoWidth, mVideoHeight\)/);
  });

  it('returns the same surface to mini mode before the controls-only route closes', () => {
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const back = fullscreenPlayer.slice(backStart, backStart + 4200);

    expect(backStart).toBeGreaterThan(-1);
    expect(back).toContain('persistentSurfaceBackInFlightRef.current) return');
    expect(back).toContain('persistentSurfaceBackInFlightRef.current = true');
    expect(back).toContain("transitionNativeSurface('mini', returnToLive)");
    expect(back).toContain("DEE.emit('live:restore-preview-focus')");
    expect(back).not.toContain('setNativeSurfaceUrl(');
    expect(back).not.toContain('setVlcReloadKey');
    expect(back).not.toContain('player.replace(');
  });

  it('restores Fire TV focus to the real mini-player control after BACK', () => {
    expect(liveTab).toContain("DeviceEventEmitter.addListener('live:restore-preview-focus'");
    expect(liveTab).toContain('restorePreviewFocusOnReturnRef.current = true');
    expect(liveTab).toContain('requestTvFocus(miniPlayerRef.current)');
    expect(liveTab).toContain('setTimeout(() => requestTvFocus(miniPlayerRef.current), 180)');
  });

  it('publishes handoff ownership before every Android fullscreen entry point', () => {
    for (const entryPoint of [
      'const handleWatch = useCallback',
      'const handleWatchChannel = useCallback',
      'const handleTVWatch = useCallback',
    ]) {
      const start = liveTab.indexOf(entryPoint);
      const block = liveTab.slice(start, start + 3200);
      expect(start).toBeGreaterThan(-1);
      expect(block).toContain('beginNativeSurfaceHandoff');
      expect(block).toContain("transitionNativeSurface('fullscreen', navigate)");
    }
  });

  it('does not reload playback or raise a black cover during a native fullscreen entry', () => {
    const entryStart = liveTab.indexOf('const handleWatch = useCallback');
    const entryBlock = liveTab.slice(entryStart, liveTab.indexOf('const handleMiniPlayerPress', entryStart));

    expect(entryStart).toBeGreaterThan(-1);
    expect(entryBlock).toContain("transitionNativeSurface('fullscreen', navigate)");
    expect(entryBlock).not.toContain('setVlcReloadKey');
    expect(entryBlock).not.toContain('player.replace(');
    expect(entryBlock).not.toContain('flashOverlayOpacity.setValue');

    // The active React Native layout resize must not ask libVLC to recreate
    // its video output. That is the Fire TV black-frame regression we guard.
    const layoutStart = vlcAndroidPatch.indexOf('onLayoutChange(View view');
    const layoutBlock = vlcAndroidPatch.slice(layoutStart, vlcAndroidPatch.indexOf('};', layoutStart));
    const activeLayoutLines = layoutBlock
      .split('\n')
      .filter((line) => !line.startsWith('-'))
      .join('\n');
    expect(layoutStart).toBeGreaterThan(-1);
    expect(activeLayoutLines).not.toContain('setWindowSize');
    expect(activeLayoutLines).not.toContain('setAspectRatio');
  });

  it('does not collapse the persistent surface while fullscreen navigation is in flight', () => {
    expect(liveTab).toContain(
      "if (nativeSurfaceMode !== 'mini' && !goingToPlayerRef.current)",
    );
  });

  it('updates the existing persistent source after a real channel zap', () => {
    const switchStart = fullscreenPlayer.indexOf('const switchChannel = useCallback');
    const switchBlock = fullscreenPlayer.slice(switchStart, switchStart + 3600);
    expect(switchBlock).toContain('setNativeSurfaceUrl(entry.url)');
    expect(switchBlock).toContain('updateNativeSurfaceHandoffUrl(nativeSurfaceHandoffId, entry.url)');
    expect(switchBlock).toContain("DeviceEventEmitter.emit('channel:switched'");
  });
});