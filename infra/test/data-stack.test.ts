import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

function synthDataStack(): Template {
  const app = testApp();
  const stack = new DataStack(app, 'GoldFinch-Data-test', {
    env: TEST_ENV,
    config: testConfig(app),
  });
  return Template.fromStack(stack);
}

describe('DataStack', () => {
  const template = synthDataStack();

  test('table is on-demand with PITR, deletion protection, and RETAIN', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'GoldFinch',
      BillingMode: 'PAY_PER_REQUEST',
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
        RecoveryPeriodInDays: 35,
      },
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('GSI1 and GSI2 use INCLUDE projections with the planned attributes', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: Match.arrayWith(['amountMinor', 'payee', 'categoryId', 'pending', 'currency']),
          },
        }),
        Match.objectLike({
          IndexName: 'GSI2',
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: Match.arrayWith(['amountMinor', 'payee', 'accountId']),
          },
        }),
      ]),
    });
  });

  test('backup bucket blocks all public access, enforces SSL, and expires exports', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'goldfinch-backups-111111111111-us-east-1',
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
      VersioningConfiguration: { Status: 'Enabled' },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Prefix: 'dynamodb-exports/',
            ExpirationInDays: 90,
            NoncurrentVersionExpiration: Match.objectLike({ NoncurrentDays: 30 }),
          }),
        ]),
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      }),
    });
  });

  test('weekly FULL_EXPORT schedule targets the universal SDK action', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(30 6 ? * SUN *)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
      Target: Match.objectLike({
        Arn: 'arn:aws:scheduler:::aws-sdk:dynamodb:exportTableToPointInTime',
        // Input is a JSON string containing deploy-time tokens (table ARN,
        // bucket name), so it synthesizes as an Fn::Join over string parts.
        Input: Match.objectLike({
          'Fn::Join': [
            '',
            Match.arrayWith([Match.stringLikeRegexp('"ExportType":"FULL_EXPORT"')]),
          ],
        }),
      }),
    });
  });

  test('export role is least-privilege (export + scoped S3 writes only)', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('dynamodb:ExportTableToPointInTime');
    expect(json).not.toContain('dynamodb:DeleteTable');
    expect(json).not.toContain('s3:GetObject');
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'scheduler.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': '111111111111' } },
          }),
        ]),
      }),
    });
  });

  test('snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
