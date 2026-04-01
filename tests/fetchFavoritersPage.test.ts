import { test } from 'vitest';
import assert from 'node:assert/strict';

import { TwitterRequestError, buildFavoritersUrl, fetchFavoritersPage } from '@rt/twitter/fetchFavoritersPage';
import type { FetchImpl } from '@shared/rtDraw';

test('buildFavoritersUrl includes variables and features', () => {
  const url = buildFavoritersUrl({
    operationId: 'op123',
    tweetId: '111',
    count: 20,
    features: { featureA: true },
    cursor: 'abc',
  });

  const parsed = new URL(url);
  const variables = JSON.parse(parsed.searchParams.get('variables')!);
  const features = JSON.parse(parsed.searchParams.get('features')!);

  assert.equal(parsed.pathname, '/i/api/graphql/op123/Favoriters');
  assert.equal(variables.tweetId, '111');
  assert.equal(variables.count, 20);
  assert.equal(variables.cursor, 'abc');
  assert.equal(variables.enableRanking, false);
  assert.equal(variables.includePromotedContent, false);
  assert.equal(features.featureA, true);
});

test('buildFavoritersUrl supports ranking/promoted overrides', () => {
  const url = buildFavoritersUrl({
    operationId: 'op123',
    tweetId: '111',
    count: 100,
    enableRanking: true,
    includePromotedContent: true,
  });

  const parsed = new URL(url);
  const variables = JSON.parse(parsed.searchParams.get('variables')!);

  assert.equal(variables.enableRanking, true);
  assert.equal(variables.includePromotedContent, true);
  assert.equal(variables.count, 100);
});

test('fetchFavoritersPage forwards ranking options into request URL', async () => {
  let capturedUrl = '';
  const fetchImpl: FetchImpl = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };

  const result = await fetchFavoritersPage({
    tweetId: '111',
    count: 40,
    operationId: 'op123',
    features: {},
    enableRanking: true,
    includePromotedContent: true,
    fetchImpl,
  });

  assert.deepEqual(result.payload, { data: { ok: true } });
  assert.equal(capturedUrl.length > 0, true);

  const parsed = new URL(capturedUrl);
  const variables = JSON.parse(parsed.searchParams.get('variables')!);
  assert.equal(variables.enableRanking, true);
  assert.equal(variables.includePromotedContent, true);
  assert.equal(variables.count, 40);
});

test('retry once on 429 using x-rate-limit-reset', async () => {
  let callCount = 0;
  const sleeps: number[] = [];
  const fetchImpl: FetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response('{}', {
        status: 429,
        headers: {
          'x-rate-limit-reset': '2',
        },
      });
    }

    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
    });
  };

  const result = await fetchFavoritersPage({
    tweetId: '111',
    count: 20,
    operationId: 'op123',
    features: {},
    headers: {},
    fetchImpl,
    now: () => 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    maxRetries: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 1000);
  assert.deepEqual(result.payload, { data: { ok: true } });
});

test('throw auth error immediately on 401', async () => {
  const fetchImpl: FetchImpl = async () =>
    new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }), {
      status: 401,
    });

  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        features: {},
        headers: {},
        fetchImpl,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.equal((error as TwitterRequestError & { status?: number }).status, 401);
      return true;
    }
  );
});

test('retry on 5xx then succeed', async () => {
  let callCount = 0;
  const waits: number[] = [];
  const fetchImpl: FetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response('temporary error', { status: 503 });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };

  const result = await fetchFavoritersPage({
    tweetId: '111',
    count: 20,
    operationId: 'op123',
    features: {},
    headers: {},
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
    maxRetries: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(result.payload, { data: { ok: true } });
});

test('retry on timeout-like abort error', async () => {
  let callCount = 0;
  const waits: number[] = [];
  const fetchImpl: FetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      throw error;
    }

    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };

  const result = await fetchFavoritersPage({
    tweetId: '111',
    count: 20,
    operationId: 'op123',
    features: {},
    headers: {},
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
    maxRetries: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(result.payload, { data: { ok: true } });
});

test('retry once on invalid JSON body then succeed', async () => {
  let callCount = 0;
  const waits: number[] = [];
  const fetchImpl: FetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response('not-json', { status: 200 });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };

  const result = await fetchFavoritersPage({
    tweetId: '111',
    count: 20,
    operationId: 'op123',
    features: {},
    headers: {},
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms);
    },
    maxRetries: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(waits.length, 1);
  assert.deepEqual(result.payload, { data: { ok: true } });
});

test('throw when GraphQL errors are present', async () => {
  const fetchImpl: FetchImpl = async () =>
    new Response(
      JSON.stringify({
        errors: [{ message: 'Bad request: unsupported operation' }],
      }),
      { status: 200 }
    );

  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        features: {},
        headers: {},
        fetchImpl,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.match((error as Error).message, /GraphQL returned errors/i);
      return true;
    }
  );
});

test('buildFavoritersUrl validates required fields', () => {
  assert.throws(
    () =>
      buildFavoritersUrl({
        operationId: '',
        tweetId: '111',
        count: 20,
      }),
    /Favoriters operationId is required/
  );

  assert.throws(
    () =>
      buildFavoritersUrl({
        operationId: 'op123',
        tweetId: '',
        count: 20,
      }),
    /tweetId is required/
  );
});

test('fetchFavoritersPage validates request timeout value', async () => {
  const fetchImpl: FetchImpl = async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });

  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        fetchImpl,
        requestTimeoutMs: 0,
      }),
    /requestTimeoutMs must be a positive integer/
  );
});

test('fetchFavoritersPage throws when fetch implementation is invalid', async () => {
  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        fetchImpl: null as unknown as FetchImpl,
      }),
    /Fetch implementation is not available/
  );
});

test('maps timeout/network GraphQL errors to favoriters-specific messages', async () => {
  const timeoutFetch: FetchImpl = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };

  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        fetchImpl: timeoutFetch,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.equal((error as Error).message, 'Request timed out while fetching favoriters.');
      return true;
    }
  );

  const networkFetch: FetchImpl = async () => {
    throw new Error('socket hang up');
  };

  await assert.rejects(
    () =>
      fetchFavoritersPage({
        tweetId: '111',
        count: 20,
        operationId: 'op123',
        fetchImpl: networkFetch,
        maxRetries: 0,
      }),
    (error: unknown) => {
      assert.equal(error instanceof TwitterRequestError, true);
      assert.equal((error as Error).message, 'Network error while fetching favoriters.');
      return true;
    }
  );
});



