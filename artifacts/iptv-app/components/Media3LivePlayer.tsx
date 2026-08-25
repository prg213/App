import type { Media3LivePlayerProps } from './Media3LivePlayer.android';

/**
 * Android supplies the native Media3 view. Other platforms keep their existing
 * Expo-video path and never render this component.
 */
export function Media3LivePlayer(_props: Media3LivePlayerProps) {
  return null;
}