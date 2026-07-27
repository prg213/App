const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const _rr = config.resolver && config.resolver.resolveRequest;
config.resolver = config.resolver || {};
config.resolver.resolveRequest = function (ctx, moduleName, platform) {
  if (moduleName === '@workspace/api-client-react') {
    return {
      filePath: path.resolve(__dirname, 'eas-stubs/api-client-react.js'),
      type: 'sourceFile',
    };
  }
  if (_rr) return _rr(ctx, moduleName, platform);
  return ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
