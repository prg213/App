import fs from 'fs';
import path from 'path';

jest.mock('react-native', () => ({
  Platform: { OS: 'android', isTV: false },
}));

import {
  ARM32_APK_NAME,
  ARM64_APK_NAME,
  FIRE_TV_APK_NAME,
  selectUpdateAsset,
} from '@/services/updateService';

const appRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.resolve(appRoot, '../../.github/workflows/build-android.yml'), 'utf8');
const appConfig = fs.readFileSync(path.resolve(appRoot, 'app.config.js'), 'utf8');
const abiPlugin = fs.readFileSync(path.resolve(appRoot, 'plugins/withReleaseAbis.js'), 'utf8');
const updateService = fs.readFileSync(path.resolve(appRoot, 'services/updateService.ts'), 'utf8');

describe('Android release packaging', () => {
  it('uses the CI build number as Android’s monotonically increasing version code', () => {
    expect(appConfig).toContain('process.env.EXPO_PUBLIC_BUILD_NUMBER');
    expect(appConfig).toContain('versionCode: androidVersionCode()');
  });

  it('builds compact ARM split APKs for Fire TV and mobile devices', () => {
    expect(abiPlugin).toContain('include "armeabi-v7a", "arm64-v8a"');
    expect(abiPlugin).toContain('universalApk false');
    expect(workflow).toContain('find "$OUTPUT_DIR" -name \'*armeabi-v7a*release.apk\'');
    expect(workflow).toContain('find "$OUTPUT_DIR" -name \'*arm64-v8a*release.apk\'');
    expect(workflow).toContain('cp "$ARM32_APK" StreamVault.apk');
    expect(workflow).toContain('cp "$ARM32_APK" StreamVault-armeabi-v7a.apk');
    expect(workflow).toContain('cp "$ARM64_APK" StreamVault-arm64-v8a.apk');
  });

  it('excludes emulator libraries from compact release APKs', () => {
    expect(abiPlugin).toContain('withGradleProperties');
    expect(abiPlugin).toContain("key: 'reactNativeArchitectures'");
    expect(abiPlugin).toContain("value: 'armeabi-v7a,arm64-v8a'");
    expect(abiPlugin).not.toContain('abiFilters');
  });

  it('uses the compact Fire TV APK and publishes a compact arm64 mobile asset', () => {
    expect(updateService).toContain("export const FIRE_TV_APK_NAME = 'StreamVault.apk'");
    expect(updateService).toContain(": [FIRE_TV_APK_NAME, ARM32_APK_NAME]");
    expect(updateService).toContain("Platform.OS === 'android' && !Platform.isTV");
    expect(workflow).toContain('**Fire TV and older Android:** Download StreamVault.apk.');
    expect(workflow).toContain('**Modern 64-bit Android:** StreamVault-arm64-v8a.apk is also available.');
  });

  it('never sends a 32-bit Fire TV updater to an arm64-only release asset', () => {
    const arm64Only = [{ name: ARM64_APK_NAME, browser_download_url: 'https://example.com/arm64.apk' }];
    const arm32 = [{ name: ARM32_APK_NAME, browser_download_url: 'https://example.com/arm32.apk' }];
    const generic = [{ name: FIRE_TV_APK_NAME, browser_download_url: 'https://example.com/fire-tv.apk' }];

    expect(selectUpdateAsset(arm64Only)).toBeUndefined();
    expect(selectUpdateAsset(arm32)?.browser_download_url).toBe('https://example.com/arm32.apk');
    expect(selectUpdateAsset(generic)?.browser_download_url).toBe('https://example.com/fire-tv.apk');
  });

  it('selects the arm64 release asset for modern Android mobile updates', () => {
    const arm64 = [{ name: ARM64_APK_NAME, browser_download_url: 'https://example.com/arm64.apk' }];
    const arm32 = [{ name: ARM32_APK_NAME, browser_download_url: 'https://example.com/arm32.apk' }];
    const universal = [{ name: FIRE_TV_APK_NAME, browser_download_url: 'https://example.com/universal.apk' }];
    const both = [
      { name: FIRE_TV_APK_NAME, browser_download_url: 'https://example.com/fire-tv.apk' },
      { name: ARM64_APK_NAME, browser_download_url: 'https://example.com/arm64.apk' },
    ];

    expect(selectUpdateAsset(arm64, 'android-mobile')?.browser_download_url)
      .toBe('https://example.com/arm64.apk');
    expect(selectUpdateAsset(both, 'android-mobile')?.browser_download_url)
      .toBe('https://example.com/arm64.apk');
    expect(selectUpdateAsset(arm32, 'android-mobile')?.browser_download_url)
      .toBe('https://example.com/arm32.apk');
    expect(selectUpdateAsset(universal, 'android-mobile')?.browser_download_url)
      .toBe('https://example.com/universal.apk');
    expect(selectUpdateAsset(universal, 'firetv')?.browser_download_url)
      .toBe('https://example.com/universal.apk');
  });
});