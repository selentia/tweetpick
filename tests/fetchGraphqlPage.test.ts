import assert from 'node:assert/strict';

import { test } from 'vitest';

import { TwitterRequestError, requestGraphqlPage } from '@rt/twitter/fetchGraphqlPage';
import type { FetchImpl, RetryHandlerInfo } from '@shared/rtDraw';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

type FetchStep = Response | Error;

function createResponse(body: string, status: number, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers,
  });
}

function createFetchSequence(steps: FetchStep[]): { fetchImpl: FetchImpl; calls: FetchCall[] } {
  const queue = steps.slice();
  const calls: FetchCall[] = [];

  const fetchImpl: FetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      init,
    });

    const step = queue.shift();
    if (!step) {
      throw new Error('No fetch step queued.');
    }

    if (step instanceof Error) {
      throw step;
    }

    return step;
  };

  return { fetchImpl, calls };
}

function createRetryRecorder(): {
  retries: RetryHandlerInfo[];
  sleeps: number[];
  onRetry: (retry: RetryHandlerInfo) => void;
  sleep: (ms: number) => Promise<void>;
} {
  const retries: RetryHandlerInfo[] = [];
  const sleeps: number[] = [];

  return {
    retries,
    sleeps,
    onRetry: (retry: RetryHandlerInfo) => {
      retries.push(retry);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

test('throws validation errors for url, method, fetchImpl, and requestTimeoutMs', async () => {
  await assert.rejects(
    () => requestGraphqlPage({ url: '' }),
    /url is required/,
  );

  await assert.rejects(
    () => requestGraphqlPage({ url: 'https://example.com/graphql', method: 'PUT' as 'GET' }),
    /method must be GET or POST/,
  );

  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: null as unknown as FetchImpl,
      }),
    /Fetch implementation is not available/,
  );

  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        requestTimeoutMs: 0,
      }),
    /requestTimeoutMs must be a positive integer/,
  );
});

test('returns payload, status, and url for successful GET request', async () => {
  const { fetchImpl, calls } = createFetchSequence([
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);

  const result = await requestGraphqlPage<{ data: { ok: boolean } }>({
    url: 'https://example.com/graphql',
    fetchImpl,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.equal(result.status, 200);
  assert.equal(result.url, 'https://example.com/graphql');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, 'GET');
  assert.equal('body' in (calls[0]?.init ?? {}), false);
});

test('sends POST body for successful POST request', async () => {
  const { fetchImpl, calls } = createFetchSequence([
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);

  const result = await requestGraphqlPage<{ data: { ok: boolean } }>({
    url: 'https://example.com/graphql',
    method: 'POST',
    body: JSON.stringify({ hello: 'world' }),
    headers: { 'content-type': 'application/json' },
    fetchImpl,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[0]?.init?.body, '{"hello":"world"}');
});

test('throws auth error immediately for 401 and 403', async () => {
  for (const status of [401, 403]) {
    const { fetchImpl } = createFetchSequence([
      createResponse('unauthorized-body', status),
    ]);

    await assert.rejects(
      () =>
        requestGraphqlPage({
          url: 'https://example.com/graphql',
          fetchImpl,
        }),
      (error: unknown) => {
        assert.equal(error instanceof TwitterRequestError, true);
        assert.equal((error as TwitterRequestError).status, status);
        assert.match((error as Error).message, /Authentication failed/);
        assert.equal((error as TwitterRequestError).bodySnippet, 'unauthorized-body');
        return true;
      },
    );
  }
});

test('retries 429 using retry-after header then succeeds', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse('rate limited', 429, { 'retry-after': '3' }),
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl,
    maxRetries: 1,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [{ reason: 'rate-limit', attempt: 1, waitMs: 3000 }]);
  assert.deepEqual(recorder.sleeps, [3000]);
});

test('retries 429 using x-rate-limit-reset header then succeeds', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse('rate limited', 429, { 'x-rate-limit-reset': '3' }),
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl,
    maxRetries: 1,
    now: () => 1500,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [{ reason: 'rate-limit', attempt: 1, waitMs: 1500 }]);
  assert.deepEqual(recorder.sleeps, [1500]);
});

