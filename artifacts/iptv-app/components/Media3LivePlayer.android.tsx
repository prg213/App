import React from 'react';
import {
  DeviceEventEmitter,
  requireNativeComponent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';

type Media3NativeEvent = {
  type?: 'state' | 'error' | 'progress' | 'tracks' | 'capabilities';
  state?: 'idle' | 'loading' | 'buffering' | 'ready' | 'playing' | 'paused' | 'ended';
  message?: string;
  position?: number;
  duration?: number;
};

export interface Media3LivePlayerProps {
  source: string;
  paused?: boolean;
  resizeMode?: 'contain' | 'cover' | 'fill';
  style?: StyleProp<ViewStyle>;
  reloadKey?: string | number;
  onPlaying?: () => void;
  onBuffering?: () => void;
  onError?: (message?: string) => void;
  onProgress?: (currentTime: number, duration: number) => void;
}

type NativeProps = {
  source: string;
  paused?: boolean;
  resizeMode?: string;
  reloadKey?: string;
  style?: StyleProp<ViewStyle>;
};

const NativeMedia3LivePlayer = requireNativeComponent<NativeProps>('StreamVaultMedia3View');

function Media3LivePlayerAndroid({
  source,
  paused = false,
  resizeMode = 'contain',
  style,
  reloadKey,
  onPlaying,
  onBuffering,
  onError,
  onProgress,
}: Media3LivePlayerProps) {
  useKeepAwake('streamvault-media3-live');
  const callbacksRef = React.useRef({ onPlaying, onBuffering, onError, onProgress });
  callbacksRef.current = { onPlaying, onBuffering, onError, onProgress };

  React.useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      'streamvault:media3-event',
      (event: Media3NativeEvent) => {
        if (event.type === 'state') {
          if (event.state === 'buffering' || event.state === 'loading') callbacksRef.current.onBuffering?.();
          if (event.state === 'ready' || event.state === 'playing') callbacksRef.current.onPlaying?.();
        } else if (event.type === 'error') {
          callbacksRef.current.onError?.(event.message);
        } else if (event.type === 'progress') {
          callbacksRef.current.onProgress?.(event.position ?? 0, event.duration ?? 0);
        }
      },
    );
    return () => subscription.remove();
  }, []);

  return (
    <NativeMedia3LivePlayer
      source={source}
      paused={paused}
      resizeMode={resizeMode}
      reloadKey={reloadKey === undefined ? undefined : String(reloadKey)}
      style={style}
    />
  );
}

export const Media3LivePlayer = React.memo(
  Media3LivePlayerAndroid,
  (previous, next) => (
    previous.source === next.source
    && previous.reloadKey === next.reloadKey
    && previous.paused === next.paused
    && previous.resizeMode === next.resizeMode
    && previous.onPlaying === next.onPlaying
    && previous.onBuffering === next.onBuffering
    && previous.onError === next.onError
    && previous.onProgress === next.onProgress
  ),
);