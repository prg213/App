import AsyncStorage from '@react-native-async-storage/async-storage';

const MAC_KEY = 'streamvault_device_mac';

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

export async function getDeviceMac(): Promise<string> {
  // 1. Return in-memory cache if already loaded this session
  if (cached) return cached;

  // 2. Try to read from persistent storage
  const stored = await tryRead();
  if (stored) {
    cached = stored;
    return stored;
  }

  // 3. Nothing stored yet — generate, persist, and cache
  const mac = generateMac();
  cached = mac;
  await trySave(mac);

  // 4. Verify the write landed; if not, try once more
  const verify = await tryRead();
  if (!verify) {
    await trySave(mac);
  }

  return mac;
}
