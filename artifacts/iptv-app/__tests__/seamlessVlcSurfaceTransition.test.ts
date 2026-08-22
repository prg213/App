import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const fullscreenPlayer = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveContext = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const tvLayout = fs.readFileSync(path.resolve(appRoot, 'components/TVLiveLayout.tsx'), 'utf8');
const androidNativePlayer = fs.readFileSync(path.resolve(appRoot, 'components/NativeStreamPlayer.android.tsx'), 'utf8');

describe('Android live VLC surface transitions', () => {
  it('coordinates the persistent native surface through LivePlayerContext', () => {
    expect(liveContext).toContain("export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden'");
    expect(liveContext).toContain('transitionNativeSurface');
    expect(liveContext).toContain('setNativeSurfaceTransitionHandler');
    expect(liveContext).toContain('beginNativeSurfaceHandoff');
    expect(liveContext).toContain('endNativeSurfaceHandoff');
  });

  it('expands the mounted mini-player VLC surface instead of calling the Expo overlay transition', () => {
    const watchStart = liveTab.indexOf('const handleWatch = useCallback');
    const watchBlock = liveTab.slice(watchStart, watchStart + 3000);

    expect(watchBlock).toContain('setNativeSurfaceUrl(selectedChannel.streamUrl)');
    expect(watchBlock).toContain("transitionNativeSurface('fullscreen', navigate)");
    expect(watchBlock).toContain('triggerExpand(navigate)');
    expect(watchBlock).toMatch(/if\s*\(\s*USES_NATIVE_VLC\s*\)/);
  });

  it('keeps one Android VLC surface inside the actual mini-player host', () => {
    // The native TextureView must be a child of the focusable mini-player,
    // never a separately-positioned sibling that can drift from its bounds.
    expect(liveTab).toContain('The native VLC surface always fills this real focusable');
    expect(tvLayout).toContain('The real VLC TextureView belongs to the actual focusable');
    expect(liveTab).not.toContain('Root-level VLC surface');
    const persistentReloadKeys = liveTab.match(/reloadKey=\{vlcReloadKey\}/g) ?? [];
    expect(persistentReloadKeys.length).toBe(1);
    expect(liveTab).not.toContain('reloadKey={USES_NATIVE_VLC ? vlcReloadKey');
    expect(tvLayout).toContain("Platform.OS === 'android' ? vlcReloadKey");
  });

  it('does not mount a competing VLC surface during a persistent Live TV handoff', () => {
    const tvVlcMounts = tvLayout.match(/<NativeStreamPlayer/g) ?? [];
    const fullscreenMountStart = fullscreenPlayer.indexOf('videoMounted && !usesPersistentNativeSurface');
    const fullscreenMountBlock = fullscreenPlayer.slice(fullscreenMountStart, fullscreenMountStart + 900);
    const contextOverlayStart = liveContext.indexOf('{overlayVisible && (');
    const contextOverlayBlock = liveContext.slice(contextOverlayStart, contextOverlayStart + 1200);

    // Fire TV returns before the phone layout is rendered, leaving one concrete
    // VLC renderer: the absolute-fill child of the visible TV mini-player.
    expect(liveTab).toContain('if (Platform.isTV) {');
    expect(tvVlcMounts).toHaveLength(1);
    expect(tvLayout).toContain('isPlaybackActive && !!streamUrl && (');
    expect(tvLayout).toContain('style={[styles.nativeSurfaceHost, StyleSheet.absoluteFill]}');

    // A Live TV handoff makes the fullscreen route controls-only. Its separate
    // renderer is for direct/non-handoff launches and cannot mount at the same
    // time as the mini-player VLC owner.
    expect(fullscreenMountBlock).toContain('<NativeStreamPlayer');
    expect(fullscreenMountBlock).toContain('!usesPersistentNativeSurface');

    // The legacy root-level animation overlay is an Expo VideoView, not a
    // hidden VLC surface, and the persistent VLC transition does not use it.
    expect(contextOverlayBlock).toContain('<VideoView');
    expect(contextOverlayBlock).not.toContain('<NativeStreamPlayer');
  });

  it('does not reapply VLC playback props for a layout-only transition', () => {
    // React.memo receives stable live-tab callbacks, so changing
    // nativeSurfaceMode only resizes the parent Animated.View. It cannot reset
    // libVLC-owned playback position, pause state, audio/subtitle selection,
    // volume, mute state, or programme state by re-sending native props.
    expect(androidNativePlayer).toContain('React.memo(NativeStreamPlayerAndroid)');
    expect(liveTab).toContain('onPlaying={handlePersistentVlcPlaying}');
    expect(liveTab).toContain('onBuffering={handlePersistentVlcBuffering}');
    expect(liveTab).toContain('onError={handlePersistentVlcError}');
  });

  it('lets the real container layout resize VLC without pixel rebinds', () => {
    expect(liveTab).not.toContain('measureMiniPlayerInSurfaceRoot');
    expect(liveTab).not.toContain('rebindPersistentVlcPreviewSurface');
    expect(liveTab).not.toContain('vlcWidth.setValue');
    expect(liveTab).not.toContain('vlcHeight.setValue');
    expect(liveTab).toContain('requestAnimationFrame(onComplete)');
  });

  it('keeps the mounted VLC TextureView inside its real preview host', () => {
    expect(liveTab).toContain('styles.nativeSurfaceHost');
    expect(liveTab).toContain('StyleSheet.absoluteFill');
    expect(liveTab).toContain('nativeSurfaceFullscreen && styles.previewPanelFullscreen');
    expect(liveTab).not.toMatch(/top:\s*vlcTop/);
    expect(liveTab).not.toMatch(/left:\s*vlcLeft/);
    expect(liveTab).not.toMatch(/width:\s*vlcWidth/);
    expect(liveTab).not.toMatch(/height:\s*vlcHeight/);
    expect(tvLayout).toContain('styles.nativeSurfaceHost');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.nativeSurfaceFullscreen');
    expect(tvLayout).toContain('nativeSurfaceFullscreen && styles.previewPanelFullscreen');
    expect(tvLayout).toContain('style={[styles.nativeSurfaceHost, StyleSheet.absoluteFill]}');
  });

  it('does not position the native VLC surface with screen coordinates', () => {
    for (const forbidden of [
      'nativeSurfaceRootRef',
      'measureMiniPlayerInSurfaceRoot',
      'toValue: -rect.top',
      'toValue: -rect.left',
      'vlcTop',
      'vlcLeft',
      'vlcWidth',
      'vlcHeight',
    ]) {
      expect(liveTab).not.toContain(forbidden);
    }
    expect(liveTab).toContain('onPress={handleMiniPlayerPress}');
  });

  it('hides Live TV panels while the persistent surface is fullscreen', () => {
    expect(tvLayout).toContain("const hideLiveChromeForFullscreen = nativeSurfaceFullscreen && Platform.OS === 'android'");
    expect(tvLayout).toContain("pointerEvents={hideLiveChromeForFullscreen ? 'none' : 'auto'}");
    expect(tvLayout).toContain('hideLiveChromeForFullscreen && styles.fullscreenChromeHidden');
    expect(tvLayout).toContain('fullscreenChromeHidden: {');
    expect(tvLayout).toContain('opacity: 0');
  });

  it('applies the hide guard to all five chrome containers — prevents partial-hide regressions on older Fire TV Stick models', () => {
    // Five distinct panel containers must each carry both guards:
    //   (1) categories panel   (2) channels panel   (3) info bar
    //   (4) catchup row        (5) mini-guide wrap
    //
    // If a new panel is introduced without the suppression the count below
    // breaks, forcing the author to add the guard explicitly.  On 1st/2nd-gen
    // Fire TV Sticks (Fire OS 3/5) the surface compositor does not honour
    // elevation alone, so every overlapping view must be visually removed via
    // opacity:0 AND event-blocked via pointerEvents:'none'.
    const pointerMatches =
      tvLayout.match(/pointerEvents=\{hideLiveChromeForFullscreen \? 'none' : 'auto'\}/g) ?? [];
    expect(pointerMatches.length).toBeGreaterThanOrEqual(5);

    const opacityMatches =
      tvLayout.match(/hideLiveChromeForFullscreen && styles\.fullscreenChromeHidden/g) ?? [];
    expect(opacityMatches.length).toBeGreaterThanOrEqual(5);
  });

  it('fullscreenChromeHidden uses opacity not display/visibility — opacity:0 is reliable on all Android API levels', () => {
    // display:'none' can cause layout recalculation artefacts on older RN/Android
    // combinations; visibility:'hidden' has inconsistent support.  opacity:0
    // leaves the view in the layout tree (preventing reflow) while making it
    // invisible on every Android version including Fire OS 3 (Android 4.2.2).
    const styleStart = tvLayout.indexOf('fullscreenChromeHidden:');
    expect(styleStart).toBeGreaterThan(-1);
    const ruleBody = tvLayout.slice(styleStart, tvLayout.indexOf('},', styleStart));
    expect(ruleBody).toContain('opacity: 0');
    expect(ruleBody).not.toMatch(/display\s*:/);
    expect(ruleBody).not.toMatch(/visibility\s*:/);
  });

  it('expands the preview container above surrounding TV chrome', () => {
    const styleStart = tvLayout.indexOf('previewPanelFullscreen:');
    expect(styleStart).toBeGreaterThan(-1);
    const ruleBody = tvLayout.slice(styleStart, tvLayout.indexOf('},', styleStart));
    expect(ruleBody).toMatch(/zIndex\s*:/);
    expect(ruleBody).toMatch(/elevation\s*:/);
    expect(ruleBody).toMatch(/top:\s*0/);
    expect(ruleBody).toMatch(/right:\s*0/);
    expect(ruleBody).toMatch(/bottom:\s*0/);
    expect(ruleBody).toMatch(/left:\s*0/);
  });

  it('catchup row carries an explicit focusable guard alongside pointerEvents — TV remote focus is not blocked by pointerEvents alone on older Fire OS', () => {
    // On Fire OS 3 and some Fire OS 5 builds, setting pointerEvents='none' on a
    // parent View does NOT prevent TV remote D-pad focus reaching Pressable
    // children.  The focusable={false} prop must be set on each interactive
    // child individually when the chrome is hidden.
    expect(tvLayout).toContain('focusable={!hideLiveChromeForFullscreen}');
  });

  it('keeps the existing Android surface for only its fullscreen route lifetime', () => {
    const ownershipStart = fullscreenPlayer.indexOf('const hasPersistentNativeSurfaceHandoff');
    const ownershipBlock = fullscreenPlayer.slice(ownershipStart, ownershipStart + 500);

    expect(ownershipBlock).toContain('USES_NATIVE_VLC');
    expect(ownershipBlock).toContain('&& isLive');
    // Route params are synchronous. Comparing with async context state can
    // briefly produce false during the handoff and mount a second VLC decoder.
    expect(ownershipBlock).toContain('nativeSurfaceHandoffId !== null');
    // BACK sets the shared visual mode to mini before this route is removed.
    // Ownership must survive that transition or player.tsx mounts a second VLC
    // decoder in the closing route and restarts playback.
    expect(fullscreenPlayer).toContain('const usesPersistentNativeSurface = hasPersistentNativeSurfaceHandoff');
    expect(ownershipBlock).not.toContain("nativeSurfaceMode === 'fullscreen'");
    expect(fullscreenPlayer).toContain('endNativeSurfaceHandoff(nativeSurfaceHandoffId)');
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');
    expect(fullscreenPlayer).toContain("transitionNativeSurface('mini', returnToLive)");
  });

  it('never paints a connecting overlay over a persistent VLC handoff', () => {
    // Route params are available on the first render, while effects run later.
    // A handoff must therefore begin non-buffering and keep the generic loading
    // overlay out of the controls-only fullscreen route from frame one.
    expect(fullscreenPlayer).toContain('const hasPersistentNativeSurfaceHandoff =');
    expect(fullscreenPlayer).toContain('useState(() => !hasPersistentNativeSurfaceHandoff)');
    const loadingStart = fullscreenPlayer.indexOf('{isBuffering && !usesPersistentNativeSurface');
    expect(loadingStart).toBeGreaterThan(-1);
    const loadingBlock = fullscreenPlayer.slice(loadingStart, loadingStart + 1100);
    expect(loadingBlock).toContain('Connecting to stream');
  });

  it('removes fullscreen only after the container layout gets a frame to commit', () => {
    const transitionStart = liveTab.indexOf('const runNativeSurfaceTransition');
    const transitionBlock = liveTab.slice(transitionStart, transitionStart + 4200);
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const backBlock = fullscreenPlayer.slice(backStart, backStart + 5200);

    expect(transitionBlock).toContain('requestAnimationFrame(onComplete)');
    expect(liveContext).toContain('const [nativeSurfaceTransitioning, setNativeSurfaceTransitioning] = useState(false)');
    expect(liveContext).toContain('setNativeSurfaceTransitioning(true);');
    expect(liveContext).toContain('setNativeSurfaceTransitioning(false);');
    // A rapid Firestick double-BACK must not start an overlapping collapse.
    expect(backBlock).toContain('persistentSurfaceBackInFlightRef.current) return');
    expect(backBlock).toContain('persistentSurfaceBackInFlightRef.current = true');
    expect(backBlock).toContain("transitionNativeSurface('mini', returnToLive)");
  });

  it('does not reload, replace, or stop the stream in either transition path', () => {
    const watchStart = liveTab.indexOf('const handleWatch = useCallback');
    const watchEnd = liveTab.indexOf('const handleMiniPlayerPress = useCallback', watchStart);
    const watchBlock = liveTab.slice(watchStart, watchEnd);
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const backBlock = fullscreenPlayer.slice(backStart, backStart + 5200);

    for (const transitionBlock of [watchBlock, backBlock]) {
      expect(transitionBlock).not.toContain('setVlcReloadKey');
      expect(transitionBlock).not.toContain('player.replace(');
      expect(transitionBlock).not.toContain('.stop(');
      expect(transitionBlock).not.toContain('.release(');
      expect(transitionBlock).not.toContain('.destroy(');
    }
  });

  it('does not run a second mini resize when the tab regains focus after BACK', () => {
    const normalFocusReturn = liveTab.indexOf('// Normal focus return');
    const focusReturnStart = liveTab.lastIndexOf('if (USES_NATIVE_VLC) {', normalFocusReturn);
    const focusReturnBlock = liveTab.slice(focusReturnStart, focusReturnStart + 700);

    expect(focusReturnBlock).toContain("if (nativeSurfaceMode !== 'mini') transitionNativeSurface('mini')");
  });

  it('restores Firestick focus to the preview control after the completed handoff', () => {
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const backBlock = fullscreenPlayer.slice(backStart, backStart + 5200);

    // The event sits in returnToLive, which is invoked only by the completed
    // native shrink callback, before router.back makes Live TV focused again.
    expect(backBlock).toContain("DEE.emit('live:restore-preview-focus')");
    expect(liveTab).toContain("DeviceEventEmitter.addListener('live:restore-preview-focus'");
    expect(liveTab).toContain('restorePreviewFocusOnReturnRef.current = true');
    expect(liveTab).toContain('requestTvFocus(miniPlayerRef.current)');
    // The persistent VLC container has pointerEvents=none; focus belongs to
    // the mini-player Pressable, so remote navigation is independent of video.
    expect(liveTab).toContain('pointerEvents="none"');
  });

  it('makes the actual Fire TV mini-player remotely focusable and visually focused', () => {
    expect(tvLayout).toContain("focusable={Platform.isTV ? isPlaybackActive && !!streamUrl : true}");
    expect(tvLayout).toContain('onPress={onWatchFullscreen}');
    expect(tvLayout).toContain('chRefMap.current.forEach((node) => {');
    expect(tvLayout).toContain('patch(node, { nextFocusRight: previewH });');
    expect(tvLayout).toContain('nextFocusRight: previewH');
    expect(tvLayout).toContain('previewFocused && !nativeSurfaceFullscreen');
    expect(tvLayout).toContain('styles.videoFocusRing');
    expect(tvLayout).toContain('borderColor: FOCUS_BORDER');
    expect(tvLayout).toContain('shadowColor: FOCUS_BORDER');
  });

  it('supports repeated Fire TV mini-player → fullscreen → BACK → mini-player cycles', () => {
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const backBlock = fullscreenPlayer.slice(backStart, backStart + 5200);
    const restoreListenerStart = liveTab.indexOf("DeviceEventEmitter.addListener('live:restore-preview-focus'");
    const restoreListener = liveTab.slice(restoreListenerStart, restoreListenerStart + 420);
    const restoreFocusStart = liveTab.indexOf('// Firestick focus is restored after');
    const restoreFocusBlock = liveTab.slice(restoreFocusStart, restoreFocusStart + 1000);
    const tvWatchStart = liveTab.indexOf('const handleTVWatch = useCallback');
    const tvWatchBlock = liveTab.slice(tvWatchStart, tvWatchStart + 1800);

    // Every physical BACK publishes the channel that is actively playing now,
    // returns the existing VLC surface to mini mode, then leaves fullscreen.
    expect(backBlock).toContain("DEE.emit('live:setPlayingChannel', returnChannel)");
    expect(backBlock).toContain("transitionNativeSurface('mini', returnToLive)");
    expect(backBlock).toContain("DEE.emit('live:restore-preview-focus')");
    expect(backBlock).not.toContain('setNativeSurfaceUrl(');
    expect(backBlock).not.toContain('setVlcReloadKey');
    expect(backBlock).not.toContain('player.replace(');

    // The event sets the restore flag every time it is received. The focus
    // effect clears it only after scheduling focus and retries the real player
    // Pressable after Fire OS has committed the returned screen.
    expect(restoreListener).toContain('restorePreviewFocusOnReturnRef.current = true');
    expect(restoreFocusBlock).toContain('restorePreviewFocusOnReturnRef.current = false');
    expect(restoreFocusBlock).toContain('requestTvFocus(miniPlayerRef.current)');
    expect(restoreFocusBlock).toContain('setTimeout(() => requestTvFocus(miniPlayerRef.current), 180)');

    // Once focus is back, OK reuses the same normal TV entry point for the next
    // cycle rather than requiring touch or mounting another player.
    expect(tvWatchBlock).toContain('beginNativeSurfaceHandoff(selectedChannel.streamUrl)');
    expect(tvWatchBlock).toContain("transitionNativeSurface('fullscreen', navigate)");
    expect(tvLayout).toContain('onPress={onWatchFullscreen}');
  });

  it('publishes native ownership before every Android fullscreen entry point', () => {
    const watchStart = liveTab.indexOf('const handleWatch = useCallback');
    const watchChannelStart = liveTab.indexOf('const handleWatchChannel = useCallback');
    const tvWatchStart = liveTab.indexOf('const handleTVWatch = useCallback');

    expect(liveTab.slice(watchStart, watchStart + 3000))
      .toContain('setNativeSurfaceUrl(selectedChannel.streamUrl)');
    expect(liveTab.slice(watchStart, watchStart + 3000))
      .toContain('beginNativeSurfaceHandoff(selectedChannel.streamUrl)');
    expect(liveTab.slice(watchChannelStart, watchChannelStart + 2600))
      .toContain('setNativeSurfaceUrl(ch.streamUrl)');
    expect(liveTab.slice(watchChannelStart, watchChannelStart + 2600))
      .toContain('beginNativeSurfaceHandoff(ch.streamUrl)');
    expect(liveTab.slice(tvWatchStart, tvWatchStart + 1800))
      .toContain('setNativeSurfaceUrl(selectedChannel.streamUrl)');
    expect(liveTab.slice(tvWatchStart, tvWatchStart + 1800))
      .toContain('beginNativeSurfaceHandoff(selectedChannel.streamUrl)');
  });

  it('updates the persistent source on a real channel zap without mounting fullscreen VLC', () => {
    const switchStart = fullscreenPlayer.indexOf('const switchChannel = useCallback');
    const switchBlock = fullscreenPlayer.slice(switchStart, switchStart + 3600);

    expect(switchBlock).toContain('setNativeSurfaceUrl(entry.url)');
    expect(switchBlock).toContain('updateNativeSurfaceHandoffUrl(nativeSurfaceHandoffId, entry.url)');
    expect(switchBlock).toContain("DeviceEventEmitter.emit('channel:switched'");
  });
});