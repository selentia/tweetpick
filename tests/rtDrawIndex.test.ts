import assert from 'node:assert/strict';

import { test } from 'vitest';

import * as rtDrawIndex from '@rt/index';

const EXPECTED_FUNCTION_EXPORTS = [
  'resolveTwitterConfig',
  'buildEligiblePool',
  'collectFavoriters',
  'collectQuotes',
  'collectReplies',
  'collectRetweeters',
  'drawWinners',
  'parseTweetUrl',
  'fetchFavoritersPage',
  'fetchSearchTimelinePage',
  'fetchTweetDetailPage',
  'fetchRetweetersPage',
  'makeHeaders',
] as const;

test('rt-draw index exposes expected named function exports', () => {
  for (const exportName of EXPECTED_FUNCTION_EXPORTS) {
    assert.equal(typeof rtDrawIndex[exportName], 'function', `${exportName} should be a function export`);
  }
});
