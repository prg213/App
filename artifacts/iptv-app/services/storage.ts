import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Credentials, FavoriteChannel, FavoriteMovie, FavoriteSeries, ParentalSettings, RecentChannel, WatchHistoryEntry } from '@/types';

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
  PREF_AUDIO_LANG: 'sv_pref_audio_lang',
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
      return data
        ? { blockedChannels: [], ...(JSON.parse(data) as ParentalSettings) }
        : { maxRating: 'all', lockEnabled: false, blockedChannels: [] };
    } catch {
      return { maxRating: 'all', lockEnabled: false, blockedChannels: [] };
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
};
