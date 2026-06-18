const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Prefer CJS ("require") over ESM ("import") when resolving package exports.
// Several deps (zustand/middleware among them) ship ESM builds containing
// `import.meta`, which is a parse-time SyntaxError in Metro's classic-script
// web output and blanks the whole app. The CJS builds are semantically
// identical and import.meta-free.
config.resolver.unstable_conditionNames = ['browser', 'require', 'react-native'];

module.exports = config;
