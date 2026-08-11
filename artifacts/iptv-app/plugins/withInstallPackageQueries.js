/**
 * Expo config plugin — adds <queries> entries needed for the in-app APK
 * installer on Android 11+ / Fire OS 7+.
 *
 * Without these entries the system considers the VIEW (package-archive) and
 * INSTALL_PACKAGE intents unresolvable at query time, so startActivityAsync()
 * silently fails and the APK never installs.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withInstallPackageQueries(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults;

    // Ensure the top-level <queries> element exists
    if (!manifest.manifest.queries) {
      manifest.manifest.queries = [];
    }

    const queries = manifest.manifest.queries;

    // Normalise: expo sometimes serialises queries as an object, sometimes
    // as an array.  Work with an array of intent objects.
    const queriesObj = Array.isArray(queries) ? queries[0] : queries;
    if (!queriesObj.intent) queriesObj.intent = [];

    const intents = queriesObj.intent;

    // Helper: check if an intent with a given action is already present
    const has = (action) =>
      intents.some((i) => i?.action?.some?.((a) => a?.$?.['android:name'] === action));

    // VIEW application/vnd.android.package-archive
    if (!has('android.intent.action.VIEW_APK')) {
      intents.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:mimeType': 'application/vnd.android.package-archive' } }],
      });
    }

    // INSTALL_PACKAGE
    if (!has('android.intent.action.INSTALL_PACKAGE')) {
      intents.push({
        action: [{ $: { 'android:name': 'android.intent.action.INSTALL_PACKAGE' } }],
      });
    }

    return c;
  });
};
