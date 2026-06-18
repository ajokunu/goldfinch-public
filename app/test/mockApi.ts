/**
 * Fetch-level API mock for the component/integration suite.
 *
 * The real data layer (src/api/client.ts -> endpoints.ts -> TanStack hooks)
 * runs untouched; only the network edge is replaced. Routes are registered
 * per test as `METHOD /path` against the response body (or a handler), so a
 * test exercises the exact paths the typed endpoint functions build --
 * including query-string handling -- and fails loudly on any request it did
 * not anticipate.
 *
 * Error simulation returns the server's ErrorEnvelope shape so ApiError
 * construction in src/api/errors.ts is exercised end to end. Deferred routes
 * let tests hold a screen in its loading state and then release it.
 */
import type { ErrorEnvelope } from '@goldfinch/shared/types';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface MockRequest {
  method: HttpMethod;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

type RouteHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

/** Minimal Response surface used by src/api/client.ts and errors.ts. */
function makeResponse(status: number, body: unknown): Response {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      if (payload === undefined) {
        throw new Error('mock response has no body');
      }
      return JSON.parse(payload) as unknown;
    },
    async text(): Promise<string> {
      return payload ?? '';
    },
  } as unknown as Response;
}

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

export interface Deferred {
  /** Release the held request(s) with the given reply. */
  resolve: (reply: MockReply) => void;
}

class MockApi {
  private routes = new Map<string, RouteHandler>();
  private unmatched: string[] = [];
  private realFetch: typeof fetch | undefined;

  install(): void {
    if (this.realFetch !== undefined) return;
    this.realFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => this.dispatch(input, init)) as typeof fetch;
  }

  uninstall(): void {
    if (this.realFetch !== undefined) {
      globalThis.fetch = this.realFetch;
      this.realFetch = undefined;
    }
  }

  reset(): void {
    this.routes.clear();
    this.unmatched = [];
  }

  /** Register a handler (or static body) for `METHOD /path`. */
  on(method: HttpMethod, path: string, reply: MockReply | RouteHandler): void {
    const handler: RouteHandler =
      typeof reply === 'function' ? reply : () => reply;
    this.routes.set(`${method} ${path}`, handler);
  }

  /** Shorthand: 200 GET returning `body`. */
  get(path: string, body: unknown): void {
    this.on('GET', path, { status: 200, body });
  }

  /** Shorthand: an error-enveloped non-2xx reply. */
  error(
    method: HttpMethod,
    path: string,
    status: number,
    code = 'INTERNAL_ERROR',
    message = 'simulated failure',
  ): void {
    this.on(method, path, { status, body: errorEnvelope(code, message) });
  }

  /**
   * Register a route that stays pending until the returned Deferred is
   * resolved -- used to assert loading states deterministically.
   */
  defer(method: HttpMethod, path: string): Deferred {
    let release: (reply: MockReply) => void = () => {};
    const gate = new Promise<MockReply>((resolve) => {
      release = resolve;
    });
    this.on(method, path, () => gate);
    return { resolve: release };
  }

  /** Requests that hit no registered route (asserted empty in teardown). */
  unmatchedRequests(): readonly string[] {
    return this.unmatched;
  }

  private async dispatch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl, 'https://goldfinch.test');
    const method = (init?.method ?? 'GET').toUpperCase() as HttpMethod;
    const key = `${method} ${url.pathname}`;
    const handler = this.routes.get(key);
    if (handler === undefined) {
      this.unmatched.push(key);
      throw new Error(`mockApi: unmatched request ${key}`);
    }
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body) as unknown;
    }
    const reply = await handler({
      method,
      path: url.pathname,
      query: url.searchParams,
      body,
    });
    return makeResponse(reply.status ?? 200, reply.body);
  }
}

export const mockApi = new MockApi();
