/**
 * Bedrock module unit tests with a mocked ModelInvoker:
 * request-body contract, JSON parsing/validation, batching and the hard
 * per-run call cap (the cost-control invariants).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCategorizationRequest,
  buildCategorizationSystemPrompt,
  buildSummaryRequest,
  categorizeResidual,
  chunk,
  filterConfident,
  isModelAccessError,
  parseCategorizationResponse,
  parseSummaryResponse,
  BedrockResponseError,
} from '../src/bedrock.js';
import type {
  AnthropicRequestBody,
  AnthropicResponseBody,
  CategoryDescriptor,
  ModelInvoker,
  ResidualTxn,
} from '../src/bedrock.js';
import { ANTHROPIC_VERSION } from '../src/config.js';

const CATEGORIES: CategoryDescriptor[] = [
  { categoryId: 'coffee', name: 'Coffee', type: 'EXPENSE' },
  { categoryId: 'groceries', name: 'Groceries', type: 'EXPENSE' },
  { categoryId: 'salary', name: 'Salary', type: 'INCOME' },
];

function txn(id: number): ResidualTxn {
  return { txnId: `t${id}`, payee: `PAYEE ${id}`, amount: '-1.00' };
}

function txns(count: number): ResidualTxn[] {
  return Array.from({ length: count }, (_, i) => txn(i + 1));
}

function okResponse(
  results: Array<{ txnId: string; categoryId: string; confidence: number }>,
  usage = { input_tokens: 100, output_tokens: 20 },
): AnthropicResponseBody {
  return {
    content: [{ type: 'text', text: JSON.stringify({ results }) }],
    stop_reason: 'end_turn',
    usage,
  };
}

class MockInvoker implements ModelInvoker {
  calls: AnthropicRequestBody[] = [];
  constructor(
    private readonly respond: (
      body: AnthropicRequestBody,
      callIndex: number,
    ) => AnthropicResponseBody | Error,
  ) {}

  async invoke(body: AnthropicRequestBody): Promise<AnthropicResponseBody> {
    const index = this.calls.length;
    this.calls.push(body);
    const out = this.respond(body, index);
    if (out instanceof Error) {
      throw out;
    }
    return out;
  }
}

/** Echo every txn in the batch back at the given confidence. */
function echoInvoker(confidence = 0.95): MockInvoker {
  return new MockInvoker((body) => {
    const payload = JSON.parse(body.messages[0]!.content) as {
      transactions: ResidualTxn[];
    };
    return okResponse(
      payload.transactions.map((t) => ({
        txnId: t.txnId,
        categoryId: 'coffee',
        confidence,
      })),
    );
  });
}

describe('request body contract', () => {
  it('builds the Bedrock Messages shape with cached system prompt', () => {
    const system = buildCategorizationSystemPrompt(CATEGORIES);
    const body = buildCategorizationRequest(system, txns(2), 512);
    assert.equal(body.anthropic_version, ANTHROPIC_VERSION);
    assert.equal(body.anthropic_version, 'bedrock-2023-05-31');
    assert.equal(body.max_tokens, 512);
    assert.equal(body.system.length, 1);
    assert.deepEqual(body.system[0]!.cache_control, { type: 'ephemeral' });
    assert.equal(body.system[0]!.text, system);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]!.role, 'user');
    const payload = JSON.parse(body.messages[0]!.content) as {
      transactions: unknown[];
    };
    assert.equal(payload.transactions.length, 2);
  });

  it('system prompt lists every category id and is deterministic', () => {
    const a = buildCategorizationSystemPrompt(CATEGORIES);
    const b = buildCategorizationSystemPrompt([...CATEGORIES].reverse());
    assert.equal(a, b); // byte-identical regardless of input order (cacheable)
    for (const c of CATEGORIES) {
      assert.ok(a.includes(`- ${c.categoryId}: ${c.name} (${c.type})`));
    }
  });

  it('summary request uses the summary system prompt and max_tokens', () => {
    const body = buildSummaryRequest('{"month":"2026-05"}', 600);
    assert.equal(body.anthropic_version, 'bedrock-2023-05-31');
    assert.equal(body.max_tokens, 600);
    assert.deepEqual(body.system[0]!.cache_control, { type: 'ephemeral' });
    assert.equal(body.messages[0]!.content, '{"month":"2026-05"}');
  });
});

