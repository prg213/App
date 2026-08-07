import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Returns a counter that increments each time the app returns to the foreground
 * (AppState transitions to 'active').
 *
 * Use it as part of an expo-image `recyclingKey` to force a clean remount
 * whenever the app resumes — this clears stale in-memory cache entries that
 * were evicted while the app was backgrounded (#172).
 */
export function useForegroundEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setEpoch((e) => e + 1);
    });
    return () => sub.remove();
  }, []);
  return epoch;
}
