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

  it('mounts one Android VLC child in a root-level presentation host measured from the preview control', () => {
    const controlStart = liveTab.indexOf('ref={miniPlayerRef as any}');
    const phoneOwner = liveTab.slice(
      controlStart,
      liveTab.indexOf('</FocusablePressable>', controlStart),
    );
    const presentationStart = liveTab.indexOf('Android VLC presentation host');
    const presentationHost = liveTab.slice(presentationStart, presentationStart + 2600);

    expect(controlStart).toBeGreaterThan(-1);
    expect(phoneOwner).toContain('onLayout={() => {');
    expect(phoneOwner).toContain('requestAnimationFrame(measureNativeSurfaceOwner)');
    expect(phoneOwner).toContain('{!USES_NATIVE_VLC && isLivePreviewActive && (');
    expect(presentationStart).toBeGreaterThan(controlStart);
    expect(presentationHost).toContain('styles.nativeSurfacePresentationLayer');
    expect(presentationHost).toContain('styles.nativeSurfacePresentationFrame');
    expect(presentationHost).toContain('<NativeStreamPlayer');
    expect(presentationHost).toContain('StyleSheet.absoluteFill');
    expect(presentationHost).toContain('source={activeNativeSurfaceUrl}');
    expect(presentationHost).toContain('reloadKey={vlcReloadKey}');
    expect(presentationHost).toContain('pointerEvents="none"');
    expect(liveTab).toContain('nativeSurfaceRootRef');
    expect(liveTab).toContain('measureNativeSurfaceOwner');
    expect(liveTab).toContain('owner.measureLayout(');
    expect(liveTab).toContain('const timers = [0, 16, 64, 200].map');
    expect(liveTab).toContain('playingChannel?.id');
    expect(liveTab.match(/<NativeStreamPlayer/g)).toHaveLength(2); // Android + non-Android branch
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

  it('acknowledges final owner layout on both phone and Fire TV before continuing a handoff', () => {
    expect(liveTab).toContain('commitNativeSurfaceLayout(nativeSurfaceMode, { width, height, x, y })');
    expect(liveTab).toContain('onNativeSurfaceLayout={(bounds) => {');
    expect(liveTab).toContain('commitNativeSurfaceLayout(nativeSurfaceMode, bounds);');
    expect(tvLayout).toContain('onNativeSurfaceLayout?: (bounds: { width: number; height: number; x: number; y: number }) => void;');
    expect(tvLayout).toContain('onNativeSurfaceLayout?.({ width, height, x, y });');
  });

  it('expands the fullscreen preview frame without retaining the mini-player ratio', () => {
    expect(liveTab).toContain('styles.nativeSurfacePresentationLayer');
    expect(liveTab).toContain('styles.nativeSurfacePresentationFrame');
    expect(liveTab).toContain('nativeSurfaceFullscreen\n                ? StyleSheet.absoluteFill');
    expect(liveTab).toContain('left: nativeOwnerBounds.x');
    expect(liveTab).toContain('height: nativeOwnerBounds.height');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.previewPanelFullscreen');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.fullscreenVideoContainer');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.rootFullscreen');

    const tvRuleStart = tvLayout.indexOf('fullscreenVideoContainer:');
    const tvRuleBody = tvLayout.slice(tvRuleStart, tvLayout.indexOf('},', tvRuleStart));
    expect(tvRuleStart).toBeGreaterThan(-1);
    expect(tvRuleBody).toContain("width: '100%'");
    expect(tvRuleBody).toContain("height: '100%'");
    expect(tvRuleBody).toContain('aspectRatio: undefined');
    expect(tvRuleBody).toContain("maxWidth: '100%'");
    expect(tvRuleBody).toContain("maxHeight: '100%'");
    expect(tvRuleBody).toContain('flex: 1');
    expect(tvRuleBody).not.toContain('aspectRatio: 16 / 9');
  });

  it('uses one container-owned presentation surface without a second persistent decoder', () => {
    for (const forbidden of [
      'rebindPersistentVlcPreviewSurface',
      'vlcTop',
      'vlcLeft',
      'vlcWidth',
      'vlcHeight',
    ]) {
      expect(tvLayout).not.toContain(forbidden);
      expect(liveTab).not.toContain(forbidden);
    }

    expect(liveTab).toContain('nativeSurfaceRootRef');
    expect(liveTab).toContain('nativeOwnerBounds');
    expect(liveTab).toContain('styles.nativeSurfacePresentationLayer');
    expect(liveTab).toContain('commitNativeSurfaceLayout(nativeSurfaceMode, { width, height, x, y })');
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
    const phoneControl = liveTab.slice(controlStart, controlStart + 4200);
    expect(controlStart).toBeGreaterThan(-1);
    expect(liveTab).toContain('pointerEvents="none"');
    expect(phoneControl).toContain('isBuffering && !hasError && nativeSurfaceMode === \'mini\'');
    expect(phoneControl).toContain('hasError && nativeSurfaceMode === \'mini\'');
    expect(phoneControl).toContain('onPress={handleMiniPlayerPress}');
    expect(phoneControl).toContain('<NativeStreamPlayer');

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
    expect(liveTab).toContain('nativeSurfacePresentationLayer:');
    expect(liveTab).toContain('nativeSurfacePresentationFrame:');
    expect(liveTab).toContain('nativeSurfaceFullscreen\n                ? StyleSheet.absoluteFill');
    expect(liveTab).toContain('nativeSurfaceMode !== \'hidden\'');
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
    // while the root-level presentation frame is the only visible content.
    const infoStart = liveTab.indexOf('{!nativeSurfaceFullscreen && playingChannel && (');
    const guideStart = liveTab.indexOf('{!nativeSurfaceFullscreen && (selectedChannel ? (');
    expect(infoStart).toBeGreaterThan(-1);
    expect(guideStart).toBeGreaterThan(infoStart);
    expect(liveTab.slice(infoStart, guideStart)).toContain('styles.chInfoBar');
    expect(liveTab.slice(guideStart, guideStart + 900)).toContain('TV GUIDE');
    expect(liveTab.slice(guideStart, guideStart + 900)).toContain('channelEpg');
    expect(liveTab).toContain('styles.nativeSurfacePresentationLayer');
    expect(liveTab).toContain('styles.nativeSurfacePresentationFrame');
    expect(liveTab).toContain('nativeSurfaceFullscreen\n                ? StyleSheet.absoluteFill');

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

  it('resizes the attached libVLC output to its actual TextureView while the React Native host expands', () => {
    const nativeVlcChange = vlcAndroidPatch.slice(
      vlcAndroidPatch.indexOf('ReactVlcPlayerView.java'),
    );
    expect(nativeVlcChange).toContain('private boolean syncVlcOutputToView(String reason)');
    expect(nativeVlcChange).toContain('int outputWidth = getWidth()');
    expect(nativeVlcChange).toContain('int outputHeight = getHeight()');
    expect(nativeVlcChange).toContain('vlcOut.setWindowSize(outputWidth, outputHeight)');
    expect(nativeVlcChange).toContain('syncVlcOutputToView("layout")');
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

    // The active React Native layout resize must update the current Vout,
    // never recreate its decoder, player, or source.
    const layoutStart = vlcAndroidPatch.indexOf('onLayoutChange(View view');
    const layoutEnd = vlcAndroidPatch.indexOf('     };', layoutStart) + '     };'.length;
    const layoutBlock = vlcAndroidPatch.slice(layoutStart, layoutEnd);
    const activeLayoutLines = layoutBlock
      .split('\n')
      .filter((line) => !line.startsWith('-'))
      .join('\n');
    expect(layoutStart).toBeGreaterThan(-1);
    expect(activeLayoutLines).toContain('syncVlcOutputToView("layout")');
    expect(activeLayoutLines).not.toContain('createPlayer(');
    expect(activeLayoutLines).not.toContain('releasePlayer(');
    expect(activeLayoutLines).not.toContain('setAspectRatio');
  });

  it('records root-relative Android owner dimensions without reparenting the surface', () => {
    expect(liveTab).toContain("console.log(VLC_TRACE, 'react-window-bounds'");
    expect(liveTab).toContain('insetRight: insets.right');
    expect(liveTab).toContain('fullscreen: nativeSurfaceFullscreen');
    expect(liveTab).toContain('commitNativeSurfaceLayout(nativeSurfaceMode, { width, height, x, y })');
    expect(liveTab).toContain('owner.measureLayout(');
    expect(liveTab).toContain('nativeSurfaceRootRef');
    expect(liveTab).toContain('setNativeOwnerBounds');
    expect(vlcAndroidPatch).toContain('int outputWidth = getWidth()');
    expect(vlcAndroidPatch).toContain('int outputHeight = getHeight()');
    expect(vlcAndroidPatch).not.toContain('getRootView()');
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

  it('uses the current TextureView bounds instead of a cached mini-player ratio', () => {
    expect(liveTab).not.toContain('nativeVlcAspectRatio');
    expect(liveTab).not.toContain('videoAspectRatio=');
    expect(liveTab).toContain("resizeMode={nativeSurfaceFullscreen ? 'fill' : 'contain'}");
    expect(tvLayout).toContain("resizeMode={nativeSurfaceFullscreen ? 'fill' : 'contain'}");
    expect(androidNativePlayer).not.toContain('videoAspectRatio={videoAspectRatio as any}');
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

  it('resumes a host-paused retained player whether its Vout survives or reattaches later', () => {
    const nativeVlcChange = vlcAndroidPatch.slice(
      vlcAndroidPatch.indexOf('ReactVlcPlayerView.java'),
    );
    const resumeStart = nativeVlcChange.indexOf('public void onHostResume()');
    const resumeBlock = nativeVlcChange.slice(
      resumeStart,
      nativeVlcChange.indexOf('public void onHostPause()', resumeStart),
    );

    expect(resumeStart).toBeGreaterThan(-1);
    expect(resumeBlock).toContain('if (hasRetainablePlayer() && isHostPaused)');
    expect(resumeBlock).toContain('syncVlcOutputToView("host-resume")');
    expect(resumeBlock).toContain('recoverVlcOutputIfReady("host-resume")');
    expect(resumeBlock).toContain('resumeHostPausedPlayerIfReady("host-resume")');
    expect(resumeBlock).toContain('if (!vlcOut.areViewsAttached())');
    expect(resumeBlock).toContain('isHostPaused = false');
    expect(resumeBlock).toContain('mMediaPlayer.play()');
    expect(nativeVlcChange).toContain('resumeHostPausedPlayerIfReady("surface-available")');
    expect(nativeVlcChange).toContain('resumeHostPausedPlayerIfReady("already-attached-" + reason)');
    expect(nativeVlcChange).toContain('resumeHostPausedPlayerIfReady("reattached-" + reason)');
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