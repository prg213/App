const {
  createRunOncePlugin,
  withGradleProperties,
} = require('expo/config-plugins');

const PLUGIN_NAME = 'withStreamVaultReleaseAbis';

/**
 * Keep both physical ARM architectures in one universal APK so the same
 * StreamVault.apk can install on Fire TV and Android mobile devices.
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

  return config;
}

module.exports = createRunOncePlugin(withReleaseAbis, PLUGIN_NAME, '1.3.0');