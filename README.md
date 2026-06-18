<p align="center">
  <img src="docs/icon.png" alt="GoldFinch app icon" width="120" height="120" />
</p>

<h1 align="center">GoldFinch</h1>

Private, serverless household finance — a self-built Monarch Money replacement.
Daily bank sync, budgets, recurring detection, reports, goals, investments, CSV
import, and AI categorization, with native iOS + Android + web from one Expo
codebase, running on AWS for about $3-4/month all-in.

This is published as an **open reference architecture** — a complete, production-grade
example of a serverless personal-finance app: DynamoDB single-table design, a
cost-guardrail CDK that fails synthesis on any always-on resource, contract-parity
tests across workspaces, and a privacy posture where bank credentials never enter
the system. It is built for a single household (the data model partitions on one
`household` claim); you deploy it to your own AWS account and run it for yourself.
It is **not** a hosted service and not multi-tenant — see "Single-household by design."

## Screenshots

> Drop your own captures into `docs/screenshots/` and they render here.

| Dashboard | Budgets | Transactions | Investments |
|---|---|---|---|
| _add `docs/screenshots/dashboard.png`_ | _add `budgets.png`_ | _add `transactions.png`_ | _add `investments.png`_ |

## Architecture

```
Clients (Expo: iOS / Android / RN Web on CloudFront)
   | Cognito passkeys/OTP -> access token (household claim injected pre-token-gen)
   v
API Gateway HTTP API (JWT authorizer, routes derived from the shared manifest)
   -> Lambda app API ----------> DynamoDB single table (PK = USER#<household>)
   -> Lambda AI insights ------> Bedrock (rules first, model residual)
EventBridge (daily 9am ET) ----> Lambda SimpleFIN sync -> DynamoDB
                                   ^ SSM SecureString (the ONE secret), CMK with
                                     explicit Deny for every principal but sync
EventBridge (SyncCompleted) ---> Lambda notifications -> Expo Push
```

Load-bearing decisions:

- **No VPC, no NAT, no ALB, no always-on anything.** A CDK Aspect fails synthesis
  if a banned resource type appears. Cost ceiling and attack surface are the same
  guardrail.
- **One secret.** The SimpleFIN access URL (read-only bank feed) in SSM, KMS-encrypted,
  decryptable only by the sync role — enforced by an explicit key-policy Deny, not
  convention. Bank credentials never exist in this system; worst-case breach is
  read-only transaction history.
- **Identity from the token, never the client.** Every handler derives the DynamoDB
  partition from the JWT household claim. No request input selects whose data you get.
- **Field ownership by construction.** Sync writes are attribute-scoped updates over
  bank-owned fields only; user edits (categories, notes, account-type overrides) are
  physically untouchable by the nightly sync.
- **Contract parity as tests.** The gateway route table is generated from the same
  route manifest the Lambda router consumes; IAM grants are asserted against actual
  SDK calls; env vars set are diffed against env vars read. Cross-workspace drift
  fails the build.

## Tech stack

- **Client:** Expo / React Native (iOS, Android, web), TypeScript, Reanimated, Skia charts, phosphor duotone icons, native home-screen widgets (SwiftUI/WidgetKit + Jetpack Glance).
- **Backend:** AWS Lambda, API Gateway HTTP API, DynamoDB (single-table, on-demand), Cognito (passkeys / email OTP / optional TOTP), EventBridge Scheduler, KMS, SSM, S3 + CloudFront, Bedrock.
- **Infra:** AWS CDK (TypeScript), cdk-nag, a cost-guardrail Aspect, contract-parity tests.
- **Data:** SimpleFIN Bridge for read-only bank aggregation. Money is integer minor units + decimal strings, never floats; financial modules are mutation-tested (Stryker).

## Monorepo layout

