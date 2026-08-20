const {
  createRunOncePlugin,
  withAppBuildGradle,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Produce one universal APK containing the two physical ARM architectures.
 * This intentionally trades APK size for a single download that works on both
 * 32-bit Fire TV userspaces and arm64 Android phones.
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
            universalApk true
        }
    }
}
// @generated end ${PLUGIN_NAME}
`;

    return config;
  });
}

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.0.0');