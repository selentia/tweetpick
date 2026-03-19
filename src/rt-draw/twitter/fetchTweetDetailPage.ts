import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  requestGraphqlPage,
} from '@rt/twitter/fetchGraphqlPage';
import { TWITTER_GRAPHQL_BASE_URL } from '@rt/twitter/graphqlBase';
import type {
  GraphqlPageResponse,
  RequestGraphqlPageOptions,
  TweetDetailUrlOptions,
} from '@shared/rtDraw';

const TWEET_DETAIL_BASE_URL = TWITTER_GRAPHQL_BASE_URL;

interface FetchTweetDetailPageOptions
  extends TweetDetailUrlOptions,
    Omit<RequestGraphqlPageOptions, 'url' | 'method' | 'body'> {}

function buildTweetDetailUrl({
  operationId,
  focalTweetId,
  cursor,
  controllerData,
  referrer,
  rankingMode = 'Relevance',
  features,
  fieldToggles,
}: TweetDetailUrlOptions): string {
  if (!operationId) {
    throw new Error('TweetDetail operationId is required.');
  }
  if (!focalTweetId) {
    throw new Error('focalTweetId is required.');
  }

  const variables: Record<string, unknown> = {
    focalTweetId: String(focalTweetId),
    with_rux_injections: false,
    rankingMode,
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  };

  if (cursor) {
    variables.cursor = cursor;
  }
  if (typeof referrer === 'string' && referrer.length > 0) {
    variables.referrer = referrer;
  }
  if (typeof controllerData === 'string' && controllerData.length > 0) {
    variables.controller_data = controllerData;
  }

  const query = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features || {}),
    fieldToggles: JSON.stringify(fieldToggles || {}),
  });

  return `${TWEET_DETAIL_BASE_URL}/${operationId}/TweetDetail?${query.toString()}`;
}

async function fetchTweetDetailPage<TPayload = unknown>(
  options: FetchTweetDetailPageOptions
): Promise<GraphqlPageResponse<TPayload>> {
  const {
    operationId,
    focalTweetId,
    cursor = null,
    controllerData = '',
    referrer = '',
    rankingMode = 'Relevance',
    features,
    fieldToggles,
    headers,
    fetchImpl,
    maxRetries = 3,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    sleep,
    now,
    onRetry,
  } = options;

  const url = buildTweetDetailUrl({
    operationId,
    focalTweetId,
    cursor,
    controllerData,
    referrer,
    rankingMode,
    features,
    fieldToggles,
  });

  return requestGraphqlPage<TPayload>({
    url,
    headers,
    fetchImpl,
    maxRetries,
    requestTimeoutMs,
    sleep,
    now,
    onRetry,
  });
}

export {
  TWEET_DETAIL_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  buildTweetDetailUrl,
  fetchTweetDetailPage,
};

