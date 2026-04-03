import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import {
  DEFAULT_RETWEETERS_FEATURES,
  DEFAULT_TWEET_DETAIL_FIELD_TOGGLES,
  REQUIRED_TWITTER_ENV_VARS,
  resolveTwitterConfig,
} from '@rt/config/twitterDefaults';

const TWITTER_ENV_KEYS = [
  REQUIRED_TWITTER_ENV_VARS.bearerToken,
  REQUIRED_TWITTER_ENV_VARS.retweetersOperationId,
  REQUIRED_TWITTER_ENV_VARS.favoritersOperationId,
  REQUIRED_TWITTER_ENV_VARS.searchTimelineOperationId,
  REQUIRED_TWITTER_ENV_VARS.tweetDetailOperationId,
  'TWITTER_RETWEETERS_FEATURES_JSON',
  'TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON',
] as const;

type TwitterEnvKey = (typeof TWITTER_ENV_KEYS)[number];
type SavedEnv = Partial<Record<TwitterEnvKey, string | undefined>>;
let savedEnvForTest: SavedEnv | null = null;

function captureEnv(): SavedEnv {
  const saved: SavedEnv = {};
  for (const key of TWITTER_ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved: SavedEnv): void {
  for (const key of TWITTER_ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setRequiredEnv(): void {
  process.env.TWITTER_BEARER = 'env-bearer';
  process.env.TWITTER_RETWEETERS_OP_ID = 'env-retweeters-op';
  process.env.TWITTER_SEARCH_TIMELINE_OP_ID = 'env-search-op';
  process.env.TWITTER_TWEET_DETAIL_OP_ID = 'env-detail-op';
  process.env.TWITTER_FAVORITERS_OP_ID = 'env-favoriters-op';
}

afterEach(() => {
  if (savedEnvForTest) {
    restoreEnv(savedEnvForTest);
    savedEnvForTest = null;
  }
});

test('resolveTwitterConfig throws with missing required env var names', () => {
  savedEnvForTest = captureEnv();
  restoreEnv({});

  assert.throws(
    () => resolveTwitterConfig(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /TWITTER_BEARER/);
      assert.match(error.message, /TWITTER_RETWEETERS_OP_ID/);
      assert.match(error.message, /TWITTER_FAVORITERS_OP_ID/);
      assert.match(error.message, /TWITTER_SEARCH_TIMELINE_OP_ID/);
      assert.match(error.message, /TWITTER_TWEET_DETAIL_OP_ID/);
      return true;
    }
  );
});

test('resolveTwitterConfig uses env-only values', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();

  const config = resolveTwitterConfig();

  assert.equal(config.bearerToken, 'env-bearer');
  assert.equal(config.operationId, 'env-retweeters-op');
  assert.equal(config.retweetersOperationId, 'env-retweeters-op');
  assert.equal(config.favoritersOperationId, 'env-favoriters-op');
  assert.equal(config.searchTimelineOperationId, 'env-search-op');
  assert.equal(config.tweetDetailOperationId, 'env-detail-op');
  assert.equal(config.features, DEFAULT_RETWEETERS_FEATURES);
  assert.equal(config.fieldToggles, DEFAULT_TWEET_DETAIL_FIELD_TOGGLES);
});

test('resolveTwitterConfig lets options override env values', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();

  const config = resolveTwitterConfig({
    bearerToken: 'override-bearer',
    retweetersOperationId: 'override-retweeters-op',
    favoritersOperationId: 'override-favoriters-op',
    searchTimelineOperationId: 'override-search-op',
    tweetDetailOperationId: 'override-detail-op',
  });

  assert.equal(config.bearerToken, 'override-bearer');
  assert.equal(config.operationId, 'override-retweeters-op');
  assert.equal(config.retweetersOperationId, 'override-retweeters-op');
  assert.equal(config.favoritersOperationId, 'override-favoriters-op');
  assert.equal(config.searchTimelineOperationId, 'override-search-op');
  assert.equal(config.tweetDetailOperationId, 'override-detail-op');
});

test('resolveTwitterConfig falls back from operationId to retweeters/favoriters operation ids', () => {
  savedEnvForTest = captureEnv();
  process.env.TWITTER_BEARER = 'env-bearer';
  process.env.TWITTER_SEARCH_TIMELINE_OP_ID = 'env-search-op';
  process.env.TWITTER_TWEET_DETAIL_OP_ID = 'env-detail-op';
  delete process.env.TWITTER_RETWEETERS_OP_ID;
  delete process.env.TWITTER_FAVORITERS_OP_ID;

  const config = resolveTwitterConfig({
    operationId: 'operation-id-fallback',
  });

  assert.equal(config.operationId, 'operation-id-fallback');
  assert.equal(config.retweetersOperationId, 'operation-id-fallback');
  assert.equal(config.favoritersOperationId, 'operation-id-fallback');
});

test('resolveTwitterConfig throws when favoriters op id is missing without operationId override', () => {
  savedEnvForTest = captureEnv();
  process.env.TWITTER_BEARER = 'env-bearer';
  process.env.TWITTER_RETWEETERS_OP_ID = 'env-retweeters-op';
  process.env.TWITTER_SEARCH_TIMELINE_OP_ID = 'env-search-op';
  process.env.TWITTER_TWEET_DETAIL_OP_ID = 'env-detail-op';
  delete process.env.TWITTER_FAVORITERS_OP_ID;

  assert.throws(() => resolveTwitterConfig(), /TWITTER_FAVORITERS_OP_ID/);
});

test('resolveTwitterConfig parses features and field toggles from object overrides', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();

  const features = { customFeature: true };
  const fieldToggles = { customToggle: false };
  const config = resolveTwitterConfig({
    featuresJson: features,
    fieldTogglesJson: fieldToggles,
  });

  assert.equal(config.features, features);
  assert.equal(config.fieldToggles, fieldToggles);
});

test('resolveTwitterConfig parses features and field toggles from string env values', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();
  process.env.TWITTER_RETWEETERS_FEATURES_JSON = '{"customFeature":true}';
  process.env.TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON = '{"customToggle":false}';

  const config = resolveTwitterConfig();

  assert.deepEqual(config.features, { customFeature: true });
  assert.deepEqual(config.fieldToggles, { customToggle: false });
});

test('resolveTwitterConfig throws on invalid JSON override', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();

  assert.throws(() => resolveTwitterConfig({ featuresJson: '{bad-json' }), /Failed to parse --features-json/);
  assert.throws(() => resolveTwitterConfig({ fieldTogglesJson: '{bad-json' }), /Failed to parse --field-toggles-json/);
});

test('resolveTwitterConfig throws on non-object JSON override', () => {
  savedEnvForTest = captureEnv();
  setRequiredEnv();

  assert.throws(() => resolveTwitterConfig({ featuresJson: '123' }), /Failed to parse --features-json/);
  assert.throws(() => resolveTwitterConfig({ fieldTogglesJson: 'true' }), /Failed to parse --field-toggles-json/);
});
