import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..');
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const fullscreenPlayer = fs.readFileSync(path.resolve(appRoot, 'app/player.tsx'), 'utf8');
const liveContext = fs.readFileSync(path.resolve(appRoot, 'context/LivePlayerContext.tsx'), 'utf8');
const tvLayout = fs.readFileSync(path.resolve(appRoot, 'components/TVLiveLayout.tsx'), 'utf8');
const tabLayout = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/_layout.tsx'), 'utf8');
const media3Session = fs.readFileSync(
  path.resolve(appRoot, 'native/media3/StreamVaultMedia3Session.java'),
  'utf8',
);
const media3View = fs.readFileSync(
  path.resolve(appRoot, 'native/media3/StreamVaultMedia3View.java'),
  'utf8',
);
const media3Plugin = fs.readFileSync(
  path.resolve(appRoot, 'plugins/withMedia3LivePlayer.js'),
  'utf8',
);

describe('Android Live TV Media3 session ownership', () => {
  it('coordinates a route-scoped mini/fullscreen handoff without storing geometry in playback state', () => {
    expect(liveContext).toContain("export type NativeSurfaceMode = 'mini' | 'fullscreen' | 'hidden'");
    expect(liveContext).toContain('beginNativeSurfaceHandoff');
    expect(liveContext).toContain('transitionNativeSurface');
    expect(liveContext).toContain('commitNativeSurfaceLayout');
    expect(liveContext).toContain('nativeSurfaceReloadKey');
    expect(liveContext).toContain('reloadNativeSurface');
    expect(liveContext).not.toContain('measureInWindow');
    expect(liveContext).not.toContain('<VideoView');
  });

  it('mounts one root-owned Media3 presentation host and never mounts a renderer in TVLiveLayout', () => {
    const hostStart = liveTab.indexOf('const nativeMedia3PresentationHost =');
    const host = liveTab.slice(hostStart, liveTab.indexOf('// ── Render', hostStart));

    expect(hostStart).toBeGreaterThan(-1);
    expect(host).toContain('<Media3LivePlayer');
    expect(host).toContain('source={activeNativeSurfaceUrl}');
    expect(host).toContain('reloadKey={`${media3ReloadKey}:${nativeSurfaceReloadKey}`}');
    expect(host).toContain("paused={nativeSurfaceMode === 'hidden'}");
    expect(host).toContain('nativeSurfacePresentationSuspended');
    expect(host).toContain('styles.nativeSurfacePresentationLayer');
    expect(host).toContain('styles.nativeSurfacePresentationFrame');
    expect(host).toContain('pointerEvents="none"');
    expect(liveTab).not.toContain('const nativeVlcPresentationHost =');
    expect(tvLayout).toContain('nativePresentationHost?: React.ReactNode;');
    expect(tvLayout).toContain('{nativePresentationHost}');
    expect(tvLayout).not.toContain('<Media3LivePlayer');
  });

  it('keeps one ExoPlayer session while output views attach and detach', () => {
    expect(media3Session).toContain('private static StreamVaultMedia3Session instance');
    expect(media3Session).toContain('new ExoPlayer.Builder(context)');
    expect(media3Session).toContain('PlayerView.switchTargetView(player, attachedView, nextView)');
    expect(media3Session).toContain('PlayerView.switchTargetView(player, view, null)');
    expect(media3Session).not.toContain('player.release()');
    expect(media3View).toContain('session.attach(playerView)');
    expect(media3View).toContain('session.detach(playerView)');
    expect(media3View).toContain('session.setSource(source, false)');
  });

  it('reprepares only for a source change or an explicit retry key', () => {
    expect(media3Session).toContain('if (!forceReload && source.equals(activeSource))');
    expect(media3Session).toContain('player.setMediaItem(item, true)');
    expect(media3Session).toContain('player.prepare()');
    expect(media3View).toContain('if (normalised.equals(source)) return');
    expect(media3View).toContain('if (java.util.Objects.equals(reloadKey, nextReloadKey)) return');
  });

  it('preserves the current fullscreen sizing and controls-only route contract', () => {
    expect(liveTab).toContain('width: screenWidth');
    expect(liveTab).toContain('height: screenHeight');
    expect(liveTab).toContain('nativeSurfaceFullscreen ? 0 : nativeOwnerBounds.x');
    expect(tabLayout).toContain("const nativeSurfaceFullscreen = Platform.OS === 'android' && nativeSurfaceMode === 'fullscreen'");
    expect(tabLayout).toContain('nativeSurfaceFullscreen ? null : <Sidebar {...props} />');
    expect(fullscreenPlayer).toContain('const usesPersistentNativeSurface = hasPersistentNativeSurfaceHandoff;');
    expect(fullscreenPlayer).toContain('videoMounted && !usesPersistentNativeSurface');
    expect(fullscreenPlayer).toContain('transitionNativeSurface(\'mini\', returnToLive)');
  });

  it('registers native source copying, package registration, and Media3 Gradle dependencies', () => {
    expect(media3Plugin).toContain('withDangerousMod');
    expect(media3Plugin).toContain('withMainApplication');
    expect(media3Plugin).toContain('add(StreamVaultMedia3Package())');
    expect(media3Plugin).toContain('media3-exoplayer-hls');
    expect(media3Plugin).toContain('media3-exoplayer-rtsp');
  });
});