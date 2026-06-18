import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { ITopic } from 'aws-cdk-lib/aws-sns';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import {
  SYNC_COMPLETED_DETAIL_TYPE,
  SYNC_EVENT_SOURCE,
} from '../../packages/shared/src/constants';
import { EnvConfig } from './config';
import { GoldFinchFunction } from './goldfinch-function';
import {
  NOTIFICATIONS_HANDLER_ENTRY,
  NOTIFICATIONS_RECEIPTS_HANDLER_ENTRY,
} from './handler-paths';

export interface NotificationsStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: ITable;
  /** goldfinch-alerts topic (owned by SyncStack); alarm destination. */
  readonly alertsTopic: ITopic;
}

/**
 * NotificationsStack: Expo push delivery for Phase 7 (P7-8).
 *
 * - EventsFn (services/notifications/src/handler.ts) receives SyncCompleted
 *   events emitted by the sync Lambda on the DEFAULT EventBridge bus
 *   (source goldfinch.sync, detail-type SyncCompleted -- both imported from
 *   the shared constants so the rule and the emitter cannot drift) and sends
 *   sync/budget pushes via the Expo relay.
 * - ReceiptsFn (services/notifications/src/receipts.ts) sweeps Expo push
 *   receipts on an EventBridge Scheduler cron 15 minutes after the daily
 *   09:00 America/New_York sync, pruning DeviceNotRegistered tokens.
 * - Both functions read PUSHTOKEN#/PUSHTICKET#/SENTNOTIF#/PROFILE#/BUDGET#/
 *   CATEGORY# rows via base-table Query and write/delete ticket, marker and
 *   token rows: exactly dynamodb Query/PutItem/DeleteItem on the table ARN
 *   (the store never queries a GSI -- no index grant). No UpdateItem: the
 *   store issues none (services/notifications/src/store.ts).
 * - The Expo access token is an SSM SecureString (AWS-managed aws/ssm key,
 *   value put out-of-band): ssm:GetParameter on exactly that parameter ARN.
 *   This role gets NO access to the SimpleFIN parameter or its CMK.
 */
