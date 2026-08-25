/**
 * Regression guards for Android IPTV streams carrying MPEG audio layer II.
 *
 * Media3's FFmpeg extension is not published as a Maven artifact. The Android
 * bridge must therefore report whether a vetted, ABI-complete extension AAR is
 * present instead of silently treating a platform MPEG decoder as MP2 support.
 */

import * as fs from 'fs';
import * as path from 'path';

const appRoot = path.resolve(__dirname, '..');
const media3Session = fs.readFileSync(
  path.resolve(appRoot, 'native/media3/StreamVaultMedia3Session.java'),
  'utf8',
);
const media3Plugin = fs.readFileSync(
  path.resolve(appRoot, 'plugins/withMedia3LivePlayer.js'),
  'utf8',
);
const media3Player = fs.readFileSync(
  path.resolve(appRoot, 'components/Media3LivePlayer.android.tsx'),
  'utf8',
);
const liveTab = fs.readFileSync(path.resolve(appRoot, 'app/(tabs)/index.tsx'), 'utf8');
const appConfig = JSON.parse(
  fs.readFileSync(path.resolve(appRoot, 'app.json'), 'utf8'),
) as { expo: { plugins: Array<string | [string, Record<string, unknown>]> } };

describe('MP2 audio playback compatibility', () => {
  it('uses Media3 for Android Live TV while retaining VLC for non-Live playback', () => {
    expect(liveTab).toContain("const USES_NATIVE_MEDIA3_LIVE = Platform.OS === 'android'");
    expect(liveTab).toContain("from '@/components/Media3LivePlayer'");
    expect(liveTab).toContain('<Media3LivePlayer');
    expect(liveTab).not.toContain('const nativeVlcPresentationHost =');
  });

  it('prefers the FFmpeg renderer when a vetted Media3 decoder extension is bundled', () => {
    expect(media3Session).toContain('EXTENSION_RENDERER_MODE_PREFER');
    expect(media3Session).toContain('androidx.media3.decoder.ffmpeg.FfmpegLibrary');
    expect(media3Session).toContain('ffmpegAudioExtension');
    expect(media3Session).toContain('m2AudioSupported');
    expect(media3Session).toContain('media3-ffmpeg-extension');
  });

  it('never treats an unavailable FFmpeg extension as confirmed MP2 support', () => {
    const capabilityStart = media3Session.indexOf('WritableMap capabilities()');
    const capabilityBlock = media3Session.slice(capabilityStart, capabilityStart + 900);
    expect(capabilityBlock).toContain('isFfmpegAvailable()');
    expect(capabilityBlock).toContain('platform-codecs-only');
    expect(capabilityBlock).not.toContain('putBoolean("m2AudioSupported", true)');
  });

  it('includes the Media3 demuxers required by the current IPTV input matrix', () => {
    expect(media3Plugin).toContain('media3-exoplayer:1.9.2');
    expect(media3Plugin).toContain('media3-exoplayer-hls:1.9.2');
    expect(media3Plugin).toContain('media3-exoplayer-rtsp:1.9.2');
    expect(media3Plugin).toContain('media3-ui:1.9.2');
    expect(media3Plugin).toContain('media3-decoder-ffmpeg-1.9.2.aar');
    expect(media3Plugin).toContain('implementation(files("libs/${FFMPEG_AAR_NAME}"))');
    expect(media3Plugin).toContain("metadata.androidxMediaTag === '1.9.2'");
    expect(media3Plugin).toContain("metadata.ffmpegRef === 'release/6.0'");
    expect(media3Plugin).toContain("metadata.enabledDecoders.includes('mp2')");
    expect(appConfig.expo.plugins).toContain('./plugins/withMedia3LivePlayer');
  });

  it('surfaces native readiness, buffering, failure, and progress events to React', () => {
    expect(media3Player).toContain("'streamvault:media3-event'");
    expect(media3Player).toContain("event.state === 'buffering'");
    expect(media3Player).toContain("event.state === 'playing'");
    expect(media3Player).toContain("event.type === 'error'");
    expect(media3Player).toContain("event.type === 'progress'");
  });
});