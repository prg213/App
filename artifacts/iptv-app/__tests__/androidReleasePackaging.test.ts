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

  it('builds one universal ARM APK for all supported Android devices', () => {
    expect(abiPlugin).toContain('include "armeabi-v7a", "arm64-v8a"');
    expect(abiPlugin).toContain('universalApk true');
    expect(workflow).toContain('find "$OUTPUT_DIR" -name \'*universal*release.apk\'');
    expect(workflow).toContain('cp "$UNIVERSAL_APK" StreamVault.apk');
    expect(workflow).not.toContain('StreamVault-armeabi-v7a.apk');
    expect(workflow).not.toContain('StreamVault-arm64-v8a.apk');
  });

  it('excludes emulator libraries from the universal release APK', () => {
    expect(abiPlugin).toContain('withGradleProperties');
    expect(abiPlugin).toContain("key: 'reactNativeArchitectures'");
    expect(abiPlugin).toContain("value: 'armeabi-v7a,arm64-v8a'");
    expect(abiPlugin).toContain('abiFilters "armeabi-v7a", "arm64-v8a"');
  });

  it('uses the universal APK as the single in-app update asset', () => {
    expect(updateService).toContain("export const FIRE_TV_APK_NAME = 'StreamVault.apk'");
    expect(updateService).toContain(": [FIRE_TV_APK_NAME, ARM32_APK_NAME]");
    expect(updateService).toContain("Platform.OS === 'android' && !Platform.isTV");
    expect(workflow).toContain('**All Android and Fire TV devices:** Download StreamVault.apk.');
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