import { test } from 'vitest';
import assert from 'node:assert/strict';

import { collectQuotes, parseQuoteSearchPage } from '@rt/collectQuotes';
import type { GraphqlPageResponse } from '@shared/rtDraw';

interface QuoteTweetFactoryInput {
  userId: string;
  screenName: string;
  name: string;
  quotedStatusId: string;
  fullText: string;
  following?: boolean;
  followedBy?: boolean;
  friendsCount?: number;
  followersCount?: number;
}

interface QuoteTweetResult {
  legacy: {
    quoted_status_id_str: string;
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

interface SearchTimelineCursorEntry {
  content: {
    entryType: 'TimelineTimelineCursor';
    cursorType: 'Bottom';
    value: string;
  };
}

interface SearchTimelineItemEntry {
  content: {
    entryType: 'TimelineTimelineItem';
    itemContent: {
      tweet_results: {
        result: QuoteTweetResult;
      };
    };
  };
}

interface QuoteSearchPayload {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: Array<{
            entries: Array<SearchTimelineItemEntry | SearchTimelineCursorEntry>;
          }>;
        };
      };
    };
  };
}

type CollectQuotesFetchPage = NonNullable<Parameters<typeof collectQuotes>[0]['fetchPage']>;
type QuotePayloadInput = Parameters<typeof parseQuoteSearchPage>[0];

function makeTweet({
  userId,
  screenName,
  name,
  quotedStatusId,
  fullText,
  following = false,
  followedBy = false,
  friendsCount = 0,
  followersCount = 0,
}: QuoteTweetFactoryInput): QuoteTweetResult {
  return {
    legacy: {
      quoted_status_id_str: String(quotedStatusId),
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

function makeTimelineItem(tweet: QuoteTweetResult): SearchTimelineItemEntry {
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

function makeBottomCursor(value: string): SearchTimelineCursorEntry {
  return {
    content: {
      entryType: 'TimelineTimelineCursor',
      cursorType: 'Bottom',
      value,
    },
  };
}

function makeResponse<TPayload>(payload: TPayload): GraphqlPageResponse<TPayload> {
  return {
    payload,
    status: 200,
    url: 'https://x.com/i/api/graphql/op/SearchTimeline',
  };
}

test('parseQuoteSearchPage extracts only matching quoted tweet and bottom cursor', () => {
  const payload: QuoteSearchPayload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  makeTimelineItem(
                    makeTweet({
                      userId: '1',
                      screenName: 'riko',
                      name: 'Riko',
                      quotedStatusId: '999',
                      fullText: 'match',
                    })
                  ),
                  makeTimelineItem(
                    makeTweet({
                      userId: '2',
                      screenName: 'tabi',
                      name: 'Tabi',
                      quotedStatusId: '123',
                      fullText: 'ignore',
                    })
                  ),
                  makeBottomCursor('CURSOR_A'),
                ],
              },
            ],
          },
        },
      },
    },
  };

  const parsed = parseQuoteSearchPage(payload, '999');
  assert.equal(parsed.participants.length, 1);
  assert.equal(parsed.participants[0]!.userId, '1');
  assert.equal(parsed.participants[0]!.sourceTexts[0], 'match');
  assert.equal(parsed.bottomCursor, 'CURSOR_A');
});

test('collectQuotes handles dedupe, author exclusion, and cursor loop safely', async () => {
  const page1: QuoteSearchPayload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  makeTimelineItem(
                    makeTweet({
                      userId: '10',
                      screenName: 'riko',
                      name: 'Riko',
                      quotedStatusId: '999',
                      fullText: 'hello',
                    })
                  ),
                  makeTimelineItem(
                    makeTweet({
                      userId: '99',
                      screenName: 'yuni',
                      name: 'Yuni',
                      quotedStatusId: '999',
                      fullText: 'yuni quote',
                    })
                  ),
                  makeBottomCursor('CURSOR_1'),
                ],
              },
            ],
          },
        },
      },
    },
  };

  const page2: QuoteSearchPayload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  makeTimelineItem(
                    makeTweet({
                      userId: '10',
                      screenName: 'riko',
                      name: 'Riko',
                      quotedStatusId: '999',
                      fullText: 'hello again',
                    })
                  ),
                  makeTimelineItem(
                    makeTweet({
                      userId: '11',
                      screenName: 'tabi',
                      name: 'Tabi',
                      quotedStatusId: '999',
                      fullText: 'new',
                    })
                  ),
                  makeBottomCursor('CURSOR_1'),
                ],
              },
            ],
          },
        },
      },
    },
  };

  const fetchPage: CollectQuotesFetchPage = async ({ cursor }) => makeResponse(cursor ? page2 : page1);

  const result = await collectQuotes({
    tweetId: '999',
    authorScreenName: 'yuni',
    operationId: 'op',
    features: {},
    headers: {},
    fetchPage,
  });

  assert.deepEqual(result.participants.map((item) => item.screenName).sort(), ['riko', 'tabi']);
  assert.equal(result.metrics.pagesFetched, 2);
  assert.equal(result.metrics.totalCollectedRaw, 4);
  assert.equal(result.metrics.duplicatesSkipped, 1);
  assert.equal(result.metrics.excludedAuthorCount, 1);
  assert.equal(result.metrics.loopDetected, true);
  assert.equal(result.metrics.terminationReason, 'cursor_cycle');
});

