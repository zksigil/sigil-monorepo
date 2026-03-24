const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
const moproModulePath = path.resolve(projectRoot, 'modules/mopro');

const config = getDefaultConfig(projectRoot);

// Watch the local mopro module so Metro picks up changes
config.watchFolders = [...(config.watchFolders ?? []), moproModulePath];

module.exports = withNativeWind(config, {
  input: './global.css',
});
