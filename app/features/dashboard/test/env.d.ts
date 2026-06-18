/**
 * The node:test harness compiles src/lib/logger.ts (labels.ts imports it),
 * which reads the React Native global __DEV__. The harness program loads
 * only @types/node, so the global is declared here; test/setupDev.ts assigns
 * it before the logger module initializes. Matches the expo/react-native
 * declaration (`var __DEV__: boolean`), so the app typecheck (which sees
 * both) merges them without conflict.
 */
declare var __DEV__: boolean;
