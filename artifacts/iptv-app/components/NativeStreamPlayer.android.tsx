import React from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { VLCPlayer } from 'react-native-vlc-media-player';
import type { NativeStreamPlayerProps } from './NativeStreamPlayer';

/**
 * Android and Fire TV playback surface.
 *
 * libVLC includes demuxers and decoders for IPTV MPEG transport streams,
 * including MPEG Layer II audio, which are not bundled with the standard
 * ExoPlayer configuration used by expo-video.
 */
export function NativeStreamPlayer({
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
  // Fire TV ignores this harmlessly; on phones it prevents the screen from
  // timing out while the viewer is actively watching the stream. Do not share
  // a tag with the mini-player/fullscreen sibling: Expo removes a tag when
  // either surface unmounts instead of reference-counting that tag.
  useKeepAwake();

  return (
    <VLCPlayer
      key={`${source}:${reloadKey ?? 0}`}
      style={style}
      source={{
        uri: source,
        initType: 2,
        initOptions: [
          '--network-caching=1200',
          '--clock-jitter=0',
          '--clock-synchro=0',
        ],
      }}
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
