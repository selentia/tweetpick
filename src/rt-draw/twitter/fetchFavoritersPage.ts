import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  requestGraphqlPage,
} from '@rt/twitter/fetchGraphqlPage';
import { TWITTER_GRAPHQL_BASE_URL } from '@rt/twitter/graphqlBase';
import type { FavoritersUrlOptions, GraphqlPageResponse, RequestGraphqlPageOptions } from '@shared/rtDraw';

const FAVORITERS_BASE_URL = TWITTER_GRAPHQL_BASE_URL;
const GRAPHQL_ERROR_MESSAGE_MAP = Object.freeze({
  'Request timed out while fetching GraphQL page.': 'Request timed out while fetching favoriters.',
  'Network error while fetching GraphQL page.': 'Network error while fetching favoriters.',
});

function normalizeTimeoutMs(timeoutMs: number | string): number {
  const parsed = Number.parseInt(String(timeoutMs), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('requestTimeoutMs must be a positive integer.');
  }
  return parsed;
}

function buildFavoritersUrl({
  operationId,
  tweetId,
  count,
  features,
  enableRanking = false,
  includePromotedContent = false,
  cursor,
}: FavoritersUrlOptions): string {
  if (!operationId) {
    throw new Error('Favoriters operationId is required.');
  }
  if (!tweetId) {
    throw new Error('tweetId is required.');
  }

  const variables: Record<string, unknown> = {
    tweetId: String(tweetId),
    count,
    enableRanking,
    includePromotedContent,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  const query = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features || {}),
  });

  return `${FAVORITERS_BASE_URL}/${operationId}/Favoriters?${query.toString()}`;
}

interface FetchFavoritersPageOptions
  extends FavoritersUrlOptions,
    Omit<RequestGraphqlPageOptions, 'url' | 'method' | 'body'> {}

async function fetchFavoritersPage<TPayload = unknown>(
  options: FetchFavoritersPageOptions
): Promise<GraphqlPageResponse<TPayload>> {
  const {
    tweetId,
    count,
    cursor,
    operationId,
    features,
    enableRanking = false,
    includePromotedContent = false,
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

  const url = buildFavoritersUrl({
    operationId,
    tweetId,
    count,
    features,
    enableRanking,
    includePromotedContent,
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
  FAVORITERS_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  buildFavoritersUrl,
  fetchFavoritersPage,
};