export class NotificationsStack extends Stack {
  public readonly eventsFn: GoldFinchFunction;
  public readonly receiptsFn: GoldFinchFunction;
  public readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: NotificationsStackProps) {
    super(scope, id, props);
    const { config, table, alertsTopic } = props;
    Tags.of(this).add('Component', 'notifications');

    // DLQ for terminal notification failures: EventBridge rule target dead
    // letters, Scheduler dead letters, and both functions' async on-failure
    // destinations all land here (no silent failures).
    this.dlq = new Queue(this, 'NotificationsDlq', {
      queueName: `goldfinch-notifications-dlq-${config.env}`,
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    // services/notifications/src/config.ts reads TABLE_NAME (required) and
    // EXPO_ACCESS_TOKEN_PARAM (optional, defaulting to the non-prod name);
    // the household id is a shared compile-time constant, not env.
    const environment = {
      TABLE_NAME: table.tableName,
      EXPO_ACCESS_TOKEN_PARAM: config.expoAccessTokenParamName,
    };

    this.eventsFn = new GoldFinchFunction(this, 'NotificationsEventsFn', {
      entry: NOTIFICATIONS_HANDLER_ENTRY,
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment,
      logRetention: config.logRetention,
      description: 'GoldFinch push notifications: SyncCompleted/budget-threshold events -> Expo push',
      overrides: { onFailure: new SqsDestination(this.dlq) },
    });

    this.receiptsFn = new GoldFinchFunction(this, 'NotificationsReceiptsFn', {
      entry: NOTIFICATIONS_RECEIPTS_HANDLER_ENTRY,
      memorySize: 256,
      timeout: Duration.seconds(60),
      // Scheduler owns retries; the function itself must not double-retry.
      retryAttempts: 0,
      environment,
      logRetention: config.logRetention,
      description: 'GoldFinch push receipt sweep: prunes DeviceNotRegistered Expo tokens',
      overrides: { onFailure: new SqsDestination(this.dlq) },
    });

    // Least-privilege table access shared by both functions. See class doc
    // for why this is exactly Query/PutItem/DeleteItem on the base table.
    const tableStatement = new PolicyStatement({
      sid: 'GoldFinchTableNotificationsAccess',
      effect: Effect.ALLOW,
      actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Query'],
      resources: [table.tableArn],
    });
    // ssm:GetParameter on exactly one parameter ARN (the Expo access token).
    // No kms grant: the parameter uses the AWS-managed aws/ssm key, whose key
    // policy already permits via-service decryption for account principals.
    const expoParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${config.expoAccessTokenParamName}`;
    const expoParamStatement = new PolicyStatement({
      sid: 'ReadExpoAccessTokenParam',
      effect: Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [expoParamArn],
    });
    for (const fn of [this.eventsFn, this.receiptsFn]) {
      fn.addToRolePolicy(tableStatement);
      fn.addToRolePolicy(expoParamStatement);
    }

    // ------------------------------------------------------------------
    // SyncCompleted -> events Lambda, on the DEFAULT bus (P7-8). The sync
    // Lambda emits with the same shared constants (EVENT_BUS_NAME=default,
    // EVENT_SOURCE=goldfinch.sync env vars; detail-type SyncCompleted).
    // ------------------------------------------------------------------
    new Rule(this, 'SyncCompletedRule', {
      ruleName: `goldfinch-sync-completed-${config.env}`,
      description: 'Routes goldfinch.sync SyncCompleted events to the notifications Lambda',
      eventPattern: {
        source: [SYNC_EVENT_SOURCE],
        detailType: [SYNC_COMPLETED_DETAIL_TYPE],
      },
      targets: [
        new LambdaFunction(this.eventsFn, {
          deadLetterQueue: this.dlq,
          retryAttempts: 2,
          maxEventAge: Duration.hours(1),
        }),
      ],
    });

    // ------------------------------------------------------------------
    // Receipt sweep: 09:15 America/New_York, 15 minutes after the 09:00
    // daily sync (Expo receipts become available ~15 minutes after a send;
    // any still-pending tickets roll into the next day's sweep or expire
    // via their 25h TTL).
    // ------------------------------------------------------------------
    const schedulerRole = new Role(this, 'SchedulerRole', {
      roleName: `GoldFinch-NotificationsScheduler-${config.env}`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'Lets EventBridge Scheduler invoke the receipt-sweep Lambda and dead-letter to SQS',
    });
    schedulerRole.addToPolicy(
      new PolicyStatement({
        sid: 'InvokeReceiptsFn',
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.receiptsFn.functionArn],
      }),
    );
    this.dlq.grantSendMessages(schedulerRole);

    new CfnSchedule(this, 'ReceiptSweepSchedule', {
      name: `goldfinch-receipt-sweep-${config.env}`,
      description: 'Expo push receipt sweep, 15 minutes after the daily sync',
      scheduleExpression: 'cron(15 9 * * ? *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      state: config.syncScheduleEnabled ? 'ENABLED' : 'DISABLED',
      target: {
        arn: this.receiptsFn.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
        deadLetterConfig: { arn: this.dlq.queueArn },
      },
    });

    // ------------------------------------------------------------------
    // Alarms -> goldfinch-alerts (same posture as the sync pipeline).
    // ------------------------------------------------------------------
    const dlqAlarm = new Alarm(this, 'NotificationsDlqAlarm', {
      alarmName: `goldfinch-notifications-dlq-${config.env}`,
      alarmDescription: 'A notification invocation failed terminally and landed in the DLQ',
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new SnsAction(alertsTopic));

    const errorsAlarm = new Alarm(this, 'NotificationsErrorsAlarm', {
      alarmName: `goldfinch-notifications-errors-${config.env}`,
      alarmDescription: 'The notifications events Lambda reported one or more errors in the last six hours',
      metric: this.eventsFn.metricErrors({ period: Duration.hours(6), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errorsAlarm.addAlarmAction(new SnsAction(alertsTopic));

    new CfnOutput(this, 'NotificationsEventsFnArn', { value: this.eventsFn.functionArn });
    new CfnOutput(this, 'NotificationsReceiptsFnArn', { value: this.receiptsFn.functionArn });
    new CfnOutput(this, 'NotificationsDlqUrl', { value: this.dlq.queueUrl });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-SQS3',
        reason: 'This queue IS the dead-letter queue for the notification pipeline; a DLQ for the DLQ adds nothing.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Lambdas use the AWS-managed AWSLambdaBasicExecutionRole policy for CloudWatch Logs only.',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Runtime is pinned to the Node LTS that the esbuild bundling target (node22) matches; upgrades happen deliberately in lockstep.',
      },
    ]);
  }
}
