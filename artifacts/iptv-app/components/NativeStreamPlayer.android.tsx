import React from 'react';
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
      onBuffering={onBuffering}
      onError={onError}
      // LibVLC reports milliseconds; StreamVault controls, history, and
      // catch-up offsets consistently use seconds.
      onProgress={({ currentTime, duration }) => onProgress?.(currentTime / 1000, duration / 1000)}
    />
  );
}