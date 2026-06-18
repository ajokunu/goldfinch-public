import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { AnyPrincipal, Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { SqsDestination } from 'aws-cdk-lib/aws-lambda-destinations';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { SYNC_EVENT_SOURCE } from '../../packages/shared/src/constants';
import { EnvConfig } from './config';
import { GoldFinchFunction } from './goldfinch-function';
import { AI_HANDLER_ENTRY, SYNC_HANDLER_ENTRY } from './handler-paths';

export interface SyncStackProps extends StackProps {
  readonly config: EnvConfig;
  readonly table: ITable;
}

/**
 * Bedrock model addressing (master plan part 11): on-demand invocation of
 * Claude on Bedrock requires the cross-region inference-profile id, and IAM
 * must allow BOTH the inference-profile ARN and the underlying
 * foundation-model ARNs in every region the profile can route to.
 */
export const BEDROCK_INFERENCE_PROFILE_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
export const BEDROCK_FOUNDATION_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
const BEDROCK_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];

/**
 * SyncStack: the daily SimpleFIN sync pipeline.
 *
 * - Customer-managed CMK (decision D1) encrypting the SimpleFIN access-url
 *   SSM SecureString; key policy allows Decrypt only for the sync role.
 * - The SSM parameter is referenced (never created/valued) in IaC; the value
 *   is put out-of-band via the CLI so it never lands in a template.
 * - Sync NodejsFunction with least-privilege IAM, daily EventBridge Scheduler
 *   trigger, SQS DLQ, CloudWatch alarms -> SNS topic goldfinch-alerts.
 * - Optional AI Lambdas (categorization + monthly summary) with
 *   bedrock:InvokeModel plus scoped table access, on their own EventBridge
 *   schedules (no SSM, no KMS).
 */
export class SyncStack extends Stack {
  public readonly simplefinKey: Key;
  public readonly syncFn: GoldFinchFunction;
  public readonly alertsTopic: Topic;
  public readonly dlq: Queue;
  public readonly aiFn?: GoldFinchFunction;
  public readonly aiMonthlySummaryFn?: GoldFinchFunction;

