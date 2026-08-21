import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const MAC_KEY = 'streamvault_device_mac';
// Legacy key used by builds that switched to SecureStore — migrated on first read
const LEGACY_SECURE_KEY = 'sv_device_mac';

function generateMac(): string {
  const hex = '0123456789ABCDEF';
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push(
      hex[Math.floor(Math.random() * 16)] +
      hex[Math.floor(Math.random() * 16)],
    );
  }
  return parts.join(':');
}

// In-memory cache — stable for the lifetime of the JS runtime
let cached: string | null = null;

async function tryRead(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(MAC_KEY);
  } catch {
    return null;
  }
}

async function trySave(mac: string): Promise<void> {
  try {
    await AsyncStorage.setItem(MAC_KEY, mac);
  } catch {
    // best-effort; cached still prevents regeneration within this session
  }
}

async function migrateFromSecureStore(): Promise<string | null> {
  // One-time migration: if a previous build stored the MAC in SecureStore,
  // move it to AsyncStorage so we don't lose it on the first launch after update.
  try {
    const legacy = await SecureStore.getItemAsync(LEGACY_SECURE_KEY);
    if (legacy) {
      await trySave(legacy);
      await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY).catch(() => {});
      return legacy;
    }
  } catch {
    // SecureStore unavailable or key absent — not an error
  }
  return null;
}

export async function getDeviceMac(): Promise<string> {
  // 1. Return in-memory cache if already loaded this session
  if (cached) return cached;

  // 2. Try AsyncStorage (primary store)
  const stored = await tryRead();
  if (stored) {
    cached = stored;
    return stored;
  }

  // 3. One-time migration from legacy SecureStore builds
  const migrated = await migrateFromSecureStore();
  if (migrated) {
    cached = migrated;
    return migrated;
  }

  // 4. Nothing stored — generate, persist, and cache
  const mac = generateMac();
  cached = mac;
  await trySave(mac);

  // Verify the write landed; if not, try once more
  const verify = await tryRead();
  if (!verify) {
    await trySave(mac);
  }

  return mac;
}

export async function clearDeviceMac(): Promise<void> {
  cached = null;
  try {
    await AsyncStorage.removeItem(MAC_KEY);
  } catch {
    // best-effort
  }
}
