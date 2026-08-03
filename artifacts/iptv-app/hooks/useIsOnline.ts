import { useEffect, useState } from 'react';
import * as Network from 'expo-network';

/**
 * Returns true when the device has an active network connection.
 * Subscribes to state changes so the value updates automatically.
 * Used by trailer buttons (#129) to show a visual "unavailable" state
 * before the user taps, rather than failing silently after the tap.
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true); // optimistic default

  useEffect(() => {
    // Seed with the current state immediately
    Network.getNetworkStateAsync()
      .then((s) => setIsOnline(s.isConnected ?? true))
      .catch(() => {});

    const sub = Network.addNetworkStateListener((s) => {
      setIsOnline(s.isConnected ?? true);
    });
    return () => sub.remove();
  }, []);

  return isOnline;
}
