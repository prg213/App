import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAC_KEY = 'streamvault_device_mac';

/**
 * Derive a deterministic MAC from a seed string using a simple djb2 hash.
 * Same seed → always same MAC, no storage required.
 */
function deriveMacFromSeed(seed: string): string {
  // djb2 over the seed characters, producing 6 independent byte values
  const bytes: number[] = [];
  let hash = 5381;
  for (let b = 0; b < 6; b++) {
    hash = 0;
    for (let i = b; i < seed.length; i += 6) {
      hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
      hash = hash & 0xffffffff; // keep 32-bit
    }
    // Mix in the byte index so each octet differs even for short seeds
    hash = ((hash << 5) + hash) ^ (b * 31 + 7);
    bytes.push(Math.abs(hash) & 0xff);
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

function generateRandomMac(): string {
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

// In-memory cache — stable for the JS runtime lifetime
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
    // best-effort; deterministic derivation means we don't depend on this
  }
}

export async function getDeviceMac(): Promise<string> {
  // 1. In-memory cache (stable for this JS session)
  if (cached) return cached;

  // 2. Derive deterministically from the Android device ID — this is stable
  //    across JS reloads, Metro restarts, and Expo Go reconnections.
  //    It only changes if the app is uninstalled and reinstalled.
  try {
    const androidId = Application.getAndroidId?.() ?? Application.androidId ?? null;
    if (androidId) {
      const mac = deriveMacFromSeed(androidId);
      cached = mac;
      // Persist anyway so it's readable in Settings / debug screens
      await trySave(mac);
      return mac;
    }
  } catch {
    // expo-application unavailable or threw — fall through
  }

  // 3. Try AsyncStorage (covers iOS or cases where androidId wasn't available
  //    in a previous session but we saved a value then)
  const stored = await tryRead();
  if (stored) {
    cached = stored;
    return stored;
  }

  // 4. Last resort: random, persisted as best-effort
  const mac = generateRandomMac();
  cached = mac;
  await trySave(mac);
  return mac;
}
