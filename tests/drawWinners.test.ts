import { test } from 'vitest';
import assert from 'node:assert/strict';

import { drawWinners } from '@rt/drawWinners';

const participants = [
  { userId: '1', screenName: 'a' },
  { userId: '2', screenName: 'b' },
  { userId: '3', screenName: 'c' },
  { userId: '4', screenName: 'd' },
];

test('same seed returns same winners', () => {
  const first = drawWinners({ participants, winners: 2, seed: 'fixed-seed' });
  const second = drawWinners({ participants, winners: 2, seed: 'fixed-seed' });

  assert.deepEqual(
    first.winners.map((item) => item.userId),
    second.winners.map((item) => item.userId)
  );
});

test('draw has no duplicates', () => {
  const result = drawWinners({ participants, winners: 3, seed: 'abc' });
  const winnerIds = result.winners.map((item) => item.userId);
  const uniqueWinnerIds = new Set(winnerIds);
  assert.equal(uniqueWinnerIds.size, winnerIds.length);
});

test('throw when winners exceed participants', () => {
  assert.throws(() => drawWinners({ participants, winners: 10, seed: 'seed' }), { message: /Not enough participants/ });
});

test('drawWinners auto-generates seed when omitted', () => {
  const result = drawWinners({ participants, winners: 2 });
  assert.equal(typeof result.seed, 'string');
  assert.match(result.seed, /^[a-f0-9]{32}$/);
  assert.equal(result.winners.length, 2);
});

test('drawWinners throws when participants is not an array', () => {
  assert.throws(
    () => drawWinners({ participants: null as unknown as Array<{ userId: string }>, winners: 1, seed: 'seed' }),
    {
      message: /participants must be an array/i,
    }
  );
});

test('drawWinners throws when winners is not a positive integer', () => {
  assert.throws(() => drawWinners({ participants, winners: 0, seed: 'seed' }), {
    message: /winners must be a positive integer/i,
  });
  assert.throws(() => drawWinners({ participants, winners: 1.5, seed: 'seed' }), {
    message: /winners must be a positive integer/i,
  });
});


