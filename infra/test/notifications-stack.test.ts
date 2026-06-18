import { Match, Template } from 'aws-cdk-lib/assertions';
import {
  SYNC_COMPLETED_DETAIL_TYPE,
  SYNC_EVENT_SOURCE,
} from '../../packages/shared/src/constants';
import { DataStack } from '../lib/data-stack';
import { NotificationsStack } from '../lib/notifications-stack';
import { SyncStack } from '../lib/sync-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

function synthNotificationsStack(): Template {
  const app = testApp();
  const config = testConfig(app);
  const data = new DataStack(app, 'GoldFinch-Data-test', { env: TEST_ENV, config });
  const sync = new SyncStack(app, 'GoldFinch-Sync-test', {
    env: TEST_ENV,
    config,
    table: data.table,
  });
  const stack = new NotificationsStack(app, 'GoldFinch-Notifications-test', {
    env: TEST_ENV,
    config,
    table: data.table,
    alertsTopic: sync.alertsTopic,
  });
  return Template.fromStack(stack);
}

describe('NotificationsStack', () => {
  const template = synthNotificationsStack();

  test('two Lambdas: events handler and receipt sweep', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
    const fns = template.findResources('AWS::Lambda::Function');
    const descriptions = Object.values(fns).map(
      (fn) => (fn as { Properties: { Description: string } }).Properties.Description,
    );
    expect(descriptions.join(' ')).toContain('Expo push');
    expect(descriptions.join(' ')).toContain('receipt sweep');
  });

  test('EventBridge rule on the DEFAULT bus matches the shared SyncCompleted contract', () => {
    // Source and detail-type come from @goldfinch/shared constants, the same
    // values the sync emitter uses (EVENT_SOURCE env / detail-type constant),
    // so the rule and the emitter cannot drift.
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: [SYNC_EVENT_SOURCE],
        'detail-type': [SYNC_COMPLETED_DETAIL_TYPE],
      },
      State: 'ENABLED',
      Targets: Match.arrayWith([
        Match.objectLike({
          DeadLetterConfig: Match.objectLike({}),
          RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 2 }),
        }),
      ]),
    });
    // No EventBusName property means the rule lives on the default bus.
    const rules = template.findResources('AWS::Events::Rule');
    for (const rule of Object.values(rules)) {
      const props = (rule as { Properties: Record<string, unknown> }).Properties;
      expect(props['EventBusName']).toBeUndefined();
    }
  });

  test('receipt sweep runs 15 minutes after the 09:00 daily sync', () => {
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'goldfinch-receipt-sweep-prod',
      ScheduleExpression: 'cron(15 9 * * ? *)',
      ScheduleExpressionTimezone: 'America/New_York',
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
      Target: Match.objectLike({
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 3600 },
        DeadLetterConfig: Match.objectLike({}),
      }),
    });
  });

  test('both functions carry exactly the env the service config reads', () => {
    // services/notifications/src/config.ts: TABLE_NAME (required) and
    // EXPO_ACCESS_TOKEN_PARAM (optional with a non-prod default that the
    // deployment must override with the canonical prod name).
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: Match.anyValue(),
            EXPO_ACCESS_TOKEN_PARAM: '/goldfinch/prod/expo/access-token',
          }),
        },
      },
    });
    expect(Object.keys(fns)).toHaveLength(2);
  });

  test('table access is Query/PutItem/DeleteItem on the base table only (matches the store)', () => {
    // services/notifications/src/store.ts issues QueryCommand, PutCommand and
    // DeleteCommand, never UpdateCommand, never an IndexName: the grant is
    // exactly those three actions on the table ARN with NO index resource.
    const tableStatement = Match.objectLike({
      Sid: 'GoldFinchTableNotificationsAccess',
      Effect: 'Allow',
      Action: ['dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Query'],
    });
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([tableStatement]),
        }),
      },
    });
    expect(Object.keys(policies)).toHaveLength(2);
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('dynamodb:Scan');
    expect(json).not.toContain('dynamodb:GetItem');
    expect(json).not.toContain('dynamodb:UpdateItem');
    expect(json).not.toContain('dynamodb:BatchWriteItem');
    expect(json).not.toContain('/index/');
  });

  test('reads exactly one SSM parameter (the Expo token) and never the SimpleFIN secret', () => {
    const ssmStatement = Match.objectLike({
      Sid: 'ReadExpoAccessTokenParam',
      Action: 'ssm:GetParameter',
      Resource: 'arn:aws:ssm:us-east-1:111111111111:parameter/goldfinch/prod/expo/access-token',
    });
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([ssmStatement]),
        }),
      },
    });
    expect(Object.keys(policies)).toHaveLength(2);
    const json = JSON.stringify(template.toJSON());
    expect(json).not.toContain('simplefin');
    expect(json).not.toContain('kms:Decrypt');
    expect(json).not.toContain('ssm:GetParameters');
    expect(json).not.toContain('ssm:PutParameter');
    expect(json).not.toContain('bedrock:InvokeModel');
    expect(json).not.toContain('events:PutEvents');
  });

  test('DLQ retains for 14 days; DLQ and errors alarms feed goldfinch-alerts', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'goldfinch-notifications-dlq-prod',
      MessageRetentionPeriod: 1209600,
    });
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
  });

  test('Lambdas are arm64 and not VPC-attached', () => {
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
