import fs from 'fs';
import path from 'path';

jest.mock('react-native', () => ({ Platform: { OS: 'android', isTV: false } }));

import {
  ARM32_APK_NAME, ARM64_APK_NAME, FIRE_TV_APK_NAME, selectUpdateAsset,
} from '@/services/updateService';

const appRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.resolve(appRoot, '../../.github/workflows/build-android.yml'), 'utf8');
const appConfig = fs.readFileSync(path.resolve(appRoot, 'app.config.js'), 'utf8');
const abiPlugin = fs.readFileSync(path.resolve(appRoot, 'plugins/withReleaseAbis.js'), 'utf8');
const updateService = fs.readFileSync(path.resolve(appRoot, 'services/updateService.ts'), 'utf8');

describe('Android release packaging', () => {
  it('builds a compressed universal physical-ARM APK', () => {
    expect(appConfig).toContain('versionCode: androidVersionCode()');
    expect(abiPlugin).toContain('include "armeabi-v7a", "arm64-v8a"');
    expect(abiPlugin).toContain('universalApk true');
    expect(abiPlugin).toContain("key: 'expo.useLegacyPackaging'");
    expect(workflow).toContain('MAX_UNIVERSAL_APK_BYTES=$((150 * 1024 * 1024))');
    expect(workflow).toContain("tags:");
    expect(workflow).toContain("'android-candidate-*'");
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/android-candidate-')");
    expect(workflow).toContain('for ABI in armeabi-v7a arm64-v8a; do');
    expect(workflow).toContain('for VLC_LIBRARY in libvlc.so libvlcjni.so; do');
    expect(workflow).toContain('test "$COMPRESSION_METHOD" = "deflated"');
    expect(workflow).toContain('x86|x86_64');
  });

  it('validates APK identity, signer continuity, and VLC regression coverage', () => {
    expect(workflow).toContain('test "$VERSION_CODE" = "$GITHUB_RUN_NUMBER"');
    expect(workflow).toContain('test "$CANDIDATE_CERT_SHA256" = "$INSTALLED_CERT_SHA256"');
    expect(workflow).toContain('Android packaging and VLC MP2 regressions');
    expect(workflow).toContain('Full IPTV test suite');
  });

  it('only promotes the exact device-validated candidate', () => {
    expect(workflow).toContain('default: build-candidate');
    expect(workflow).toContain('Promote Device-Validated APK');
    expect(workflow).toContain('CANDIDATE_ARTIFACT_ID=');
    expect(workflow).toContain('actions/artifacts/${{ steps.candidate.outputs.artifact_id }}/zip');
    expect(workflow).toContain('This exact candidate was validated');
  });

  it('uses the universal asset for every Android updater target', () => {
    expect(updateService).toContain("? [FIRE_TV_APK_NAME, ARM64_APK_NAME, ARM32_APK_NAME]");
    const universal = [{ name: FIRE_TV_APK_NAME, browser_download_url: 'https://example.com/universal.apk' }];
    const arm64 = [{ name: ARM64_APK_NAME, browser_download_url: 'https://example.com/arm64.apk' }];
    const arm32 = [{ name: ARM32_APK_NAME, browser_download_url: 'https://example.com/arm32.apk' }];
    expect(selectUpdateAsset(universal, 'firetv')?.browser_download_url).toBe('https://example.com/universal.apk');
    expect(selectUpdateAsset(universal, 'android-mobile')?.browser_download_url).toBe('https://example.com/universal.apk');
    expect(selectUpdateAsset(arm64, 'android-mobile')?.browser_download_url).toBe('https://example.com/arm64.apk');
    expect(selectUpdateAsset(arm32)?.browser_download_url).toBe('https://example.com/arm32.apk');
  });
});