test('throws when 429 retries are exhausted', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse('still rate limited', 429),
  ]);

  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.equal((error as TwitterRequestError).status, 429);
      assert.match((error as Error).message, /Rate limited/);
      return true;
    },
  );
});

test('retries 408 and 5xx responses with backoff then succeeds', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse('timeout', 408),
    createResponse('server error', 503),
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl,
    maxRetries: 2,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [
    { reason: 'request-timeout', attempt: 1, waitMs: 500 },
    { reason: 'server', attempt: 2, waitMs: 1000 },
  ]);
  assert.deepEqual(recorder.sleeps, [500, 1000]);
});

test('throws when 408 and 5xx retries are exhausted', async () => {
  const timeoutFetch = createFetchSequence([createResponse('timeout', 408)]);
  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: timeoutFetch.fetchImpl,
        maxRetries: 0,
      }),
    /Request timeout from X and retries exhausted/,
  );

  const serverFetch = createFetchSequence([createResponse('server error', 502)]);
  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: serverFetch.fetchImpl,
        maxRetries: 0,
      }),
    /Server error from X and retries exhausted/,
  );
});

test('retries invalid JSON then succeeds and throws when exhausted', async () => {
  const successSequence = createFetchSequence([
    createResponse('not-json', 200),
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl: successSequence.fetchImpl,
    maxRetries: 1,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [{ reason: 'invalid-json', attempt: 1, waitMs: 500 }]);
  assert.deepEqual(recorder.sleeps, [500]);

  const exhaustedSequence = createFetchSequence([createResponse('still-not-json', 200)]);
  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: exhaustedSequence.fetchImpl,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.match((error as Error).message, /Response is not valid JSON/);
      assert.equal((error as TwitterRequestError).bodySnippet, 'still-not-json');
      return true;
    },
  );
});

test('retries retryable GraphQL errors then succeeds', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse(JSON.stringify({ errors: [{ message: 'temporary over capacity' }] }), 200),
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl,
    maxRetries: 1,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [{ reason: 'graphql-error', attempt: 1, waitMs: 500 }]);
  assert.deepEqual(recorder.sleeps, [500]);
});

test('throws non-retryable GraphQL errors with summarized message', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse(
      JSON.stringify({
        errors: [{ message: 'Bad request' }, { message: 'Unsupported operation' }, { message: 'Ignored extra' }],
      }),
      200,
    ),
  ]);

  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.match((error as Error).message, /GraphQL returned errors\./);
      assert.match((error as Error).message, /Bad request \| Unsupported operation/);
      return true;
    },
  );
});

test('retries network and abort errors, then throws when exhausted', async () => {
  const networkError = new Error('socket hang up');
  const abortError = new Error('The operation was aborted.');
  abortError.name = 'AbortError';

  const retrySequence = createFetchSequence([
    networkError,
    abortError,
    createResponse(JSON.stringify({ data: { ok: true } }), 200),
  ]);
  const recorder = createRetryRecorder();

  const result = await requestGraphqlPage({
    url: 'https://example.com/graphql',
    fetchImpl: retrySequence.fetchImpl,
    maxRetries: 2,
    onRetry: recorder.onRetry,
    sleep: recorder.sleep,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.deepEqual(recorder.retries, [
    { reason: 'network', attempt: 1, waitMs: 500 },
    { reason: 'timeout', attempt: 2, waitMs: 1000 },
  ]);
  assert.deepEqual(recorder.sleeps, [500, 1000]);

  const exhaustedNetwork = createFetchSequence([new Error('dns lookup failed')]);
  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: exhaustedNetwork.fetchImpl,
        maxRetries: 0,
      }),
    /Network error while fetching GraphQL page/,
  );

  const exhaustedAbort = createFetchSequence([abortError]);
  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl: exhaustedAbort.fetchImpl,
        maxRetries: 0,
      }),
    /Request timed out while fetching GraphQL page/,
  );
});

test('throws request error for non-retryable non-ok status', async () => {
  const { fetchImpl } = createFetchSequence([
    createResponse('missing', 404),
  ]);

  await assert.rejects(
    () =>
      requestGraphqlPage({
        url: 'https://example.com/graphql',
        fetchImpl,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.equal((error as TwitterRequestError).status, 404);
      assert.match((error as Error).message, /Request failed with status 404/);
      return true;
    },
  );
});
