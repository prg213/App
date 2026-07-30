import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { StorageService } from '@/services/storage';
import type { MaxRating, ParentalSettings } from '@/types';

/** Background lock timeout: 2 minutes. */
const LOCK_TIMEOUT_MS = 2 * 60 * 1000;

interface ParentalContextValue {
  /** True once the context has loaded its initial state from storage. */
  parentalReady: boolean;
  isPinSet: boolean;
  /** True when the app is locked and the PIN gate should be shown. */
  isLocked: boolean;
  maxRating: MaxRating;
  lockEnabled: boolean;
  /** IDs of channels hidden from Live TV. */
  blockedChannels: string[];

  /** Attempt to unlock. Returns true on success. */
  unlockApp: (pin: string) => Promise<boolean>;
  /** Verify a PIN without unlocking (for settings protection). */
  verifyPin: (pin: string) => Promise<boolean>;
  /**
   * Set or change the PIN.
   * Pass `currentPin` when a PIN is already set; omit when setting for the first time.
   * Returns false if `currentPin` is wrong.
   */
  setPin: (newPin: string, currentPin?: string) => Promise<boolean>;
  /** Remove PIN. Returns false if currentPin is wrong. */
  disablePin: (currentPin: string) => Promise<boolean>;
  /** Toggle the app-lock feature (PIN must already be set). */
  setLockEnabled: (enabled: boolean) => Promise<void>;
  /** Change the max-rating ceiling. */
  setMaxRating: (rating: MaxRating) => Promise<void>;
  /** Toggle a channel in/out of the blocked list. */
  toggleBlockedChannel: (channelId: string) => Promise<void>;
  /** Provided by the root layout — clears credentials (logout) as the forgot-PIN escape. */
  resetAndLogout: () => void;
}

const ParentalContext = createContext<ParentalContextValue>({
  parentalReady: false,
  isPinSet: false,
  isLocked: false,
  maxRating: 'all',
  lockEnabled: false,
  blockedChannels: [],
  unlockApp: async () => false,
  verifyPin: async () => false,
  setPin: async () => false,
  disablePin: async () => false,
  setLockEnabled: async () => {},
  setMaxRating: async () => {},
  toggleBlockedChannel: async () => {},
  resetAndLogout: () => {},
});

export function ParentalContextProvider({
  children,
  onForgotPin,
}: {
  children: React.ReactNode;
  onForgotPin: () => void;
}) {
  const [parentalReady, setParentalReady] = useState(false);
  const [isPinSet, setIsPinSet] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [maxRating, setMaxRatingState] = useState<MaxRating>('all');
  const [lockEnabled, setLockEnabledState] = useState(false);
  const [blockedChannels, setBlockedChannels] = useState<string[]>([]);

  // Timestamp when the app went to background
  const bgTimestamp = useRef<number | null>(null);

  // Load initial state
  useEffect(() => {
    (async () => {
      const [pin, settings] = await Promise.all([
        StorageService.getPin(),
        StorageService.getParentalSettings(),
      ]);
      const pinSet = pin !== null;
      setIsPinSet(pinSet);
      setMaxRatingState(settings.maxRating);
      setLockEnabledState(settings.lockEnabled);
      setBlockedChannels(settings.blockedChannels ?? []);
      // Lock on first launch if PIN + lock are configured
      if (pinSet && settings.lockEnabled) {
        setIsLocked(true);
      }
      setParentalReady(true);
    })();
  }, []);

  // Lock after 2 minutes in background
  useEffect(() => {
    if (!parentalReady) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        bgTimestamp.current = Date.now();
      } else if (state === 'active') {
        if (bgTimestamp.current !== null && isPinSet && lockEnabled) {
          const elapsed = Date.now() - bgTimestamp.current;
          if (elapsed >= LOCK_TIMEOUT_MS) {
            setIsLocked(true);
          }
        }
        bgTimestamp.current = null;
      }
    });
    return () => sub.remove();
  }, [parentalReady, isPinSet, lockEnabled]);

  const unlockApp = useCallback(async (pin: string) => {
    const ok = await StorageService.verifyPin(pin);
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const verifyPin = useCallback(async (pin: string) => {
    return StorageService.verifyPin(pin);
  }, []);

  const setPin = useCallback(
    async (newPin: string, currentPin?: string) => {
      if (isPinSet && currentPin !== undefined) {
        const ok = await StorageService.verifyPin(currentPin);
        if (!ok) return false;
      }
      await StorageService.setPin(newPin);
      setIsPinSet(true);
      return true;
    },
    [isPinSet],
  );

  const disablePin = useCallback(async (currentPin: string) => {
    const ok = await StorageService.verifyPin(currentPin);
    if (!ok) return false;
    await StorageService.clearPin();
    setIsPinSet(false);
    setIsLocked(false);
    const settings = await StorageService.getParentalSettings();
    await StorageService.saveParentalSettings({ ...settings, lockEnabled: false });
    setLockEnabledState(false);
    return true;
  }, []);

  const setLockEnabled = useCallback(async (enabled: boolean) => {
    const settings = await StorageService.getParentalSettings();
    await StorageService.saveParentalSettings({ ...settings, lockEnabled: enabled });
    setLockEnabledState(enabled);
    if (!enabled) setIsLocked(false);
  }, []);

  const setMaxRating = useCallback(async (rating: MaxRating) => {
    const settings = await StorageService.getParentalSettings();
    await StorageService.saveParentalSettings({ ...settings, maxRating: rating });
    setMaxRatingState(rating);
  }, []);

  const toggleBlockedChannel = useCallback(async (channelId: string) => {
    const settings = await StorageService.getParentalSettings();
    const current = settings.blockedChannels ?? [];
    const updated = current.includes(channelId)
      ? current.filter((id) => id !== channelId)
      : [...current, channelId];
    await StorageService.saveParentalSettings({ ...settings, blockedChannels: updated });
    setBlockedChannels(updated);
  }, []);

  return (
    <ParentalContext.Provider
      value={{
        parentalReady,
        isPinSet,
        isLocked,
        maxRating,
        lockEnabled,
        blockedChannels,
        unlockApp,
        verifyPin,
        setPin,
        disablePin,
        setLockEnabled,
        setMaxRating,
        toggleBlockedChannel,
        resetAndLogout: onForgotPin,
      }}
    >
      {children}
    </ParentalContext.Provider>
  );
}

export function useParentalContext() {
  return useContext(ParentalContext);
}

// ── Rating helpers ──────────────────────────────────────────────────────────

export const RATING_OPTIONS: { value: MaxRating; label: string }[] = [
  { value: 'all', label: 'All content' },
  { value: '7',   label: '7+ (Young children)' },
  { value: '12',  label: '12+ (Pre-teens)' },
  { value: '16',  label: '16+ (Teens)' },
  { value: '18',  label: '18+ (Adults only)' },
];

/**
 * Returns true when the content should be hidden entirely based on the
 * user's chosen ceiling.  The `rating` field is treated as a numeric
 * age-band (e.g. 7, 12, 16, 18).  Non-numeric ratings always pass through.
 */
export function isContentBlocked(rating: string | undefined, maxRating: MaxRating): boolean {
  if (maxRating === 'all' || !rating) return false;
  const r = parseFloat(rating);
  if (isNaN(r)) return false;
  return r > parseInt(maxRating, 10);
}
