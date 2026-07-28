/**
 * Stable device MAC for StreamVault.
 *
 * Priority:
 *  1. SecureStore (Android Keystore) — survives app updates as long as the
 *     signing key stays the same. Only cleared on full uninstall / "Clear Data".
 *  2. Random — generated once on first launch and immediately stored.
 *     Never derived from Android ID (which is signing-key-scoped and would
 *     produce a different value if the APK is signed with a new certificate).
 *
 * A MAC changing on reinstall (after uninstall) is intentional: the user
 * must re-activate, which is correct behaviour for a licensed IPTV app.
 */

import * as SecureStore from 'expo-secure-store';

const SECURE_MAC_KEY = 'sv_device_mac';

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

  // 2. SecureStore — persists across app updates (same signing key)
  const stored = await readSecure();
  if (stored) {
    cached = stored;
    return stored;
  }

  // 3. First launch — generate random MAC and persist it
  const mac = randomMac();
  cached = mac;
  await writeSecure(mac);
  return mac;
}