describe('parseCategorizationResponse', () => {
  const valid = new Set(['coffee', 'groceries']);
  const batchIds = new Set(['t1', 't2']);

  it('parses valid strict JSON', () => {
    const out = parseCategorizationResponse(
      okResponse([{ txnId: 't1', categoryId: 'coffee', confidence: 0.91 }]),
      valid,
      batchIds,
    );
    assert.deepEqual(out, [{ txnId: 't1', categoryId: 'coffee', confidence: 0.91 }]);
  });

  it('tolerates a markdown fence but rejects non-JSON', () => {
    const fenced: AnthropicResponseBody = {
      content: [
        {
          type: 'text',
          text: '```json\n{"results":[{"txnId":"t1","categoryId":"coffee","confidence":0.9}]}\n```',
        },
      ],
    };
    assert.equal(parseCategorizationResponse(fenced, valid, batchIds).length, 1);

    const prose: AnthropicResponseBody = {
      content: [{ type: 'text', text: 'Sure! The category is coffee.' }],
    };
    assert.throws(
      () => parseCategorizationResponse(prose, valid, batchIds),
      BedrockResponseError,
    );
  });

  it('rejects responses without a results array or without text', () => {
    assert.throws(
      () =>
        parseCategorizationResponse(
          { content: [{ type: 'text', text: '{"answer":42}' }] },
          valid,
          batchIds,
        ),
      BedrockResponseError,
    );
    assert.throws(
      () => parseCategorizationResponse({ content: [] }, valid, batchIds),
      BedrockResponseError,
    );
  });

  it('drops hallucinated categories, foreign txnIds, duplicates; clamps confidence', () => {
    const out = parseCategorizationResponse(
      okResponse([
        { txnId: 't1', categoryId: 'made-up', confidence: 0.99 },
        { txnId: 'not-in-batch', categoryId: 'coffee', confidence: 0.99 },
        { txnId: 't1', categoryId: 'coffee', confidence: 1.7 },
        { txnId: 't1', categoryId: 'groceries', confidence: 0.9 },
      ]),
      valid,
      batchIds,
    );
    assert.deepEqual(out, [{ txnId: 't1', categoryId: 'coffee', confidence: 1 }]);
  });
});

describe('filterConfident', () => {
  it('keeps only suggestions at or above the threshold', () => {
    const out = filterConfident(
      [
        { txnId: 'a', categoryId: 'coffee', confidence: 0.79 },
        { txnId: 'b', categoryId: 'coffee', confidence: 0.8 },
        { txnId: 'c', categoryId: 'coffee', confidence: 0.99 },
      ],
      0.8,
    );
    assert.deepEqual(
      out.map((s) => s.txnId),
      ['b', 'c'],
    );
  });
});

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 3), []);
  });
  it('rejects non-positive sizes', () => {
    assert.throws(() => chunk([1], 0), RangeError);
  });
});

