import { circuitBreaker, retry } from './resilience.js';

/** Thrown when an authorization dependency is unavailable. Callers fail closed. */
export class AuthzUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthzUnavailableError';
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const transient = (e: unknown) => !(e instanceof HttpError) || e.status >= 500 || e.status === 429;

async function postJson(url: string, token: string, body: unknown, timeoutMs: number) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok)
    throw new HttpError(res.status, `${url} returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<unknown>;
}

// ---------------------------------------------------------------------------
// OpenFGA: relationship-based access control (ADR-0013)
// ---------------------------------------------------------------------------

export interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

export interface FgaOptions {
  url: string;
  apiKey: string;
  storeName?: string;
  timeoutMs?: number;
}

/**
 * Minimal OpenFGA HTTP client. The store is resolved by name once; checks use
 * the latest authorization model. Calls are retried on transient errors and
 * guarded by a circuit breaker.
 */
export class FgaClient {
  private storeId?: Promise<string>;
  private readonly call;

  constructor(private readonly opts: FgaOptions) {
    this.call = circuitBreaker(
      (path: string, body: unknown) =>
        retry(() => postJson(`${opts.url}${path}`, opts.apiKey, body, opts.timeoutMs ?? 3000), {
          retries: 2,
          baseDelayMs: 100,
          shouldRetry: transient,
        }),
      { name: 'openfga', timeoutMs: (opts.timeoutMs ?? 3000) * 3 + 500 },
    );
  }

  private store(): Promise<string> {
    this.storeId ??= this.call
      .fire(`/stores?name=${encodeURIComponent(this.opts.storeName ?? 'raadi')}`, undefined)
      .then((body) => {
        const id = (body as { stores?: Array<{ id: string }> }).stores?.[0]?.id;
        if (!id) throw new Error(`OpenFGA store "${this.opts.storeName ?? 'raadi'}" not found`);
        return id;
      })
      .catch((error: unknown) => {
        this.storeId = undefined;
        throw error;
      });
    return this.storeId;
  }

  private async fire(path: (store: string) => string, body: unknown): Promise<unknown> {
    try {
      return await this.call.fire(path(await this.store()), body);
    } catch (error) {
      throw new AuthzUnavailableError('OpenFGA request failed', { cause: error });
    }
  }

  async check(tuple: TupleKey, contextual: TupleKey[] = []): Promise<boolean> {
    const body = await this.fire((s) => `/stores/${s}/check`, {
      tuple_key: tuple,
      contextual_tuples: { tuple_keys: contextual },
    });
    return (body as { allowed?: boolean }).allowed === true;
  }

  /** Checks many tuples in one round trip; returns results in input order. */
  async checkAll(tuples: TupleKey[], contextual: TupleKey[] = []): Promise<boolean[]> {
    if (tuples.length === 0) return [];
    const body = await this.fire((s) => `/stores/${s}/batch-check`, {
      checks: tuples.map((tuple_key, i) => ({
        tuple_key,
        contextual_tuples: { tuple_keys: contextual },
        correlation_id: String(i),
      })),
    });
    const result = (body as { result?: Record<string, { allowed?: boolean }> }).result ?? {};
    return tuples.map((_, i) => result[String(i)]?.allowed === true);
  }

  /** Idempotent: duplicate writes and missing deletes are ignored. Max 100 tuples per call. */
  async write(writes: TupleKey[], deletes: TupleKey[] = []): Promise<void> {
    if (writes.length + deletes.length === 0) return;
    await this.fire((s) => `/stores/${s}/write`, {
      ...(writes.length ? { writes: { tuple_keys: writes, on_duplicate: 'ignore' } } : {}),
      ...(deletes.length ? { deletes: { tuple_keys: deletes, on_missing: 'ignore' } } : {}),
    });
  }

  async ping(): Promise<void> {
    await this.store();
  }
}

// ---------------------------------------------------------------------------
// OPA: policy decisions (ADR-0013)
// ---------------------------------------------------------------------------

export interface PolicyDecision {
  allow: boolean;
  reasons: string[];
}

export class OpaClient {
  private readonly call;

  constructor(opts: { url: string; token: string; timeoutMs?: number }) {
    this.call = circuitBreaker(
      (path: string, input: unknown) =>
        retry(
          () =>
            postJson(`${opts.url}/v1/data/${path}`, opts.token, { input }, opts.timeoutMs ?? 2000),
          {
            retries: 2,
            baseDelayMs: 100,
            shouldRetry: transient,
          },
        ),
      { name: 'opa', timeoutMs: (opts.timeoutMs ?? 2000) * 3 + 500 },
    );
  }

  /** Evaluates e.g. "raadi/listings/decision". Missing or malformed results deny. */
  async decide(path: string, input: unknown): Promise<PolicyDecision> {
    let body: unknown;
    try {
      body = await this.call.fire(path, input);
    } catch (error) {
      throw new AuthzUnavailableError('OPA request failed', { cause: error });
    }
    const result = (body as { result?: Partial<PolicyDecision> }).result;
    if (typeof result?.allow !== 'boolean') return { allow: false, reasons: ['policy_undefined'] };
    return { allow: result.allow, reasons: Array.isArray(result.reasons) ? result.reasons : [] };
  }
}
