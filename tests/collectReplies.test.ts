import { test } from 'vitest';
import assert from 'node:assert/strict';

import { collectReplies, parseReplyDetailPage } from '@rt/collectReplies';
import type { GraphqlPageResponse } from '@shared/rtDraw';

interface ReplyTweetFactoryInput {
  tweetId: string;
  inReplyToStatusId: string;
  userId: string;
  screenName: string;
  name: string;
  fullText: string;
  following?: boolean;
  followedBy?: boolean;
  friendsCount?: number;
  followersCount?: number;
}

interface ReplyTweetResult {
  rest_id: string;
  legacy: {
    id_str: string;
    in_reply_to_status_id_str: string;
    full_text: string;
  };
  core: {
    user_results: {
      result: {
        rest_id: string;
        core: {
          screen_name: string;
          name: string;
        };
        relationship_perspectives: {
          following: boolean;
          followed_by: boolean;
        };
        legacy: {
          friends_count: number;
          followers_count: number;
          default_profile: boolean;
          default_profile_image: boolean;
        };
      };
    };
  };
}

interface ReplyTimelineItemEntry {
  content: {
    entryType: 'TimelineTimelineItem';
    itemContent: {
      tweet_results: {
        result: ReplyTweetResult;
      };
    };
  };
}

interface ReplyTimelineModuleItem {
  entryId: string;
  item: {
    itemContent: {
      itemType: 'TimelineTweet';
      tweet_results: {
        result: ReplyTweetResult;
      };
    };
  };
}

interface ReplyCursorEntry {
  content: {
    entryType: 'TimelineTimelineCursor';
    cursorType: string;
    value: string;
  };
}

interface ReplyModuleEntry {
  content: {
    entryType: 'TimelineTimelineModule';
    items: ReplyTimelineModuleItem[];
  };
}

type ReplyEntry = ReplyTimelineItemEntry | ReplyCursorEntry | ReplyModuleEntry;

interface ReplyDetailPayload {
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: Array<{
        type: string;
        entries: ReplyEntry[];
      }>;
    };
  };
}

type CollectRepliesFetchPage = NonNullable<Parameters<typeof collectReplies>[0]['fetchPage']>;
type ReplyPayloadInput = Parameters<typeof parseReplyDetailPage>[0];

function makeTweet({
  tweetId,
  inReplyToStatusId,
  userId,
  screenName,
  name,
  fullText,
  following = false,
  followedBy = false,
  friendsCount = 0,
  followersCount = 0,
}: ReplyTweetFactoryInput): ReplyTweetResult {
  return {
    rest_id: String(tweetId),
    legacy: {
      id_str: String(tweetId),
      in_reply_to_status_id_str: String(inReplyToStatusId),
      full_text: fullText,
    },
    core: {
      user_results: {
        result: {
          rest_id: String(userId),
          core: {
            screen_name: screenName,
            name,
          },
          relationship_perspectives: {
            following,
            followed_by: followedBy,
          },
          legacy: {
            friends_count: friendsCount,
            followers_count: followersCount,
            default_profile: false,
            default_profile_image: false,
          },
        },
      },
    },
  };
}

function makeTimelineItem(tweet: ReplyTweetResult): ReplyTimelineItemEntry {
  return {
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        tweet_results: {
          result: tweet,
        },
      },
    },
  };
}

function makeTimelineModuleItem(tweet: ReplyTweetResult): ReplyTimelineModuleItem {
  return {
    entryId: `module-${tweet.rest_id}`,
    item: {
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: {
          result: tweet,
        },
      },
    },
  };
}

function makeCursorEntry(cursorType: string, value: string): ReplyCursorEntry {
  return {
    content: {
      entryType: 'TimelineTimelineCursor',
      cursorType,
      value,
    },
  };
}

function makeModule(items: ReplyTimelineModuleItem[]): ReplyModuleEntry {
  return {
    content: {
      entryType: 'TimelineTimelineModule',
      items,
    },
  };
}

function makePayload(entries: ReplyEntry[]): ReplyDetailPayload {
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries,
          },
        ],
      },
    },
  };
}

function makeResponse<TPayload>(payload: TPayload): GraphqlPageResponse<TPayload> {
  return {
    payload,
    status: 200,
    url: 'https://x.com/i/api/graphql/op/TweetDetail',
  };
}

