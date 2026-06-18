import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { HealthResponse } from '@goldfinch/shared/types';
import { json } from '../http.js';

export async function health(): Promise<APIGatewayProxyStructuredResultV2> {
  const body: HealthResponse = { ok: true };
  return json(200, body);
}
