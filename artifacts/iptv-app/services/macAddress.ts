/**
 * Stable device MAC for StreamVault.
 *
 * Priority:
 *  1. SecureStore (Android Keystore) — survives Expo Go reloads, Metro restarts.
 *     Only cleared on app uninstall or explicit "Clear Data".
 *  2. Android ID — hardware-level identifier tied to device + app signing key.
 *     Deterministically converted to a MAC so the same device always produces
 *     the same address with no storage required.
 *  3. Random fallback — generated once and immediately written to SecureStore.
 *
 * AsyncStorage is intentionally NOT used here: Expo Go can wipe it on reconnect.
 */

import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';

const SECURE_MAC_KEY = 'sv_device_mac';

/** djb2-based deterministic MAC from any seed string. */
function deriveMacFromSeed(seed: string): string {
  const bytes: number[] = [];
  for (let b = 0; b < 6; b++) {
    let hash = 5381 + b * 1000003;
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash, 31) ^ seed.charCodeAt(i);
    }
    // Mix the byte index in so adjacent bytes differ even for short seeds
    hash ^= (b + 1) * 2654435761;
    bytes.push(Math.abs(hash) & 0xff);
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

function randomMac(): string {
  const hex = '0123456789ABCDEF';
  return Array.from({ length: 6 }, () =>
    hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)],
  ).join(':');
}

/** In-memory cache — stable for the JS runtime lifetime. */
let cached: string | null = null;

async function readSecure(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(SECURE_MAC_KEY); } catch { return null; }
}

async function writeSecure(mac: string): Promise<void> {
  try { await SecureStore.setItemAsync(SECURE_MAC_KEY, mac); } catch { /* best-effort */ }
}

export async function getDeviceMac(): Promise<string> {
  // 1. In-memory cache
  if (cached) return cached;

  // 2. SecureStore — most reliable across Expo Go reloads
  const stored = await readSecure();
  if (stored) {
    cached = stored;
    return stored;
  }

  // 3. Android hardware ID → deterministic MAC (same device = same MAC forever)
  try {
    const androidId: string | null = Application.getAndroidId();
    if (androidId && androidId.length > 0) {
      const mac = deriveMacFromSeed(androidId);
      cached = mac;
      await writeSecure(mac);
      return mac;
    }
  } catch {
    // getAndroidId unavailable on this platform/build — fall through
  }

  // 4. Random fallback — written to SecureStore immediately so it never changes
  const mac = randomMac();
  cached = mac;
  await writeSecure(mac);
  return mac;
}
