import { Match, Template } from 'aws-cdk-lib/assertions';
import { DataStack } from '../lib/data-stack';
import { SyncStack } from '../lib/sync-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

function synthSyncStack(context: Record<string, unknown> = {}): Template {
  const app = testApp(context);
  const config = testConfig(app);
  const data = new DataStack(app, 'GoldFinch-Data-test', { env: TEST_ENV, config });
  const stack = new SyncStack(app, 'GoldFinch-Sync-test', {
    env: TEST_ENV,
    config,
    table: data.table,
  });
  return Template.fromStack(stack);
}

describe('SyncStack', () => {
  const template = synthSyncStack();

  test('customer-managed CMK with rotation and a sync-role-only decrypt statement', () => {
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowSyncRoleDecryptOnly',
            Action: 'kms:Decrypt',
            Effect: 'Allow',
          }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::KMS::Alias', {
      AliasName: 'alias/goldfinch/simplefin',
    });
  });

  test('key policy DENIES kms:Decrypt to every principal except the sync role (D1)', () => {
    // The deny must bind all principals (Principal: *) and exempt exactly the
    // sync role via StringNotEquals on aws:PrincipalArn (role ARN token).
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DenyDecryptExceptSyncRole',
            Effect: 'Deny',
            // Decrypt ONLY: denying management actions would make the key
            // unmanageable, and admins still need Encrypt/GenerateDataKey to
            // write the SecureString parameter out-of-band.
            Action: 'kms:Decrypt',
            Principal: { AWS: '*' },
            Resource: '*',
            Condition: {
              StringNotEquals: {
                'aws:PrincipalArn': {
                  'Fn::GetAtt': [Match.stringLikeRegexp('^SyncFnServiceRole'), 'Arn'],
                },
              },
            },
          }),
        ]),
      }),
    });
  });

  test('sync role reads exactly one SSM parameter and decrypts exactly one key', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'ReadSimplefinParam',
            Action: 'ssm:GetParameter',
            Resource: 'arn:aws:ssm:us-east-1:111111111111:parameter/goldfinch/prod/simplefin/access-url',
          }),
        ]),
      }),
    });
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('ssm:GetParameters');
    expect(json).not.toContain('ssm:PutParameter');
    expect(json).not.toContain('kms:Encrypt');
    expect(json).not.toContain('kms:GenerateDataKey');
  });

  test('sync role table access is BatchWrite/Delete/Put/Query/Update only', () => {
    // UpdateItem: attribute-scoped updates of existing rows.
    // DeleteItem: pending->posted re-key deletes the old pending item.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GoldFinchTableSyncAccess',
            Action: [
              'dynamodb:BatchWriteItem',
              'dynamodb:DeleteItem',
              'dynamodb:PutItem',
              'dynamodb:Query',
              'dynamodb:UpdateItem',
            ],
          }),
        ]),
      }),
    });
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('dynamodb:Scan');
    expect(json).not.toContain('dynamodb:GetItem');
  });

  test('sync role may PutEvents only on the default bus with source goldfinch.sync', () => {
    // P7-8: the SyncCompleted emission grant is pinned to the default bus ARN
    // AND the goldfinch.sync source condition, so the role cannot spoof
    // events from any other source (e.g. fake budget events).
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'PutSyncCompletedEvents',
            Action: 'events:PutEvents',
            Resource: 'arn:aws:events:us-east-1:111111111111:event-bus/default',
            Condition: { StringEquals: { 'events:source': 'goldfinch.sync' } },
          }),
        ]),
      }),
    });
  });

  test('the env carries the SyncCompleted emission contract', () => {
    // services/sync reads EVENT_BUS_NAME + EVENT_SOURCE; the detail-type is
    // the shared SYNC_COMPLETED_DETAIL_TYPE constant on both sides.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          EVENT_BUS_NAME: 'default',
          EVENT_SOURCE: 'goldfinch.sync',
          // P7-7: the same infra-owned value the API Lambda gets, so the two
          // services can never disagree on the base-currency slice.
          BASE_CURRENCY: 'USD',
        }),
      },
    });
    // services/sync reads no DLQ_URL (the DLQ is wired via the Scheduler
    // target + Lambda onFailure destination, not the handler).
    const json = JSON.stringify(template.findResources('AWS::Lambda::Function'));
    expect(json).not.toContain('DLQ_URL');
  });

  test('daily schedule at 09:00 America/New_York with retries and DLQ', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(0 9 * * ? *)',
      ScheduleExpressionTimezone: 'America/New_York',
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
      Target: Match.objectLike({
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
        DeadLetterConfig: Match.objectLike({}),
      }),
    });
  });

  test('DLQ retains for 14 days and alarms feed goldfinch-alerts', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'goldfinch-sync-dlq-prod',
      MessageRetentionPeriod: 1209600,
    });
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'goldfinch-alerts',
    });
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
  });

  test('the env carries only the parameter NAME, never a secret value', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          SIMPLEFIN_PARAM_NAME: '/goldfinch/prod/simplefin/access-url',
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  test('AI functions and schedules are absent by default', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('bedrock:InvokeModel');
    expect(json).not.toContain('GoldFinchTableAiAccess');
    expect(json).not.toContain('monthlySummaryHandler');
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  describe('with goldfinch:aiEnabled', () => {
    const withAi = synthSyncStack({ 'goldfinch:aiEnabled': true });

    test('both AI functions get bedrock via the inference profile', () => {
      const bedrockStatement = Match.objectLike({
        Sid: 'InvokeClaudeViaInferenceProfile',
        // Exactly what services/ai/src/bedrockClient.ts calls: InvokeModel,
        // nothing else (no streaming action until the code streams).
        Action: 'bedrock:InvokeModel',
        Resource: Match.arrayWith([
          'arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
          'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
          'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
          'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
        ]),
      });
      const policies = withAi.findResources('AWS::IAM::Policy', {
        Properties: {
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([bedrockStatement]),
          }),
        },
      });
      expect(Object.keys(policies)).toHaveLength(2);
    });

    test('both AI functions get scoped table access (no Scan, no Delete)', () => {
      const tableStatement = Match.objectLike({
        Sid: 'GoldFinchTableAiAccess',
        Effect: 'Allow',
        Action: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
      });
      const policies = withAi.findResources('AWS::IAM::Policy', {
        Properties: {
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([tableStatement]),
          }),
        },
      });
      expect(Object.keys(policies)).toHaveLength(2);
      expect(JSON.stringify(withAi.toJSON())).not.toContain('dynamodb:Scan');
    });

    test('AI functions carry the env the service config reads', () => {
      // services/ai/src/config.ts: GOLDFINCH_TABLE_NAME ?? TABLE_NAME,
      // GOLDFINCH_HOUSEHOLD, BEDROCK_MODEL_ID (the rest defaults in code).
      const aiEnv = {
        Variables: Match.objectLike({
          TABLE_NAME: Match.anyValue(),
          GOLDFINCH_HOUSEHOLD: 'goldfinch-home',
          BEDROCK_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        }),
      };
      const fns = withAi.findResources('AWS::Lambda::Function', {
        Properties: { Environment: aiEnv },
      });
      expect(Object.keys(fns)).toHaveLength(2);
    });

    test('the monthly summary function targets the monthlySummaryHandler export', () => {
      withAi.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.monthlySummaryHandler',
        Environment: { Variables: Match.objectLike({ GOLDFINCH_HOUSEHOLD: 'goldfinch-home' }) },
      });
    });

    test('daily categorization at 09:30 ET (after the 09:00 sync) and monthly summary on the 1st at 07:00 ET', () => {
      withAi.resourceCountIs('AWS::Scheduler::Schedule', 3);
      withAi.hasResourceProperties('AWS::Scheduler::Schedule', {
        Name: 'goldfinch-daily-categorize-prod',
        ScheduleExpression: 'cron(30 9 * * ? *)',
        ScheduleExpressionTimezone: 'America/New_York',
        State: 'ENABLED',
        Target: Match.objectLike({
          RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
          DeadLetterConfig: Match.objectLike({}),
        }),
      });
      withAi.hasResourceProperties('AWS::Scheduler::Schedule', {
        Name: 'goldfinch-monthly-summary-prod',
        ScheduleExpression: 'cron(0 7 1 * ? *)',
        ScheduleExpressionTimezone: 'America/New_York',
        State: 'ENABLED',
        Target: Match.objectLike({
          RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
          DeadLetterConfig: Match.objectLike({}),
        }),
      });
    });
  });

  test('snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
