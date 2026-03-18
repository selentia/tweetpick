import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  buildSearchTimelineUrl,
  buildSearchTimelineBody,
  fetchSearchTimelinePage,
} from '@rt/twitter/fetchSearchTimelinePage';
import type { FetchImpl } from '@shared/rtDraw';

test('buildSearchTimelineUrl builds operation route', () => {
  const url = buildSearchTimelineUrl({
    operationId: 'op123',
  });
  assert.equal(url, 'https://x.com/i/api/graphql/op123/SearchTimeline');
});

test('buildSearchTimelineBody includes variables and features', () => {
  const bodyJson = buildSearchTimelineBody({
    rawQuery: 'quoted_tweet_id:111',
    count: 30,
    cursor: 'CURSOR_A',
    querySource: 'typed_query',
    product: 'Latest',
    features: { sample_feature: true },
  });
  const body = JSON.parse(bodyJson);

  assert.equal(body.variables.rawQuery, 'quoted_tweet_id:111');
  assert.equal(body.variables.count, 30);
  assert.equal(body.variables.cursor, 'CURSOR_A');
  assert.equal(body.variables.querySource, 'typed_query');
  assert.equal(body.variables.product, 'Latest');
  assert.equal(body.features.sample_feature, true);
});

test('fetchSearchTimelinePage sends POST request with JSON body', async () => {
  type FetchCall = {
    input: Parameters<FetchImpl>[0];
    init: Parameters<FetchImpl>[1];
  };

  const fetchCalls: FetchCall[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    fetchCalls.push({ input, init });
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
    });
  };

  const result = await fetchSearchTimelinePage({
    operationId: 'op123',
    rawQuery: 'quoted_tweet_id:999',
    count: 20,
    features: { featureA: true },
    headers: { Authorization: 'Bearer test' },
    fetchImpl,
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]!.input, 'https://x.com/i/api/graphql/op123/SearchTimeline');
  assert.equal(fetchCalls[0]!.init?.method, 'POST');
  assert.equal(typeof fetchCalls[0]!.init?.body, 'string');

  const body = JSON.parse(fetchCalls[0]!.init?.body as string);
  assert.equal(body.variables.rawQuery, 'quoted_tweet_id:999');
  assert.equal(body.variables.count, 20);
  assert.equal(body.features.featureA, true);
  const payload = result.payload as {
    data?: {
      ok?: boolean;
    };
  };
  assert.equal(payload.data?.ok, true);
});

test('buildSearchTimelineUrl throws when operationId is missing', () => {
  assert.throws(() => buildSearchTimelineUrl({ operationId: '' }), /SearchTimeline operationId is required/);
});

test('buildSearchTimelineBody throws when rawQuery is missing', () => {
  assert.throws(() => buildSearchTimelineBody({ rawQuery: '' } as never), /rawQuery is required/);
});

test('buildSearchTimelineBody applies default count and empty features fallback', () => {
  const bodyJson = buildSearchTimelineBody({
    rawQuery: 'quoted_tweet_id:333',
    count: Number.NaN,
  } as never);
  const body = JSON.parse(bodyJson) as {
    variables: {
      count: number;
    };
    features: Record<string, unknown>;
  };

  assert.equal(body.variables.count, 20);
  assert.deepEqual(body.features, {});
});

