import type {
  ErrorLike,
  GraphqlErrorLike,
  GraphqlPageResponse,
  GraphqlRetryReason,
  HeadersLike,
  RequestGraphqlPageOptions,
  TwitterRequestErrorDetails,
} from '@shared/rtDraw';

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

class TwitterRequestError extends Error {
  status?: number;

  url?: string;

  bodySnippet?: string;

  cause?: unknown;

  constructor(message: string, details: TwitterRequestErrorDetails = {}) {
    super(message);
    this.name = 'TwitterRequestError';
    Object.assign(this, details);
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function rateLimitWaitMs(headers: HeadersLike | undefined, nowFn: () => number): number {
  const retryAfterRaw = headers && headers.get ? headers.get('retry-after') : null;
  const retryAfterSec = Number.parseInt(retryAfterRaw || '', 10);
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return retryAfterSec * 1000;
  }

  const resetRaw = headers && headers.get ? headers.get('x-rate-limit-reset') : null;
  const resetSec = Number.parseInt(resetRaw || '', 10);
  if (Number.isFinite(resetSec)) {
    return Math.max(resetSec * 1000 - nowFn(), 1000);
  }
  return 2000;
}

function backoffMs(attempt: number): number {
  const raw = 500 * 2 ** (attempt - 1);
  return Math.min(raw, 8000);
}

function normalizeTimeoutMs(timeoutMs: number | string): number {
  const parsed = Number.parseInt(String(timeoutMs), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('requestTimeoutMs must be a positive integer.');
  }
  return parsed;
}

function isAbortError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const typedError = error as ErrorLike;
  const name = String(typedError.name || '').toLowerCase();
  const message = String(typedError.message || '').toLowerCase();
  return name === 'aborterror' || message.includes('aborted') || message.includes('timeout');
}

function summarizeGraphqlErrors(errors: unknown): string {
  if (!Array.isArray(errors)) {
    return '';
  }

  return errors
    .map((item) => {
      const error = item as GraphqlErrorLike | null | undefined;
      return error && typeof error.message === 'string' ? error.message.trim() : '';
    })
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
}

function isRetryableGraphqlError(errors: unknown): boolean {
  if (!Array.isArray(errors)) {
    return false;
  }

  return errors.some((item) => {
    const error = item as GraphqlErrorLike | null | undefined;
    const message = String(error && error.message ? error.message : '').toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('temporar') ||
      message.includes('timeout') ||
      message.includes('over capacity')
    );
  });
}

function makeSnippet(text: string): string {
  if (!text) {
    return '';
  }
  return text.slice(0, 280);
}

async function requestGraphqlPage<TPayload = unknown>(
  options: RequestGraphqlPageOptions
): Promise<GraphqlPageResponse<TPayload>> {
  const {
    url,
    headers,
    method = 'GET',
    body,
    fetchImpl = globalThis.fetch,
    maxRetries = 3,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    sleep = sleepMs,
    now = () => Date.now(),
    onRetry,
  } = options;

  if (!url || typeof url !== 'string') {
    throw new Error('url is required.');
  }
  const upperMethod = String(method || 'GET').toUpperCase();
  if (upperMethod !== 'GET' && upperMethod !== 'POST') {
    throw new Error('method must be GET or POST.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation is not available.');
  }
  const safeRequestTimeoutMs = normalizeTimeoutMs(requestTimeoutMs);

  const attempts = maxRetries + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    let bodyText = '';
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    try {
      if (typeof AbortController === 'function') {
        controller = new AbortController();
        timeoutHandle = setTimeout(() => {
          controller?.abort();
        }, safeRequestTimeoutMs);
      }

      response = await fetchImpl(url, {
        method: upperMethod,
        headers,
        ...(upperMethod === 'POST' && body != null ? { body } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      bodyText = await response.text();
    } catch (error) {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      const reason: GraphqlRetryReason = isAbortError(error) ? 'timeout' : 'network';
      if (attempt >= attempts) {
        throw new TwitterRequestError(
          reason === 'timeout'
            ? 'Request timed out while fetching GraphQL page.'
            : 'Network error while fetching GraphQL page.',
          {
            url,
            cause: error,
          }
        );
      }

      const waitMs = backoffMs(attempt);
      if (typeof onRetry === 'function') {
        onRetry({ reason, attempt, waitMs });
      }
      await sleep(waitMs);
      continue;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new TwitterRequestError('Authentication failed (401/403). Check auth_token, ct0, and bearer token.', {
        status: response.status,
        url,
        bodySnippet: makeSnippet(bodyText),
      });
    }

    if (response.status === 429) {
      if (attempt >= attempts) {
        throw new TwitterRequestError('Rate limited (429) and retries exhausted.', {
          status: response.status,
          url,
          bodySnippet: makeSnippet(bodyText),
        });
      }

      const waitMs = rateLimitWaitMs(response.headers, now);
      if (typeof onRetry === 'function') {
        onRetry({ reason: 'rate-limit', attempt, waitMs });
      }
      await sleep(waitMs);
      continue;
    }

    if (response.status === 408) {
      if (attempt >= attempts) {
        throw new TwitterRequestError('Request timeout from X and retries exhausted.', {
          status: response.status,
          url,
          bodySnippet: makeSnippet(bodyText),
        });
      }

      const waitMs = backoffMs(attempt);
      if (typeof onRetry === 'function') {
        onRetry({ reason: 'request-timeout', attempt, waitMs });
      }
      await sleep(waitMs);
      continue;
    }

    if (response.status >= 500) {
      if (attempt >= attempts) {
        throw new TwitterRequestError('Server error from X and retries exhausted.', {
          status: response.status,
          url,
          bodySnippet: makeSnippet(bodyText),
        });
      }

      const waitMs = backoffMs(attempt);
      if (typeof onRetry === 'function') {
        onRetry({ reason: 'server', attempt, waitMs });
      }
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new TwitterRequestError(`Request failed with status ${response.status}.`, {
        status: response.status,
        url,
        bodySnippet: makeSnippet(bodyText),
      });
    }

    let payload;
    try {
      payload = JSON.parse(bodyText) as TPayload;
    } catch {
      if (attempt < attempts) {
        const waitMs = backoffMs(attempt);
        if (typeof onRetry === 'function') {
          onRetry({ reason: 'invalid-json', attempt, waitMs });
        }
        await sleep(waitMs);
        continue;
      }

      throw new TwitterRequestError('Response is not valid JSON.', {
        status: response.status,
        url,
        bodySnippet: makeSnippet(bodyText),
      });
    }

    const maybePayload = payload as { errors?: unknown };
    if (Array.isArray(maybePayload.errors) && maybePayload.errors.length > 0) {
      const messageSummary = summarizeGraphqlErrors(maybePayload.errors);
      const retryable = isRetryableGraphqlError(maybePayload.errors);

      if (retryable && attempt < attempts) {
        const waitMs = backoffMs(attempt);
        if (typeof onRetry === 'function') {
          onRetry({ reason: 'graphql-error', attempt, waitMs });
        }
        await sleep(waitMs);
        continue;
      }

      throw new TwitterRequestError(`GraphQL returned errors.${messageSummary ? ` ${messageSummary}` : ''}`, {
        status: response.status,
        url,
        bodySnippet: makeSnippet(bodyText),
      });
    }

    return {
      payload,
      status: response.status,
      url,
    };
  }

  throw new TwitterRequestError('Unexpected retry state.');
}

export { DEFAULT_REQUEST_TIMEOUT_MS, TwitterRequestError, requestGraphqlPage };