| Path | What |
|---|---|
| `packages/shared` | Contracts: types, DTOs, key builders, money (integer minor units + decimal strings, never floats), SimpleFIN client, recurrence detector, rule matcher, budget math — mutation-tested (Stryker, financial modules held >= 85%) |
| `infra/` | CDK app: Data / Auth / Api / Sync / Notifications / Web / Application stacks, cost-guardrail Aspect, cdk-nag, parity tests |
| `services/api` | App API Lambda: 40+ routes, cursor pagination, version-conditional writes |
| `services/sync` | Daily SimpleFIN sync: idempotent upserts, pending->posted re-key repair, per-account cursors, recurrence detection, net-worth snapshots |
| `services/ai` | Rules-first categorization, Bedrock residual (cost-capped, degrades gracefully) |
| `services/notifications` | Budget threshold + sync push via Expo, receipt sweep |
| `app/` | Expo client: four-direction theme system, phosphor duotone identity icons, motion system (Reanimated), e2e via Playwright |
| `e2e/` | Playwright walkthrough: every screen, two themes, zero-console-error gate |

## Prerequisites

- An **AWS account** you control, with credentials configured locally (CDK deploys to `us-east-1`).
- **Node.js 20+** and npm.
- A **SimpleFIN Bridge** account and a setup token (about $15/year) — this is the read-only bank feed. See https://www.simplefin.org/ .
- Optional, for the mobile apps: an **Expo/EAS** account, and **Apple ($99/yr)** / **Google Play ($25)** developer accounts. The web client needs none of these.
- Optional: **Amazon Bedrock** model access (Claude Haiku) for AI categorization — the app degrades gracefully to rules-only without it.

## Quick start

```bash
npm install                 # root workspaces
npm run typecheck           # all workspaces
npm test                    # all workspaces
```

Configure your deployment (household id, the two user emails, domain/Cognito prefix)
via CDK context — copy `infra/cdk.json` context values or pass `-c goldfinch:userAEmail=...`.
Nothing here is a secret; the only secret (the SimpleFIN URL) is set after deploy.

```bash
cd infra
npx cdk bootstrap                 # once per account/region
npx cdk deploy --all              # Data / Auth / Api / Sync / Web / Notifications
```

After the stacks are up, store your SimpleFIN access URL (the script claims a setup
token and writes the resulting URL to SSM as a SecureString — it is never committed):

```bash
npm run claim-token --workspace services/sync     # claim + store the SimpleFIN URL
npm run verify-simplefin --workspace services/sync # confirm the feed responds
```

The daily sync runs on an EventBridge schedule; trigger an immediate sync from the
app's "Sync now", or invoke the sync Lambda directly.

### Web and mobile clients

```bash
# Web (no app-store accounts needed): export and host on the deployed S3/CloudFront
cd app && npx expo export -p web

# Native builds (need an EAS account; widgets need your own Apple/Google accounts)
npx eas-cli build -p android --profile preview
npx eas-cli build -p ios --profile production
```

The `EXPO_PUBLIC_*` values in `eas.json` point the client at the API/Cognito; set
them to your own deployed endpoints.

## Cost

About **$3-4/month all-in** for one household: SimpleFIN (~$1.25), a KMS CMK ($1),
S3+CloudFront (~$1), Route53 ($0.50), and a few cents of Bedrock/DynamoDB/Lambda
(all within or near the always-free tiers). The cost-guardrail Aspect makes this
structural — it refuses to synthesize a stack containing any hourly/always-on
resource type.

## Single-household by design

The data model partitions every item on `PK = USER#<household>`, and the household
id is injected into the access token by a Cognito pre-token-generation trigger — it
is never taken from client input. This is a deliberate simplification: one deploy
serves one household (the reference design is two users). There is no signup,
billing, per-tenant isolation, or admin console. Making it multi-tenant would be a
substantial rebuild, not a config change. Run one deploy per household.

## Security posture

- Bank credentials never enter the system — only a read-only SimpleFIN access URL,
  stored once in SSM as a KMS-encrypted SecureString that only the sync role can decrypt.
- Every API route sits behind a Cognito JWT authorizer; identity is derived from the
  token's household claim, never from request parameters.
- The `EXPO_PUBLIC_*` API and Cognito identifiers ship in the client bundle by design
  (as in any SPA/mobile app); they grant no data access without a valid token.

## License

MIT — see [LICENSE](./LICENSE).
