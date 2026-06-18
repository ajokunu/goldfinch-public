import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { resolveHandler, rootLockFile } from './handler-paths';

export interface GoldFinchFunctionProps {
  /** Repo-root-relative handler entry (see handler-paths.ts constants). */
  readonly entry: string;
  readonly memorySize?: number;
  readonly timeout?: Duration;
  readonly environment?: Record<string, string>;
  readonly logRetention: RetentionDays;
  readonly retryAttempts?: number;
  readonly description?: string;
  /** Extra NodejsFunction props (e.g. onFailure destination). */
  readonly overrides?: Partial<NodejsFunctionProps>;
}

/**
 * Shared NodejsFunction wrapper: esbuild bundling, ESM output, arm64,
 * Node 22, AWS SDK v3 externalized (preinstalled in the runtime), explicit
 * log group with one-month retention (avoids the legacy log-retention custom
 * resource), no VPC ever (enforced by the CostGuardrailAspect).
 */
export class GoldFinchFunction extends NodejsFunction {
  constructor(scope: Construct, id: string, props: GoldFinchFunctionProps) {
    const logGroup = new LogGroup(scope, `${id}Logs`, {
      retention: props.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    super(scope, id, {
      entry: resolveHandler(props.entry),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? Duration.seconds(10),
      environment: props.environment,
      retryAttempts: props.retryAttempts,
      description: props.description,
      logGroup,
      depsLockFilePath: rootLockFile(),
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        mainFields: ['module', 'main'],
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        // createRequire shim so CJS-only transitive deps keep working in the
        // ESM bundle on the Node runtime.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      ...props.overrides,
    });

    // Defensive double-check of the no-VPC rule (the aspect also enforces it).
    if (this.isBoundToVpc) {
      throw new Error(`GoldFinchFunction ${Stack.of(this).stackName}/${id} must not be VPC-attached`);
    }
  }
}
