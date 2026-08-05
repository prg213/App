// CJS stub for expo/virtual/env — used by jest only.
// babel-preset-expo rewrites process.env.EXPO_PUBLIC_* references into imports
// from this module. In a node test environment the real file uses ESM syntax
// which jest cannot parse, so we redirect it here via moduleNameMapper.
const env = process.env;
module.exports = { env };
