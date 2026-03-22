import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { collectRetweeters, parseRetweetersPage } from '@rt/collectRetweeters';
import { DRAW_MODES, filterEligible } from '@rt/filterEligible';
import type { GraphqlPageResponse, SourceCollectionProgress } from '@shared/rtDraw';

interface RetweetersUser {
  __typename: string;
  rest_id: string;
  core: {
    screen_name: string;
    name: string;
  };
  legacy: {
    screen_name: string;
    friends_count: number | string;
    followers_count: number | string;
    default_profile: boolean;
    default_profile_image: boolean;
  };
}

interface RetweetersItemEntry {
  content: {
    entryType: 'TimelineTimelineItem';
    itemContent: {
      user_results: {
        result: RetweetersUser;
      };
    };
  };
}

interface RetweetersCursorEntry {
  content: {
    entryType: 'TimelineTimelineCursor';
    cursorType: 'Bottom';
    value: string;
  };
}

type RetweetersEntry = RetweetersItemEntry | RetweetersCursorEntry | Record<string, unknown>;

interface RetweetersPayload {
  data?: {
    retweeters_timeline?: {
      timeline?: {
        instructions?: Array<{
          entries?: RetweetersEntry[];
        }>;
      };
    };
  };
}

type CollectRetweetersFetchPage = NonNullable<Parameters<typeof collectRetweeters>[0]['fetchPage']>;

function readFixture<TPayload>(name: string): TPayload {
  const filePath = path.join(process.cwd(), 'tests', 'fixtures', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TPayload;
}

function makePayload(entries: RetweetersEntry[]): RetweetersPayload {
  return {
    data: {
      retweeters_timeline: {
        timeline: {
          instructions: [{ entries }],
        },
      },
    },
  };
}

function makeResponse<TPayload>(payload: TPayload): GraphqlPageResponse<TPayload> {
  return {
    payload,
    status: 200,
    url: 'https://x.com/i/api/graphql/op/Retweeters',
  };
}

function makeUser({
  id,
  screenName,
  name,
  friendsCount = 0,
  followersCount = 0,
  defaultProfile = false,
  defaultProfileImage = false,
  typename = 'User',
}: {
  id: string;
  screenName: string;
  name: string;
  friendsCount?: number | string;
  followersCount?: number | string;
  defaultProfile?: boolean;
  defaultProfileImage?: boolean;
  typename?: string;
}): RetweetersUser {
  return {
    __typename: typename,
    rest_id: id,
    core: {
      screen_name: screenName,
      name,
    },
    legacy: {
      screen_name: screenName,
      friends_count: friendsCount,
      followers_count: followersCount,
      default_profile: defaultProfile,
      default_profile_image: defaultProfileImage,
    },
  };
}

function makeUserEntry(user: RetweetersUser): RetweetersItemEntry {
  return {
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        user_results: {
          result: user,
        },
      },
    },
  };
}

function makeBottomCursor(value: string): RetweetersCursorEntry {
  return {
    content: {
      entryType: 'TimelineTimelineCursor',
      cursorType: 'Bottom',
      value,
    },
  };
}

test('parse page extracts users and bottom cursor', () => {
  const payload = readFixture<RetweetersPayload>('page-multi-1.json');
  const parsed = parseRetweetersPage(payload);

  assert.equal(parsed.participants.length, 2);
  assert.equal(parsed.bottomCursor, 'cursor-1');
});

test('collect single page', async () => {
  const payload = readFixture<RetweetersPayload>('page-single.json');
  const fetchPage: CollectRetweetersFetchPage = async () => makeResponse(payload);

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  assert.equal(result.participants.length, 2);
  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(result.metrics.totalCollectedRaw, 2);
});

test('collect multi page dedupe + author exclusion', async () => {
  const page1 = readFixture<RetweetersPayload>('page-multi-1.json');
  const page2 = readFixture<RetweetersPayload>('page-multi-2.json');

  const fetchPage: CollectRetweetersFetchPage = async ({ cursor }) => makeResponse(cursor ? page2 : page1);

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  assert.equal(result.participants.length, 2);
  assert.deepEqual(result.participants.map((item) => item.screenName).sort(), ['nana', 'riko']);
  assert.equal(result.metrics.pagesFetched, 2);
  assert.equal(result.metrics.totalCollectedRaw, 4);
  assert.equal(result.metrics.excludedAuthorCount, 1);
  assert.equal(result.metrics.duplicatesSkipped, 1);
});

