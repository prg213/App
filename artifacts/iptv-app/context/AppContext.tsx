import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getDeviceMac } from '@/services/macAddress';
import { StorageService } from '@/services/storage';
import { clearTmdbTrailerCache } from '@/services/tmdb';
import { clearReminderRefreshCache } from '@/services/reminderUrlCache';
import { resetSessionPushFailures } from '@/services/favoritesSync';
import { resetChannelMenuState } from '@/components/LiveChannelMenu';
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

  // ── Periodic interval ref — defined early so doLogout can clear it ────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks when the last foreground MAC check ran so the periodic timer can
  // skip a redundant call within a short grace window (#189).
  const lastForegroundCheckRef = useRef(0);

  // #190: Counts consecutive MAC-check failures across both the periodic
  // interval and foreground checks.  A single transient network error should
  // not immediately log the user out; only N consecutive failures do.
  const consecutiveMacFailRef = useRef(0);
  const MAX_CONSECUTIVE_MAC_FAILURES = 5;

  const stopMacInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const doLogout = useCallback(async (reason?: LogoutReason) => {
    stopMacInterval(); // stop periodic checks immediately on logout
    if (reason) {
      await StorageService.saveLogoutReason(reason);
    }
    void StorageService.clearStartupFailCount(); // #267: reset persisted streak on logout
    void StorageService.setPrefSearchQuery(''); // #122: clear stale query across sessions
    await StorageService.clearCredentials();
    clearTmdbTrailerCache();
    clearReminderRefreshCache(); // #126: reset backfill gate so fresh credentials always get a new URL check
    resetSessionPushFailures(); // #23: new login gets a clean failure counter
    resetChannelMenuState(); // #390: clear stale category/search/scroll so next login auto-selects fresh
    setCredentials(null);
    setIsActivated(false);
    isActivatedRef.current = false;
  }, [stopMacInterval]);

  // Starts the 5-minute interval; no-op if already running.
  // Skips a tick if a foreground check ran within the last 2 minutes (#189).
  const startMacInterval = useCallback(() => {
    if (intervalRef.current) return; // already running
    const INTERVAL_MS = 5 * 60_000; // 5 minutes
    const SKIP_AFTER_FOREGROUND_MS = 2 * 60_000; // 2-minute grace window
    intervalRef.current = setInterval(async () => {
      if (!isActivatedRef.current || !deviceMacRef.current) return;
      // Skip if a foreground check just ran to avoid back-to-back calls
      if (Date.now() - lastForegroundCheckRef.current < SKIP_AFTER_FOREGROUND_MS) return;
      const stillActive = await isMacStillRegistered(deviceMacRef.current);
      if (stillActive) {
        consecutiveMacFailRef.current = 0; // #190: reset on success
        void StorageService.clearStartupFailCount(); // #267
      } else {
        consecutiveMacFailRef.current += 1; // #190: count consecutive failures
        void StorageService.saveStartupFailCount(consecutiveMacFailRef.current); // #267
        if (consecutiveMacFailRef.current >= MAX_CONSECUTIVE_MAC_FAILURES) {
          await doLogout('deactivated');
        }
      }
    }, INTERVAL_MS);
  }, [doLogout]);

  // ── Startup: load stored credentials ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [mac, creds, persistedFailCount] = await Promise.all([
        getDeviceMac(),
        StorageService.getCredentials(),
        StorageService.getStartupFailCount(), // #267: restore streak across force-quits
      ]);
      setDeviceMac(mac);
      deviceMacRef.current = mac;

      // #267: seed the in-memory counter from storage so force-quitting and
      // relaunching cannot indefinitely reset the deactivation streak to zero.
      consecutiveMacFailRef.current = persistedFailCount;

      if (creds) {
        // Verify the MAC is still registered before trusting stored credentials
        const stillActive = await isMacStillRegistered(mac);
        if (stillActive) {
          consecutiveMacFailRef.current = 0; // #257: reset streak on a clean startup
          void StorageService.clearStartupFailCount(); // #267
          setCredentials(creds);
          setIsActivated(true);
          isActivatedRef.current = true;
          // App launched while already foregrounded — start the interval now
          // so a cold-launch session is covered without needing an AppState event.
          if (AppState.currentState === 'active') {
            lastForegroundCheckRef.current = Date.now();
            startMacInterval();
          }
        } else {
          // #257: A single transient server blip at cold-start must not force a
          // logout.  Reuse the shared counter so only N consecutive failures
          // (startup + foreground/interval) actually deactivate the session.
          consecutiveMacFailRef.current += 1;
          if (consecutiveMacFailRef.current >= MAX_CONSECUTIVE_MAC_FAILURES) {
            void StorageService.clearStartupFailCount(); // #267: clean up before logout
            await doLogout('deactivated');
          } else {
            // Below the threshold — trust stored credentials and let the
            // foreground/interval checks confirm deactivation.  Do NOT update
            // lastForegroundCheckRef so the next AppState 'active' event will
            // run a fresh check immediately without being skipped.
            void StorageService.saveStartupFailCount(consecutiveMacFailRef.current); // #267
            setCredentials(creds);
            setIsActivated(true);
            isActivatedRef.current = true;
            if (AppState.currentState === 'active') {
              startMacInterval();
            }
          }
        }
      }
      setIsLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Foreground check + periodic interval ─────────────────────────────────
  // Re-verify on foreground; pause/resume the interval with app state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'active') {
        if (!isActivatedRef.current || !deviceMacRef.current) return;
        // Immediate check on foreground; record timestamp so interval can skip
        lastForegroundCheckRef.current = Date.now();
        const stillActive = await isMacStillRegistered(deviceMacRef.current);
        if (!stillActive) {
          // #190: tolerate transient network errors; only logout after N failures
          consecutiveMacFailRef.current += 1;
          void StorageService.saveStartupFailCount(consecutiveMacFailRef.current); // #267
          if (consecutiveMacFailRef.current >= MAX_CONSECUTIVE_MAC_FAILURES) {
            await doLogout('deactivated');
          }
          return;
        }
        consecutiveMacFailRef.current = 0; // #190: reset streak on success
        void StorageService.clearStartupFailCount(); // #267
        startMacInterval();
      } else {
        // Background or inactive — pause the interval to avoid wasted requests
        stopMacInterval();
      }
    });
    return () => {
      sub.remove();
      stopMacInterval();
    };
  }, [doLogout, startMacInterval, stopMacInterval]);

  const setActivated = async (creds: Credentials) => {
    try {
      await StorageService.saveCredentials(creds);
    } catch {
      // Storage failure must not block navigation — session still works in-memory
    }
    setCredentials(creds);
    setIsActivated(true);
    isActivatedRef.current = true;
    // Start periodic checks immediately when the user activates their device,
    // rather than waiting for the next AppState transition.
    if (AppState.currentState === 'active') {
      startMacInterval();
    }
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
