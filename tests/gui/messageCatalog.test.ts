import { test } from 'vitest';
import assert from 'node:assert/strict';

import { toKoreanMessage, toRetryMessage, mapTerminationReason } from '@main/messageCatalog';

test('toKoreanMessage maps known fragment', () => {
  const message = toKoreanMessage(new Error('`--auth-token` is required.'));
  assert.equal(message, 'auth_token을 입력해 주세요.');
});

test('toKoreanMessage returns fallback for unknown error', () => {
  const message = toKoreanMessage(new Error('unexpected unknown error'));
  assert.equal(message, '추첨 중 오류가 발생했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.');
});

test('toKoreanMessage includes counts for not-enough-participants error', () => {
  const message = toKoreanMessage(new Error('Not enough participants. requested=40, available=7'));
  assert.equal(message, '추첨 가능한 참여자가 부족합니다. 당첨 인원을 줄여 주세요. (추첨 인원: 40명 / 대상 인원: 7명)');
});

test('toKoreanMessage falls back to base not-enough message when count parsing fails', () => {
  const malformed = toKoreanMessage(new Error('Not enough participants without count details'));
  assert.equal(malformed, '추첨 가능한 참여자가 부족합니다. 당첨 인원을 줄여 주세요.');

  const invalidNumbers = toKoreanMessage(new Error('Not enough participants. requested=NaN, available=abc'));
  assert.equal(invalidNumbers, '추첨 가능한 참여자가 부족합니다. 당첨 인원을 줄여 주세요.');
});

test('toRetryMessage maps reason and falls back', () => {
  assert.equal(toRetryMessage('request-timeout'), '응답 지연으로 재시도합니다.');
  assert.equal(toRetryMessage('unknown-retry'), '일시적 오류로 재시도합니다.');
});

test('mapTerminationReason maps reason and falls back', () => {
  assert.equal(mapTerminationReason('cursor_cycle'), '커서 순환 감지');
  assert.equal(mapTerminationReason('something-else'), '알 수 없음');
});