test('cursor loop detection stops safely', async () => {
  const pageLoop = readFixture<RetweetersPayload>('page-loop.json');
  const requests: Array<{ enableRanking?: boolean; includePromotedContent?: boolean; count: number }> = [];
  const fetchPage: CollectRetweetersFetchPage = async ({ enableRanking, includePromotedContent, count }) => {
    requests.push({ enableRanking, includePromotedContent, count });
    return makeResponse(pageLoop);
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  assert.equal(result.metrics.loopDetected, true);
  assert.equal(result.metrics.pagesFetched, 4);
  assert.equal(requests.some((item) => item.enableRanking === true && item.includePromotedContent === true), true);
});

test('rt-follow mode filters collected participants', async () => {
  const payload = readFixture<RetweetersPayload>('page-single.json');
  const fetchPage: CollectRetweetersFetchPage = async () => makeResponse(payload);

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  const filtered = filterEligible(result.participants, DRAW_MODES.RT_FOLLOW);
  assert.equal(filtered.eligible.length, 1);
  assert.equal(filtered.eligible[0]!.screenName, 'riko');
});

test('transient empty payload retries and recovers', async () => {
  const payload = readFixture<RetweetersPayload>('page-single.json');
  let callCount = 0;

  const fetchPage: CollectRetweetersFetchPage = async () => {
    callCount += 1;
    if (callCount === 1) {
      return makeResponse({});
    }
    return makeResponse(payload);
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxTransientEmptyPages: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(result.participants.length, 2);
  assert.equal(result.metrics.pagesFetched, 2);
});

test('persistent empty payload stops with invalid_or_empty_payload', async () => {
  let callCount = 0;
  const fetchPage: CollectRetweetersFetchPage = async () => {
    callCount += 1;
    return makeResponse({});
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxTransientEmptyPages: 1,
  });

  assert.equal(result.participants.length, 0);
  assert.equal(result.metrics.terminationReason, 'invalid_or_empty_payload');
  assert.equal(result.metrics.pagesFetched, 4);
  assert.equal(callCount, 4);
});

test('parseRetweetersPage handles malformed entries and schema warnings', () => {
  const payload = makePayload([
    {},
    { content: { entryType: 'TimelineUnknown' } },
    makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko', friendsCount: '10', followersCount: '20' })),
    makeUserEntry(makeUser({ id: '2', screenName: '', name: 'Tabi' })),
    makeUserEntry(makeUser({ id: '3', screenName: 'nana', name: 'Nana', typename: 'NotUser' })),
    makeBottomCursor('cursor-x'),
  ]);

  const parsed = parseRetweetersPage(payload);

  assert.equal(parsed.bottomCursor, 'cursor-x');
  assert.equal(parsed.participants.length, 1);
  assert.equal(parsed.participants[0]!.userId, '1');
  assert.equal(parsed.participants[0]!.followingCount, 10);
  assert.equal(parsed.participants[0]!.followersCount, 20);
  assert.equal(parsed.participants[0]!.defaultProfile, false);
  assert.equal(parsed.participants[0]!.defaultProfileImage, false);
  assert.equal(parsed.warnings, 2);
});

test('collectRetweeters validates required inputs and numeric options', async () => {
  const okFetch: CollectRetweetersFetchPage = async () =>
    makeResponse(readFixture<RetweetersPayload>('page-single.json'));

  await assert.rejects(
    () =>
      collectRetweeters({
        tweetId: '',
        authorScreenName: 'yuni',
        pageSize: 20,
        operationId: 'op',
        features: {},
        headers: {},
        fetchPage: okFetch,
      }),
    /tweetId is required/
  );

  await assert.rejects(
    () =>
      collectRetweeters({
        tweetId: '123',
        authorScreenName: 'yuni',
        pageSize: 20,
        operationId: '',
        features: {},
        headers: {},
        fetchPage: okFetch,
      }),
    /operationId is required/
  );

  await assert.rejects(
    () =>
      collectRetweeters({
        tweetId: '123',
        authorScreenName: 'yuni',
        pageSize: 20,
        operationId: 'op',
        features: {},
        headers: {},
        fetchPage: okFetch,
        maxPages: 0,
      }),
    /maxPages must be a positive integer/
  );

  await assert.rejects(
    () =>
      collectRetweeters({
        tweetId: '123',
        authorScreenName: 'yuni',
        pageSize: 20,
        operationId: 'op',
        features: {},
        headers: {},
        fetchPage: okFetch,
        maxTransientEmptyPages: -1,
      }),
    /maxTransientEmptyPages must be a non-negative integer/
  );
});

test('collectRetweeters terminates by max_pages and reports progress callback', async () => {
  let seq = 0;
  const progressEvents: SourceCollectionProgress[] = [];
  const fetchPage: CollectRetweetersFetchPage = async () => {
    seq += 1;
    return makeResponse(
      makePayload([
        makeUserEntry(makeUser({ id: String(seq), screenName: `riko${seq}`, name: `Riko ${seq}` })),
        makeBottomCursor(`cursor-${seq}`),
      ])
    );
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: '',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxPages: 1,
    onProgress: (event: SourceCollectionProgress) => progressEvents.push(event),
  });

  assert.equal(result.metrics.terminationReason, 'max_pages');
  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0]!.pagesFetched, 1);
});

