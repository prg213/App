import AsyncStorage from '@react-native-async-storage/async-storage';

const MAC_KEY = 'streamvault_device_mac';

function generateMac(): string {
  const hex = '0123456789ABCDEF';
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const seed = (Date.now() * (i + 1)) % 256;
    const h1 = hex[Math.floor(Math.random() * 16)];
    const h2 = hex[Math.floor((seed + Math.random() * 16)) % 16];
    parts.push(h1 + h2);
  }
  return parts.join(':');
}

let cached: string | null = null;

export async function getDeviceMac(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(MAC_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
    const mac = generateMac();
    await AsyncStorage.setItem(MAC_KEY, mac);
    cached = mac;
    return mac;
  } catch {
    const mac = generateMac();
    cached = mac;
    return mac;
  }
}
