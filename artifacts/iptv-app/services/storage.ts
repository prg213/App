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
// Exported so tests can iterate the full key list and catch any key added to
// KEYS that is missing from clearCredentials.
export const KEYS = {
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
  PREF_SEARCH_TYPE: 'sv_pref_search_type',
  PREF_SEARCH_QUERY: 'sv_pref_search_query',
  BACKFILL_TS: 'sv_backfill_ts',
  RECENT_SEARCHES: 'sv_recent_searches',
  // Written just before a forced logout so the activation screen can show
  // a one-time explanation banner. Intentionally NOT cleared in clearCredentials
  // so it survives the logout and is readable on first render of activation.
  LOGOUT_REASON: 'sv_logout_reason',
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
      KEYS.REMINDERS,
      KEYS.PREF_AUDIO_LANG,
      KEYS.PREF_SUBTITLE_LANG,
      KEYS.PREF_REMINDER_LEAD_MINS,
      KEYS.PREF_SEARCH_TYPE,
      KEYS.PREF_SEARCH_QUERY, // #122: clear saved search query on logout
      KEYS.BACKFILL_TS,
      KEYS.RECENT_SEARCHES,  // #122: also clear recent search history on logout
      // NOTE: LOGOUT_REASON is intentionally excluded — it must survive logout
      // so the activation screen can display a one-time explanation banner.
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
  async moveMovieToTop(id: string): Promise<FavoriteMovie[] | null> {
    const current = await StorageService.getMovieFavorites();
    const idx = current.findIndex((f) => f.id === id);
    if (idx <= 0) return null; // already at top or not found
    const item = current[idx];
    const updated = [item, ...current.slice(0, idx), ...current.slice(idx + 1)];
    await AsyncStorage.setItem(KEYS.MOVIE_FAVORITES, JSON.stringify(updated));
    return updated;
  },

  async moveSeriesToTop(id: string): Promise<FavoriteSeries[] | null> {
    const current = await StorageService.getSeriesFavorites();
    const idx = current.findIndex((f) => f.id === id);
    if (idx <= 0) return null;
    const item = current[idx];
    const updated = [item, ...current.slice(0, idx), ...current.slice(idx + 1)];
    await AsyncStorage.setItem(KEYS.SERIES_FAVORITES, JSON.stringify(updated));
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

  /**
   * Removes all history entries that belong to a given series (matched by
   * parentId OR id).  Use this instead of removeFromHistory when removing a
   * series from the Recently Watched grid, because individual episode entries
   * are stored with their own id and a separate parentId pointing to the series.
   */
  async removeSeriesFromHistory(seriesId: string): Promise<void> {
    const history = await StorageService.getWatchHistory();
    const updated = history.filter(
      (h) => h.parentId !== seriesId && h.id !== seriesId,
    );
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

  /** Remove a single channel from the recently-watched list by ID. */
  async removeFromRecentChannels(id: string): Promise<void> {
    const current = await StorageService.getRecentChannels();
    const updated = current.filter((c) => c.id !== id);
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

  /**
   * Partially updates a stored reminder by merging the given patch into the
   * existing entry.  No-ops silently if the id is not found.
   */
  async updateReminder(id: string, patch: Partial<Reminder>): Promise<void> {
    const current = await StorageService.getReminders();
    const updated = current.map((r) => (r.id === id ? { ...r, ...patch } : r));
    await AsyncStorage.setItem(KEYS.REMINDERS, JSON.stringify(updated));
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
      return removed.map((r) => r.programTitle ?? r.channelName ?? 'Unknown');
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

  // ── Preferred search type (AsyncStorage) ──────────────────────────────────

  /**
   * Returns the last-used search filter ('all' | 'live' | 'movies' | 'series').
   * Defaults to 'all' if no preference has been saved yet.
   */
  async getPrefSearchType(): Promise<'all' | 'live' | 'movies' | 'series'> {
    try {
      const val = await AsyncStorage.getItem(KEYS.PREF_SEARCH_TYPE);
      if (val === 'all' || val === 'live' || val === 'movies' || val === 'series') return val;
    } catch {}
    return 'all';
  },

  /** Persists the user's chosen search filter type. */
  async setPrefSearchType(type: 'all' | 'live' | 'movies' | 'series'): Promise<void> {
    await AsyncStorage.setItem(KEYS.PREF_SEARCH_TYPE, type);
  },

  // ── Preferred search query (AsyncStorage) ─────────────────────────────────

  /** Returns the last search query the user typed, or empty string. */
  async getPrefSearchQuery(): Promise<string> {
    try {
      return (await AsyncStorage.getItem(KEYS.PREF_SEARCH_QUERY)) ?? '';
    } catch { return ''; }
  },

  /** Persists the search query; clears the key when query is empty. */
  async setPrefSearchQuery(q: string): Promise<void> {
    try {
      if (q) {
        await AsyncStorage.setItem(KEYS.PREF_SEARCH_QUERY, q);
      } else {
        await AsyncStorage.removeItem(KEYS.PREF_SEARCH_QUERY);
      }
    } catch {}
  },

  // ── Logout reason (AsyncStorage) ──────────────────────────────────────────

  /** Persists the reason for a forced logout so the activation screen can show
   *  a one-time explanation. Call before clearing credentials. */
  async saveLogoutReason(reason: string): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.LOGOUT_REASON, reason);
    } catch {}
  },

  /** Returns the pending logout reason (if any) and clears it immediately so
   *  the banner is shown only once. */
  async consumeLogoutReason(): Promise<string | null> {
    try {
      const val = await AsyncStorage.getItem(KEYS.LOGOUT_REASON);
      if (val) await AsyncStorage.removeItem(KEYS.LOGOUT_REASON);
      return val;
    } catch {
      return null;
    }
  },

  // ── Backfill timestamp (AsyncStorage) ─────────────────────────────────────

  /**
   * Returns the epoch-ms timestamp of the last successful stream-URL backfill,
   * or 0 if none has been recorded yet.
   */
  async getLastBackfillTs(): Promise<number> {
    try {
      const val = await AsyncStorage.getItem(KEYS.BACKFILL_TS);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  },

  /** Persists the current time as the last backfill timestamp. */
  async setLastBackfillTs(ts: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.BACKFILL_TS, String(ts));
  },

  // ── Recent searches ────────────────────────────────────────────────────────
  async getRecentSearches(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(KEYS.RECENT_SEARCHES);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  },

  /** Prepends `query` to the recent-search list, deduplicating and capping at 10. */
  async addRecentSearch(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return;
    try {
      const existing = await this.getRecentSearches();
      const updated = [q, ...existing.filter((s) => s !== q)].slice(0, 10);
      await AsyncStorage.setItem(KEYS.RECENT_SEARCHES, JSON.stringify(updated));
    } catch {}
  },

  async clearRecentSearches(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.RECENT_SEARCHES);
  },

  async removeRecentSearch(query: string): Promise<void> {
    try {
      const existing = await this.getRecentSearches();
      await AsyncStorage.setItem(KEYS.RECENT_SEARCHES, JSON.stringify(existing.filter((s) => s !== query)));
    } catch {}
  },
};
