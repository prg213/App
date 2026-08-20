const appConfig = require('./app.json');

function androidVersionCode() {
  const requestedBuild = Number(process.env.EXPO_PUBLIC_BUILD_NUMBER ?? 1);

  // Android rejects a package whose install version is lower than the version
  // already on the device. GitHub run numbers are monotonically increasing,
  // so they make a suitable release version while local/dev builds retain 1.
  return Number.isSafeInteger(requestedBuild) && requestedBuild > 0
    ? requestedBuild
    : 1;
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    versionCode: androidVersionCode(),
  },
});