test('collectRetweeters terminates on repeated page signatures', async () => {
  let seq = 0;
  const requests: Array<{ enableRanking?: boolean; includePromotedContent?: boolean; count: number }> = [];
  const fetchPage: CollectRetweetersFetchPage = async ({ enableRanking, includePromotedContent, count }) => {
    requests.push({ enableRanking, includePromotedContent, count });
    seq += 1;
    return makeResponse(
      makePayload([
        makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
        makeBottomCursor(`cursor-${seq}`),
      ])
    );
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxRepeatPageSignatures: 2,
  });

  assert.equal(result.metrics.terminationReason, 'repeated_page');
  assert.equal(result.metrics.loopDetected, true);
  assert.equal(result.metrics.pagesFetched, 4);
  assert.equal(requests.some((item) => item.enableRanking === true && item.includePromotedContent === true), true);
});

test('collectRetweeters terminates on no-growth streak', async () => {
  let seq = 0;
  const fetchPage: CollectRetweetersFetchPage = async () => {
    seq += 1;
    return makeResponse(
      makePayload([
        makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
        makeBottomCursor(`cursor-${seq}`),
      ])
    );
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxNoGrowthPages: 1,
    maxRepeatPageSignatures: 99,
  });

  assert.equal(result.metrics.terminationReason, 'no_growth');
  assert.equal(result.metrics.noGrowthStreak, 1);
  assert.equal(result.metrics.pagesFetched, 3);
});

test('collectRetweeters falls back to ranked strategy after no-growth and keeps new users', async () => {
  const requests: Array<{
    cursor?: string | null;
    count: number;
    enableRanking?: boolean;
    includePromotedContent?: boolean;
  }> = [];
  let unrankedCalls = 0;
  let rankedCalls = 0;

  const fetchPage: CollectRetweetersFetchPage = async ({ cursor, count, enableRanking, includePromotedContent }) => {
    requests.push({ cursor, count, enableRanking, includePromotedContent });

    const isRanked = enableRanking === true && includePromotedContent === true;
    if (!isRanked) {
      unrankedCalls += 1;
      if (unrankedCalls === 1) {
        return makeResponse(
          makePayload([
            makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
            makeBottomCursor('cursor-u1'),
          ])
        );
      }
      return makeResponse(
        makePayload([
          makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
          makeBottomCursor('cursor-u2'),
        ])
      );
    }

    rankedCalls += 1;
    if (rankedCalls === 1) {
      return makeResponse(
        makePayload([
          makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
          makeUserEntry(makeUser({ id: '2', screenName: 'nana', name: 'Nana' })),
        ])
      );
    }

    return makeResponse(makePayload([]));
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxNoGrowthPages: 1,
    maxRepeatPageSignatures: 99,
  });

  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
  assert.equal(result.metrics.pagesFetched, 3);
  assert.equal(result.metrics.totalUnique, 2);
  assert.equal(result.metrics.duplicatesSkipped, 2);
  assert.deepEqual(
    result.participants.map((item) => item.screenName).sort(),
    ['nana', 'riko']
  );
  assert.equal(requests.length, 3);
  assert.equal(requests[0]!.enableRanking, false);
  assert.equal(requests[0]!.includePromotedContent, false);
  assert.equal(requests[0]!.count, 20);
  assert.equal(requests[0]!.cursor, null);
  assert.equal(requests[1]!.enableRanking, false);
  assert.equal(requests[1]!.includePromotedContent, false);
  assert.equal(requests[1]!.count, 20);
  assert.equal(requests[1]!.cursor, 'cursor-u1');
  assert.equal(requests[2]!.enableRanking, true);
  assert.equal(requests[2]!.includePromotedContent, true);
  assert.equal(requests[2]!.count, 100);
  assert.equal(requests[2]!.cursor, null);
});