test('parseReplyDetailPage includes direct replies from item and module, and cursors', () => {
  const direct1 = makeTweet({
    tweetId: '201',
    inReplyToStatusId: '999',
    userId: '1',
    screenName: 'riko',
    name: 'Riko',
    fullText: 'direct item',
  });
  const notDirect = makeTweet({
    tweetId: '202',
    inReplyToStatusId: '555',
    userId: '2',
    screenName: 'tabi',
    name: 'Tabi',
    fullText: 'ignore',
  });
  const direct2 = makeTweet({
    tweetId: '203',
    inReplyToStatusId: '999',
    userId: '3',
    screenName: 'nana',
    name: 'Nana',
    fullText: 'direct module',
  });

  const payload = makePayload([
    makeTimelineItem(direct1),
    makeTimelineItem(notDirect),
    makeModule([makeTimelineModuleItem(direct2)]),
    makeCursorEntry('Bottom', 'CURSOR_B'),
    makeCursorEntry('ShowMoreThreads', 'CURSOR_S'),
  ]);

  const parsed = parseReplyDetailPage(payload, '999');
  assert.equal(parsed.participants.length, 2);
  assert.deepEqual(parsed.participants.map((item) => item.screenName).sort(), ['nana', 'riko']);
  assert.equal(parsed.cursors.length, 2);
  assert.deepEqual(parsed.cursors.map((item) => item.cursorType).sort(), ['Bottom', 'ShowMoreThreads']);
});

test('collectReplies handles direct-reply filter, dedupe, author exclusion, and cursor loop', async () => {
  const pageRoot = makePayload([
    makeTimelineItem(
      makeTweet({
        tweetId: '301',
        inReplyToStatusId: '999',
        userId: '1',
        screenName: 'riko',
        name: 'Riko',
        fullText: 'root',
      })
    ),
    makeCursorEntry('Bottom', 'CURSOR_B'),
    makeCursorEntry('ShowMoreThreads', 'CURSOR_S'),
  ]);

  const pageBottom = makePayload([
    makeTimelineItem(
      makeTweet({
        tweetId: '302',
        inReplyToStatusId: '999',
        userId: '1',
        screenName: 'riko',
        name: 'Riko',
        fullText: 'duplicate',
      })
    ),
  ]);

  const pageShowMore = makePayload([
    makeTimelineItem(
      makeTweet({
        tweetId: '303',
        inReplyToStatusId: '999',
        userId: '99',
        screenName: 'yuni',
        name: 'Yuni',
        fullText: 'author reply',
      })
    ),
    makeTimelineItem(
      makeTweet({
        tweetId: '304',
        inReplyToStatusId: '999',
        userId: '2',
        screenName: 'tabi',
        name: 'Tabi',
        fullText: 'new',
      })
    ),
    makeCursorEntry('Bottom', 'CURSOR_B'),
  ]);

  const fetchPage: CollectRepliesFetchPage = async ({ cursor }) => {
    if (!cursor) {
      return makeResponse(pageRoot);
    }
    if (cursor === 'CURSOR_B') {
      return makeResponse(pageBottom);
    }
    return makeResponse(pageShowMore);
  };

  const result = await collectReplies({
    tweetId: '999',
    authorScreenName: 'yuni',
    operationId: 'op',
    features: {},
    fieldToggles: {},
    headers: {},
    fetchPage,
  });

  assert.deepEqual(result.participants.map((item) => item.screenName).sort(), ['riko', 'tabi']);
  assert.equal(result.metrics.pagesFetched, 3);
  assert.equal(result.metrics.totalCollectedRaw, 4);
  assert.equal(result.metrics.duplicatesSkipped, 1);
  assert.equal(result.metrics.excludedAuthorCount, 1);
  assert.equal(result.metrics.loopDetected, true);
  assert.equal(result.metrics.terminationReason, 'cursor_cycle');
});

test('collectReplies stops on no-growth streak', async () => {
  const firstReply = makeTweet({
    tweetId: '401',
    inReplyToStatusId: '999',
    userId: '10',
    screenName: 'riko',
    name: 'Riko',
    fullText: 'hello',
  });

  let callCount = 0;
  const fetchPage: CollectRepliesFetchPage = async () => {
    callCount += 1;
    return makeResponse(makePayload([makeTimelineItem(firstReply), makeCursorEntry('Bottom', `CURSOR_${callCount}`)]));
  };

  const result = await collectReplies({
    tweetId: '999',
    authorScreenName: 'yuni',
    operationId: 'op',
    features: {},
    fieldToggles: {},
    headers: {},
    fetchPage,
    maxPages: 50,
    maxNoGrowthPages: 3,
  });

  assert.equal(result.metrics.totalUnique, 1);
  assert.equal(result.metrics.pagesFetched, 4);
  assert.equal(result.metrics.noGrowthStreak, 3);
  assert.equal(result.metrics.terminationReason, 'no_growth');
});

