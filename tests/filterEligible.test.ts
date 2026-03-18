import { test } from 'vitest';
import assert from 'node:assert/strict';

import { DRAW_MODES, filterEligible } from '@rt/filterEligible';

const participants = [
  { userId: '1', screenName: 'a', followedByAuth: true },
  { userId: '2', screenName: 'b', followedByAuth: false },
];

test('rt mode keeps all participants', () => {
  const result = filterEligible(participants, DRAW_MODES.RT);
  assert.equal(result.eligible.length, 2);
  assert.equal(result.rejected.length, 0);
});

test('rt-follow mode keeps only followed_by=true', () => {
  const result = filterEligible(participants, DRAW_MODES.RT_FOLLOW);
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0]!.userId, '1');
  assert.equal(result.rejected.length, 1);
});

test('throws when participants is not an array', () => {
  assert.throws(() => filterEligible(null as unknown as Array<{ followedByAuth?: boolean }>, DRAW_MODES.RT), {
    message: /participants must be an array/i,
  });
});

test('throws when mode is unsupported', () => {
  assert.throws(
    () => filterEligible(participants, 'unsupported' as unknown as (typeof DRAW_MODES)[keyof typeof DRAW_MODES]),
    {
      message: /unsupported mode/i,
    }
  );
});


