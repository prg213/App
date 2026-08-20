const {
  createRunOncePlugin,
  withAppBuildGradle,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Produce one compact APK per physical Android architecture. A universal APK
 * bundles VLC four times (including emulator-only x86 binaries), which is too
 * large for many Fire TV devices to stage during an update.
 */
function withReleaseAbis(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(PLUGIN_NAME)) {
      return config;
    }

    config.modResults.contents = `${config.modResults.contents.trimEnd()}

// @generated begin ${PLUGIN_NAME} - do not modify
android {
    splits {
        abi {
            enable true
            reset()
            include "armeabi-v7a", "arm64-v8a"
            universalApk false
        }
    }
}
// @generated end ${PLUGIN_NAME}
`;

    return config;
  });
}

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.0.0');