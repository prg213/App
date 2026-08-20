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

  it('does not include videoKey in Android VLC reload keys', () => {
    expect(liveTab).toContain('reloadKey={USES_NATIVE_VLC ? vlcReloadKey');
    expect(tvLayout).toContain("reloadKey={Platform.OS === 'android' ? vlcReloadKey");
  });

  it('keeps the existing Android surface for only its fullscreen route lifetime', () => {
    const ownershipStart = fullscreenPlayer.indexOf('const usesPersistentNativeSurface');
    const ownershipBlock = fullscreenPlayer.slice(ownershipStart, ownershipStart + 500);

    expect(ownershipBlock).toContain('USES_NATIVE_VLC');
    expect(ownershipBlock).toContain('&& isLive');
    expect(ownershipBlock).toContain('nativeSurfaceHandoff?.id === nativeSurfaceHandoffId');
    // BACK sets the shared visual mode to mini before this route is removed.
    // Ownership must survive that transition or player.tsx mounts a second VLC
    // decoder in the closing route and restarts playback.
    expect(ownershipBlock).not.toContain("nativeSurfaceMode === 'fullscreen'");
    expect(fullscreenPlayer).toContain('endNativeSurfaceHandoff(nativeSurfaceHandoffId)');
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');
    expect(fullscreenPlayer).toContain("transitionNativeSurface('mini', returnToLive)");
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