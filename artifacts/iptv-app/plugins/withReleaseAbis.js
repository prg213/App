const {
  createRunOncePlugin,
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Produce one universal physical-ARM APK. VLC is required on both Fire TV and
 * Android phones for IPTV MP2 streams, so its native libraries must be present
 * for both ABIs. Legacy JNI packaging compresses those libraries in the APK,
 * keeping the single download below the Fire TV staging limit.
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

  config = withAppBuildGradle(config, (config) => {
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
    packagingOptions {
        jniLibs {
            useLegacyPackaging true
        }
    }
}
// @generated end ${PLUGIN_NAME}
`;

    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.2.0');