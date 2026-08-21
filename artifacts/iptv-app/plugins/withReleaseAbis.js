const {
  createRunOncePlugin,
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

function withReleaseAbis(config) {
  config = withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter((item) =>
      item.type !== 'property'
      || (item.key !== 'reactNativeArchitectures' && item.key !== 'expo.useLegacyPackaging'),
    );
    config.modResults.push(
      { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a' },
      { type: 'property', key: 'expo.useLegacyPackaging', value: 'true' },
    );
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(PLUGIN_NAME)) return config;
    config.modResults.contents = `${config.modResults.contents.trimEnd()}

// @generated begin ${PLUGIN_NAME} - do not modify
android {
    splits {
        abi {
            enable false
        }
    }
}
// @generated end ${PLUGIN_NAME}
`;
    return config;
  });
}

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.3.0');