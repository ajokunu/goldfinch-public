import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  CfnApplication,
  CfnResourceAssociation,
} from 'aws-cdk-lib/aws-servicecatalogappregistry';
import { Construct } from 'constructs';

import { EnvConfig } from './config';

export interface ApplicationStackProps extends StackProps {
  readonly config: EnvConfig;
  /** Stack names (not tokens) of every other GoldFinch stack to associate. */
  readonly memberStackNames: readonly string[];
}

/**
 * AWS myApplications / Service Catalog AppRegistry application that groups
 * every GoldFinch stack into one Application in the AWS console (Applications
 * view: unified cost, health, and resource listing).
 *
 * Mechanism: a CFN_STACK ResourceAssociation per member stack. AppRegistry
 * then applies the application's `awsApplication` tag (whose value is the
 * application ARN - unknowable at synth time, which is why we associate
 * stacks rather than tag resources ourselves) to each associated stack so
 * its resources roll up in myApplications. The plain `Application=GoldFinch`
 * tag on every resource is applied app-wide in bin/goldfinch.ts for
 * cost-allocation and console filtering alongside Project/Component.
 *
 * This stack must deploy AFTER the member stacks exist; bin/goldfinch.ts
 * adds explicit dependencies.
 */
export class ApplicationStack extends Stack {
  readonly application: CfnApplication;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);
    Tags.of(this).add('Component', 'application-registry');

    this.application = new CfnApplication(this, 'GoldFinchApplication', {
      name: 'GoldFinch',
      description:
        'Private serverless household finance app (Monarch replacement): ' +
        'Cognito auth, DynamoDB single table, API Gateway + Lambda, SimpleFIN ' +
        'daily sync, notifications, AI insights, S3/CloudFront web client.',
    });

    for (const stackName of props.memberStackNames) {
      new CfnResourceAssociation(this, `Assoc${stackName.replace(/[^A-Za-z0-9]/g, '')}`, {
        application: this.application.attrId,
        resource: stackName,
        resourceType: 'CFN_STACK',
      });
    }

    new CfnOutput(this, 'ApplicationArn', { value: this.application.attrArn });
    new CfnOutput(this, 'ApplicationTagValue', {
      value: this.application.attrApplicationTagValue,
      description:
        'Value of the awsApplication tag AppRegistry applies to associated resources',
    });
  }
}
