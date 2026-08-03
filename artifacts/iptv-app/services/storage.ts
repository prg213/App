import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Credentials, FavoriteChannel, FavoriteMovie, FavoriteSeries, ParentalSettings, RecentChannel, Reminder, WatchHistoryEntry } from '@/types';

// Credentials live in SecureStore (Android Keystore / iOS Keychain).
// This survives Expo Go bundle reloads and Metro restarts — unlike AsyncStorage
// which can be wiped when Expo Go establishes a new development connection.
const SECURE_CREDS_KEY = 'sv_credentials';
// PIN also lives in SecureStore — never in AsyncStorage so it cannot be
// read without the device being unlocked (Android Keystore / iOS Keychain).
const SECURE_PIN_KEY = 'sv_pin';

// Everything else (favourites, history, cache) stays in AsyncStorage.
const KEYS = {
  FAVORITES: 'sv_favorites',
  MOVIE_FAVORITES: 'sv_movie_favorites',
  SERIES_FAVORITES: 'sv_series_favorites',
  HISTORY: 'sv_history',
  CHANNELS_CACHE: 'sv_channels_cache',
  MOVIES_CACHE: 'sv_movies_cache',
  PARENTAL: 'sv_parental',
  RECENT_CHANNELS: 'sv_recent_channels',
  REMINDERS: 'sv_reminders',
  PREF_AUDIO_LANG: 'sv_pref_audio_lang',
  PREF_SUBTITLE_LANG: 'sv_pref_subtitle_lang',
  PREF_REMINDER_LEAD_MINS: 'sv_pref_reminder_lead_mins',
};