test('parseQuoteSearchPage counts warnings for malformed timeline items', () => {
  const payload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  {
                    content: {
                      entryType: 'TimelineTimelineItem',
                      itemContent: {
                        tweet_results: {
                          result: {
                            core: {
                              user_results: {
                                result: {
                                  rest_id: '1',
                                  core: {
                                    screen_name: 'riko',
                                    name: 'Riko',
                                  },
                                },
                              },
                            },
                            legacy: null,
                          },
                        },
                      },
                    },
                  },
                  {
                    content: {
                      entryType: 'TimelineTimelineItem',
                      itemContent: {
                        tweet_results: {
                          result: {
                            core: {
                              user_results: {
                                result: {
                                  rest_id: null,
                                  core: {
                                    screen_name: 'tabi',
                                    name: 'Tabi',
                                  },
                                },
                              },
                            },
                            legacy: {
                              quoted_status_id_str: '999',
                              full_text: 'broken-user',
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    content: {
                      entryType: 'TimelineTimelineCursor',
                      cursorType: 'Top',
                      value: 'TOP_CURSOR',
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };

  const parsed = parseQuoteSearchPage(payload as QuotePayloadInput, '999');
  assert.equal(parsed.participants.length, 0);
  assert.equal(parsed.bottomCursor, null);
  assert.equal(parsed.warnings, 2);
});

test('collectQuotes ends with end_of_timeline when next cursor is absent without warnings', async () => {
  const payload: QuoteSearchPayload = {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                entries: [
                  makeTimelineItem(
                    makeTweet({
                      userId: '20',
                      screenName: 'riko',
                      name: 'Riko',
                      quotedStatusId: '999',
                      fullText: 'single page',
                    })
                  ),
                ],
              },
            ],
          },
        },
      },
    },
  };

  const fetchPage: CollectQuotesFetchPage = async () => makeResponse(payload);

  const result = await collectQuotes({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
  });

  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(result.metrics.totalUnique, 1);
  assert.equal(result.metrics.terminationReason, 'end_of_timeline');
});

test('collectQuotes ends with invalid_or_empty_payload on schema mismatch', async () => {
  const fetchPage: CollectQuotesFetchPage = async () => makeResponse({} as QuoteSearchPayload);

  const progressCalls: Array<{ pagesFetched: number; nextCursor: string | null | undefined }> = [];
  const result = await collectQuotes({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
    onProgress: (payload) => {
      progressCalls.push({
        pagesFetched: payload.pagesFetched,
        nextCursor: payload.nextCursor,
      });
    },
  });

  assert.equal(result.metrics.pagesFetched, 1);
  assert.equal(result.metrics.schemaWarnings > 0, true);
  assert.equal(result.metrics.terminationReason, 'invalid_or_empty_payload');
  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0]!.pagesFetched, 1);
  assert.equal(progressCalls[0]!.nextCursor, null);
});

test('collectQuotes stops with max_pages when cursor keeps advancing', async () => {
  let callCount = 0;
  const fetchPage: CollectQuotesFetchPage = async () => {
    callCount += 1;
    const payload: QuoteSearchPayload = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [makeBottomCursor(`CURSOR_${callCount}`)],
                },
              ],
            },
          },
        },
      },
    };

    return makeResponse(payload);
  };

  const result = await collectQuotes({
    tweetId: '999',
    operationId: 'op',
    fetchPage,
    maxPages: 2,
  });

  assert.equal(callCount, 2);
  assert.equal(result.metrics.pagesFetched, 2);
  assert.equal(result.metrics.terminationReason, 'max_pages');
});

test('collectQuotes rejects invalid maxPages option', async () => {
  const fetchPage: CollectQuotesFetchPage = async () => makeResponse({} as QuoteSearchPayload);

  await assert.rejects(
    () =>
      collectQuotes({
        tweetId: '999',
        operationId: 'op',
        fetchPage,
        maxPages: 0,
      }),
    /maxPages must be a positive integer/
  );
});

test('collectQuotes rejects when required options are missing', async () => {
  await assert.rejects(
    () =>
      collectQuotes({
        tweetId: '',
        operationId: 'op',
      }),
    /tweetId is required/
  );

  await assert.rejects(
    () =>
      collectQuotes({
        tweetId: '999',
        operationId: '',
      }),
    /operationId is required/i
  );
});
