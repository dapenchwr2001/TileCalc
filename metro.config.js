const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude files that trigger unwanted re-bundles
config.resolver.blockList = [
  /.*\.git\/.*/,
  /.*\.expo\/.*/,
  /.*android\/app\/build\/.*/,
  /.*android\/build\/.*/,
  /expo-env\.d\.ts$/,  // This file gets regenerated and triggers re-bundles
];

// Disable file watching entirely for certain patterns
config.watcher = {
  ...config.watcher,
  additionalExts: [],
};

module.exports = config;
