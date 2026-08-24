import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const fullscreenPlayer = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveContext = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const tvLayout = fs.readFileSync(path.resolve(appRoot, 'components/TVLiveLayout.tsx'), 'utf8');
const tabLayout = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/_layout.tsx'), 'utf8');
const rootLayout = fs.readFileSync(path.resolve(appRoot, 'app/_layout.tsx'), 'utf8');
const androidNativePlayer = fs.readFileSync(path.resolve(appRoot, 'components/NativeStreamPlayer.android.tsx'), 'utf8');
const vlcAndroidPatch = fs.readFileSync(path.resolve(appRoot, '../../patches/react-native-vlc-media-player@1.0.98.patch'), 'utf8');

describe('Android live VLC container ownership', () => {
  it('coordinates the one persistent surface through a route-scoped handoff', () => {
    expect(liveContext).toContain("export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden'");
    expect(liveContext).toContain('beginNativeSurfaceHandoff');
    expect(liveContext).toContain('updateNativeSurfaceHandoffUrl');
    expect(liveContext).toContain('endNativeSurfaceHandoff');
    expect(liveContext).toContain('transitionNativeSurface');
    expect(liveContext).toContain('requestAnimationFrame(() =>');
    expect(liveContext).toContain("animated: false");
    expect(liveContext).toContain('onComplete();');
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
    expect(androidNativePlayer).toContain('areVlcPlaybackInputsEqual');
    expect(androidNativePlayer).toContain('React.memo(');
    expect(androidNativePlayer).toContain('NativeStreamPlayerAndroid,');
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

  it('treats parent layout as presentation-only and preserves every VLC playback input', () => {
    // The explicit comparator ignores parent style changes while requiring a
    // remount only for a genuine stream/playback command. This lets libVLC keep
    // its position, pause/play state, volume, mute state, and audio/subtitle
    // selection internally while fullscreen changes the owner bounds.
    for (const input of [
      'previous.source === next.source',
      'previous.reloadKey === next.reloadKey',
      'previous.paused === next.paused',
      'previous.repeat === next.repeat',
      'previous.resizeMode === next.resizeMode',
      'previous.seekPosition === next.seekPosition',
    ]) {
      expect(androidNativePlayer).toContain(input);
    }
    expect(androidNativePlayer).toContain('previous.onPlaying === next.onPlaying');
    expect(androidNativePlayer).toContain('previous.onProgress === next.onProgress');
    expect(androidNativePlayer).toContain('previous.onError === next.onError');
    expect(androidNativePlayer).toContain('volume, and mute state');
    expect(androidNativePlayer).toContain('selection, subtitle selection');
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

  it('releases the Android tab shell so the persistent parent can fill the viewport', () => {
    expect(tabLayout).toContain('const { nativeSurfaceMode } = useLivePlayer()');
    expect(tabLayout).toContain(
      "const nativeSurfaceFullscreen = Platform.OS === 'android' && nativeSurfaceMode === 'fullscreen'",
    );
    expect(tabLayout).toContain('nativeSurfaceFullscreen ? null : <Sidebar {...props} />');
    expect(tabLayout).toContain('marginLeft: nativeSurfaceFullscreen ? 0 : SIDEBAR_W');
  });

  it('removes the phone mini-player chrome so Android fullscreen contains only the video', () => {
    expect(liveTab).toContain('!nativeSurfaceFullscreen && playingChannel && (');
    expect(liveTab).toContain('!nativeSurfaceFullscreen && (selectedChannel ? (');

    const ruleStart = liveTab.indexOf('fullscreenVideoContainer:');
    const ruleBody = liveTab.slice(ruleStart, liveTab.indexOf('},', ruleStart));
    expect(ruleBody).toContain('flex: 1');
    expect(ruleBody).toContain("height: '100%'");
    expect(ruleBody).toContain("aspectRatio: undefined");
  });

  it('guards the Android phone fullscreen journey as one layout-and-handoff contract', () => {
    // The phone path must use the same Android handoff as Fire TV, but its
    // fullscreen route also has to release the tab shell that normally reserves
    // the sidebar width.
    expect(tabLayout).toContain(
      "const nativeSurfaceFullscreen = Platform.OS === 'android' && nativeSurfaceMode === 'fullscreen'",
    );
    expect(tabLayout).toContain('nativeSurfaceFullscreen ? null : <Sidebar {...props} />');
    expect(tabLayout).toContain('sceneStyle: { marginLeft: nativeSurfaceFullscreen ? 0 : SIDEBAR_W }');

    // The route is a transparent controls layer over the persistent VLC view;
    // an opaque or animated Stack presentation would reintroduce a black frame
    // and would make the phone fullscreen layout dependent on a second player.
    expect(rootLayout).toContain(
      "presentation: Platform.OS === 'android' ? 'transparentModal' : 'fullScreenModal'",
    );
    expect(rootLayout).toContain("animation: 'none'");
    expect(rootLayout).toContain("contentStyle: { backgroundColor: 'transparent' }");
    expect(rootLayout).toContain('detachPreviousScreen: false');
    expect(rootLayout).toContain('freezeOnBlur: false');
    expect(tabLayout).toContain('freezeOnBlur: false');
    expect(fullscreenPlayer).toContain('const usesPersistentNativeSurface = hasPersistentNativeSurfaceHandoff;');
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');

    // Both pieces of phone-only Live TV chrome are guarded by the same mode:
    // the channel metadata row and the TV GUIDE/EPG panel disappear together
    // while the fullscreen video container remains the only visible content.
    const infoStart = liveTab.indexOf('{!nativeSurfaceFullscreen && playingChannel && (');
    const guideStart = liveTab.indexOf('{!nativeSurfaceFullscreen && (selectedChannel ? (');
    expect(infoStart).toBeGreaterThan(-1);
    expect(guideStart).toBeGreaterThan(infoStart);
    expect(liveTab.slice(infoStart, guideStart)).toContain('styles.chInfoBar');
    expect(liveTab.slice(guideStart, guideStart + 900)).toContain('TV GUIDE');
    expect(liveTab.slice(guideStart, guideStart + 900)).toContain('channelEpg');
    expect(liveTab).toContain('nativeSurfaceFullscreen && styles.fullscreenVideoContainer');

    // BACK must return the currently active channel (including a zap made while
    // fullscreen), restore the same persistent surface to mini mode, and only
    // then remove the transparent route.
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const back = fullscreenPlayer.slice(backStart, backStart + 3800);
    const persistentBackStart = back.indexOf('if (usesPersistentNativeSurface) {');
    const persistentBack = back.slice(persistentBackStart, persistentBackStart + 900);
    expect(backStart).toBeGreaterThan(-1);
    expect(persistentBackStart).toBeGreaterThan(-1);
    expect(back).toContain('streamUrl: currentEntry?.url || liveUrlRef.current || params.url ||');
    expect(back).toContain('setPendingLivePlayerReturn(returnChannel)');
    expect(back).toContain("DEE.emit('live:setPlayingChannel', returnChannel)");
    expect(persistentBack).toContain("transitionNativeSurface('mini', returnToLive)");
    expect(persistentBack).toContain('router.back()');
    const returnCallbackStart = persistentBack.indexOf('const returnToLive = () => {');
    const returnCallbackEnd = persistentBack.indexOf('};', returnCallbackStart);
    expect(returnCallbackStart).toBeGreaterThan(-1);
    expect(returnCallbackEnd).toBeGreaterThan(returnCallbackStart);
    expect(persistentBack.slice(returnCallbackStart, returnCallbackEnd)).toContain('router.back()');
    expect(
      back.indexOf('setPendingLivePlayerReturn(returnChannel)'),
    ).toBeLessThan(back.indexOf("transitionNativeSurface('mini', returnToLive)"));
    expect(
      persistentBack.indexOf("transitionNativeSurface('mini', returnToLive)"),
    ).toBeGreaterThan(returnCallbackEnd);

    // The receiving Live TV screen consumes that handoff into both selection
    // and playback state, so returning does not leave a stale row or a silent
    // mini-player behind.
    expect(liveTab).toContain('const returnedChannel = consumePendingLivePlayerReturn();');
    const returnedChannelStart = liveTab.indexOf('if (returnedChannel) {', liveTab.indexOf('const returnedChannel'));
    const returnedChannelBlock = liveTab.slice(returnedChannelStart, returnedChannelStart + 500);
    expect(returnedChannelBlock).toContain('setPlayingChannel(returnedChannel)');
    expect(returnedChannelBlock).toContain('setSelectedChannel(returnedChannel)');
  });

  it('keeps the libVLC output buffer stable while the React Native parent expands', () => {
    const nativeVlcChange = vlcAndroidPatch.slice(
      vlcAndroidPatch.indexOf('ReactVlcPlayerView.java'),
    );
    expect(nativeVlcChange).toContain('resolveOutputWindowSize');
    expect(nativeVlcChange).toContain('actual Android content window');
    expect(nativeVlcChange).toContain('output-window root=');
    expect(nativeVlcChange).toMatch(/\+\s+vlcOut\.setWindowSize\(outputSize\[0\], outputSize\[1\]\)/);
    expect(nativeVlcChange).toMatch(/-\s+vlcOut\.setWindowSize\(mVideoWidth, mVideoHeight\)/);
    expect(nativeVlcChange).not.toContain('+                    mMediaPlayer.setAspectRatio');
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
    const phoneOwnerStart = liveTab.indexOf('ref={miniPlayerRef as any}');
    const phoneOwner = liveTab.slice(phoneOwnerStart, phoneOwnerStart + 2800);
    expect(phoneOwner).not.toContain('styles.flashOverlay');

    // The active React Native layout resize must not ask libVLC to recreate
    // its video output. That is the Fire TV black-frame regression we guard.
    const layoutStart = vlcAndroidPatch.indexOf('onLayoutChange(View view');
    const layoutBlock = vlcAndroidPatch.slice(layoutStart, vlcAndroidPatch.indexOf('@@ -414', layoutStart));
    const activeLayoutLines = layoutBlock
      .split('\n')
      .filter((line) => !line.startsWith('-'))
      .join('\n');
    expect(layoutStart).toBeGreaterThan(-1);
    expect(activeLayoutLines).not.toContain('setWindowSize');
    expect(activeLayoutLines).not.toContain('setAspectRatio');
  });

  it('records real Android window and owner dimensions without reparenting the surface', () => {
    expect(liveTab).toContain("console.log(VLC_TRACE, 'react-window-bounds'");
    expect(liveTab).toContain('insetRight: insets.right');
    expect(liveTab).toContain('fullscreen: nativeSurfaceFullscreen');
    expect(vlcAndroidPatch).toContain('output-window root=');
    expect(vlcAndroidPatch).toContain('root.getWidth()');
    expect(vlcAndroidPatch).toContain('root.getHeight()');
  });

  it('commits the native owner directly to its final bounds instead of animating TextureView resizes', () => {
    const transitionStart = liveContext.indexOf('const transitionNativeSurface = useCallback');
    const transitionBlock = liveContext.slice(
      transitionStart,
      liveContext.indexOf('const commitNativeSurfaceLayout', transitionStart),
    );
    expect(liveContext).not.toContain('LayoutAnimation.configureNext');
    expect(liveContext).not.toContain('setLayoutAnimationEnabledExperimental');
    expect(transitionStart).toBeGreaterThan(-1);
    expect(transitionBlock).toContain("animated: false");
    expect(transitionBlock).not.toContain('requestAnimationFrame(() =>');
    expect(liveContext).toContain('pendingNativeSurfaceTransitionRef');
    expect(liveContext).toContain('commitNativeSurfaceLayout');
    expect(liveContext).toContain("'surface-transition-layout-ack'");
    expect(liveTab).toContain('commitNativeSurfaceLayout(nativeSurfaceMode, { width, height, x, y })');
  });

  it('uses the measured fullscreen owner ratio instead of the mini-player ratio', () => {
    expect(liveTab).toContain('const fullscreenVlcAspectRatio = nativeSurfaceFullscreen');
    expect(liveTab).toContain('videoAspectRatio={fullscreenVlcAspectRatio}');
    expect(liveTab).toContain("resizeMode={nativeSurfaceFullscreen ? 'cover' : 'contain'}");
    expect(androidNativePlayer).toContain('videoAspectRatio={videoAspectRatio as any}');
  });

  it('retains the libVLC player across a temporary TextureView detach or replacement', () => {
    const nativeVlcChange = vlcAndroidPatch.slice(
      vlcAndroidPatch.indexOf('ReactVlcPlayerView.java'),
    );
    const detachStart = nativeVlcChange.indexOf('protected void onDetachedFromWindow()');
    const detachBlock = nativeVlcChange
      .slice(detachStart, nativeVlcChange.indexOf('@@', detachStart))
      .split('\n')
      .filter((line) => !line.startsWith('-'))
      .join('\n');
    expect(detachStart).toBeGreaterThan(-1);
    expect(detachBlock).toContain('if (!isSurfaceTextureAvailable)');
    expect(detachBlock).toContain('detachVlcOutputForSurfaceLoss("view-detached-without-surface")');
    expect(detachBlock).not.toContain('stopPlayback()');
    expect(nativeVlcChange).toContain('private boolean hasRetainablePlayer()');
    expect(nativeVlcChange).toContain('surface-output-reattach');
    expect(nativeVlcChange).toContain('vlcOut.setVideoSurface(getSurfaceTexture())');
    expect(nativeVlcChange).toContain('if (hasRetainablePlayer())');
    expect(nativeVlcChange).toContain('recoverVlcOutputIfReady("surface-available")');
    expect(nativeVlcChange).toContain('else if (!isTerminalCleanup && srcMap != null)');
    expect(vlcAndroidPatch).not.toContain('\\ No newline at end of file');
  });

  it('expands the channel already playing rather than a separately highlighted row', () => {
    for (const entryPoint of [
      'const handleWatch = useCallback',
      'const handleTVWatch = useCallback',
    ]) {
      const start = liveTab.indexOf(entryPoint);
      const block = liveTab.slice(start, start + 2800);
      expect(start).toBeGreaterThan(-1);
      expect(block).toContain('const activeChannel = playingChannel ?? selectedChannel');
      expect(block).toContain('url: activeChannel.streamUrl');
      expect(block).toContain('beginNativeSurfaceHandoff(activeChannel.streamUrl)');
      expect(block).not.toContain('setVlcReloadKey');
      expect(block).not.toContain('player.replace(');
    }
  });

  it('retains the active channel metadata and cached guide identity through return', () => {
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const back = fullscreenPlayer.slice(backStart, backStart + 3800);

    for (const metadataField of [
      'num: currentEntry?.num',
      'tvArchive: currentEntry?.tvArchive',
      'tvArchiveDuration: currentEntry?.tvArchiveDuration',
      'epgId:     activeEpgId',
      'groupTitle: currentEntry?.groupTitle',
    ]) {
      expect(back).toContain(metadataField);
    }

    expect(fullscreenPlayer).toContain("queryKey: ['xmltv-epg', credentials]");
    expect(fullscreenPlayer).toContain('const { currentProg, nextProg } = React.useMemo');
    expect(fullscreenPlayer).toContain('const progs = epgMap.get(activeEpgId) ?? []');
  });

  it('does not collapse the persistent surface while fullscreen navigation is in flight', () => {
    expect(liveTab).toContain(
      "if (nativeSurfaceMode !== 'mini' && !goingToPlayerRef.current)",
    );
  });

  it('updates the existing persistent source after a real channel zap', () => {
    const switchStart = fullscreenPlayer.indexOf('const switchChannel = useCallback');
    const switchBlock = fullscreenPlayer.slice(switchStart, switchStart + 5000);
    expect(switchBlock).toContain('setNativeSurfaceUrl(entry.url)');
    expect(switchBlock).toContain('updateNativeSurfaceHandoffUrl(nativeSurfaceHandoffId, entry.url)');
    expect(switchBlock).toContain("DeviceEventEmitter.emit('channel:switched'");
    expect(switchBlock).toContain('channel: switchedChannel');
    expect(switchBlock).toContain('id: entry.channelId ?? entry.url');
    expect(switchBlock).toContain('if (isLive) liveUrlRef.current = entry.url');
  });

  it('keeps the mini-player identity tied to the exact fullscreen channel switch', () => {
    const listenerStart = liveTab.indexOf("DeviceEventEmitter.addListener('channel:switched'");
    const listener = liveTab.slice(listenerStart, listenerStart + 1300);

    expect(listenerStart).toBeGreaterThan(-1);
    expect(listener).toContain('channel?: Channel');
    expect(listener).toContain('candidate.id === channel.id');
    expect(listener).toContain('setSelectedChannel(activeChannel)');
    expect(listener).toContain('setPlayingChannel(activeChannel)');
    expect(liveTab).toContain("console.log(VLC_TRACE, 'react-owner-layout'");
  });

  it('returns the zapped entry URL with its matching metadata on BACK', () => {
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const back = fullscreenPlayer.slice(backStart, backStart + 3800);

    expect(backStart).toBeGreaterThan(-1);
    expect(back).toContain('const currentEntry = channelList[channelIdx]');
    expect(back).toContain('streamUrl: currentEntry?.url || liveUrlRef.current || params.url ||');
    expect(back).toContain('id:        currentEntry?.channelId');
    expect(back).toContain('epgId:     activeEpgId');
    expect(back).toContain('setPendingLivePlayerReturn(returnChannel)');
  });
});