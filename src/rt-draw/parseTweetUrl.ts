import type { ParsedTweetUrl } from '@shared/rtDraw';

const VALID_HOSTS = new Set(['x.com', 'twitter.com']);

function normalizeAuthor(author: unknown): string {
  if (!author || typeof author !== 'string') {
    return '';
  }
  return author.trim().replace(/^@+/, '');
}

function parseTweetUrl(tweetUrl: unknown, authorOverride: string = ''): ParsedTweetUrl {
  if (!tweetUrl || typeof tweetUrl !== 'string') {
    throw new Error('`--tweet-url` is required.');
  }

  let url: URL;
  try {
    url = new URL(tweetUrl);
  } catch {
    throw new Error('`--tweet-url` must be a valid URL.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!VALID_HOSTS.has(host)) {
    throw new Error('`--tweet-url` must point to x.com or twitter.com.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const statusIndex = segments.findIndex((segment) => segment.toLowerCase() === 'status');

  if (statusIndex < 0 || statusIndex + 1 >= segments.length) {
    throw new Error('Could not find `/status/{tweetId}` in `--tweet-url`.');
  }

  const tweetId = segments[statusIndex + 1];
  if (typeof tweetId !== 'string' || !/^\d+$/.test(tweetId)) {
    throw new Error('Extracted tweetId is invalid. It must be numeric.');
  }

  const extractedAuthor = segments[statusIndex - 1] || '';
  let author = normalizeAuthor(authorOverride) || normalizeAuthor(extractedAuthor);
  if (author.toLowerCase() === 'i' || author.toLowerCase() === 'web') {
    author = '';
  }

  if (!author) {
    throw new Error('Could not infer tweet author from URL. Provide `--tweet-author`.');
  }

  return {
    tweetId,
    author,
  };
}

export { parseTweetUrl };
