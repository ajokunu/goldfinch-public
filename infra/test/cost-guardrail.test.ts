import { App, Aspects, CfnResource, Stack } from 'aws-cdk-lib';
import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { CostGuardrailAspect } from '../lib/aspects/cost-guardrail';

const BANNED_MESSAGE = Match.stringLikeRegexp('\\[CostGuardrail\\] Banned resource type');

function guardedStack(context: Record<string, unknown> = {}): Stack {
  const app = new App({ context });
  const stack = new Stack(app, 'GuardrailTestStack', {
    env: { account: '111111111111', region: 'us-east-1' },
  });
  Aspects.of(stack).add(new CostGuardrailAspect());
  return stack;
}

describe('CostGuardrailAspect', () => {
  test('errors on a NAT Gateway', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Nat', {
      type: 'AWS::EC2::NatGateway',
      properties: { SubnetId: 'subnet-12345', AllocationId: 'eipalloc-12345' },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on an ALB (ELBv2)', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Alb', {
      type: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
      properties: { Type: 'application', Subnets: ['subnet-1', 'subnet-2'] },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on a classic ELB', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Elb', {
      type: 'AWS::ElasticLoadBalancing::LoadBalancer',
      properties: { Listeners: [] },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on an RDS instance', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Db', {
      type: 'AWS::RDS::DBInstance',
      properties: { DBInstanceClass: 'db.t4g.micro', Engine: 'postgres' },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on an RDS/Aurora cluster', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Cluster', {
      type: 'AWS::RDS::DBCluster',
      properties: { Engine: 'aurora-postgresql' },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on a provisioned-throughput DynamoDB table', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'ProvisionedTable', {
      type: 'AWS::DynamoDB::Table',
      properties: {
        KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on a VPC-attached Lambda', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'VpcFn', {
      type: 'AWS::Lambda::Function',
      properties: {
        Code: { ZipFile: 'exports.handler = async () => {};' },
        Handler: 'index.handler',
        Runtime: 'nodejs22.x',
        Role: 'arn:aws:iam::111111111111:role/some-role',
        VpcConfig: {
          SubnetIds: ['subnet-1'],
          SecurityGroupIds: ['sg-1'],
        },
      },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('errors on Lambda provisioned concurrency (alias)', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'FnAlias', {
      type: 'AWS::Lambda::Alias',
      properties: {
        FunctionName: 'some-fn',
        FunctionVersion: '1',
        Name: 'live',
        ProvisionedConcurrencyConfig: { ProvisionedConcurrentExecutions: 5 },
      },
    });
    Annotations.fromStack(stack).hasError('*', BANNED_MESSAGE);
  });

  test('a clean stack produces zero guardrail errors', () => {
    const stack = guardedStack();
    new CfnResource(stack, 'Bucket', {
      type: 'AWS::S3::Bucket',
      properties: {},
    });
    new CfnResource(stack, 'OnDemandTable', {
      type: 'AWS::DynamoDB::Table',
      properties: {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }],
      },
    });
    new CfnResource(stack, 'PlainFn', {
      type: 'AWS::Lambda::Function',
      properties: {
        Code: { ZipFile: 'exports.handler = async () => {};' },
        Handler: 'index.handler',
        Runtime: 'nodejs22.x',
        Role: 'arn:aws:iam::111111111111:role/some-role',
      },
    });
    Annotations.fromStack(stack).hasNoError('*', BANNED_MESSAGE);
  });

  test('an allowlisted banned type downgrades to a warning', () => {
    const stack = guardedStack({
      'costGuardrail:allow:AWS::EC2::NatGateway': 'COST-EXCEPTION-001',
    });
    new CfnResource(stack, 'SanctionedNat', {
      type: 'AWS::EC2::NatGateway',
      properties: { SubnetId: 'subnet-12345' },
    });
    const annotations = Annotations.fromStack(stack);
    annotations.hasNoError('*', BANNED_MESSAGE);
    annotations.hasWarning('*', Match.stringLikeRegexp('Sanctioned exception \\(COST-EXCEPTION-001\\)'));
  });
});
