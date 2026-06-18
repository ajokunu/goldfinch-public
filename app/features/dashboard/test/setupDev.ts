/**
 * Side-effect import that must come FIRST in any test file whose import
 * graph reaches src/lib/logger.ts: the logger evaluates `!__DEV__` at module
 * initialization, and node has no React Native __DEV__ global. CommonJS
 * emit preserves import order, so this assignment runs before the logger
 * module body.
 */
(globalThis as { __DEV__?: boolean }).__DEV__ = true;

export {};
