/**
 * Babel config. Reanimated 4 (PHASE9-DECISIONS P9-3) requires the
 * react-native-worklets babel plugin so worklets compile for the UI thread.
 *
 * babel-preset-expo (SDK 54) would auto-inject that plugin when
 * react-native-worklets is installed; we disable the auto-injection
 * (worklets/reanimated: false) and list the plugin explicitly below so this
 * file is the single visible source of worklet configuration and the plugin
 * can never be applied twice.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { worklets: false, reanimated: false }]],
    // Must stay the LAST entry in this list (worklets plugin contract).
    plugins: ['react-native-worklets/plugin'],
  };
};
