/**
 * In-app updater — checks GitHub releases for a newer build and returns
 * metadata the UpdateModal uses to drive the download + install flow.
 *
 * Build number is baked in at CI time via EXPO_PUBLIC_BUILD_NUMBER
 * (set to github.run_number). When running from source (dev) the value
 * is "0" so no update prompt appears.
 */
import { Platform } from 'react-native';

const REPO = 'prg213/App';
// The release workflow publishes this name as the compact armeabi-v7a APK.
// Fire TV devices support this ABI, including 64-bit models running a
// 32-bit Fire OS userspace. The named arm64 asset remains available for
// manual installs on modern Android devices.
export const FIRE_TV_APK_NAME = 'StreamVault.apk';
export const ARM32_APK_NAME = 'StreamVault-armeabi-v7a.apk';
export const ARM64_APK_NAME = 'StreamVault-arm64-v8a.apk';

export const CURRENT_BUILD = Number(process.env.EXPO_PUBLIC_BUILD_NUMBER ?? '0');

export interface UpdateInfo {
  /** The build number of the latest release (e.g. 138). */
  buildNumber: number;
  /** Human-readable release name, e.g. "StreamVault v138". */
  releaseName: string;
  /** Direct download URL for the APK asset. */
  downloadUrl: string;
  /** Release notes body (may be empty). */
  body: string;
}

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

export type UpdateTarget = 'firetv' | 'android-mobile';

export function selectUpdateAsset(
  assets: ReleaseAsset[] | undefined,
  target: UpdateTarget = 'firetv',
): ReleaseAsset | undefined {
  // Fire TV devices must stay on the generic ARM32 APK: some Fire TV models
  // run a 32-bit userspace and cannot install the arm64-only asset.
  //
  // Modern Android phones need the arm64 APK. Keep the ARM32 names as
  // fallbacks for older releases or partially published releases.
  const preferredNames = target === 'android-mobile'
    ? [ARM64_APK_NAME, ARM32_APK_NAME, FIRE_TV_APK_NAME]
    : [FIRE_TV_APK_NAME, ARM32_APK_NAME];
  return preferredNames
    .map((name) => assets?.find((asset) => asset.name?.toLowerCase() === name.toLowerCase()))
    .find((asset): asset is ReleaseAsset => Boolean(asset?.browser_download_url));
}

/**
 * Fetch the latest GitHub release and return UpdateInfo if it is newer
 * than the currently installed build, or null if already up to date /
 * no network / error.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // Never prompt in dev builds (build number == 0)
  if (CURRENT_BUILD === 0) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;

    const data = await res.json();
    // tag_name format: "build-137"
    const latestBuild = Number((data.tag_name as string)?.replace('build-', '') ?? '0');

    if (!latestBuild || latestBuild <= CURRENT_BUILD) return null;

    // Find the APK asset
    const target: UpdateTarget = Platform.OS === 'android' && !Platform.isTV
      ? 'android-mobile'
      : 'firetv';
    const asset = selectUpdateAsset(data.assets as ReleaseAsset[] | undefined, target);
    // Do not show an update until a compatible APK asset exists. A partially
    // published release must not send a device to a missing URL.
    if (!asset?.browser_download_url) return null;

    return {
      buildNumber: latestBuild,
      releaseName: (data.name as string) ?? `StreamVault v${latestBuild}`,
      downloadUrl: asset.browser_download_url,
      body: (data.body as string) ?? '',
    };
  } catch {
    return null;
  }
}
