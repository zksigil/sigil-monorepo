module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          jsxImportSource: 'nativewind',
          unstable_transformImportMeta: true,
        },
      ],
      'nativewind/babel',
    ],
    plugins: [
      // react-native-worklets/plugin MUST be last (replaces react-native-reanimated/plugin in v4)
      'react-native-worklets/plugin',
    ],
  };
};
