/**
 * In-app updater — checks GitHub releases for a newer build and returns
 * metadata the UpdateModal uses to drive the download + install flow.
 *
 * Build number is baked in at CI time via EXPO_PUBLIC_BUILD_NUMBER
 * (set to github.run_number). When running from source (dev) the value
 * is "0" so no update prompt appears.
 */

const REPO = 'prg213/App';
const APK_NAME = 'StreamVault.apk';

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
    const asset = (data.assets as any[])?.find(
      (a) => (a.name as string).toLowerCase() === APK_NAME.toLowerCase(),
    );
    const downloadUrl: string =
      asset?.browser_download_url ??
      `https://github.com/${REPO}/releases/latest/download/${APK_NAME}`;

    return {
      buildNumber: latestBuild,
      releaseName: (data.name as string) ?? `StreamVault v${latestBuild}`,
      downloadUrl,
      body: (data.body as string) ?? '',
    };
  } catch {
    return null;
  }
}
