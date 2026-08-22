import React from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { VLCPlayer, type VLCPlayerSource } from 'react-native-vlc-media-player';
import type { NativeStreamPlayerProps } from './NativeStreamPlayer';

/**
 * Android and Fire TV playback surface.
 *
 * libVLC includes demuxers and decoders for IPTV MPEG transport streams,
 * including MPEG Layer II audio, which are not bundled with the standard
 * ExoPlayer configuration used by expo-video.
 */
function NativeStreamPlayerAndroid({
  source,
  paused = false,
  repeat = false,
  resizeMode = 'contain',
  style,
  reloadKey,
  seekPosition,
  onPlaying,
  onBuffering,
  onError,
  onProgress,
}: NativeStreamPlayerProps) {
  // The native manager receives a ReadableMap. Keep that map identity stable
  // across layout-only parent renders; a new source object is only valid when
  // the URL itself changes.
  const vlcSource = React.useMemo<VLCPlayerSource>(() => ({
    uri: source,
    initType: 2,
    initOptions: [
      '--network-caching=1200',
      '--clock-jitter=0',
      '--clock-synchro=0',
    ],
  }), [source]);

  // Fire TV ignores this harmlessly; on phones it prevents the screen from
  // timing out while the viewer is actively watching the stream. Do not share
  // a tag with the mini-player/fullscreen sibling: Expo removes a tag when
  // either surface unmounts instead of reference-counting that tag.
  useKeepAwake();

  return (
    <VLCPlayer
      key={`${source}:${reloadKey ?? 0}`}
      style={style}
      source={vlcSource}
      autoplay
      paused={paused}
      repeat={repeat}
      seek={seekPosition}
      volume={100}
      muted={false}
      resizeMode={resizeMode}
      onPlaying={onPlaying}
      onBuffering={(event) => {
        // LibVLC reports a final `Buffering` event at 100% after some live
        // streams have already entered Playing. Treating that terminal event
        // as a new stall leaves the first fullscreen channel behind the
        // "Connecting to stream" layer because no second Playing event is
        // guaranteed. Only surface genuine, incomplete buffering.
        const bufferRate = (event as { bufferRate?: number }).bufferRate;
        if (bufferRate === undefined || bufferRate < 100) onBuffering?.();
      }}
      onError={onError}
      // LibVLC reports milliseconds; StreamVault controls, history, and
      // catch-up offsets consistently use seconds. Native progress events also
      // carry `isPlaying` at runtime (the library's typings omit it). This is
      // the durable readiness fallback when the initial Playing event happens
      // before React Native has attached the JS event listener during the first
      // fullscreen surface mount.
      onProgress={(event) => {
        const { currentTime, duration } = event;
        if ((event as typeof event & { isPlaying?: boolean }).isPlaying) onPlaying?.();
        onProgress?.(currentTime / 1000, duration / 1000);
      }}
    />
  );
}

/**
 * A mini/fullscreen handoff changes only the owner container's bounds. Ignore
 * React props that are unrelated to libVLC playback (the parent style and the
 * Expo player adapter) so a layout-only render cannot re-send volume, mute,
 * pause, seek, source, or track-related values to the native view.
 *
 * libVLC therefore retains its current decoder position, playing state, audio
 * selection, subtitle selection, volume, and mute state until the user changes
 * one of the real playback inputs below.
 */
function areVlcPlaybackInputsEqual(
  previous: Readonly<NativeStreamPlayerProps>,
  next: Readonly<NativeStreamPlayerProps>,
) {
  return previous.source === next.source
    && previous.reloadKey === next.reloadKey
    && previous.paused === next.paused
    && previous.repeat === next.repeat
    && previous.resizeMode === next.resizeMode
    && previous.seekPosition === next.seekPosition
    && previous.onPlaying === next.onPlaying
    && previous.onBuffering === next.onBuffering
    && previous.onError === next.onError
    && previous.onProgress === next.onProgress;
}

/**
 * A mini ↔ fullscreen handoff changes only the parent surface bounds. Keeping
 * this component memoized means those layout-only renders never send a fresh
 * source, volume, mute, pause, track, or seek prop set to the native VLC view.
 * The memo intentionally releases when a real playback input changes (URL,
 * reload key, pause state, seek, or resize mode).
 */
export const NativeStreamPlayer = React.memo(
  NativeStreamPlayerAndroid,
  areVlcPlaybackInputsEqual,
);
