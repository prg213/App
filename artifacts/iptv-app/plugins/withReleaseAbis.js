const {
  createRunOncePlugin,
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Produce compact APKs for the two physical ARM architectures. A universal
 * VLC APK is too large for some Fire TV devices to stage during installation.
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
            universalApk false
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