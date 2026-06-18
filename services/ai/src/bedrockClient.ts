/**
 * Real bedrock-runtime wiring for the ModelInvoker seam.
 *
 * Uses the legacy Bedrock InvokeModel API with the Anthropic Messages body
 * (anthropic_version "bedrock-2023-05-31") per master plan section 11. The
 * model ID MUST be the cross-region inference-profile ID (us.anthropic....);
 * IAM needs both the inference-profile ARN and the foundation-model ARNs in
 * us-east-1 / us-east-2 / us-west-2 (the dual-resource policy in the plan).
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

import type {
  AnthropicRequestBody,
  AnthropicResponseBody,
  ModelInvoker,
} from './bedrock.js';

export interface BedrockInvokerOptions {
  /** Cross-region inference-profile ID (never the bare foundation-model ID). */
  modelId: string;
  region?: string | undefined;
  /** Injectable for tests / client reuse. */
  client?: BedrockRuntimeClient;
}

export function createBedrockInvoker(options: BedrockInvokerOptions): ModelInvoker {
  const client =
    options.client ??
    new BedrockRuntimeClient(
      options.region !== undefined ? { region: options.region } : {},
    );
  return {
    async invoke(body: AnthropicRequestBody): Promise<AnthropicResponseBody> {
      const output = await client.send(
        new InvokeModelCommand({
          modelId: options.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body),
        }),
      );
      const raw = new TextDecoder().decode(output.body);
      return JSON.parse(raw) as AnthropicResponseBody;
    },
  };
}