describe('categorizeResidual batching and the hard cap', () => {
  it('one batch means exactly ONE InvokeModel call (cost test)', async () => {
    const invoker = echoInvoker();
    const result = await categorizeResidual(txns(10), CATEGORIES, invoker, {
      batchSize: 12,
      maxCalls: 4,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 1);
    assert.equal(result.bedrockCalls, 1);
    assert.equal(result.suggestions.length, 10);
    assert.equal(result.txnsSkipped, 0);
  });

  it('splits 25 txns into 3 calls at batchSize 10', async () => {
    const invoker = echoInvoker();
    const result = await categorizeResidual(txns(25), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 3);
    assert.equal(result.bedrockCalls, 3);
    assert.equal(result.suggestions.length, 25);
  });

  it('enforces the hard cap and reports skipped batches/txns', async () => {
    const invoker = echoInvoker();
    const result = await categorizeResidual(txns(25), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 2,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 2);
    assert.equal(result.bedrockCalls, 2);
    assert.equal(result.suggestions.length, 20);
    assert.equal(result.batchesSkipped, 1);
    assert.equal(result.txnsSkipped, 5);
  });

  it('maxCalls 0 makes zero calls and skips everything', async () => {
    const invoker = echoInvoker();
    const result = await categorizeResidual(txns(7), CATEGORIES, invoker, {
      batchSize: 3,
      maxCalls: 0,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 0);
    assert.equal(result.bedrockCalls, 0);
    assert.equal(result.txnsSkipped, 7);
    assert.equal(result.batchesSkipped, 3);
  });

  it('empty residual never calls Bedrock', async () => {
    const invoker = echoInvoker();
    const result = await categorizeResidual([], CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 4,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 0);
    assert.equal(result.bedrockCalls, 0);
  });

  it('stops calling after an invocation failure (graceful degradation)', async () => {
    const invoker = new MockInvoker((body, index) => {
      if (index === 1) {
        return new Error('ThrottlingException');
      }
      const payload = JSON.parse(body.messages[0]!.content) as {
        transactions: ResidualTxn[];
      };
      return okResponse(
        payload.transactions.map((t) => ({
          txnId: t.txnId,
          categoryId: 'coffee',
          confidence: 0.9,
        })),
      );
    });
    const result = await categorizeResidual(txns(30), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    // Call 1 succeeds, call 2 throws, call 3 is never attempted.
    assert.equal(invoker.calls.length, 2);
    assert.equal(result.suggestions.length, 10);
    assert.equal(result.batchesSkipped, 2); // the failed batch + the unattempted one
    assert.equal(result.txnsSkipped, 20);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!, /ThrottlingException/);
  });

  it('a malformed batch response is discarded but the run continues', async () => {
    const invoker = new MockInvoker((body, index) => {
      if (index === 0) {
        return { content: [{ type: 'text', text: 'NOT JSON AT ALL' }] };
      }
      const payload = JSON.parse(body.messages[0]!.content) as {
        transactions: ResidualTxn[];
      };
      return okResponse(
        payload.transactions.map((t) => ({
          txnId: t.txnId,
          categoryId: 'groceries',
          confidence: 0.85,
        })),
      );
    });
    const result = await categorizeResidual(txns(20), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 2);
    assert.equal(result.parseFailures, 1);
    assert.equal(result.suggestions.length, 10);
    assert.equal(result.errors.length, 1);
  });

  it('accumulates token usage across calls (EMF inputs)', async () => {
    const invoker = new MockInvoker((body) => {
      const payload = JSON.parse(body.messages[0]!.content) as {
        transactions: ResidualTxn[];
      };
      return okResponse(
        payload.transactions.map((t) => ({
          txnId: t.txnId,
          categoryId: 'coffee',
          confidence: 0.9,
        })),
        {
          input_tokens: 100,
          output_tokens: 25,
          // exercised: cache fields are optional on the wire
          ...{ cache_read_input_tokens: 40, cache_creation_input_tokens: 5 },
        },
      );
    });
    const result = await categorizeResidual(txns(20), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    assert.deepEqual(result.usage, {
      inputTokens: 200,
      outputTokens: 50,
      cacheReadInputTokens: 80,
      cacheCreationInputTokens: 10,
    });
  });

  it('flags modelAccessDenied on AccessDeniedException and stops calling (P7-5)', async () => {
    const invoker = new MockInvoker(() =>
      Object.assign(
        new Error("You don't have access to the model with the specified model ID."),
        { name: 'AccessDeniedException' },
      ),
    );
    const result = await categorizeResidual(txns(30), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    assert.equal(invoker.calls.length, 1);
    assert.equal(result.modelAccessDenied, true);
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.batchesSkipped, 3);
    assert.equal(result.txnsSkipped, 30);
    assert.equal(result.errors.length, 1);
  });

  it('does NOT flag modelAccessDenied for ordinary availability failures', async () => {
    const invoker = new MockInvoker(() =>
      Object.assign(new Error('Too many requests'), { name: 'ThrottlingException' }),
    );
    const result = await categorizeResidual(txns(5), CATEGORIES, invoker, {
      batchSize: 10,
      maxCalls: 5,
      maxTokens: 512,
    });
    assert.equal(result.modelAccessDenied, false);
    assert.equal(result.errors.length, 1);
  });
});

describe('isModelAccessError', () => {
  it('classifies the typed exception by name', () => {
    assert.equal(
      isModelAccessError(Object.assign(new Error('x'), { name: 'AccessDeniedException' })),
      true,
    );
  });

  it('falls back to model-not-enabled message fragments', () => {
    assert.equal(
      isModelAccessError(
        new Error("You don't have access to the model with the specified model ID."),
      ),
      true,
    );
    assert.equal(
      isModelAccessError(new Error('Model X has not been enabled for this account')),
      true,
    );
    assert.equal(
      isModelAccessError(
        new Error(
          'User: arn:aws:sts::1:assumed-role/ai is not authorized to perform: bedrock:InvokeModel',
        ),
      ),
      true,
    );
  });

  it('never classifies transient or unrelated failures', () => {
    assert.equal(isModelAccessError(new Error('ThrottlingException: slow down')), false);
    assert.equal(
      isModelAccessError(Object.assign(new Error('boom'), { name: 'ServiceUnavailableException' })),
      false,
    );
    assert.equal(isModelAccessError('AccessDeniedException'), false);
    assert.equal(isModelAccessError(null), false);
    assert.equal(isModelAccessError(undefined), false);
  });
});

describe('parseSummaryResponse', () => {
  it('extracts the narrative', () => {
    const narrative = parseSummaryResponse({
      content: [{ type: 'text', text: '{"narrative":"Spending was up 12% vs the trailing average."}' }],
    });
    assert.equal(narrative, 'Spending was up 12% vs the trailing average.');
  });

  it('rejects a missing or empty narrative', () => {
    assert.throws(
      () =>
        parseSummaryResponse({ content: [{ type: 'text', text: '{"narrative":""}' }] }),
      BedrockResponseError,
    );
    assert.throws(
      () => parseSummaryResponse({ content: [{ type: 'text', text: '{"x":1}' }] }),
      BedrockResponseError,
    );
  });
});
