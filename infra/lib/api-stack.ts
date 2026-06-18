import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { API_ROUTES } from '../../packages/shared/src/constants';
import { FULL_API_SCOPE } from './auth-stack';
import { EnvConfig } from './config';
import { GoldFinchFunction } from './goldfinch-function';
import { API_HANDLER_ENTRY } from './handler-paths';

/**
 * Derive the gateway route list from the shared route manifest
 * (@goldfinch/shared API_ROUTES), which is also exactly what the Lambda
 * router dispatches on. Registering routes from the manifest makes it
 * impossible for the gateway and the router to drift: a route added on one
 * side only either never reaches the gateway (and the parity test in
 * infra/test/api-stack.test.ts fails) or is registered here automatically.
 */
export function manifestGatewayRoutes(): Array<{ path: string; methods: HttpMethod[] }> {
  const byPath = new Map<string, HttpMethod[]>();
  for (const routeKey of Object.values(API_ROUTES)) {
    const separator = routeKey.indexOf(' ');
    const methodName = routeKey.slice(0, separator);
    const path = routeKey.slice(separator + 1);
    const method = HttpMethod[methodName as keyof typeof HttpMethod];
    if (separator < 1 || method === undefined || !path.startsWith('/')) {
      throw new Error(`Unparseable route key in shared API_ROUTES manifest: "${routeKey}"`);
    }
    const methods = byPath.get(path);
    if (methods === undefined) {
      byPath.set(path, [method]);
    } else {
      methods.push(method);
    }
  }
  return [...byPath.entries()].map(([path, methods]) => ({ path, methods }));
}

export interface ApiStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: ITable;
  /** Issuer URL of the Cognito user pool (https://cognito-idp.<region>.amazonaws.com/<poolId>). */
  readonly issuerUrl: string;
  /** App client id; the JWT authorizer audience (decision D2). */
  readonly appClientId: string;
  /**
   * The sync Lambda (SyncStack.syncFn). POST /sync/run async-invokes it;
   * the grant is scoped to exactly this function's ARN and its name is the
   * SYNC_FN_NAME env var services/api reads. Passing it here makes ApiStack
   * depend on SyncStack (acyclic: SyncStack consumes only Data + config).
   */
  readonly syncFn: IFunction;
}

/**
 * ApiStack: HTTP API (apigatewayv2) with the built-in JWT authorizer
 * validating Cognito ACCESS tokens (audience = app client id, scope
 * goldfinch/api enforced per route), fronting one NodejsFunction that routes
 * internally by routeKey. Identity (the household partition) is always
 * re-derived server-side from the JWT household claim, never client input.
 */