  constructor(scope: Construct, id: string, props: SyncStackProps) {
    super(scope, id, props);
    const { config, table } = props;
    Tags.of(this).add('Component', 'sync');

    // ------------------------------------------------------------------
    // Customer-managed CMK for the SimpleFIN SSM SecureString (D1, $1/mo,
    // already booked in the cost model). The parameter itself is created
    // out-of-band: aws ssm put-parameter --type SecureString --key-id <alias>.
    // ------------------------------------------------------------------
    this.simplefinKey = new Key(this, 'SimplefinKey', {
      alias: 'alias/goldfinch/simplefin',
      description: 'CMK encrypting the SimpleFIN access-url SSM SecureString (decrypt: sync role only)',
      enableKeyRotation: true,
      removalPolicy: config.removalPolicy,
    });

    // ------------------------------------------------------------------
    // Alerting: one SNS topic for sync failures (emails both users when an
    // alert email is configured).
    // ------------------------------------------------------------------
    this.alertsTopic = new Topic(this, 'AlertsTopic', {
      topicName: 'goldfinch-alerts',
      displayName: 'GoldFinch operational alerts',
      enforceSSL: true,
    });
    if (config.alertEmail.length > 0) {
      this.alertsTopic.addSubscription(new EmailSubscription(config.alertEmail));
    }

    // ------------------------------------------------------------------
    // DLQ for terminal sync failures (Scheduler dead-letter target and the
    // Lambda async on-failure destination).
    // ------------------------------------------------------------------
    this.dlq = new Queue(this, 'SyncDlq', {
      queueName: `goldfinch-sync-dlq-${config.env}`,
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    // ------------------------------------------------------------------
    // Sync Lambda.
    // ------------------------------------------------------------------
    this.syncFn = new GoldFinchFunction(this, 'SyncFn', {
      entry: SYNC_HANDLER_ENTRY,
      memorySize: 512,
      timeout: Duration.seconds(120),
      // Scheduler owns retries; the function itself must not double-retry.
      retryAttempts: 0,
      environment: {
        TABLE_NAME: table.tableName,
        GSI1_NAME: 'GSI1',
        GSI2_NAME: 'GSI2',
        HOUSEHOLD_ID: config.householdId,
        // Name only - the secret value NEVER appears in env vars or templates.
        SIMPLEFIN_PARAM_NAME: config.simplefinParamName,
        OVERLAP_BUFFER_DAYS: '7',
        MAX_HISTORY_DAYS: '90',
        METRICS_NAMESPACE: 'GoldFinch/Sync',
        // P7-7: one infra-owned value, also set on the API Lambda, so the
        // two services can never disagree on the base-currency slice.
        BASE_CURRENCY: config.baseCurrency,
        // SyncCompleted emission contract (P7-8): the sync service reads
        // EVENT_BUS_NAME and EVENT_SOURCE from env and emits detail-type
        // SYNC_COMPLETED_DETAIL_TYPE (shared constant) after each run; the
        // NotificationsStack rule matches the same shared constants.
        EVENT_BUS_NAME: 'default',
        EVENT_SOURCE: SYNC_EVENT_SOURCE,
      },
      logRetention: config.logRetention,
      description: 'Daily SimpleFIN sync: pulls accounts/transactions and upserts into the GoldFinch table',
      overrides: {
        onFailure: new SqsDestination(this.dlq),
      },
    });

    // Reference (not create) the SecureString parameter - decision D1.
    const simplefinParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'SimplefinAccessUrl',
      { parameterName: config.simplefinParamName },
    );
    const simplefinParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${config.simplefinParamName}`;
    // Reference the construct so the read-only handle stays wired into the tree.
    void simplefinParam;

    // ssm:GetParameter on exactly one parameter ARN. Explicitly NOT granted:
    // GetParameters (plural), PutParameter, DeleteParameter.
    this.syncFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'ReadSimplefinParam',
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [simplefinParamArn],
      }),
    );
    // kms:Decrypt on exactly one key.
    this.syncFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'DecryptSimplefinParam',
        effect: Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [this.simplefinKey.keyArn],
      }),
    );
    // Key-policy side of D1: only the sync role may Decrypt with this key.
    // (The account-root admin statement CDK adds by default is retained so
    // the key stays manageable and the parameter can be written by an admin.)
    this.simplefinKey.addToResourcePolicy(
      new PolicyStatement({
        sid: 'AllowSyncRoleDecryptOnly',
        effect: Effect.ALLOW,
        principals: [this.syncFn.grantPrincipal],
        actions: ['kms:Decrypt'],
        resources: ['*'],
      }),
    );
    // D1 ENFORCEMENT (not just convention): without this, the CDK default
    // account-root kms:* statement lets ANY principal that an admin grants
    // kms:Decrypt in IAM read the SimpleFIN secret. An explicit resource-policy
    // Deny binds every principal in the account, including root sessions.
    //
    // Scope discipline:
    // - Deny ONLY kms:Decrypt. Management actions (Describe/Put/Schedule
    //   Delete/Enable rotation/...) and Encrypt/GenerateDataKey (admins write
    //   the SecureString parameter out-of-band) must stay governed by the
    //   default account-root statement or the key becomes unmanageable.
    // - StringNotEquals on aws:PrincipalArn exempts the sync role. For an
    //   assumed-role session, aws:PrincipalArn evaluates to the ROLE arn (no
    //   session-name suffix), so the running Lambda matches the exemption.
    // - No service-principal carve-out is needed for SSM: GetParameter with
    //   WithDecryption performs kms:Decrypt using the CALLER's credentials
    //   (a via-service call, kms:ViaService = ssm.<region>.amazonaws.com),
    //   so the principal KMS evaluates IS the sync Lambda role, which the
    //   condition already exempts.
    // Referencing the role ARN from the key policy in the same stack is fine
    // in CloudFormation (no circular resource dependency: key policy -> role,
    // role inline policy -> key ARN are both plain attribute references).
    this.simplefinKey.addToResourcePolicy(
      new PolicyStatement({
        sid: 'DenyDecryptExceptSyncRole',
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringNotEquals: { 'aws:PrincipalArn': this.syncFn.role!.roleArn },
        },
      }),
    );

    // Table access: write path plus Query (sync state read, pointer lookups).
    // UpdateItem backs attribute-scoped updates of existing rows and
    // DeleteItem backs the pending->posted re-key (delete old pending item),
    // both performed by services/sync writer. No Scan, ever.
    this.syncFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'GoldFinchTableSyncAccess',
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:BatchWriteItem',
          'dynamodb:DeleteItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    );

    // SyncCompleted events for the notifications pipeline (P7-8): PutEvents
    // on exactly the default bus, further constrained to the goldfinch.sync
    // source so the role cannot spoof events from any other source.
    this.syncFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'PutSyncCompletedEvents',
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
        conditions: { StringEquals: { 'events:source': SYNC_EVENT_SOURCE } },
      }),
    );

    // Metrics need NO IAM grant: services/sync/src/metrics.ts emits Embedded
    // Metric Format lines over stdout (CloudWatch Logs extracts them into the
    // GoldFinch/Sync namespace), so the role deliberately carries no
    // cloudwatch:PutMetricData. The contract-parity audit removed the unused
    // grant the EMF decision had orphaned.

    // ------------------------------------------------------------------
    // Daily schedule: 09:00 America/New_York (after banks post overnight).
    // ------------------------------------------------------------------
    const schedulerRole = new Role(this, 'SchedulerRole', {
      roleName: `GoldFinch-SyncScheduler-${config.env}`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'Lets EventBridge Scheduler invoke the GoldFinch scheduled Lambdas and dead-letter to SQS',
    });
    schedulerRole.addToPolicy(
      new PolicyStatement({
        sid: 'InvokeSyncFn',
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.syncFn.functionArn],
      }),
    );
    this.dlq.grantSendMessages(schedulerRole);

    new CfnSchedule(this, 'DailySyncSchedule', {
      name: `goldfinch-daily-sync-${config.env}`,
      description: 'Daily SimpleFIN sync trigger',
      scheduleExpression: 'cron(0 9 * * ? *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      state: config.syncScheduleEnabled ? 'ENABLED' : 'DISABLED',
      target: {
        arn: this.syncFn.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
        deadLetterConfig: { arn: this.dlq.queueArn },
      },
    });

    // ------------------------------------------------------------------
    // Alarms -> goldfinch-alerts.
    // ------------------------------------------------------------------
    const dlqAlarm = new Alarm(this, 'SyncDlqAlarm', {
      alarmName: `goldfinch-sync-dlq-${config.env}`,
      alarmDescription: 'A sync invocation failed terminally and landed in the DLQ',
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new SnsAction(this.alertsTopic));

    const errorsAlarm = new Alarm(this, 'SyncErrorsAlarm', {
      alarmName: `goldfinch-sync-errors-${config.env}`,
      alarmDescription: 'The sync Lambda reported one or more errors in the last six hours',
      metric: this.syncFn.metricErrors({ period: Duration.hours(6), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    errorsAlarm.addAlarmAction(new SnsAction(this.alertsTopic));

    // ------------------------------------------------------------------
    // Optional AI Lambdas (Phase 5, gated by goldfinch:aiEnabled):
    // - AiFn (export `handler`): rules-first transaction categorization,
    //   scheduled daily at 09:30 America/New_York, after the 09:00 sync.
    // - AiMonthlySummaryFn (export `monthlySummaryHandler`): monthly cashflow
    //   narrative, scheduled on the 1st at 07:00 America/New_York.
    // Both read/write the table directly (services/ai/src/store.ts: Query,
    // GetItem, PutItem, conditional UpdateItem) and call Bedrock InvokeModel.
    // No SSM, no KMS, no Scan, no Delete.
    // ------------------------------------------------------------------
    if (config.aiEnabled) {
      // services/ai/src/config.ts reads GOLDFINCH_TABLE_NAME ?? TABLE_NAME
      // and GOLDFINCH_HOUSEHOLD (everything else has safe in-code defaults).
      const aiEnvironment = {
        TABLE_NAME: table.tableName,
        GOLDFINCH_HOUSEHOLD: config.householdId,
        BEDROCK_MODEL_ID: BEDROCK_INFERENCE_PROFILE_ID,
      };
      const aiBedrockStatement = new PolicyStatement({
        sid: 'InvokeClaudeViaInferenceProfile',
        effect: Effect.ALLOW,
        // services/ai/src/bedrockClient.ts issues only InvokeModelCommand;
        // no streaming action until code actually streams (least privilege).
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${BEDROCK_INFERENCE_PROFILE_ID}`,
          ...BEDROCK_PROFILE_REGIONS.map(
            (region) => `arn:aws:bedrock:${region}::foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
          ),
        ],
      });
      const aiTableStatement = new PolicyStatement({
        sid: 'GoldFinchTableAiAccess',
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      });

      const aiFn = new GoldFinchFunction(this, 'AiFn', {
        entry: AI_HANDLER_ENTRY,
        memorySize: 256,
        timeout: Duration.seconds(30),
        environment: aiEnvironment,
        logRetention: config.logRetention,
        description: 'GoldFinch AI categorization (rules first, Bedrock for the residual)',
      });
      const aiMonthlySummaryFn = new GoldFinchFunction(this, 'AiMonthlySummaryFn', {
        entry: AI_HANDLER_ENTRY,
        memorySize: 256,
        timeout: Duration.seconds(30),
        environment: aiEnvironment,
        logRetention: config.logRetention,
        description: 'GoldFinch AI monthly cashflow summary (idempotent by input digest)',
        // Same bundle, different export (services/ai/src/handler.ts).
        overrides: { handler: 'monthlySummaryHandler' },
      });
      for (const fn of [aiFn, aiMonthlySummaryFn]) {
        fn.addToRolePolicy(aiBedrockStatement);
        fn.addToRolePolicy(aiTableStatement);
      }

      // Scheduler wiring reuses the scheduler role and the sync DLQ.
      schedulerRole.addToPolicy(
        new PolicyStatement({
          sid: 'InvokeAiFns',
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [aiFn.functionArn, aiMonthlySummaryFn.functionArn],
        }),
      );
      new CfnSchedule(this, 'DailyCategorizeSchedule', {
        name: `goldfinch-daily-categorize-${config.env}`,
        description: 'Daily AI categorization run, 30 minutes after the daily sync',
        scheduleExpression: 'cron(30 9 * * ? *)',
        scheduleExpressionTimezone: 'America/New_York',
        flexibleTimeWindow: { mode: 'OFF' },
        state: config.syncScheduleEnabled ? 'ENABLED' : 'DISABLED',
        target: {
          arn: aiFn.functionArn,
          roleArn: schedulerRole.roleArn,
          retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
          deadLetterConfig: { arn: this.dlq.queueArn },
        },
      });
      new CfnSchedule(this, 'MonthlySummarySchedule', {
        name: `goldfinch-monthly-summary-${config.env}`,
        description: 'Monthly AI cashflow narrative for the previous month',
        scheduleExpression: 'cron(0 7 1 * ? *)',
        scheduleExpressionTimezone: 'America/New_York',
        flexibleTimeWindow: { mode: 'OFF' },
        state: config.syncScheduleEnabled ? 'ENABLED' : 'DISABLED',
        target: {
          arn: aiMonthlySummaryFn.functionArn,
          roleArn: schedulerRole.roleArn,
          retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
          deadLetterConfig: { arn: this.dlq.queueArn },
        },
      });

      this.aiFn = aiFn;
      this.aiMonthlySummaryFn = aiMonthlySummaryFn;
      new CfnOutput(this, 'AiFnArn', { value: aiFn.functionArn });
      new CfnOutput(this, 'AiMonthlySummaryFnArn', { value: aiMonthlySummaryFn.functionArn });
    }

    new CfnOutput(this, 'SyncFnArn', { value: this.syncFn.functionArn });
    new CfnOutput(this, 'AlertsTopicArn', { value: this.alertsTopic.topicArn });
    new CfnOutput(this, 'SimplefinKeyArn', { value: this.simplefinKey.keyArn });
    new CfnOutput(this, 'SyncDlqUrl', { value: this.dlq.queueUrl });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-SQS3',
        reason: 'This queue IS the dead-letter queue for the sync pipeline; a DLQ for the DLQ adds nothing.',
      },
      {
        id: 'AwsSolutions-SNS2',
        reason:
          'CloudWatch alarms cannot publish to SNS topics encrypted with the AWS-managed key, and a dedicated CMK costs $1/mo for alert text that contains no financial data. Transport is TLS-enforced.',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Lambdas use the AWS-managed AWSLambdaBasicExecutionRole policy for CloudWatch Logs only.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards are confined to the GoldFinch table index ARN form table/index/* (index access requires it).',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Runtime is pinned to the Node LTS that the esbuild bundling target (node22) matches; upgrades happen deliberately in lockstep.',
      },
    ]);
  }
}
