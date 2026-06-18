---
name: contract-parity
description: Audit cross-workspace contract drift after any parallel or multi-agent build, after merging branches that touch different layers, and before any deploy. Use when multiple agents/PRs built separate workspaces (infra, services, client) against a shared plan, or when the user says "check the wiring", "contract audit", or "did everything connect".
---

# Contract Parity Audit

Parallel agents (or parallel humans) building separate workspaces against a shared plan
produce code that is individually correct and collectively broken: each side of every
cross-boundary contract typechecks and passes its own tests while the contract itself
was never checked. Unit-test suites cannot catch this — only tracing both sides of each
boundary can.

This failure class is real, not hypothetical. One parallel build of this stack shipped,
in a single pass: six API routes implemented in the Lambda router but never registered
at the gateway (dashboard dead in prod), a registered route with no handler, a DELETE
handler whose IAM role lacked DeleteItem, a Lambda missing its TABLE_NAME env var with
zero DynamoDB permissions and no trigger, an entire service workspace deployed by no
stack, and a client calling a route that existed nowhere — all while every workspace's
tests were green.

## Procedure

Enumerate every boundary the change set crosses, then verify each leg by READING BOTH
SIDES — never trust one side's constants, comments, or tests as proof of the other.
For large diffs, fan out one tracer agent per leg in parallel.

### The seven legs

1. **Route parity (three-way).** Gateway/proxy route table vs server router vs client
   call sites. Diff all three pairwise: a route in the router but not the gateway 404s
   before the code runs; a gateway route with no handler 404s after auth; a client path
   nobody serves fails silently if the call is fire-and-forget.
2. **IAM/permissions vs calls actually made.** For each function/role, list the SDK or
   API calls the code actually issues (grep the source, not the docs) and diff against
   the granted actions. Check both directions: missing grants (runtime AccessDenied)
   and excess grants (least-privilege violation).
3. **Env/config vs reads.** Every env var, parameter, or config key the code reads must
   be set by the thing that deploys it; every one set must be read. Empty-string
   defaults hide this until cold start.
4. **Events: every producer has a consumer, every consumer a producer.** A handler
   subscribed to events nothing emits is dead code; an emitted event nobody consumes is
   a silent gap. Grep for the event names on both sides.
5. **Deployment reachability.** Every workspace/package must be deployed by something,
   and everything deployed must have a real implementation behind it (watch for stub
   generators, feature flags, and placeholder entries that synth/build will happily
   ship). Walk from the deploy entry point to each artifact and back.
6. **Single source of truth for shared rules.** Business rules implemented in more than
   one writer/renderer (index membership, rounding, date bucketing, threshold math)
   WILL diverge. Grep for the rule's distinguishing tokens across workspaces; if it
   appears twice, extract it to the shared package and point both at it.
7. **Latent-flag audit.** Anything gated behind a disabled flag must be audited as if
   enabled — flag-gated misconfiguration is invisible until the day the flag flips.

### After the audit

- Fix drift at the right altitude: derive one side from the other (e.g. build the
  gateway route table FROM the shared route manifest) so the drift class becomes
  impossible, not merely fixed once.
- Encode each leg as an automated parity test where the stack allows (route manifest
  equality, IAM action-list assertions against grepped SDK calls, env-var contract
  tests). A leg with a parity test never needs this audit again.
- Report findings with file:line on BOTH sides of every broken contract, ranked by
  user-visible impact. Anything broken in deployed environments outranks latent issues.

## Standing rule

Run this audit unprompted whenever work was split across parallel agents or merged from
parallel branches, and always before a deploy that includes such work. Per-workspace
green is not done; parity-verified is done.
