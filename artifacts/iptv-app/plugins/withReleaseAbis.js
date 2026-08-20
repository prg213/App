const {
  createRunOncePlugin,
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Produce one universal APK containing the two physical ARM architectures.
 * This intentionally trades APK size for a single download that works on both
 * 32-bit Fire TV userspaces and arm64 Android phones.
 */
function withReleaseAbis(config) {
  config = withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => item.type !== 'property' || item.key !== 'reactNativeArchitectures',
    );
    config.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'armeabi-v7a,arm64-v8a',
    });
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(PLUGIN_NAME)) {
      return config;
    }

    config.modResults.contents = `${config.modResults.contents.trimEnd()}

// @generated begin ${PLUGIN_NAME} - do not modify
android {
    defaultConfig {
        // A universal APK otherwise also pulls the x86/x86_64 emulator
        // libraries from React Native and VLC. Fire TV and physical Android
        // phones are ARM devices, so retain only the two required ARM ABIs.
        ndk {
            abiFilters "armeabi-v7a", "arm64-v8a"
        }
    }
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

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.1.0');