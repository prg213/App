import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Credentials, FavoriteChannel, WatchHistoryEntry } from '@/types';

const KEYS = {
  CREDENTIALS: 'sv_credentials',
  FAVORITES: 'sv_favorites',
  HISTORY: 'sv_history',
  CHANNELS_CACHE: 'sv_channels_cache',
  MOVIES_CACHE: 'sv_movies_cache',
};

export const StorageService = {
  // Credentials
  async saveCredentials(creds: Credentials): Promise<void> {
    await AsyncStorage.setItem(KEYS.CREDENTIALS, JSON.stringify(creds));
  },
  async getCredentials(): Promise<Credentials | null> {
    try {
      const data = await AsyncStorage.getItem(KEYS.CREDENTIALS);
      return data ? (JSON.parse(data) as Credentials) : null;
    } catch {
      return null;
    }
  },
  async clearCredentials(): Promise<void> {
    await AsyncStorage.multiRemove([
      KEYS.CREDENTIALS,
      KEYS.FAVORITES,
      KEYS.HISTORY,
      KEYS.CHANNELS_CACHE,
      KEYS.MOVIES_CACHE,
    ]);
  },

  // Favorites
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

  // Watch history
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
};