test('parseReplyDetailPage keeps relevant cursors and counts malformed tweets as warnings', () => {
  const payload = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              makeCursorEntry('Top', 'TOP_CURSOR'),
              {
                content: {
                  entryType: 'TimelineTimelineModule',
                  clientEventInfo: {
                    details: {
                      timelinesDetails: {
                        controllerData: 'ENTRY_CTL',
                      },
                    },
                  },
                  items: [
                    {
                      item: {
                        itemContent: {
                          itemType: 'TimelineTimelineCursor',
                          cursorType: 'ShowMore',
                          value: 'CURSOR_SHOW_MORE',
                        },
                      },
                    },
                    {
                      item: {
                        itemContent: {
                          itemType: 'TimelineTweet',
                          tweet_results: {
                            result: {
                              legacy: null,
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };

  const parsed = parseReplyDetailPage(payload as ReplyPayloadInput, '999');
  assert.equal(parsed.participants.length, 0);
  assert.equal(parsed.warnings, 1);
  assert.equal(parsed.cursors.length, 1);
  assert.equal(parsed.cursors[0]!.cursorType, 'ShowMore');
  assert.equal(parsed.cursors[0]!.value, 'CURSOR_SHOW_MORE');
  assert.equal(parsed.cursors[0]!.controllerData, 'ENTRY_CTL');
});

test('collectReplies ends with end_of_timeline when queue is exhausted without warnings', async () => {
  const payload = makePayload([
    makeTimelineItem(
      makeTweet({
        tweetId: '901',
        inReplyToStatusId: '999',
        userId: '11',
        screenName: 'riko',
        name: 'Riko',
        fullText: 'done',
      })
    ),
  ]);
  const fetchPage: CollectRepliesFetchPage = async () => makeResponse(payload);

  const result = await collectReplies({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
  });

  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(result.metrics.totalUnique, 1);
  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
});

test('collectReplies ends with invalid_or_empty_payload on schema mismatch', async () => {
  const fetchPage: CollectRepliesFetchPage = async () => makeResponse({} as ReplyDetailPayload);

  const result = await collectReplies({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
  });

  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(result.metrics.totalUnique, 0);
  assert.equal(result.metrics.schemaWarnings > 0, true);
  assert.equal(result.metrics.terminationReason, 'invalid_or_empty_payload');
});

test('collectReplies stops with max_pages when cursor queue keeps expanding', async () => {
  let callCount = 0;
  const fetchPage: CollectRepliesFetchPage = async () => {
    callCount += 1;
    return makeResponse(makePayload([makeCursorEntry('Bottom', `CURSOR_${callCount}`)]));
  };

  const result = await collectReplies({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
    maxPages: 2,
    maxNoGrowthPages: 10,
  });

  assert.equal(callCount, 2);
  assert.equal(result.metrics.pagesFetched, 2);
  assert.equal(result.metrics.terminationReason, 'max_pages');
});

test('collectReplies rejects invalid maxNoGrowthPages option', async () => {
  const fetchPage: CollectRepliesFetchPage = async () => makeResponse(makePayload([]));

  await assert.rejects(
    () =>
      collectReplies({
        tweetId: '999',
        operationId: 'op',
        fetchPage,
        maxNoGrowthPages: 0,
      }),
    /maxNoGrowthPages must be a positive integer/
  );
});

test('collectReplies reports progress payload shape while queue evolves', async () => {
  const rootPayload = makePayload([
    makeTimelineItem(
      makeTweet({
        tweetId: '1001',
        inReplyToStatusId: '999',
        userId: '42',
        screenName: 'riko',
        name: 'Riko',
        fullText: 'first',
      })
    ),
    makeCursorEntry('Bottom', 'CURSOR_NEXT'),
  ]);
  const secondPayload = makePayload([]);

  const fetchPage: CollectRepliesFetchPage = async ({ cursor }) =>
    makeResponse(cursor ? secondPayload : rootPayload);

  const progress: Array<{ pagesFetched: number; noGrowthStreak: number; nextCursorCount: number }> = [];
  const result = await collectReplies({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
    onProgress: (payload) => {
      progress.push({
        pagesFetched: payload.pagesFetched,
        noGrowthStreak: payload.noGrowthStreak ?? -1,
        nextCursorCount: payload.nextCursorCount ?? -1,
      });
    },
  });

  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
  assert.equal(progress.length, 2);
  assert.equal(progress[0]!.pagesFetched, 1);
  assert.equal(progress[0]!.noGrowthStreak, 0);
  assert.equal(progress[0]!.nextCursorCount, 1);
  assert.equal(progress[1]!.pagesFetched, 2);
  assert.equal(progress[1]!.noGrowthStreak, 1);
  assert.equal(progress[1]!.nextCursorCount, 0);
});

test('collectReplies rejects when required options are missing', async () => {
  await assert.rejects(
    () =>
      collectReplies({
        tweetId: '',
        operationId: 'op',
      }),
    /tweetId is required/
  );

  await assert.rejects(
    () =>
      collectReplies({
        tweetId: '999',
        operationId: '',
      }),
    /operationId is required/i
  );
});
