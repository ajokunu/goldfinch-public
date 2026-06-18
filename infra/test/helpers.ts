import { App } from 'aws-cdk-lib';
import { EnvConfig, getConfig } from '../lib/config';

export const TEST_ENV = { account: '111111111111', region: 'us-east-1' } as const;

/**
 * Build a test App with NodejsFunction bundling skipped (the
 * aws:cdk:bundling-stacks escape hatch) so unit tests neither require esbuild
 * nor the real services/* handler sources to exist.
 */
export function testApp(context: Record<string, unknown> = {}): App {
  return new App({
    context: {
      'aws:cdk:bundling-stacks': [],
      env: 'prod',
      ...context,
    },
  });
}

export function testConfig(app: App): EnvConfig {
  return getConfig(app);
}
