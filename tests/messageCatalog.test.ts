import assert from 'node:assert/strict';
import { test } from 'vitest';

import { mapTerminationReason, toKoreanMessage, toRetryMessage } from '@main/messageCatalog';

test('toRetryMessage maps known reason and falls back for unknown reason', () => {
  const known = toRetryMessage('timeout');
  const unknown = toRetryMessage('unknown-reason');

  assert.equal(typeof known, 'string');
  assert.equal(typeof unknown, 'string');
  assert.equal(known.length > 0, true);
  assert.equal(unknown.length > 0, true);
  assert.notEqual(known, unknown);
});

test('mapTerminationReason maps known reason and falls back for unknown reason', () => {
  const known = mapTerminationReason('end_of_timeline');
  const unknown = mapTerminationReason('unknown-reason');

  assert.equal(typeof known, 'string');
  assert.equal(typeof unknown, 'string');
  assert.equal(known.length > 0, true);
  assert.equal(unknown.length > 0, true);
  assert.notEqual(known, unknown);
});

test('toKoreanMessage appends counts only when requested/available are numeric', () => {
  const withCounts = toKoreanMessage({
    message: 'Not enough participants: requested=5, available=2',
  });
  const base = toKoreanMessage({
    message: 'Not enough participants',
  });
  const invalidCounts = toKoreanMessage({
    message: 'Not enough participants: requested=abc, available=2',
  });

  assert.equal(withCounts.includes('5'), true);
  assert.equal(withCounts.includes('2'), true);
  assert.equal(invalidCounts, base);
});

test('toKoreanMessage falls back when parsed counts overflow to infinity', () => {
  const huge = '9'.repeat(500);
  const overflow = toKoreanMessage({
    message: `Not enough participants: requested=${huge}, available=2`,
  });
  const base = toKoreanMessage({
    message: 'Not enough participants',
  });

  assert.equal(overflow, base);
});
