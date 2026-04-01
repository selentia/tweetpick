import { test } from 'vitest';
import assert from 'node:assert/strict';

import { buildEligiblePool, SOURCE_MATCH_MODES } from '@rt/buildEligiblePool';
import type { BuildEligiblePoolOptions } from '@shared/rtDraw';

test('buildEligiblePool applies AND, author exclusion, keyword, and profile filters', () => {
  const sourceParticipants = {
    rt: [
      {
        userId: '1',
        screenName: 'riko',
        name: 'Riko',
        followingAuth: true,
        followedByAuth: true,
        followingCount: 80,
        followersCount: 120,
        defaultProfile: false,
        defaultProfileImage: false,
      },
      {
        userId: '2',
        screenName: 'tabi',
        name: 'Tabi',
        followingAuth: true,
        followedByAuth: true,
        followingCount: 90,
        followersCount: 140,
        defaultProfile: false,
        defaultProfileImage: false,
      },
      {
        userId: '99',
        screenName: 'yuni',
        name: 'Yuni',
      },
    ],
    quote: [
      {
        userId: '1',
        screenName: 'riko',
        sourceTexts: ['first text'],
      },
      {
        userId: '1',
        screenName: 'riko',
        sourceTexts: ['burger keyword in quote'],
      },
      {
        userId: '2',
        screenName: 'tabi',
        sourceTexts: ['no keyword here'],
      },
    ],
    reply: [
      {
        userId: '1',
        screenName: 'riko',
        sourceTexts: ['reply has burger too'],
      },
      {
        userId: '2',
        screenName: 'tabi',
        sourceTexts: ['still no keyword'],
      },
    ],
  };

  const result = buildEligiblePool({
    sourceParticipants,
    selectedSources: {
      rt: true,
      quote: true,
      reply: true,
    },
    authorScreenName: 'yuni',
    keyword: 'burger',
    filters: {
      requireParticipantFollowsAuth: true,
      requireAuthFollowsParticipant: true,
      minFollowersEnabled: true,
      minFollowers: 50,
      excludeDefaultProfile: true,
      excludeDefaultProfileImage: true,
    },
  });

  assert.equal(result.eligibleParticipants.length, 1);
  assert.equal(result.eligibleParticipants[0]!.screenName, 'riko');
  assert.equal(result.stats.authorExcludedBySource.rt, 1);
  assert.equal(result.stats.intersectionCount, 2);
  assert.equal(result.stats.afterKeywordCount, 1);
  assert.equal(result.stats.afterProfileCount, 1);
  assert.equal(result.stats.excludedByKeyword, 1);
  assert.equal(result.stats.excludedByProfile, 0);
});

test('buildEligiblePool is fail-closed when required profile fields are missing', () => {
  const sourceParticipants: NonNullable<BuildEligiblePoolOptions['sourceParticipants']> = {
    rt: [
      {
        userId: '1',
        screenName: 'riko',
        followingAuth: true,
        followedByAuth: true,
        followersCount: null,
      },
    ],
    quote: [],
    reply: [],
  };

  const result = buildEligiblePool({
    sourceParticipants,
    selectedSources: { rt: true, quote: false, reply: false },
    authorScreenName: 'yuni',
    keyword: '',
    filters: {
      requireParticipantFollowsAuth: false,
      requireAuthFollowsParticipant: false,
      minFollowersEnabled: true,
      minFollowers: 50,
      excludeDefaultProfile: false,
      excludeDefaultProfileImage: false,
    },
  });

  assert.equal(result.stats.intersectionCount, 1);
  assert.equal(result.stats.afterProfileCount, 0);
  assert.equal(result.stats.excludedByProfile, 1);
});

