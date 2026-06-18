# @goldfinch/service-ai

AI insights Lambda (master plan section 11): rules-first transaction
categorization with a Bedrock (Claude Haiku 4.5) fallback, plus the monthly
cashflow summary generator.

## Entry points (`src/handler.ts`)

| Export                  | Trigger                              | What it does |
| ----------------------- | ------------------------------------ | ------------ |
| `handler`               | EventBridge, after each sync run     | Loads CATEGORY# and RULE# items, applies the deterministic rule engine (exact > prefix > contains) to uncategorized transactions, sends only the residual to Bedrock in batched InvokeModel calls, applies suggestions with confidence >= 0.8. |
| `monthlySummaryHandler` | EventBridge monthly schedule         | Computes month + trailing-3-month rollups in integer minor units, then makes ONE Bedrock call to phrase the narrative; writes `INSIGHT#SUMMARY#<yyyy-mm>` with an `inputDigest` so unchanged months cost zero tokens. |

Both degrade gracefully: any Bedrock failure leaves transactions uncategorized
and skips the summary write. User-categorized transactions are never
overwritten (in-memory filter + DynamoDB ConditionExpression).

## Data items owned by this service

- `RULE#<matchType>#<normalizedPattern>` (`entityType: CATEGORY_RULE`) — payee
  pattern to categoryId map. The transactions PATCH path should upsert an
  `exact` rule via `buildRuleItem()` when a user corrects a category.
- `INSIGHT#SUMMARY#<yyyy-mm>` (`entityType: INSIGHT_SUMMARY`) — the monthly
  narrative.

## Cost control

- Rules run first at zero token cost; only the residual reaches Bedrock.
- Many transactions per InvokeModel call (`AI_BATCH_SIZE`, default 12).
- Hard per-run call cap (`AI_MAX_BEDROCK_CALLS`, default 4) with an absolute
  in-code ceiling of 10 that no configuration can exceed.
- Token usage, call counts, and failure counters are emitted as EMF metrics in
  namespace `GoldFinch/AI` (dimension `Operation` = `categorize` | `summarize`)
  for the Bedrock spend alarm.

## Environment

| Variable                  | Default                                        |
| ------------------------- | ---------------------------------------------- |
| `GOLDFINCH_TABLE_NAME`    | (required)                                     |
| `GOLDFINCH_HOUSEHOLD`     | `goldfinch-home`                               |
| `BEDROCK_MODEL_ID`        | `us.anthropic.claude-haiku-4-5-20251001-v1:0`  |
| `BEDROCK_REGION`          | falls back to `AWS_REGION`                     |
| `AI_MAX_BEDROCK_CALLS`    | `4` (clamped to 0..10)                         |
| `AI_BATCH_SIZE`           | `12`                                           |
| `AI_CATEGORIZE_MAX_TOKENS`| `512`                                          |
| `AI_SUMMARY_MAX_TOKENS`   | `600`                                          |
| `AI_CONFIDENCE_THRESHOLD` | `0.8`                                          |
| `AI_LOOKBACK_DAYS`        | `30`                                           |

## IAM (for the infra stack)

- `dynamodb:Query`, `dynamodb:GetItem`, `dynamodb:PutItem`,
  `dynamodb:UpdateItem` on the table (household partition access patterns
  only; no scans needed).
- `bedrock:InvokeModel` on BOTH the inference-profile ARN and the
  foundation-model ARNs in us-east-1 / us-east-2 / us-west-2 (the
  dual-resource policy from the master plan; either alone yields a 403).
- No SSM, no KMS. The SimpleFIN secret never reaches this function.

Note: this deviates from the plan's "AI Lambda holds Bedrock permissions and
nothing else" sketch because the build brief for this part has the Lambda read
uncategorized transactions and write categories itself (EventBridge-after-sync,
not API-invoked). The DynamoDB grant above is the minimum for that contract.

## Tests

`npm test -w @goldfinch/service-ai` — rule precedence, batching/cap logic with
a mocked Bedrock invoker, rollup math, digest idempotency.
