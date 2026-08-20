/**
 * Regression guards for Android IPTV streams carrying MPEG audio layer II.
 *
 * Standard Expo/ExoPlayer does not bundle the MPEG Layer II decoder required
 * by some IPTV transport streams. Android and Fire TV must use libVLC instead
 * of forcing an ExoPlayer track selection that can stop video playback.
 */

import * as fs from 'fs';
import * as path from 'path';

const playerSource = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');
const liveContextSource = fs.readFileSync(path.resolve(__dirname, '../context/LivePlayerContext.tsx'), 'utf8');
const nativeVlcSource = fs.readFileSync(path.resolve(__dirname, '../components/NativeStreamPlayer.android.tsx'), 'utf8');
const liveTabSource = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');
const vlcAndroidPluginSource = fs.readFileSync(path.resolve(__dirname, '../plugins/withVlcAndroid.js'), 'utf8');
const vlcGradlePatchSource = fs.readFileSync(
  path.resolve(__dirname, '../../../patches/react-native-vlc-media-player@1.0.98.patch'),
  'utf8',
);
const appConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'),
) as { expo: { plugins: Array<string | [string, Record<string, any>]> } };

describe('MP2 audio playback', () => {
  it('uses the VLC renderer on Android rather than forcing an ExoPlayer track', () => {
    expect(playerSource).toContain("const USES_NATIVE_VLC = Platform.OS === 'android'");
    expect(nativeVlcSource).toContain("from 'react-native-vlc-media-player'");
    expect(nativeVlcSource).toContain('<VLCPlayer');
    expect(playerSource).not.toContain('fallbackAudioTrack');
    expect(playerSource).not.toContain('tracks.find((track) => track.isDefault)');
  });

  it('does not reintroduce the audio-mixing workaround that broke video startup', () => {
    expect(playerSource).not.toContain("p.audioMixingMode = 'doNotMix'");
    expect(liveContextSource).not.toContain("p.audioMixingMode = 'doNotMix'");
  });

  it('keeps VLC unmuted with IPTV network buffering configured', () => {
    expect(nativeVlcSource).toContain('muted={false}');
    expect(nativeVlcSource).toContain("'--network-caching=1200'");
  });

  it('configures the Android build for the VLC native dependency', () => {
    const plugins = appConfig.expo.plugins;
    const buildProperties = plugins.find(
      (plugin): plugin is [string, Record<string, any>] =>
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );

    expect(buildProperties?.[1].android?.minSdkVersion).toBe(26);
    expect(plugins).toContain('./plugins/withVlcAndroid');
    expect(vlcAndroidPluginSource).toContain("require('expo/config-plugins')");
    expect(vlcAndroidPluginSource).toContain('jetified-react-android');
    expect(vlcAndroidPluginSource).toContain('libc++_shared.so');
    expect(vlcGradlePatchSource).toContain(
      '-        classpath("com.android.tools.build:gradle:4.0.2")',
    );
  });

  it('uses seconds for VLC progress and gives fullscreen exclusive ownership', () => {
    expect(nativeVlcSource).toContain('currentTime / 1000');
    expect(nativeVlcSource).toContain('duration / 1000');
    expect(playerSource).toContain('setVlcSeekPosition(Math.max(0, Math.min(1, resumeAt / reportedDuration)))');
    expect(liveTabSource).toContain('setIsLivePreviewActive(false)');
    expect(liveTabSource).toContain('isPlaybackActive={isLivePreviewActive}');
    expect(playerSource).toContain('const handleNativeVlcError = useCallback');
    expect(playerSource).toContain('reloadNativeVlc(urls[1])');
    expect(playerSource).toContain('didResolveStaleUrlRef.current = false');
  });
});