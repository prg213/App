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
  });

  it('expands the mounted mini-player VLC surface instead of calling the Expo overlay transition', () => {
    const watchStart = liveTab.indexOf('const handleWatch = useCallback');
    const watchBlock = liveTab.slice(watchStart, watchStart + 2200);

    expect(watchBlock).toContain("transitionNativeSurface('fullscreen', navigate)");
    expect(watchBlock).toContain('triggerExpand(navigate)');
    expect(watchBlock).toMatch(/if\s*\(\s*USES_NATIVE_VLC\s*\)/);
  });

  it('does not include videoKey in Android VLC reload keys', () => {
    expect(liveTab).toContain('reloadKey={USES_NATIVE_VLC ? vlcReloadKey');
    expect(tvLayout).toContain("reloadKey={Platform.OS === 'android' ? vlcReloadKey");
  });

  it('uses the existing Android surface as the fullscreen video layer', () => {
    expect(fullscreenPlayer).toContain("nativeSurfaceMode === 'fullscreen'");
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');
    expect(fullscreenPlayer).toContain("transitionNativeSurface('mini', returnToLive)");
  });

  it('updates the persistent source on a real channel zap without mounting fullscreen VLC', () => {
    const switchStart = fullscreenPlayer.indexOf('const switchChannel = useCallback');
    const switchBlock = fullscreenPlayer.slice(switchStart, switchStart + 3600);

    expect(switchBlock).toContain('setNativeSurfaceUrl(entry.url)');
    expect(switchBlock).toContain("DeviceEventEmitter.emit('channel:switched'");
  });
});