import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const fullscreenPlayer = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveContext = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const tvLayout = fs.readFileSync(path.resolve(appRoot, 'components/TVLiveLayout.tsx'), 'utf8');

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

  it('keeps one root-level Android VLC surface without videoKey in its reload key', () => {
    // The root-level surface is deliberately outside both mini-player
    // containers so resize/reposition can never unmount or clip libVLC.
    expect(liveTab).toContain('Root-level VLC surface (TV layout)');
    expect(liveTab).toContain('Root-level VLC surface (phone layout)');
    const rootVlcReloadKeys = liveTab.match(/reloadKey=\{vlcReloadKey\}/g) ?? [];
    expect(rootVlcReloadKeys.length).toBe(2);
    expect(liveTab).not.toContain('reloadKey={USES_NATIVE_VLC ? vlcReloadKey');
    // Android TV receives the root-level instance from index.tsx; this layout
    // must never create a second VLC player for the same fullscreen handoff.
    expect(tvLayout).toContain("Platform.OS !== 'android' && isPlaybackActive");
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

  it('nativeSurfaceFullscreen style carries both zIndex and elevation for cross-generation compositor compatibility', () => {
    // elevation (API ≥ 21, Fire OS 5+) controls the Android shadow compositor
    // layer ordering on modern Fire TV Stick 3rd gen / Fire TV Cube.
    // zIndex is the only effective ordering signal on pre-Lollipop surfaces
    // (Fire TV Stick 1st gen, Fire OS 3, Android 4.2).
    // Both must be present so the VLC texture sits above any residual chrome
    // on every hardware generation — opacity:0 is the primary guard but
    // belt-and-suspenders compositor ordering prevents edge-case bleed-through.
    const styleStart = tvLayout.indexOf('nativeSurfaceFullscreen:');
    expect(styleStart).toBeGreaterThan(-1);
    const ruleBody = tvLayout.slice(styleStart, tvLayout.indexOf('},', styleStart));
    expect(ruleBody).toMatch(/zIndex\s*:/);
    expect(ruleBody).toMatch(/elevation\s*:/);
  });

  it('catchup row carries an explicit focusable guard alongside pointerEvents — TV remote focus is not blocked by pointerEvents alone on older Fire OS', () => {
    // On Fire OS 3 and some Fire OS 5 builds, setting pointerEvents='none' on a
    // parent View does NOT prevent TV remote D-pad focus reaching Pressable
    // children.  The focusable={false} prop must be set on each interactive
    // child individually when the chrome is hidden.
    expect(tvLayout).toContain('focusable={!hideLiveChromeForFullscreen}');
  });

  it('keeps the existing Android surface for only its fullscreen route lifetime', () => {
    const ownershipStart = fullscreenPlayer.indexOf('const usesPersistentNativeSurface');
    const ownershipBlock = fullscreenPlayer.slice(ownershipStart, ownershipStart + 500);

    expect(ownershipBlock).toContain('USES_NATIVE_VLC');
    expect(ownershipBlock).toContain('&& isLive');
    // Route params are synchronous. Comparing with async context state can
    // briefly produce false during the handoff and mount a second VLC decoder.
    expect(ownershipBlock).toContain('nativeSurfaceHandoffId !== null');
    // BACK sets the shared visual mode to mini before this route is removed.
    // Ownership must survive that transition or player.tsx mounts a second VLC
    // decoder in the closing route and restarts playback.
    expect(ownershipBlock).not.toContain("nativeSurfaceMode === 'fullscreen'");
    expect(fullscreenPlayer).toContain('endNativeSurfaceHandoff(nativeSurfaceHandoffId)');
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');
    expect(fullscreenPlayer).toContain("transitionNativeSurface('mini', returnToLive)");
  });

  it('only removes fullscreen after the native surface reaches mini bounds', () => {
    const transitionStart = liveTab.indexOf('const runNativeSurfaceTransition');
    const transitionBlock = liveTab.slice(transitionStart, transitionStart + 4200);
    const backStart = fullscreenPlayer.indexOf('const handleBackLive = useCallback');
    const backBlock = fullscreenPlayer.slice(backStart, backStart + 5200);

    // Interrupted Animated.timing callbacks report finished:false. They must
    // never call the route-pop completion callback early.
    expect(transitionBlock).toContain('({ finished }) => { if (finished) onComplete(); }');
    // A rapid Firestick double-BACK must not start an overlapping collapse.
    expect(backBlock).toContain('persistentSurfaceBackInFlightRef.current) return');
    expect(backBlock).toContain('persistentSurfaceBackInFlightRef.current = true');
    expect(backBlock).toContain("transitionNativeSurface('mini', returnToLive)");
  });

  it('does not run a second mini resize when the tab regains focus after BACK', () => {
    const normalFocusReturn = liveTab.indexOf('// Normal focus return');
    const focusReturnStart = liveTab.lastIndexOf('if (USES_NATIVE_VLC) {', normalFocusReturn);
    const focusReturnBlock = liveTab.slice(focusReturnStart, focusReturnStart + 700);

    expect(focusReturnBlock).toContain("if (nativeSurfaceMode !== 'mini') transitionNativeSurface('mini')");
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