/**
 * Stable device MAC for StreamVault.
 *
 * Priority:
 *  1. SecureStore — persists across app updates (signing key unchanged).
 *     Cleared only on full uninstall or "Clear Data".
 *  2. Android ID — scoped to (device × signing key). With a persistent
 *     keystore, this is stable forever on the same device, including after
 *     a reinstall. Only changes on factory reset.
 *  3. Random fallback — written to SecureStore immediately so it is stable
 *     for the lifetime of that install.
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

let cached: string | null = null;

async function readSecure(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(SECURE_MAC_KEY); } catch { return null; }
}

async function writeSecure(mac: string): Promise<void> {
  try { await SecureStore.setItemAsync(SECURE_MAC_KEY, mac); } catch { /* best-effort */ }
}

export async function getDeviceMac(): Promise<string> {
  if (cached) return cached;

  // 1. SecureStore — most stable across Expo Go reloads and app updates
  const stored = await readSecure();
  if (stored) { cached = stored; return stored; }

  // 2. Android ID — deterministic per device + signing key.
  //    Stable across reinstalls as long as the signing key doesn't change.
  try {
    const androidId: string | null = Application.getAndroidId();
    if (androidId && androidId.length > 0) {
      const mac = deriveMacFromSeed(androidId);
      cached = mac;
      await writeSecure(mac);
      return mac;
    }
  } catch { /* fall through */ }

  // 3. Random fallback — persisted immediately so it never changes this install
  const mac = randomMac();
  cached = mac;
  await writeSecure(mac);
  return mac;
}
