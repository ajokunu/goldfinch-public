import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Match, Template } from 'aws-cdk-lib/assertions';
import { API_ROUTES } from '../../packages/shared/src/constants';
import { ApiStack } from '../lib/api-stack';
import { DataStack } from '../lib/data-stack';
import { SyncStack } from '../lib/sync-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

const TEST_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL';
const TEST_CLIENT_ID = 'test-client-id';

function synthApiStack(context: Record<string, unknown> = {}): Template {
  const app = testApp(context);
  const config = testConfig(app);
  const data = new DataStack(app, 'GoldFinch-Data-test', { env: TEST_ENV, config });
  // Mirrors bin/goldfinch.ts: SyncStack first, ApiStack consumes sync.syncFn
  // (POST /sync/run invoke grant + SYNC_FN_NAME). Acyclic by construction.
  const sync = new SyncStack(app, 'GoldFinch-Sync-test', {
    env: TEST_ENV,
    config,
    table: data.table,
  });
  const stack = new ApiStack(app, 'GoldFinch-Api-test', {
    env: TEST_ENV,
    config,
    table: data.table,
    issuerUrl: TEST_ISSUER,
    appClientId: TEST_CLIENT_ID,
    syncFn: sync.syncFn,
  });
  return Template.fromStack(stack);
}

