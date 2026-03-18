import { test } from 'vitest';
import assert from 'node:assert/strict';

import { parseTweetUrl } from '@rt/parseTweetUrl';

test('parse x.com status URL with querystring', () => {
  const result = parseTweetUrl('https://x.com/some_author/status/1234567890123456789?s=20');

  assert.equal(result.author, 'some_author');
  assert.equal(result.tweetId, '1234567890123456789');
});

test('parse twitter.com URL', () => {
  const result = parseTweetUrl('https://twitter.com/other/status/987654321');

  assert.equal(result.author, 'other');
  assert.equal(result.tweetId, '987654321');
});

test('parse www host and normalize override handle', () => {
  const result = parseTweetUrl('https://www.twitter.com/other/status/987654321', '  @@override_user  ');

  assert.equal(result.author, 'override_user');
  assert.equal(result.tweetId, '987654321');
});

test('use --tweet-author override when URL has /i/web/status', () => {
  const result = parseTweetUrl('https://x.com/i/web/status/111', '@override_user');

  assert.equal(result.author, 'override_user');
  assert.equal(result.tweetId, '111');
});

test('use override when status URL has no author segment', () => {
  const result = parseTweetUrl('https://x.com/status/12345', 'riko');

  assert.equal(result.author, 'riko');
  assert.equal(result.tweetId, '12345');
});

test('throw when tweet url is missing', () => {
  assert.throws(() => parseTweetUrl(''), {
    message: /--tweet-url.*required/i,
  });
});

test('throw on invalid URL format', () => {
  assert.throws(() => parseTweetUrl('not-a-url'), {
    message: /must be a valid URL/i,
  });
});

test('throw on unsupported host', () => {
  assert.throws(() => parseTweetUrl('https://example.com/a/status/123'), {
    message: /x\.com or twitter\.com/,
  });
});

test('throw when status segment is missing', () => {
  assert.throws(() => parseTweetUrl('https://x.com/some_author/likes/123'), {
    message: /status\/\{tweetId\}/i,
  });
});

test('throw when extracted tweet id is non-numeric', () => {
  assert.throws(() => parseTweetUrl('https://x.com/some_author/status/not-number'), {
    message: /tweetId is invalid/i,
  });
});

test('throw when author cannot be inferred and override is absent', () => {
  assert.throws(() => parseTweetUrl('https://x.com/i/web/status/111'), {
    message: /could not infer tweet author/i,
  });
});

