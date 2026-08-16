const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const _rr = config.resolver && config.resolver.resolveRequest;
config.resolver = config.resolver || {};

// Block Metro from watching Xcode user-data directories that may not exist on
// disk (e.g. inside react-native-google-cast's ios/ tree). Without this,
// Metro crashes when it encounters a .xcworkspace that references a
// xcuserdata directory that was never checked in.
config.resolver.blockList = [
  /.*\/\.xcodeproj\/.*/,
  /.*\/xcuserdata\/.*/,
  /.*\.xcworkspace\/.*/,
];

config.resolver.resolveRequest = function (ctx, moduleName, platform) {
  if (moduleName === '@workspace/api-client-react') {
    return {
      filePath: path.resolve(__dirname, 'eas-stubs/api-client-react.ts'),
      type: 'sourceFile',
    };
  }
  if (_rr) return _rr(ctx, moduleName, platform);
  return ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
