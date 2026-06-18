import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Resolved per-environment configuration for the GoldFinch CDK app.
 *
 * Per the Resolved Decisions Log (AUTHORITATIVE) in GoldFinch-MASTER-PLAN.md:
 * - KEY: DynamoDB PK = USER#<household> where household = the "household" claim
 *   on the Cognito ACCESS token, constant value "goldfinch-home".
 * - D1:  SimpleFIN token lives at SSM SecureString
 *   /goldfinch/prod/simplefin/access-url, encrypted with a customer-managed CMK,
 *   readable only by the sync Lambda role.
 * - D2:  API bearer is the Cognito ACCESS token; resource server "goldfinch"
 *   exposes scope "api"; the JWT authorizer audience is the app client id.
 */
export interface EnvConfig {
  /** Deployment environment name. v1 deploys only "prod"; "dev" stays synthesizable. */
  readonly env: 'dev' | 'prod';
  /** Pinned region. Bedrock, CloudFront ACM certs, and the cost model all assume us-east-1. */
  readonly region: 'us-east-1';
  /** RETAIN in prod, DESTROY in dev. */
  readonly removalPolicy: RemovalPolicy;
  /** PITR on the single table (prod true). */
  readonly pointInTimeRecovery: boolean;
  /** Whether the daily SimpleFIN sync schedule is ENABLED (false in dev to avoid live pulls). */
  readonly syncScheduleEnabled: boolean;
  /** Single-table name. The KEY decision fixes one table named GoldFinch. */
  readonly tableName: string;
  /** Constant household id injected into the access token by the pre-token-gen trigger. */
  readonly householdId: string;
  /** CloudWatch Logs retention (cost control). */
  readonly logRetention: RetentionDays;
  /** Canonical SSM parameter name for the SimpleFIN access URL (decision D1). */
  readonly simplefinParamName: string;
  /**
   * Canonical SSM parameter name for the Expo push access token (P7-8).
   * SecureString encrypted with the AWS-managed aws/ssm key, NOT the SimpleFIN
   * CMK (that key carries an explicit Deny for every principal but the sync
   * role). Value is put out-of-band, never in IaC.
   */
  readonly expoAccessTokenParamName: string;
  /** User emails (context placeholders until real values are supplied). */
  readonly userAEmail: string;
  readonly userBEmail: string;
  /** Optional ops alert email; empty string means no SNS email subscription is created. */
  readonly alertEmail: string;
  /** Cognito managed-login domain prefix. */
  readonly cognitoDomainPrefix: string;
  /** WebAuthn relying-party id (custom domain). Empty until the Route 53 domain (D3) is live. */
  readonly relyingPartyId: string;
  /** OAuth callback / logout URLs for the app client. */
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  /** CORS allow-list for the HTTP API. */
  readonly webOrigins: string[];
  /** Whether the optional Bedrock AI Lambda (Phase 5) is provisioned. */
  readonly aiEnabled: boolean;
  /**
   * Household base currency (P7-7): the currency whose slice fills the
   * summary/net-worth top-level totals. Set HERE (one value, injected as
   * BASE_CURRENCY into BOTH the API and sync Lambdas) so the two services can
   * never disagree on what "base" means.
   */
  readonly baseCurrency: string;
}

function contextString(scope: Construct, key: string, fallback: string): string {
  const value = scope.node.tryGetContext(key);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function contextList(scope: Construct, key: string, fallback: string[]): string[] {
  const value = scope.node.tryGetContext(key);
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return fallback;
}

function contextBool(scope: Construct, key: string, fallback: boolean): boolean {
  const value = scope.node.tryGetContext(key);
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true';
  }
  return fallback;
}

export function getConfig(scope: Construct): EnvConfig {
  const envName = contextString(scope, 'env', 'prod');
  if (envName !== 'prod' && envName !== 'dev') {
    throw new Error(`Unknown env context "${envName}" (expected "prod" or "dev")`);
  }
  const isProd = envName === 'prod';

  return {
    env: envName,
    region: 'us-east-1',
    removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    pointInTimeRecovery: isProd,
    syncScheduleEnabled: isProd,
    tableName: 'GoldFinch',
    householdId: 'goldfinch-home',
    logRetention: RetentionDays.ONE_MONTH,
    simplefinParamName: '/goldfinch/prod/simplefin/access-url',
    expoAccessTokenParamName: '/goldfinch/prod/expo/access-token',
    userAEmail: contextString(scope, 'goldfinch:userAEmail', 'user-a@example.com'),
    userBEmail: contextString(scope, 'goldfinch:userBEmail', 'user-b@example.com'),
    alertEmail: contextString(scope, 'goldfinch:alertEmail', ''),
    cognitoDomainPrefix: contextString(scope, 'goldfinch:cognitoDomainPrefix', 'goldfinch-login'),
    relyingPartyId: contextString(scope, 'goldfinch:relyingPartyId', ''),
    callbackUrls: contextList(scope, 'goldfinch:callbackUrls', ['goldfinch://auth']),
    logoutUrls: contextList(scope, 'goldfinch:logoutUrls', ['goldfinch://signout']),
    webOrigins: contextList(scope, 'goldfinch:webOrigins', [
      'http://localhost:8081',
      'http://localhost:19006',
    ]),
    aiEnabled: contextBool(scope, 'goldfinch:aiEnabled', false),
    baseCurrency: contextString(scope, 'goldfinch:baseCurrency', 'USD'),
  };
}
