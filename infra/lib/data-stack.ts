import { Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from 'aws-cdk-lib/aws-s3';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

export interface DataStackProps extends StackProps {
  readonly config: EnvConfig;
}

/**
 * DataStack: the single DynamoDB table (KEY decision: PK = USER#<household>),
 * GSI1/GSI2, plus the data-ownership layer - the goldfinch-backups bucket and
 * the weekly codeless EventBridge Scheduler FULL_EXPORT of the table to S3.
 */
export class DataStack extends Stack {
  public readonly table: Table;
  public readonly backupBucket: Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;
    Tags.of(this).add('Component', 'data');

    // ------------------------------------------------------------------
    // Single table. Generic key attributes; entityType discriminator lives
    // on items, not in infra. AWS-owned encryption per the data-model part
    // (the customer-managed CMK is reserved for the SimpleFIN SSM secret).
    // ------------------------------------------------------------------
    this.table = new Table(this, 'GoldFinchTable', {
      tableName: config.tableName,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.DEFAULT,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
        ...(config.pointInTimeRecovery ? { recoveryPeriodInDays: 35 } : {}),
      },
      deletionProtection: config.env === 'prod',
      removalPolicy: config.removalPolicy,
    });

    // GSI1: transactions per account. Sparse (only TRANSACTION items carry keys).
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ['amountMinor', 'payee', 'categoryId', 'pending', 'currency'],
    });

    // GSI2: spend rollup by category. Sparse (categorized, non-transfer expenses only).
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ['amountMinor', 'payee', 'accountId'],
    });

    // ------------------------------------------------------------------
    // Backup bucket: versioned, SSE-S3, TLS-only, fully private, lifecycle
    // expiry instead of Glacier (false economy at < 100 MB).
    // ------------------------------------------------------------------
    const exportPrefix = 'dynamodb-exports/';
    this.backupBucket = new Bucket(this, 'BackupBucket', {
      bucketName: `goldfinch-backups-${this.account}-${this.region}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: config.removalPolicy,
      lifecycleRules: [
        {
          id: 'expire-exports-90d',
          prefix: exportPrefix,
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });

    // ------------------------------------------------------------------
    // Weekly FULL_EXPORT via EventBridge Scheduler universal SDK target -
    // no Lambda, no code. Sundays 06:30 UTC, after the daily sync window.
    // ------------------------------------------------------------------
    const exportRole = new Role(this, 'ExportRole', {
      roleName: `GoldFinch-Export-${config.env}`,
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
      description: 'Least-privilege role for the scheduled DynamoDB table export to S3',
    });
    exportRole.addToPolicy(
      new PolicyStatement({
        sid: 'ExportTable',
        effect: Effect.ALLOW,
        actions: ['dynamodb:ExportTableToPointInTime'],
        resources: [this.table.tableArn],
      }),
    );
    exportRole.addToPolicy(
      new PolicyStatement({
        sid: 'WriteExportObjects',
        effect: Effect.ALLOW,
        actions: ['s3:AbortMultipartUpload', 's3:PutObject', 's3:GetBucketLocation'],
        resources: [this.backupBucket.bucketArn, this.backupBucket.arnForObjects(`${exportPrefix}*`)],
      }),
    );

    new CfnSchedule(this, 'ExportSchedule', {
      name: `goldfinch-weekly-export-${config.env}`,
      description: 'Weekly DynamoDB FULL_EXPORT of the GoldFinch table to the backup bucket',
      scheduleExpression: 'cron(30 6 ? * SUN *)',
      flexibleTimeWindow: { mode: 'OFF' },
      state: config.env === 'prod' ? 'ENABLED' : 'DISABLED',
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:dynamodb:exportTableToPointInTime',
        roleArn: exportRole.roleArn,
        input: this.toJsonString({
          TableArn: this.table.tableArn,
          S3Bucket: this.backupBucket.bucketName,
          S3Prefix: 'dynamodb-exports',
          ExportFormat: 'DYNAMODB_JSON',
          ExportType: 'FULL_EXPORT',
        }),
        retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
      },
    });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Server access logging on a two-user private backup bucket adds cost and a second bucket for no security benefit; access is via IAM only and CloudTrail covers management events.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'The export role needs s3:PutObject on the dynamodb-exports/* object prefix; DynamoDB chooses the object keys (AWSDynamoDB/<ExportId>/...), so a prefix wildcard is the narrowest possible grant.',
      },
    ]);
  }
}
