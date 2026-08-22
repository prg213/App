/**
 * Regression guards for returning from live fullscreen playback.
 *
 * Android/Fire TV no longer uses a measured overlay handoff: the VLC child
 * stays mounted in Live TV and only its owner changes between mini and
 * fullscreen layouts.
 */
import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const context = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const player = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');

describe('live fullscreen return ownership', () => {
  it('does not retain the measured overlay collapse implementation', () => {
    for (const retiredImplementation of [
      'measureInWindow',
      'setOverlayHasVideo',
      'onCollapseCompleteRef',
      'pendingCollapseRemountRef',
      '_runCollapseAnimation',
      '<VideoView',
    ]) {
      expect(context).not.toContain(retiredImplementation);
    }
  });

  it('returns the current channel through the shared handoff before closing', () => {
    const backStart = player.indexOf('const handleBackLive = useCallback');
    const back = player.slice(backStart, backStart + 3600);

    expect(back).toContain('setPendingLivePlayerReturn(returnChannel)');
    expect(back).toContain("DEE.emit('live:setPlayingChannel', returnChannel)");
    expect(back.indexOf('setPendingLivePlayerReturn(returnChannel)'))
      .toBeLessThan(back.indexOf("DEE.emit('live:setPlayingChannel', returnChannel)"));
  });

  it('restores both live selection and playback state without remounting Android VLC', () => {
    const returnStart = liveTab.indexOf('const returnedChannel = consumePendingLivePlayerReturn()');
    const returnBlock = liveTab.slice(returnStart, returnStart + 1600);

    expect(returnStart).toBeGreaterThan(-1);
    expect(returnBlock).toContain('setPlayingChannel(returnedChannel)');
    expect(returnBlock).toContain('setSelectedChannel(returnedChannel)');
    expect(returnBlock).toContain('if (!USES_NATIVE_VLC) setVideoKey');
    expect(returnBlock).toContain('focusPlayingChannelRef.current?.()');
    expect(returnBlock).toContain('requestTvFocus(miniPlayerRef.current)');
  });

  it('keeps early stop-on-back launches silent', () => {
    const backStart = player.indexOf('const handleBackLive = useCallback');
    const back = player.slice(backStart, backStart + 900);

    expect(back).toContain("if (params.stopOnBack === 'true')");
    expect(back).toContain('sharedPlayer?.pause()');
    expect(back).toContain('setVideoMounted(false)');
    expect(back).toContain('router.back()');
  });

  it('waits for the persistent surface to contract before routing back to Live TV', () => {
    const transitionStart = context.indexOf('const transitionNativeSurface = useCallback');
    const transition = context.slice(transitionStart, transitionStart + 1400);
    const collapseStart = context.indexOf('const triggerCollapse = useCallback');
    const collapse = context.slice(collapseStart, collapseStart + 300);

    expect(transitionStart).toBeGreaterThan(-1);
    expect(transition).toContain('setNativeSurfaceMode(mode)');
    expect(transition).toContain('LayoutAnimation.configureNext');
    expect(transition).toContain('setTimeout(onComplete, shouldAnimate ? NATIVE_SURFACE_TRANSITION_MS : 0)');
    expect(transition).not.toContain('measureInWindow');
    expect(transition).not.toContain('Animated.');
    expect(collapseStart).toBeGreaterThan(-1);
    expect(collapse).toContain('requestAnimationFrame(() => {');
    expect(collapse).toContain('requestAnimationFrame(onDone)');

    const backStart = player.indexOf('const handleBackLive = useCallback');
    const back = player.slice(backStart, backStart + 4300);
    const directUnmount = back.indexOf('setVideoMounted(false)');
    const directCollapse = back.indexOf('triggerCollapse(() => router.back())');
    expect(directUnmount).toBeGreaterThan(-1);
    expect(directCollapse).toBeGreaterThan(directUnmount);
  });

  it('returns without showing a loading state or replacing the persistent stream', () => {
    const returnStart = liveTab.indexOf('const returnedChannel = consumePendingLivePlayerReturn()');
    const returnBlock = liveTab.slice(returnStart, returnStart + 1100);

    expect(returnStart).toBeGreaterThan(-1);
    expect(returnBlock).toContain('setIsBuffering(false)');
    expect(returnBlock).toContain('setPlayingChannel(returnedChannel)');
    expect(returnBlock).toContain('setSelectedChannel(returnedChannel)');
    expect(returnBlock).not.toContain('setVlcReloadKey');
    expect(returnBlock).not.toContain('player.replace(');
    expect(returnBlock).not.toContain('player.pause(');
  });
});