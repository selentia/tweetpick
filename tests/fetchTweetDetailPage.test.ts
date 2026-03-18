import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildTweetDetailUrl,
  fetchTweetDetailPage,
} from '@rt/twitter/fetchTweetDetailPage';
import type { FetchImpl } from '@shared/rtDraw';

test('buildTweetDetailUrl throws when operationId is missing', () => {
  assert.throws(
    () =>
      buildTweetDetailUrl({
        focalTweetId: '123',
      } as never),
    /TweetDetail operationId is required\./
  );
});

test('buildTweetDetailUrl throws when focalTweetId is missing', () => {
  assert.throws(
    () =>
      buildTweetDetailUrl({
        operationId: 'op123',
      } as never),
    /focalTweetId is required\./
  );
});

test('buildTweetDetailUrl encodes route, variables, features, and fieldToggles', () => {
  const url = buildTweetDetailUrl({
    operationId: 'op123',
    focalTweetId: 'tweet-999',
    cursor: 'CURSOR_1',
    controllerData: 'controller-abc',
    referrer: 'https://example.com/thread',
    rankingMode: 'Chronological',
    features: { featureA: true },
    fieldToggles: { toggleA: false },
  });

  const parsed = new URL(url);
  const variables = JSON.parse(parsed.searchParams.get('variables') as string) as {
    focalTweetId: string;
    cursor?: string;
    referrer?: string;
    controller_data?: string;
    rankingMode: string;
    with_rux_injections: boolean;
    includePromotedContent: boolean;
    withCommunity: boolean;
    withQuickPromoteEligibilityTweetFields: boolean;
    withBirdwatchNotes: boolean;
    withVoice: boolean;
  };
  const features = JSON.parse(parsed.searchParams.get('features') as string) as {
    featureA: boolean;
  };
  const fieldToggles = JSON.parse(parsed.searchParams.get('fieldToggles') as string) as {
    toggleA: boolean;
  };

  assert.equal(parsed.pathname, '/i/api/graphql/op123/TweetDetail');
  assert.equal(variables.focalTweetId, 'tweet-999');
  assert.equal(variables.cursor, 'CURSOR_1');
  assert.equal(variables.referrer, 'https://example.com/thread');
  assert.equal(variables.controller_data, 'controller-abc');
  assert.equal(variables.rankingMode, 'Chronological');
  assert.equal(variables.with_rux_injections, false);
  assert.equal(variables.includePromotedContent, true);
  assert.equal(variables.withCommunity, true);
  assert.equal(variables.withQuickPromoteEligibilityTweetFields, true);
  assert.equal(variables.withBirdwatchNotes, true);
  assert.equal(variables.withVoice, true);
  assert.equal(features.featureA, true);
  assert.equal(fieldToggles.toggleA, false);
});

test('fetchTweetDetailPage calls request path and returns parsed payload', async () => {
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

  const result = await fetchTweetDetailPage({
    operationId: 'op123',
    focalTweetId: 'tweet-999',
    cursor: 'CURSOR_1',
    controllerData: 'controller-abc',
    referrer: 'https://example.com/thread',
    features: { featureA: true },
    fieldToggles: { toggleA: false },
    headers: { Authorization: 'Bearer test' },
    fetchImpl,
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]!.init?.method, 'GET');
  const requestUrl = new URL(fetchCalls[0]!.input as string);
  assert.equal(requestUrl.pathname, '/i/api/graphql/op123/TweetDetail');
  const variables = JSON.parse(requestUrl.searchParams.get('variables') as string) as {
    focalTweetId: string;
    cursor?: string;
    referrer?: string;
    controller_data?: string;
  };
  assert.equal(variables.focalTweetId, 'tweet-999');
  assert.equal(variables.cursor, 'CURSOR_1');
  assert.equal(variables.referrer, 'https://example.com/thread');
  assert.equal(variables.controller_data, 'controller-abc');
  assert.deepEqual(result.payload, { data: { ok: true } });
});
