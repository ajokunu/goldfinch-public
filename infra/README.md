# GoldFinch Infrastructure (AWS CDK v2, TypeScript)

This workspace owns every AWS resource. Five stacks, one app entry
(`bin/goldfinch.ts`), pinned to `us-east-1`, tagged `Project=GoldFinch` plus a
per-stack `Component` tag, guarded at synth by `CostGuardrailAspect` (bans NAT,
ALB/ELB, RDS, provisioned DynamoDB, VPC Lambdas, provisioned concurrency) and
cdk-nag `AwsSolutionsChecks`.

## Stacks

| Stack | Component | Contents |
|---|---|---|
| `GoldFinch-Data-<env>` | data | Single table `GoldFinch` (PK/SK, GSI1/GSI2 INCLUDE projections, on-demand, PITR 35d, deletion protection, RETAIN); `goldfinch-backups-<acct>-us-east-1` bucket; weekly codeless `FULL_EXPORT` schedule `cron(30 6 ? * SUN *)` + scoped export role |
| `GoldFinch-Auth-<env>` | auth | Cognito pool (Essentials, closed, passkey + EMAIL_OTP, Managed Login), resource server `goldfinch` scope `api`, public app client (`ALLOW_USER_AUTH`, PKCE, no secret), pre-token-gen V2 Lambda injecting `household=goldfinch-home` into ACCESS tokens, two `CfnUserPoolUser`s |
| `GoldFinch-Api-<env>` | api | HTTP API + JWT authorizer (issuer = pool URL, audience = app client id, scope `goldfinch/api` per route), single API NodejsFunction with Query/GetItem/PutItem/UpdateItem on the table + GSIs only |
| `GoldFinch-Sync-<env>` | sync | CMK `alias/goldfinch/simplefin` (decrypt: sync role only), SSM param REFERENCE `/goldfinch/prod/simplefin/access-url`, sync NodejsFunction, daily schedule `cron(0 9 * * ? *)` America/New_York, SQS DLQ, alarms to SNS `goldfinch-alerts`, optional Bedrock AI fn (`-c goldfinch:aiEnabled=true`) |
| `GoldFinch-Web-<env>` | web | Private S3 web bucket + CloudFront (OAC, SPA rewrite function, 403/404 to index.html) |

## Cross-workspace contract

- Lambda entries are repo-root-relative constants in `lib/handler-paths.ts`:
  `services/api/src/handler.ts`, `services/sync/src/handler.ts`,
  `services/ai/src/handler.ts`. `resolveHandler()` substitutes a throwing stub
  (under `infra/.synth-stubs/`, git-ignored) until those files exist, so synth
  and tests never block on parallel workspaces.
- Handler env vars: API gets `TABLE_NAME`, `GSI1_NAME`, `GSI2_NAME`,
  `DEFAULT_TZ`, `BASE_CURRENCY`, `ATTACHMENTS_BUCKET`; sync gets `TABLE_NAME`,
  `GSI1_NAME`, `GSI2_NAME`, `HOUSEHOLD_ID`, `SIMPLEFIN_PARAM_NAME` (the NAME,
  never the value), `OVERLAP_BUFFER_DAYS`, `MAX_HISTORY_DAYS`,
  `METRICS_NAMESPACE`, `BASE_CURRENCY`, `EVENT_BUS_NAME`, `EVENT_SOURCE`; AI
  gets `TABLE_NAME`, `GOLDFINCH_HOUSEHOLD`, `BEDROCK_MODEL_ID`; notifications
  gets `TABLE_NAME`, `EXPO_ACCESS_TOKEN_PARAM`. Every var set here is read by
  its service (in-code defaults cover the optional knobs); the contract-parity
  audit checks both directions.
- The household partition is always derived from the JWT `household` claim
  (constant `goldfinch-home`), never from client input.

## One-time manual steps (never in IaC)

1. Create the secret value (after the CMK exists):
   `aws ssm put-parameter --name /goldfinch/prod/simplefin/access-url \
    --type SecureString --key-id alias/goldfinch/simplefin \
    --value '<access-url>' --region us-east-1`
2. Real user emails via context:
   `-c goldfinch:userAEmail=... -c goldfinch:userBEmail=...` (placeholders are
   `aaron@example.com` / `dami@example.com`).
3. Alert email: `-c goldfinch:alertEmail=...` subscribes it to
   `goldfinch-alerts`.

## Commands

```
npm run typecheck --workspace infra
npm run test --workspace infra
npm run synth --workspace infra      # cdk synth (fails on guardrail/nag errors)
```

Tests skip esbuild bundling via the `aws:cdk:bundling-stacks` context escape
hatch, so they run before the service workspaces exist.