test('collectRetweeters uses pageSize when ranked fallback pageSize exceeds 100', async () => {
  const requests: Array<{
    cursor?: string | null;
    count: number;
    enableRanking?: boolean;
    includePromotedContent?: boolean;
  }> = [];
  let unrankedCalls = 0;

  const fetchPage: CollectRetweetersFetchPage = async ({ cursor, count, enableRanking, includePromotedContent }) => {
    requests.push({ cursor, count, enableRanking, includePromotedContent });

    const isRanked = enableRanking === true && includePromotedContent === true;
    if (!isRanked) {
      unrankedCalls += 1;
      if (unrankedCalls === 1) {
        return makeResponse(
          makePayload([
            makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
            makeBottomCursor('cursor-u1'),
          ])
        );
      }

      return makeResponse(
        makePayload([
          makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
          makeBottomCursor('cursor-u2'),
        ])
      );
    }

    return makeResponse(makePayload([]));
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 150,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxNoGrowthPages: 1,
    maxRepeatPageSignatures: 99,
  });

  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
  assert.equal(result.metrics.pagesFetched, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests[2]!.enableRanking, true);
  assert.equal(requests[2]!.includePromotedContent, true);
  assert.equal(requests[2]!.count, 150);
});

test('collectRetweeters does not fallback when primary strategy ends timeline', async () => {
  const requests: Array<{ count: number; enableRanking?: boolean; includePromotedContent?: boolean }> = [];
  const fetchPage: CollectRetweetersFetchPage = async ({ count, enableRanking, includePromotedContent }) => {
    requests.push({ count, enableRanking, includePromotedContent });
    return makeResponse(makePayload([makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' }))]));
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.enableRanking, false);
  assert.equal(requests[0]!.includePromotedContent, false);
  assert.equal(requests[0]!.count, 20);
});

test('collectRetweeters maxPages applies across strategies', async () => {
  const requests: Array<{ count: number; enableRanking?: boolean; includePromotedContent?: boolean }> = [];
  const fetchPage: CollectRetweetersFetchPage = async ({ count, enableRanking, includePromotedContent, cursor }) => {
    requests.push({ count, enableRanking, includePromotedContent });
    return makeResponse(
      makePayload([
        makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
        makeBottomCursor(cursor ? 'cursor-2' : 'cursor-1'),
      ])
    );
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxPages: 2,
    maxNoGrowthPages: 1,
    maxRepeatPageSignatures: 99,
  });

  assert.equal(result.metrics.terminationReason, 'max_pages');
  assert.equal(result.metrics.pagesFetched, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((item) => item.enableRanking === false && item.includePromotedContent === false), true);
});

test('collectRetweeters shares maxPages budget after fallback starts', async () => {
  const requests: Array<{
    cursor?: string | null;
    count: number;
    enableRanking?: boolean;
    includePromotedContent?: boolean;
  }> = [];
  let unrankedCalls = 0;

  const fetchPage: CollectRetweetersFetchPage = async ({ cursor, count, enableRanking, includePromotedContent }) => {
    requests.push({ cursor, count, enableRanking, includePromotedContent });
    const isRanked = enableRanking === true && includePromotedContent === true;

    if (!isRanked) {
      unrankedCalls += 1;
      if (unrankedCalls === 1) {
        return makeResponse(
          makePayload([
            makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
            makeBottomCursor('cursor-u1'),
          ])
        );
      }

      return makeResponse(
        makePayload([
          makeUserEntry(makeUser({ id: '1', screenName: 'riko', name: 'Riko' })),
          makeBottomCursor('cursor-u2'),
        ])
      );
    }

    return makeResponse(
      makePayload([
        makeUserEntry(makeUser({ id: '2', screenName: 'nana', name: 'Nana' })),
        makeBottomCursor('cursor-r1'),
      ])
    );
  };

  const result = await collectRetweeters({
    tweetId: '123',
    authorScreenName: 'yuni',
    pageSize: 20,
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
    maxPages: 3,
    maxNoGrowthPages: 1,
    maxRepeatPageSignatures: 99,
  });

  assert.equal(result.metrics.terminationReason, 'max_pages');
  assert.equal(result.metrics.pagesFetched, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests[2]!.enableRanking, true);
  assert.equal(requests[2]!.includePromotedContent, true);
  assert.equal(result.metrics.totalUnique, 2);
});