export const StorageService = {
  // ── Credentials (SecureStore) ──────────────────────────────────────────────

  async saveCredentials(creds: Credentials): Promise<void> {
    await SecureStore.setItemAsync(SECURE_CREDS_KEY, JSON.stringify(creds));
  },

  async getCredentials(): Promise<Credentials | null> {
    try {
      const data = await SecureStore.getItemAsync(SECURE_CREDS_KEY);
      return data ? (JSON.parse(data) as Credentials) : null;
    } catch {
      return null;
    }
  },

  async clearCredentials(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(SECURE_CREDS_KEY);
    } catch {
      // ignore if key doesn't exist
    }
    await AsyncStorage.multiRemove([
      KEYS.FAVORITES,
      KEYS.MOVIE_FAVORITES,
      KEYS.SERIES_FAVORITES,
      KEYS.HISTORY,
      KEYS.CHANNELS_CACHE,
      KEYS.MOVIES_CACHE,
      KEYS.PARENTAL,
      KEYS.RECENT_CHANNELS,
      KEYS.PREF_AUDIO_LANG,
      KEYS.PREF_SUBTITLE_LANG,
    ]);
  },

  // ── PIN (SecureStore) ──────────────────────────────────────────────────────

  async setPin(pin: string): Promise<void> {
    await SecureStore.setItemAsync(SECURE_PIN_KEY, pin);
  },

  async getPin(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(SECURE_PIN_KEY);
    } catch {
      return null;
    }
  },

  async clearPin(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(SECURE_PIN_KEY);
    } catch {}
  },

  async verifyPin(pin: string): Promise<boolean> {
    const stored = await StorageService.getPin();
    return stored !== null && stored === pin;
  },

  // ── Parental settings (AsyncStorage) ──────────────────────────────────────

  async getParentalSettings(): Promise<ParentalSettings> {
    try {
      const data = await AsyncStorage.getItem(KEYS.PARENTAL);
      // Spread existing data over defaults so old stored data without blockedChannels
      // still gets a valid empty array rather than undefined.
      if (data) {
        const s = JSON.parse(data) as ParentalSettings;
        return { blockedChannels: [], blockedCategories: [], ...s };
      }
      return { maxRating: 'all', lockEnabled: false, blockedChannels: [], blockedCategories: [] };
    } catch {
      return { maxRating: 'all', lockEnabled: false, blockedChannels: [], blockedCategories: [] };
    }
  },

  async saveParentalSettings(settings: ParentalSettings): Promise<void> {
    await AsyncStorage.setItem(KEYS.PARENTAL, JSON.stringify(settings));
  },

  // ── Channel Favourites (AsyncStorage) ─────────────────────────────────────

  async getFavorites(): Promise<FavoriteChannel[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.FAVORITES);
      return data ? (JSON.parse(data) as FavoriteChannel[]) : [];
    } catch {
      return [];
    }
  },
  async saveFavorites(favorites: FavoriteChannel[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.FAVORITES, JSON.stringify(favorites));
  },
  async toggleFavorite(channel: FavoriteChannel): Promise<FavoriteChannel[]> {
    const current = await StorageService.getFavorites();
    const exists = current.find((f) => f.id === channel.id);
    const updated = exists
      ? current.filter((f) => f.id !== channel.id)
      : [channel, ...current];
    await StorageService.saveFavorites(updated);
    return updated;
  },

  // ── Movie Favourites (AsyncStorage) ───────────────────────────────────────

  async getMovieFavorites(): Promise<FavoriteMovie[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.MOVIE_FAVORITES);
      return data ? (JSON.parse(data) as FavoriteMovie[]) : [];
    } catch {
      return [];
    }
  },
  async saveMovieFavorites(favorites: FavoriteMovie[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.MOVIE_FAVORITES, JSON.stringify(favorites));
  },
  async toggleMovieFavorite(movie: FavoriteMovie): Promise<FavoriteMovie[]> {
    const current = await StorageService.getMovieFavorites();
    const exists = current.find((f) => f.id === movie.id);
    const updated = exists ? current.filter((f) => f.id !== movie.id) : [movie, ...current];
    await AsyncStorage.setItem(KEYS.MOVIE_FAVORITES, JSON.stringify(updated));
    return updated;
  },

  // ── Series Favourites (AsyncStorage) ──────────────────────────────────────

  async getSeriesFavorites(): Promise<FavoriteSeries[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.SERIES_FAVORITES);
      return data ? (JSON.parse(data) as FavoriteSeries[]) : [];
    } catch {
      return [];
    }
  },
  async saveSeriesFavorites(favorites: FavoriteSeries[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.SERIES_FAVORITES, JSON.stringify(favorites));
  },
  async toggleSeriesFavorite(series: FavoriteSeries): Promise<FavoriteSeries[]> {
    const current = await StorageService.getSeriesFavorites();
    const exists = current.find((f) => f.id === series.id);
    const updated = exists ? current.filter((f) => f.id !== series.id) : [series, ...current];
    await AsyncStorage.setItem(KEYS.SERIES_FAVORITES, JSON.stringify(updated));
    return updated;
  },

  // ── Watch history (AsyncStorage) ──────────────────────────────────────────

  async getWatchHistory(): Promise<WatchHistoryEntry[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.HISTORY);
      return data ? (JSON.parse(data) as WatchHistoryEntry[]) : [];
    } catch {
      return [];
    }
  },
  async addToHistory(entry: WatchHistoryEntry): Promise<void> {
    const history = await StorageService.getWatchHistory();
    const filtered = history.filter((h) => h.id !== entry.id);
    const updated = [entry, ...filtered].slice(0, 100);
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
  },

  async removeFromHistory(id: string): Promise<void> {
    const history = await StorageService.getWatchHistory();
    const updated = history.filter((h) => h.id !== id);
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify(updated));
  },

  async clearHistory(): Promise<void> {
    await AsyncStorage.setItem(KEYS.HISTORY, JSON.stringify([]));
  },

  // ── Recently watched channels (AsyncStorage) ───────────────────────────────

  async getRecentChannels(): Promise<RecentChannel[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.RECENT_CHANNELS);
      return data ? (JSON.parse(data) as RecentChannel[]) : [];
    } catch {
      return [];
    }
  },

  /**
   * Adds (or moves to the top) a channel in the recently-watched list.
   * Deduplicates by channel ID and retains at most 20 entries.
   */
  async addRecentChannel(ch: RecentChannel): Promise<void> {
    const current = await StorageService.getRecentChannels();
    const deduped = current.filter((c) => c.id !== ch.id);
    const updated = [{ ...ch, watchedAt: Date.now() }, ...deduped].slice(0, 20);
    await AsyncStorage.setItem(KEYS.RECENT_CHANNELS, JSON.stringify(updated));
  },

  // ── Reminders (AsyncStorage) ──────────────────────────────────────────────

  async getReminders(): Promise<Reminder[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.REMINDERS);
      return data ? (JSON.parse(data) as Reminder[]) : [];
    } catch { return []; }
  },

  async addReminder(reminder: Reminder): Promise<void> {
    const current = await StorageService.getReminders();
    const deduped = current.filter((r) => r.id !== reminder.id);
    await AsyncStorage.setItem(KEYS.REMINDERS, JSON.stringify([reminder, ...deduped]));
  },

  /**
   * Atomically replaces the entire reminders list in storage.
   * Use this when updating multiple reminders at once to avoid read-modify-write races.
   */
  async saveReminders(reminders: Reminder[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.REMINDERS, JSON.stringify(reminders));
  },

  async removeReminder(id: string): Promise<void> {
    const current = await StorageService.getReminders();
    await AsyncStorage.setItem(KEYS.REMINDERS, JSON.stringify(current.filter((r) => r.id !== id)));
  },

  async hasReminder(id: string): Promise<boolean> {
    const current = await StorageService.getReminders();
    return current.some((r) => r.id === id);
  },

  /**
   * #95/#101: Remove reminders whose programme ended more than `maxAgeMins`
   * minutes ago (default 24 h).  Returns the titles of every removed reminder
   * so the caller can notify the user if anything was pruned.
   */
  async pruneExpiredReminders(maxAgeMins = 24 * 60): Promise<string[]> {
    try {
      const current = await StorageService.getReminders();
      const cutoff = Date.now() - maxAgeMins * 60 * 1000;
      const kept = current.filter((r) => new Date(r.end).getTime() > cutoff);
      const removed = current.filter((r) => new Date(r.end).getTime() <= cutoff);
      if (removed.length > 0) {
        await AsyncStorage.setItem(KEYS.REMINDERS, JSON.stringify(kept));
      }
      return removed.map((r) => r.title ?? r.channelName ?? 'Unknown');
    } catch {
      return [];
    }
  },

  /** Returns the notificationId stored for the given reminder, or null. */
  async getReminderNotificationId(id: string): Promise<string | null> {
    const current = await StorageService.getReminders();
    return current.find((r) => r.id === id)?.notificationId ?? null;
  },

  // ── Preferred audio language (AsyncStorage) ────────────────────────────────

  /**
   * Returns the stored preferred audio language code (e.g. "en", "ar") or
   * null if no preference has been set.
   */
  async getPrefAudioLanguage(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(KEYS.PREF_AUDIO_LANG);
    } catch {
      return null;
    }
  },

  /** Persists the user's preferred audio language code. */
  async setPrefAudioLanguage(lang: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.PREF_AUDIO_LANG, lang);
  },

  /** Clears the preferred audio language so the stream default is used. */
  async clearPrefAudioLanguage(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEYS.PREF_AUDIO_LANG);
    } catch {}
  },

  // ── Clear recently-watched channels ───────────────────────────────────────
  async clearRecentChannels(): Promise<void> {
    await AsyncStorage.setItem(KEYS.RECENT_CHANNELS, JSON.stringify([]));
  },

  // ── Preferred subtitle language (AsyncStorage) ────────────────────────────
  async getPrefSubtitleLang(): Promise<string | null> {
    try { return await AsyncStorage.getItem(KEYS.PREF_SUBTITLE_LANG); } catch { return null; }
  },
  async setPrefSubtitleLang(lang: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.PREF_SUBTITLE_LANG, lang);
  },
  async clearPrefSubtitleLang(): Promise<void> {
    try { await AsyncStorage.removeItem(KEYS.PREF_SUBTITLE_LANG); } catch {}
  },

  // ── Reminder lead time preference (AsyncStorage) ───────────────────────────

  /**
   * Returns the stored reminder lead time in minutes (5, 10, or 15).
   * Defaults to 5 if no preference has been saved yet.
   */
  async getReminderLeadMins(): Promise<number> {
    try {
      const val = await AsyncStorage.getItem(KEYS.PREF_REMINDER_LEAD_MINS);
      if (val) {
        const n = parseInt(val, 10);
        if ([5, 10, 15].includes(n)) return n;
      }
    } catch {}
    return 5;
  },

  /** Persists the user's chosen reminder lead time (5, 10, or 15 minutes). */
  async setReminderLeadMins(mins: 5 | 10 | 15): Promise<void> {
    await AsyncStorage.setItem(KEYS.PREF_REMINDER_LEAD_MINS, String(mins));
  },
};
