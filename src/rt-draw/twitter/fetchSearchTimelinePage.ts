import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  requestGraphqlPage,
} from '@rt/twitter/fetchGraphqlPage';
import { TWITTER_GRAPHQL_BASE_URL } from '@rt/twitter/graphqlBase';
import type {
  GraphqlPageResponse,
  RequestGraphqlPageOptions,
  SearchTimelineBodyOptions,
  SearchTimelineUrlOptions,
} from '@shared/rtDraw';

const SEARCH_BASE_URL = TWITTER_GRAPHQL_BASE_URL;

interface FetchSearchTimelinePageOptions
  extends SearchTimelineUrlOptions,
    SearchTimelineBodyOptions,
    Omit<RequestGraphqlPageOptions, 'url' | 'method' | 'body'> {}

function buildSearchTimelineUrl({ operationId }: SearchTimelineUrlOptions): string {
  if (!operationId) {
    throw new Error('SearchTimeline operationId is required.');
  }
  return `${SEARCH_BASE_URL}/${operationId}/SearchTimeline`;
}

function buildSearchTimelineBody({
  rawQuery,
  count,
  cursor,
  querySource = 'tdqt',
  product = 'Top',
  features,
}: SearchTimelineBodyOptions): string {
  if (!rawQuery || typeof rawQuery !== 'string') {
    throw new Error('rawQuery is required.');
  }
  const variables: Record<string, unknown> = {
    rawQuery: String(rawQuery),
    count: Number(count) || 20,
    querySource,
    product,
    withGrokTranslatedBio: false,
  };

  if (cursor) {
    variables.cursor = cursor;
  }

  return JSON.stringify({
    variables,
    features: features || {},
  });
}

async function fetchSearchTimelinePage<TPayload = unknown>(
  options: FetchSearchTimelinePageOptions
): Promise<GraphqlPageResponse<TPayload>> {
  const {
    operationId,
    rawQuery,
    count = 20,
    cursor = null,
    querySource = 'tdqt',
    product = 'Top',
    features,
    headers,
    fetchImpl,
    maxRetries = 3,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    sleep,
    now,
    onRetry,
  } = options;

  const url = buildSearchTimelineUrl({
    operationId,
  });
  const body = buildSearchTimelineBody({
    rawQuery,
    count,
    cursor,
    querySource,
    product,
    features,
  });

  return requestGraphqlPage<TPayload>({
    url,
    method: 'POST',
    body,
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
  SEARCH_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  TwitterRequestError,
  buildSearchTimelineUrl,
  buildSearchTimelineBody,
  fetchSearchTimelinePage,
};