export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;
  public readonly apiFn: GoldFinchFunction;
  public readonly attachmentsBucket: Bucket;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table } = props;
    Tags.of(this).add('Component', 'api');

    // ------------------------------------------------------------------
    // Attachments bucket (P7-9): private S3 store for transaction receipt
    // images/PDFs. All client access goes through presigned URLs minted by
    // the API Lambda (ATTACHMENT_PRESIGN_TTL_SECONDS, content-type allowlist
    // and the 10MB cap enforced by the handler via shared constants). The
    // abort-incomplete-uploads rule cleans up presigned PUTs that never
    // completed so half-uploaded multipart parts cannot accrue cost forever.
    // ------------------------------------------------------------------
    this.attachmentsBucket = new Bucket(this, 'AttachmentsBucket', {
      bucketName: `goldfinch-attachments-${this.account}-${this.region}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.removalPolicy,
      lifecycleRules: [
        {
          id: 'abort-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });

    this.apiFn = new GoldFinchFunction(this, 'ApiFn', {
      entry: API_HANDLER_ENTRY,
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        GSI1_NAME: 'GSI1',
        GSI2_NAME: 'GSI2',
        DEFAULT_TZ: 'America/New_York',
        // P7-7: one infra-owned value, also set on the sync Lambda, so the
        // two services can never disagree on the base-currency slice.
        BASE_CURRENCY: config.baseCurrency,
        ATTACHMENTS_BUCKET: this.attachmentsBucket.bucketName,
        // On-demand sync (Phase 8): the function POST /sync/run async-invokes
        // (services/api getSyncFnName), IAM-paired with InvokeSyncFunction.
        SYNC_FN_NAME: props.syncFn.functionName,
        // No HOUSEHOLD_ID here: the API derives the household EXCLUSIVELY
        // from the JWT household claim (decision KEY); services/api reads no
        // such env var, so setting one would only suggest otherwise.
      },
      logRetention: config.logRetention,
      description: 'GoldFinch app API handler (single function, internal routing by routeKey)',
    });

    // Attachment object access is scoped to the household prefix: every
    // object key is <householdId>/<txnId>/<attachId> and presigned URLs are
    // signed with this role, so even a leaked signing capability cannot
    // reach outside the household prefix. No ListBucket: keys are always
    // reconstructed from ATTACH# metadata items, never enumerated.
    this.apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'GoldFinchAttachmentsObjectAccess',
        effect: Effect.ALLOW,
        actions: ['s3:DeleteObject', 's3:GetObject', 's3:PutObject'],
        resources: [this.attachmentsBucket.arnForObjects(`${config.householdId}/*`)],
      }),
    );

    // On-demand "Sync now" (Phase 8): lambda:InvokeFunction on EXACTLY the
    // sync function's ARN — no alias/version wildcard (:*), no other
    // function. Backs POST /sync/run's fire-and-forget InvokeCommand
    // (InvocationType Event); the debounce lives in services/api.
    this.apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'InvokeSyncFunction',
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.syncFn.functionArn],
      }),
    );

    // Least-privilege table access: exactly BatchWriteItem/Query/GetItem/
    // PutItem/UpdateItem/DeleteItem on the table and its GSIs. No Scan, no
    // SSM/KMS/Bedrock. Two write actions are deliberate, reviewed grants:
    //  - DeleteItem backs DELETE /budgets/{categoryId} (hard DeleteCommand on
    //    the single budget item).
    //  - BatchWriteItem backs DELETE /goals/{goalId}, which removes the goal
    //    AND its contribution rows in one BatchWriteCommand; without it the
    //    delete 500s and the contribution rows are orphaned. The action is
    //    scoped to the table ARN only (BatchWriteItem never targets indexes).
    this.apiFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'GoldFinchTableAccess',
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:BatchWriteItem',
          'dynamodb:DeleteItem',
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    );

    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `goldfinch-api-${config.env}`,
      description: 'GoldFinch read/write API (JWT-gated, access tokens only)',
      corsPreflight: {
        allowOrigins: config.webOrigins,
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.days(1),
      },
    });

    // Built-in JWT authorizer. Cognito access tokens carry client_id (not
    // aud); the HTTP API authorizer checks aud then falls back to client_id,
    // so audience = appClientId validates the access token. The ID token is
    // never sent to the API (decision D2).
    const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', props.issuerUrl, {
      jwtAudience: [props.appClientId],
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', this.apiFn);

    // Every gateway route comes from the shared manifest - see
    // manifestGatewayRoutes() above. That includes GET /health, which is kept
    // JWT-gated for simplicity; nothing unauthenticated is exposed.
    for (const route of manifestGatewayRoutes()) {
      this.httpApi.addRoutes({
        path: route.path,
        methods: route.methods,
        integration,
        authorizer,
        authorizationScopes: [FULL_API_SCOPE],
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: this.httpApi.apiEndpoint });
    new CfnOutput(this, 'AttachmentsBucketName', { value: this.attachmentsBucket.bucketName });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Server access logging for a two-user private attachments bucket adds cost with no review value; all access is presigned by the API Lambda, whose logs retain request ids.',
      },
      {
        id: 'AwsSolutions-APIG1',
        reason:
          'HTTP API access logging is disabled deliberately: two known users, JWT-gated routes, and CloudWatch Logs cost discipline. Lambda logs retain request ids for tracing.',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason:
          'Every route is protected by the JWT authorizer with the goldfinch/api scope; only the gateway-managed CORS preflight is unauthenticated.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'The API Lambda uses the AWS-managed AWSLambdaBasicExecutionRole policy for CloudWatch Logs only.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards are confined to (a) the GoldFinch table index ARN form table/index/* (index access requires it), and (b) the attachments object grant, which is prefix-scoped to the household (<bucket>/<householdId>/*) -- the narrowest expressible object grant for presigned access.',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Runtime is pinned to the Node LTS that the esbuild bundling target (node22) matches; upgrades happen deliberately in lockstep.',
      },
    ]);
  }
}