describe('ApiStack', () => {
  const template = synthApiStack();

  test('JWT authorizer validates the access token audience and issuer', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: {
        Audience: [TEST_CLIENT_ID],
        Issuer: TEST_ISSUER,
      },
    });
  });

  test('gateway routes are exactly the shared API_ROUTES manifest (no drift)', () => {
    // THE parity test: the gateway must register every route key the Lambda
    // router dispatches on (@goldfinch/shared API_ROUTES) and nothing else.
    // Adding a route on one side only MUST fail here.
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const gatewayRouteKeys = Object.values(routes)
      .map((route) => (route as { Properties: { RouteKey: string } }).Properties.RouteKey)
      .sort();
    const manifestRouteKeys = [...Object.values(API_ROUTES)].sort();
    expect(gatewayRouteKeys).toEqual(manifestRouteKeys);
  });

  test('every route enforces the goldfinch/api scope', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeEntries = Object.values(routes);
    expect(routeEntries.length).toBeGreaterThanOrEqual(10);
    for (const route of routeEntries) {
      const props = (route as { Properties: Record<string, unknown> }).Properties;
      expect(props['AuthorizationType']).toBe('JWT');
      expect(props['AuthorizationScopes']).toEqual(['goldfinch/api']);
    }
  });

  test('CORS preflight is configured at the gateway', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowHeaders: ['authorization', 'content-type'],
        AllowMethods: Match.arrayWith(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']),
      }),
    });
  });

  test('prod CORS origins are CloudFront-only (no plaintext localhost)', () => {
    // Mirrors the committed cdk.json prod context. The PROD CORS allow-list
    // must trust ONLY the CloudFront origin — never plaintext http://localhost
    // (re-added locally via a non-committed override). A localhost CORS origin
    // on the prod API lets any page on a developer machine read API responses.
    const prodTemplate = synthApiStack({
      'goldfinch:webOrigins': 'https://d38nsjbqmk44hx.cloudfront.net',
    });
    prodTemplate.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['https://d38nsjbqmk44hx.cloudfront.net'],
      }),
    });
    const corsJson = JSON.stringify(
      prodTemplate.findResources('AWS::ApiGatewayV2::Api'),
    );
    expect(corsJson).not.toContain('localhost');
    expect(corsJson).not.toContain('http://');
  });

  test('the API function gets exactly the seven allowed table actions', () => {
    // DeleteItem backs DELETE /budgets/{categoryId}. BatchWriteItem backs
    // DELETE /goals/{goalId} (goal + contribution rows in one BatchWriteCommand).
    // TransactWriteItems backs POST /import/transactions (dedupe pointer + new
    // row atomically). All deliberate, reviewed grants. Scan is still forbidden.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GoldFinchTableAccess',
            Action: [
              'dynamodb:BatchWriteItem',
              'dynamodb:DeleteItem',
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:Query',
              'dynamodb:TransactWriteItems',
              'dynamodb:UpdateItem',
            ],
            Effect: 'Allow',
          }),
        ]),
      }),
    });
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('dynamodb:Scan');
    // The API function must never touch the SimpleFIN secret or Bedrock.
    expect(json).not.toContain('ssm:GetParameter');
    expect(json).not.toContain('kms:Decrypt');
    expect(json).not.toContain('bedrock:InvokeModel');
  });

  test('route<->IAM parity: granted DynamoDB actions cover every command the API source calls', () => {
    // Catches the class of bug where a route issues a DynamoDB command the IAM
    // grant omits (DELETE /budgets DeleteItem historically; POST /import
    // TransactWriteItems latently). Scans services/api/src for *Command uses,
    // maps each to its required action, and asserts the grant is a superset.
    const apiSrc = path.resolve(__dirname, '../../services/api/src');
    expect(existsSync(apiSrc)).toBe(true); // fail loud if the path moved

    const CMD_TO_ACTION: Record<string, string> = {
      GetCommand: 'dynamodb:GetItem',
      PutCommand: 'dynamodb:PutItem',
      UpdateCommand: 'dynamodb:UpdateItem',
      DeleteCommand: 'dynamodb:DeleteItem',
      QueryCommand: 'dynamodb:Query',
      BatchWriteCommand: 'dynamodb:BatchWriteItem',
      TransactWriteCommand: 'dynamodb:TransactWriteItems',
      ScanCommand: 'dynamodb:Scan',
    };

    const tsFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) tsFiles.push(full);
      }
    };
    walk(apiSrc);

    const required = new Set<string>();
    for (const file of tsFiles) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/new ([A-Za-z]+)Command\(/g)) {
        const cmd = `${m[1]}Command`;
        if (cmd in CMD_TO_ACTION) required.add(CMD_TO_ACTION[cmd]!);
        // (Non-DynamoDB SDK commands like InvokeCommand/GetParameterCommand are
        // not in the map and are intentionally ignored here.)
      }
    }
    // Guard against a vacuous pass (regex/path silently matched nothing).
    expect(required.size).toBeGreaterThan(0);
    expect(required.has('dynamodb:GetItem')).toBe(true);
    // The source must never use Scan; if it ever does, surface it loudly.
    expect(required.has('dynamodb:Scan')).toBe(false);

    const policies = template.findResources('AWS::IAM::Policy');
    const granted = new Set<string>(
      Object.values(policies)
        .flatMap(
          (p) =>
            (p as { Properties: { PolicyDocument: { Statement: Array<Record<string, unknown>> } } })
              .Properties.PolicyDocument.Statement,
        )
        .filter((s) => s['Sid'] === 'GoldFinchTableAccess')
        .flatMap((s) => s['Action'] as string[]),
    );
    expect(granted.size).toBeGreaterThan(0);
    for (const action of required) {
      expect(granted).toContain(action);
    }
  });

  test('the API function may invoke EXACTLY the sync function (one ARN, no wildcard)', () => {
    // Phase 8 on-demand sync: POST /sync/run fire-and-forget invoke. The
    // grant must name the single imported sync function ARN — never a
    // version/alias :* suffix, never lambda:* and never a second function.
    const policies = template.findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (policy as {
          Properties: { PolicyDocument: { Statement: Array<Record<string, unknown>> } };
        }).Properties.PolicyDocument.Statement,
    );
    const invokeStatements = statements.filter((statement) =>
      JSON.stringify(statement).includes('lambda:InvokeFunction'),
    );
    expect(invokeStatements).toHaveLength(1);
    const grant = invokeStatements[0] as {
      Sid: string;
      Effect: string;
      Action: unknown;
      Resource: unknown;
    };
    expect(grant.Sid).toBe('InvokeSyncFunction');
    expect(grant.Effect).toBe('Allow');
    // Exactly one action and one resource: the cross-stack import of the
    // sync function ARN (SyncStack export), as a single string — not an
    // array, so no :* qualifier ARN can ride along.
    expect(grant.Action).toBe('lambda:InvokeFunction');
    expect(grant.Resource).toEqual({
      'Fn::ImportValue': expect.stringMatching(/GoldFinch-Sync-test.*SyncFn.*Arn/),
    });

    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('lambda:*');
    expect(json).not.toContain('lambda:Invoke*');
  });

  test('attachments bucket is private, SSE-S3, SSL-enforced, with a 7-day abort-incomplete rule', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'goldfinch-attachments-111111111111-us-east-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
      LifecycleConfiguration: {
        Rules: [
          Match.objectLike({
            Id: 'abort-incomplete-uploads',
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
            Status: 'Enabled',
          }),
        ],
      },
    });
    // enforceSSL: the bucket policy denies any non-TLS access.
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            Principal: { AWS: '*' },
          }),
        ]),
      }),
    });
  });

  test('attachment object access is exactly Put/Get/Delete on the household prefix', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GoldFinchAttachmentsObjectAccess',
            Effect: 'Allow',
            Action: ['s3:DeleteObject', 's3:GetObject', 's3:PutObject'],
            Resource: {
              'Fn::Join': [
                '',
                [
                  { 'Fn::GetAtt': [Match.stringLikeRegexp('^AttachmentsBucket'), 'Arn'] },
                  '/goldfinch-home/*',
                ],
              ],
            },
          }),
        ]),
      }),
    });
    // Never bucket-level or wildcard S3 access from the Lambda role (the
    // only s3:* in the stack is the bucket policy's TLS-only Deny).
    const roleJson = JSON.stringify(template.findResources('AWS::IAM::Policy'));
    expect(roleJson).not.toContain('s3:ListBucket');
    expect(roleJson).not.toContain('s3:*');
    expect(roleJson).not.toContain('s3:GetObject*');
    expect(roleJson).not.toContain('s3:PutObject*');
  });

  test('the API function env matches what services/api reads (both directions)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ATTACHMENTS_BUCKET: Match.anyValue(),
          // P7-7: the same infra-owned value the sync Lambda gets, so the two
          // services can never disagree on the base-currency slice.
          BASE_CURRENCY: 'USD',
          // Phase 8: services/api getSyncFnName() reads this; the value is
          // the imported sync function NAME (paired with the ARN-scoped
          // InvokeSyncFunction grant above).
          SYNC_FN_NAME: {
            'Fn::ImportValue': Match.stringLikeRegexp('GoldFinch-Sync-test.*SyncFn'),
          },
        }),
      },
    });
    // No HOUSEHOLD_ID: services/api derives the household EXCLUSIVELY from
    // the JWT claim (decision KEY) and reads no such env var.
    const json = JSON.stringify(template.findResources('AWS::Lambda::Function'));
    expect(json).not.toContain('HOUSEHOLD_ID');
  });

  test('the API Lambda is arm64 and not VPC-attached', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(fns)) {
      const props = (fn as { Properties: Record<string, unknown> }).Properties;
      expect(props['VpcConfig']).toBeUndefined();
      expect(props['Architectures']).toEqual(['arm64']);
    }
  });

  test('snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