test('buildEligiblePool applies participant->auth relationship filter', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [
        { userId: '1', screenName: 'riko', followedByAuth: true },
        { userId: '2', screenName: 'tabi', followedByAuth: false },
      ],
      quote: [],
      reply: [],
    },
    selectedSources: { rt: true, quote: false, reply: false },
    authorScreenName: 'yuni',
    keyword: '',
    filters: {
      requireParticipantFollowsAuth: true,
      requireAuthFollowsParticipant: false,
      minFollowersEnabled: false,
      minFollowers: 50,
    },
  });

  assert.deepEqual(
    result.eligibleParticipants.map((item) => item.screenName),
    ['riko']
  );
});

test('buildEligiblePool applies auth->participant relationship filter', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [
        { userId: '1', screenName: 'riko', followingAuth: true },
        { userId: '2', screenName: 'tabi', followingAuth: false },
      ],
      quote: [],
      reply: [],
    },
    selectedSources: { rt: true, quote: false, reply: false },
    authorScreenName: 'yuni',
    keyword: '',
    filters: {
      requireParticipantFollowsAuth: false,
      requireAuthFollowsParticipant: true,
      minFollowersEnabled: false,
      minFollowers: 50,
    },
  });

  assert.deepEqual(
    result.eligibleParticipants.map((item) => item.screenName),
    ['riko']
  );
});

test('buildEligiblePool throws when no source is selected', () => {
  assert.throws(
    () =>
      buildEligiblePool({
        sourceParticipants: { rt: [], quote: [], reply: [] },
        selectedSources: { rt: false, quote: false, reply: false },
        authorScreenName: 'yuni',
        keyword: '',
        filters: {},
      }),
    { message: /At least one source must be selected/ }
  );
});

test('buildEligiblePool includes single-source participants in any mode', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [
        { userId: '1', screenName: 'riko' },
        { userId: '2', screenName: 'tabi' },
      ],
      quote: [{ userId: '3', screenName: 'nana', sourceTexts: ['quoted'] }],
      reply: [],
    },
    selectedSources: { rt: true, quote: true, reply: false },
    sourceMatchMode: SOURCE_MATCH_MODES.ANY,
    authorScreenName: 'yuni',
    keyword: '',
    filters: {},
  });

  assert.deepEqual(result.eligibleParticipants.map((participant) => participant.screenName).sort(), [
    'nana',
    'riko',
    'tabi',
  ]);
  assert.equal(result.stats.sourceMatchMode, SOURCE_MATCH_MODES.ANY);
  assert.equal(result.stats.intersectionCount, 3);
});

test('buildEligiblePool any mode applies keyword only to joined quote/reply sources', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [
        { userId: '1', screenName: 'rt_only' },
        { userId: '2', screenName: 'rt_and_quote' },
      ],
      quote: [
        { userId: '2', screenName: 'rt_and_quote', sourceTexts: ['burger in quote'] },
        { userId: '3', screenName: 'quote_and_reply', sourceTexts: ['no match quote'] },
      ],
      reply: [
        { userId: '4', screenName: 'reply_only', sourceTexts: ['burger in reply'] },
        { userId: '3', screenName: 'quote_and_reply', sourceTexts: ['still no match'] },
      ],
    },
    selectedSources: { rt: true, quote: true, reply: true },
    sourceMatchMode: SOURCE_MATCH_MODES.ANY,
    authorScreenName: 'yuni',
    keyword: 'burger',
    filters: {},
  });

  assert.deepEqual(result.eligibleParticipants.map((participant) => participant.screenName).sort(), [
    'reply_only',
    'rt_and_quote',
    'rt_only',
  ]);
  assert.equal(result.stats.intersectionCount, 4);
  assert.equal(result.stats.afterKeywordCount, 3);
  assert.equal(result.stats.excludedByKeyword, 1);
});

