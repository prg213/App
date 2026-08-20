import type { VideoPlayer } from 'expo-video';
import { VideoView } from 'expo-video';
import { useKeepAwake } from 'expo-keep-awake';
import type { StyleProp, ViewStyle } from 'react-native';

export type StreamResizeMode = 'contain' | 'cover' | 'fill';

export interface NativeStreamPlayerProps {
  source: string;
  player: VideoPlayer;
  paused?: boolean;
  repeat?: boolean;
  resizeMode?: StreamResizeMode;
  style?: StyleProp<ViewStyle>;
  reloadKey?: string | number;
  /** Normalized VLC seek position (0=start, 1=end). Android only. */
  seekPosition?: number;
  onPlaying?: () => void;
  onBuffering?: () => void;
  onError?: () => void;
  onProgress?: (currentTime: number, duration: number) => void;
}

/**
 * Non-Android platforms keep the Expo player. Android overrides this component
 * with a libVLC implementation so MPEG transport streams with MP2 audio are
 * decoded by VLC instead of the device ExoPlayer codec set.
 */
export function NativeStreamPlayer({
  player,
  resizeMode = 'contain',
  style,
  onPlaying,
}: NativeStreamPlayerProps) {
  // Each mounted playback surface needs its own wake-lock tag. The mini-player
  // and fullscreen player overlap briefly during handoff; sharing a tag lets
  // the old surface clear the lock while the new one is still playing.
  useKeepAwake();

  return (
    <VideoView
      player={player}
      style={style}
      contentFit={resizeMode}
      nativeControls={false}
      onFirstFrameRender={onPlaying}
    />
  );
}