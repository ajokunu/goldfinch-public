/**
 * Jest config for the GoldFinch infra workspace.
 *
 * The ts-jest tsconfig override pins module/moduleResolution to commonjs/node so
 * tests compile cleanly regardless of the NodeNext settings in the shared base
 * config.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
        },
      },
    ],
  },
  // Stack synthesis (and any esbuild bundling, when enabled) can be slow.
  testTimeout: 120000,
};
