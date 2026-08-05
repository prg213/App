import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getDeviceMac } from '@/services/macAddress';
import { StorageService } from '@/services/storage';
import { clearTmdbTrailerCache } from '@/services/tmdb';
import { clearReminderRefreshCache } from '@/services/reminderUrlCache';
import type { Credentials } from '@/types';

export type LogoutReason = 'deactivated' | null;

interface AppContextValue {
  isLoading: boolean;
  isActivated: boolean;
  credentials: Credentials | null;
  deviceMac: string;
  setActivated: (creds: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  /** URL of the last channel played in the fullscreen player — in-memory only */
  lastWatchedUrl: string | null;
  setLastWatchedUrl: (url: string | null) => void;
}

const AppContext = createContext<AppContextValue>({
  isLoading: true,
  isActivated: false,
  credentials: null,
  deviceMac: '',
  setActivated: async () => {},
  logout: async () => {},
  lastWatchedUrl: null,
  setLastWatchedUrl: () => {},
});

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : '';

/**
 * Checks whether this device's MAC is still registered on the server.
 * Returns true if still active, false if the MAC has been deleted.
 * Silently returns true on any network error so a bad connection never
 * forces a logout.
 */
async function isMacStillRegistered(mac: string): Promise<boolean> {
  if (!mac) return true;
  try {
    const res = await fetch(
      `${API_BASE}/api/activate?mac=${encodeURIComponent(mac)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return true; // server error → stay logged in
    const data = await res.json();
    return data.status === 'active';
  } catch {
    return true; // network error → stay logged in
  }
}

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isActivated, setIsActivated] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [deviceMac, setDeviceMac] = useState('');
  const [lastWatchedUrl, setLastWatchedUrl] = useState<string | null>(null);

  // Keep a ref so the AppState listener always sees the latest values without
  // needing to be re-registered every time they change.
  const isActivatedRef = useRef(false);
  const deviceMacRef = useRef('');

  const doLogout = useCallback(async (reason?: LogoutReason) => {
    if (reason) {
      await StorageService.saveLogoutReason(reason);
    }
    await StorageService.clearCredentials();
    clearTmdbTrailerCache();
    clearReminderRefreshCache(); // #126: reset backfill gate so fresh credentials always get a new URL check
    setCredentials(null);
    setIsActivated(false);
    isActivatedRef.current = false;
  }, []);

  // ── Startup: load stored credentials ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [mac, creds] = await Promise.all([
        getDeviceMac(),
        StorageService.getCredentials(),
      ]);
      setDeviceMac(mac);
      deviceMacRef.current = mac;

      if (creds) {
        // Verify the MAC is still registered before trusting stored credentials
        const stillActive = await isMacStillRegistered(mac);
        if (stillActive) {
          setCredentials(creds);
          setIsActivated(true);
          isActivatedRef.current = true;
        } else {
          // MAC was deleted while the app was closed — clear and show activation screen
          await doLogout('deactivated');
        }
      }
      setIsLoading(false);
    })();
  }, []);

  // ── Foreground check: re-verify whenever the app becomes active ───────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state !== 'active') return;
      if (!isActivatedRef.current || !deviceMacRef.current) return;
      const stillActive = await isMacStillRegistered(deviceMacRef.current);
      if (!stillActive) {
        await doLogout('deactivated');
      }
    });
    return () => sub.remove();
  }, [doLogout]);

  const setActivated = async (creds: Credentials) => {
    try {
      await StorageService.saveCredentials(creds);
    } catch {
      // Storage failure must not block navigation — session still works in-memory
    }
    setCredentials(creds);
    setIsActivated(true);
    isActivatedRef.current = true;
  };

  const logout = async () => {
    await doLogout();
  };

  return (
    <AppContext.Provider
      value={{
        isLoading,
        isActivated,
        credentials,
        deviceMac,
        setActivated,
        logout,
        lastWatchedUrl,
        setLastWatchedUrl,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
