import { Annotations, CfnResource, IAspect } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * CostGuardrailAspect
 *
 * Synth-time enforcement of GoldFinch's hard cost constraints: nothing that
 * bills by the hour, no always-on infrastructure, scale-to-zero everywhere.
 * Any banned resource type adds an error annotation, which makes `cdk synth`
 * (and therefore CI and deploy) fail before a dollar is ever spent.
 *
 * Banned at synth:
 * - NAT Gateways (AWS::EC2::NatGateway)
 * - Load balancers, classic and v2 (ALB/NLB/ELB)
 * - RDS / Aurora instances and clusters
 * - DynamoDB tables with provisioned throughput (drift from on-demand)
 * - VPC-attached Lambda functions (which would pull in NAT for egress)
 * - Lambda provisioned concurrency (aliases/versions with a
 *   ProvisionedConcurrencyConfig)
 *
 * Sanctioned exceptions: set the CDK context key
 * `costGuardrail:allow:<CfnResourceType>` (e.g.
 * `-c "costGuardrail:allow:AWS::EC2::NatGateway=issue-123"`) to downgrade the
 * error to a warning. Every exception needs a written reason recorded in
 * cost/EXCEPTIONS.md.
 */
export class CostGuardrailAspect implements IAspect {
  private static readonly BANNED_TYPES: Record<string, string> = {
    'AWS::EC2::NatGateway': 'NAT Gateways bill ~$32/mo + data processing',
    'AWS::ElasticLoadBalancingV2::LoadBalancer': 'ALB/NLB bill hourly',
    'AWS::ElasticLoadBalancing::LoadBalancer': 'Classic ELBs bill hourly',
    'AWS::RDS::DBInstance': 'RDS instances are always-on compute',
    'AWS::RDS::DBCluster': 'RDS/Aurora clusters are always-on compute',
  };

  public visit(node: IConstruct): void {
    if (!(node instanceof CfnResource)) {
      return;
    }
    const type = node.cfnResourceType;

    const flatBanReason = CostGuardrailAspect.BANNED_TYPES[type];
    if (flatBanReason !== undefined) {
      this.flag(node, type, flatBanReason);
      return;
    }

    if (type === 'AWS::DynamoDB::Table') {
      const billingMode = this.prop(node, 'BillingMode', 'billingMode');
      const provisioned = this.prop(node, 'ProvisionedThroughput', 'provisionedThroughput');
      if (provisioned !== undefined || billingMode === 'PROVISIONED') {
        this.flag(node, type, 'DynamoDB must stay PAY_PER_REQUEST (on-demand), never provisioned throughput');
      }
      return;
    }

    if (type === 'AWS::Lambda::Function') {
      const vpcConfig = this.prop(node, 'VpcConfig', 'vpcConfig');
      if (this.isNonEmpty(vpcConfig)) {
        this.flag(node, type, 'VPC-attached Lambdas require NAT for egress; GoldFinch is no-VPC by design');
      }
      return;
    }

    if (type === 'AWS::Lambda::Alias' || type === 'AWS::Lambda::Version') {
      const pc = this.prop(node, 'ProvisionedConcurrencyConfig', 'provisionedConcurrencyConfig');
      if (this.isNonEmpty(pc)) {
        this.flag(node, type, 'Lambda provisioned concurrency is an always-on charge');
      }
    }
  }

  /**
   * Read a CFN property off the resource. Raw CfnResource instances carry
   * PascalCase CFN keys; generated L1s expose camelCase accessors.
   */
  private prop(node: CfnResource, cfnKey: string, l1Key: string): unknown {
    const asAny = node as unknown as Record<string, unknown>;
    if (asAny[l1Key] !== undefined) {
      return asAny[l1Key];
    }
    const raw = (node as unknown as { cfnProperties?: Record<string, unknown> }).cfnProperties;
    if (raw !== undefined) {
      if (raw[cfnKey] !== undefined) {
        return raw[cfnKey];
      }
      if (raw[l1Key] !== undefined) {
        return raw[l1Key];
      }
    }
    return undefined;
  }

  private isNonEmpty(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return true;
  }

  private flag(node: CfnResource, type: string, reason: string): void {
    const allowKey = `costGuardrail:allow:${type}`;
    const allowRef = node.node.tryGetContext(allowKey);
    const message =
      `[CostGuardrail] Banned resource type ${type} at ${node.node.path}: ${reason}. ` +
      'This violates the no-NAT/no-ALB/no-always-on-RDS scale-to-zero cost policy ' +
      '(see cost/ACCOUNT-FACTS.md). To request a sanctioned exception, set the ' +
      `context key "${allowKey}" to an issue reference and record it in cost/EXCEPTIONS.md.`;
    if (allowRef !== undefined && allowRef !== null && allowRef !== false) {
      Annotations.of(node).addWarning(
        `[CostGuardrail] Sanctioned exception (${String(allowRef)}) for banned resource type ${type} at ${node.node.path}.`,
      );
      return;
    }
    Annotations.of(node).addError(message);
  }
}
