#!/usr/bin/env node
import { App, Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ApiStack } from '../lib/api-stack';
import { ApplicationStack } from '../lib/application-stack';
import { CostGuardrailAspect } from '../lib/aspects/cost-guardrail';
import { AuthStack } from '../lib/auth-stack';
import { getConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { NotificationsStack } from '../lib/notifications-stack';
import { SyncStack } from '../lib/sync-stack';
import { WebStack } from '../lib/web-stack';

const app = new App();
const config = getConfig(app);

// Explicit env on every stack: env-agnostic stacks cannot do context lookups
// and produce dummy values. Region is pinned to us-east-1 (Bedrock, ACM for
// CloudFront, and the cost model all assume it).
const env = {
  account:
    process.env.CDK_DEFAULT_ACCOUNT ??
    (app.node.tryGetContext('account') as string | undefined),
  region: 'us-east-1',
};

// Cost-allocation tags: Project + Application on everything, Component per
// stack (set inside each stack's constructor). The AppRegistry-managed
// awsApplication tag is applied via stack association (application-stack.ts).
Tags.of(app).add('Project', 'GoldFinch');
Tags.of(app).add('Application', 'GoldFinch');
// myApplications rollup: the AppRegistry CFN_STACK association (application-
// stack.ts) tags the STACKS but not their resources, so resources do not show
// under GoldFinch in the myApplications console view. Stamping the application's
// managed `awsApplication` tag (its resource-group ARN) on every resource fixes
// that. Static string (not a cross-stack token), so no dependency cycle with
// the application stack that owns the association.
Tags.of(app).add(
  'awsApplication',
  process.env.GOLDFINCH_APPLICATION_TAG_ARN ?? '<APPLICATION_RESOURCE_GROUP_ARN>',
);

// Synth-time guardrails: the cost aspect bans always-on resource types
// outright; cdk-nag AwsSolutions hardens what is allowed to exist.
Aspects.of(app).add(new CostGuardrailAspect());
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const data = new DataStack(app, `GoldFinch-Data-${config.env}`, { env, config });

const auth = new AuthStack(app, `GoldFinch-Auth-${config.env}`, { env, config });

// SyncStack before ApiStack: ApiStack consumes sync.syncFn (POST /sync/run
// invoke grant + SYNC_FN_NAME env), so Api now depends on Sync. Acyclic:
// SyncStack consumes only Data + config, nothing from Api.
const sync = new SyncStack(app, `GoldFinch-Sync-${config.env}`, {
  env,
  config,
  table: data.table,
});

const api = new ApiStack(app, `GoldFinch-Api-${config.env}`, {
  env,
  config,
  table: data.table,
  issuerUrl: auth.issuerUrl,
  appClientId: auth.userPoolClient.userPoolClientId,
  syncFn: sync.syncFn,
});

const notifications = new NotificationsStack(app, `GoldFinch-Notifications-${config.env}`, {
  env,
  config,
  table: data.table,
  alertsTopic: sync.alertsTopic,
});

const web = new WebStack(app, `GoldFinch-Web-${config.env}`, { env, config });

// myApplications: one AppRegistry application containing every GoldFinch
// stack. Deployed last; associations require the member stacks to exist.
const memberStacks = [data, auth, api, sync, notifications, web];
const application = new ApplicationStack(app, `GoldFinch-Application-${config.env}`, {
  env,
  config,
  memberStackNames: memberStacks.map((s) => s.stackName),
});
for (const member of memberStacks) {
  application.addDependency(member);
}

app.synth();