test('buildEligiblePool ignores invalid participants and merges duplicate sourceTexts per user', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: null,
      quote: [
        null,
        { userId: '', screenName: 'invalid' },
        { userId: '10', screenName: 'riko', sourceTexts: ['burger'] },
        { userId: '10', screenName: 'riko', sourceTexts: ['burger', 'fries'] },
      ],
      reply: [{ invalid: true }],
    },
    selectedSources: { rt: false, quote: true, reply: false },
    authorScreenName: undefined,
    keyword: 'fries',
    filters: {},
  });

  assert.equal(result.eligibleParticipants.length, 1);
  assert.equal(result.eligibleParticipants[0]!.screenName, 'riko');
  assert.equal(result.stats.sourceUniqueBeforeAuthor.quote, 1);
  assert.equal(result.stats.afterKeywordCount, 1);
});

test('buildEligiblePool falls back to ALL mode and returns empty on empty base source', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [],
      quote: [{ userId: '1', screenName: 'nana' }],
      reply: [],
    },
    selectedSources: { rt: true, quote: true, reply: false },
    sourceMatchMode: 'unsupported',
    authorScreenName: 'yuni',
    keyword: '',
    filters: {},
  });

  assert.equal(result.stats.sourceMatchMode, SOURCE_MATCH_MODES.ALL);
  assert.equal(result.stats.intersectionCount, 0);
  assert.equal(result.eligibleParticipants.length, 0);
});

test('buildEligiblePool excludes default profile and default profile image when configured', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [
        { userId: '1', screenName: 'riko', defaultProfile: true, defaultProfileImage: false },
        { userId: '2', screenName: 'tabi', defaultProfile: false, defaultProfileImage: true },
      ],
      quote: [],
      reply: [],
    },
    selectedSources: { rt: true, quote: false, reply: false },
    authorScreenName: 'yuni',
    keyword: '',
    filters: {
      excludeDefaultProfile: true,
      excludeDefaultProfileImage: true,
    },
  });

  assert.equal(result.eligibleParticipants.length, 0);
  assert.equal(result.stats.afterProfileCount, 0);
  assert.equal(result.stats.excludedByProfile, 2);
});

test('buildEligiblePool includes like source in any-mode merge and does not apply keyword to like-only users', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [],
      like: [{ userId: '1', screenName: 'like_only' }],
      quote: [{ userId: '2', screenName: 'quote_only', sourceTexts: ['no match text'] }],
      reply: [],
    },
    selectedSources: { rt: false, like: true, quote: true, reply: false },
    sourceMatchMode: SOURCE_MATCH_MODES.ANY,
    authorScreenName: 'yuni',
    keyword: 'burger',
    filters: {},
  });

  assert.deepEqual(result.eligibleParticipants.map((participant) => participant.screenName), ['like_only']);
  assert.equal(result.stats.sourceUniqueBeforeAuthor.like, 1);
  assert.equal(result.stats.sourceUniqueAfterAuthor.like, 1);
  assert.equal(result.stats.intersectionCount, 2);
  assert.equal(result.stats.afterKeywordCount, 1);
});

test('buildEligiblePool supports all-mode intersection with like source', () => {
  const result = buildEligiblePool({
    sourceParticipants: {
      rt: [],
      like: [
        { userId: '1', screenName: 'match_user' },
        { userId: '2', screenName: 'no_match_user' },
      ],
      quote: [
        { userId: '1', screenName: 'match_user', sourceTexts: ['burger in quote'] },
        { userId: '2', screenName: 'no_match_user', sourceTexts: ['without keyword'] },
      ],
      reply: [],
    },
    selectedSources: { rt: false, like: true, quote: true, reply: false },
    sourceMatchMode: SOURCE_MATCH_MODES.ALL,
    authorScreenName: 'yuni',
    keyword: 'burger',
    filters: {},
  });

  assert.deepEqual(result.eligibleParticipants.map((participant) => participant.screenName), ['match_user']);
  assert.equal(result.stats.intersectionCount, 2);
  assert.equal(result.stats.afterKeywordCount, 1);
  assert.equal(result.stats.excludedByKeyword, 1);
});
