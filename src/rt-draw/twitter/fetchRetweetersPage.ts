import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  requestGraphqlPage,
} from '@rt/twitter/fetchGraphqlPage';
import { TWITTER_GRAPHQL_BASE_URL } from '@rt/twitter/graphqlBase';
import type { GraphqlPageResponse, RequestGraphqlPageOptions, RetweetersUrlOptions } from '@shared/rtDraw';

const RETWEETERS_BASE_URL = TWITTER_GRAPHQL_BASE_URL;
const GRAPHQL_ERROR_MESSAGE_MAP = Object.freeze({
  'Request timed out while fetching GraphQL page.': 'Request timed out while fetching retweeters.',
  'Network error while fetching GraphQL page.': 'Network error while fetching retweeters.',
});

function normalizeTimeoutMs(timeoutMs: number | string): number {
  const parsed = Number.parseInt(String(timeoutMs), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('requestTimeoutMs must be a positive integer.');
  }
  return parsed;
}

function buildRetweetersUrl({ operationId, tweetId, count, features, cursor }: RetweetersUrlOptions): string {
  if (!operationId) {
    throw new Error('Retweeters operationId is required.');
  }
  if (!tweetId) {
    throw new Error('tweetId is required.');
  }

  const variables: Record<string, unknown> = {
    tweetId: String(tweetId),
    count,
    enableRanking: false,
    includePromotedContent: false,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  const query = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features || {}),
  });

  return `${RETWEETERS_BASE_URL}/${operationId}/Retweeters?${query.toString()}`;
}

interface FetchRetweetersPageOptions
  extends RetweetersUrlOptions,
    Omit<RequestGraphqlPageOptions, 'url' | 'method' | 'body'> {}

async function fetchRetweetersPage<TPayload = unknown>(
  options: FetchRetweetersPageOptions
): Promise<GraphqlPageResponse<TPayload>> {
  const {
    tweetId,
    count,
    cursor,
    operationId,
    features,
    headers,
    fetchImpl = globalThis.fetch,
    maxRetries = 3,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    sleep,
    now,
    onRetry,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is not available.');
  }

  const safeRequestTimeoutMs = normalizeTimeoutMs(requestTimeoutMs);

  const url = buildRetweetersUrl({
    operationId,
    tweetId,
    count,
    features,
    cursor,
  });

  try {
    return await requestGraphqlPage<TPayload>({
      url,
      headers,
      fetchImpl,
      maxRetries,
      requestTimeoutMs: safeRequestTimeoutMs,
      sleep,
      now,
      onRetry,
    });
  } catch (error) {
    if (error instanceof TwitterRequestError) {
      const mappedMessage =
        GRAPHQL_ERROR_MESSAGE_MAP[error.message as keyof typeof GRAPHQL_ERROR_MESSAGE_MAP] ?? error.message;
      if (mappedMessage !== error.message) {
        throw new TwitterRequestError(mappedMessage, {
          status: error.status,
          url: error.url,
          bodySnippet: error.bodySnippet,
          cause: error.cause,
        });
      }
    }

    throw error;
  }
}

export {
  RETWEETERS_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  buildRetweetersUrl,
  fetchRetweetersPage,
};
