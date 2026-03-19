import { fetchSearchTimelinePage } from '@rt/twitter/fetchSearchTimelinePage';
import type {
  GraphqlPageResponse,
  RetryHandlerInfo,
  RtParticipant,
  SearchTimelineBodyOptions,
  SearchTimelineUrlOptions,
  SourceCollectionProgress,
  SourceCollectionResult,
} from '@shared/rtDraw';

const DEFAULT_MAX_PAGES = 120;
const DEFAULT_MAX_NO_GROWTH_PAGES = 8;
const DEFAULT_MAX_REPEAT_PAGE_SIGNATURES = 3;
const DEFAULT_QUOTE_URL_QUERY_PAGE_SIZE = 100;

const TERMINATION_REASONS = Object.freeze({
  UNKNOWN: 'unknown',
  MAX_PAGES: 'max_pages',
  END_OF_TIMELINE: 'end_of_timeline',
  INVALID_OR_EMPTY_PAYLOAD: 'invalid_or_empty_payload',
  CURSOR_CYCLE: 'cursor_cycle',
  REPEATED_PAGE: 'repeated_page',
  NO_GROWTH: 'no_growth',
});

interface QuoteUserCore {
  screen_name?: unknown;
  name?: unknown;
}

interface QuoteUserLegacy {
  friends_count?: unknown;
  followers_count?: unknown;
  default_profile?: unknown;
  default_profile_image?: unknown;
}

interface QuoteRelationshipPerspectives {
  followed_by?: unknown;
  following?: unknown;
}

interface QuoteUserResult {
  rest_id?: unknown;
  core?: QuoteUserCore | null;
  legacy?: QuoteUserLegacy | null;
  relationship_perspectives?: QuoteRelationshipPerspectives | null;
}

interface QuoteTweetLegacy {
  full_text?: unknown;
  quoted_status_id_str?: unknown;
}

interface QuoteTweetCore {
  user_results?: {
    result?: QuoteUserResult | null;
  } | null;
}

interface QuoteTweetResult {
  __typename?: unknown;
  core?: QuoteTweetCore | null;
  legacy?: QuoteTweetLegacy | null;
}

interface QuoteTweetWithVisibilityResults {
  __typename?: unknown;
  tweet?: QuoteTweetResult | null;
}

type QuoteTweetGraphqlResult = QuoteTweetResult | QuoteTweetWithVisibilityResults;
type TerminationReason = (typeof TERMINATION_REASONS)[keyof typeof TERMINATION_REASONS];

interface SearchTimelineEntryContent {
  entryType?: unknown;
  cursorType?: unknown;
  value?: unknown;
  itemContent?: {
    tweet_results?: {
      result?: QuoteTweetGraphqlResult | null;
    } | null;
  } | null;
}

interface SearchTimelineEntry {
  content?: SearchTimelineEntryContent | null;
}

interface SearchTimelineInstruction {
  entry?: SearchTimelineEntry | null;
  entries?: SearchTimelineEntry[] | null;
}

interface QuoteSearchPayload {
  data?: {
    search_by_raw_query?: {
      search_timeline?: {
        timeline?: {
          instructions?: SearchTimelineInstruction[] | null;
        } | null;
      } | null;
    } | null;
  } | null;
}

interface QuoteParticipant extends RtParticipant {
  sourceTexts: string[];
  rawUser: QuoteUserResult;
  rawTweet: QuoteTweetResult;
}

interface ParsedQuoteSearchPage {
  participants: QuoteParticipant[];
  bottomCursor: string | null;
  pageSignature: string;
  warnings: number;
}

interface IngestParticipantsResult {
  addedOnPage: number;
  duplicatesSkipped: number;
  excludedAuthorCount: number;
}

interface QuoteSearchStrategy {
  rawQuery: string;
  querySource: string;
  product: string;
  count: number;
}

type FetchSearchTimelinePageOptions = SearchTimelineUrlOptions &
  Omit<SearchTimelineBodyOptions, 'count' | 'cursor'> & {
    count: number;
    cursor: string | null;
    headers?: HeadersInit;
    onRetry?: (retry: RetryHandlerInfo) => void;
  };

type SearchTimelineFetcher = (
  options: FetchSearchTimelinePageOptions
) => Promise<GraphqlPageResponse<QuoteSearchPayload>>;

interface CollectQuotesOptions {
  tweetId: string;
  authorScreenName?: string | null;
  operationId: string;
  querySource?: string;
  product?: string;
  features?: Record<string, unknown>;
  headers?: HeadersInit;
  pageSize?: number;
  maxPages?: number;
  maxNoGrowthPages?: number;
  maxRepeatPageSignatures?: number;
  fetchPage?: SearchTimelineFetcher;
  onProgress?: (payload: SourceCollectionProgress) => void;
  onRetry?: (retry: RetryHandlerInfo) => void;
}

function normalizeHandle(handle: unknown): string {
  if (!handle) {
    return '';
  }
  return String(handle).trim().replace(/^@+/, '').toLowerCase();
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractUserFromTweet(tweet: QuoteTweetResult | null | undefined): QuoteUserResult | null {
  return tweet?.core?.user_results?.result ?? null;
}

function toParticipant(tweet: QuoteTweetResult | null | undefined): QuoteParticipant | null {
  const user = extractUserFromTweet(tweet);
  const legacyTweet = tweet?.legacy ?? null;
  const legacyUser = user?.legacy ?? null;
  const relationship = user?.relationship_perspectives ?? null;

  const userId = user?.rest_id ? String(user.rest_id) : '';
  const screenName = user?.core?.screen_name ? String(user.core.screen_name) : '';

  if (!tweet || !userId || !screenName || !user) {
    return null;
  }

  return {
    userId,
    screenName,
    name: user.core?.name ? String(user.core.name) : '',
    followedByAuth: relationship?.followed_by === true,
    followingAuth: relationship?.following === true,
    followingCount: toNumberOrNull(legacyUser?.friends_count),
    followersCount: toNumberOrNull(legacyUser?.followers_count),
    defaultProfile: typeof legacyUser?.default_profile === 'boolean' ? legacyUser.default_profile : null,
    defaultProfileImage:
      typeof legacyUser?.default_profile_image === 'boolean' ? legacyUser.default_profile_image : null,
    sourceTexts:
      typeof legacyTweet?.full_text === 'string' && legacyTweet.full_text.trim().length > 0
        ? [legacyTweet.full_text]
        : [],
    rawUser: user,
    rawTweet: tweet,
  };
}

function extractTimelineEntries(payload: QuoteSearchPayload | null | undefined): {
  entries: SearchTimelineEntry[];
  warnings: number;
} {
  const instructions = payload?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;

  if (!Array.isArray(instructions)) {
    return {
      entries: [],
      warnings: 1,
    };
  }

  const entries: SearchTimelineEntry[] = [];
  for (const instruction of instructions) {
    if (Array.isArray(instruction.entries)) {
      entries.push(...instruction.entries);
    }
    if (instruction.entry && isRecord(instruction.entry)) {
      entries.push(instruction.entry);
    }
  }

  return {
    entries,
    warnings: 0,
  };
}

function unwrapTweetResult(result: QuoteTweetGraphqlResult | null | undefined): QuoteTweetResult | null {
  if (!isRecord(result)) {
    return null;
  }

  if (result.__typename === 'TweetWithVisibilityResults') {
    const wrappedTweet = (result as QuoteTweetWithVisibilityResults).tweet;
    return isRecord(wrappedTweet) ? (wrappedTweet as QuoteTweetResult) : null;
  }

  if ('tweet' in result) {
    const wrappedTweet = (result as QuoteTweetWithVisibilityResults).tweet;
    if (isRecord(wrappedTweet)) {
      return wrappedTweet as QuoteTweetResult;
    }
  }

  return result as QuoteTweetResult;
}

function extractTweetResultFromEntry(entry: SearchTimelineEntry | null | undefined): QuoteTweetResult | null {
  return unwrapTweetResult(entry?.content?.itemContent?.tweet_results?.result ?? null);
}

function parseQuoteSearchPage(payload: QuoteSearchPayload | null | undefined, tweetId: string): ParsedQuoteSearchPage {
  const normalizedTweetId = String(tweetId || '');
  const { entries, warnings: entryWarnings } = extractTimelineEntries(payload);

  let warnings = entryWarnings;
  let bottomCursor: string | null = null;
  const participants: QuoteParticipant[] = [];

  for (const entry of entries) {
    const content = entry.content;
    if (!content) {
      continue;
    }

    if (content.entryType === 'TimelineTimelineCursor') {
      if (content.cursorType === 'Bottom' && typeof content.value === 'string') {
        bottomCursor = content.value;
      }
      continue;
    }

    if (content.entryType !== 'TimelineTimelineItem') {
      continue;
    }

    const tweet = extractTweetResultFromEntry(entry);
    const legacy = tweet?.legacy ?? null;
    if (!tweet || !legacy) {
      warnings += 1;
      continue;
    }

    if (String(legacy.quoted_status_id_str || '') !== normalizedTweetId) {
      continue;
    }

    const participant = toParticipant(tweet);
    if (!participant) {
      warnings += 1;
      continue;
    }
    participants.push(participant);
  }

  return {
    participants,
    bottomCursor,
    pageSignature: participants.map((participant) => participant.userId).join(','),
    warnings,
  };
}

function appendSourceTexts(target: { sourceTexts?: string[] }, sourceTexts: string[] | null | undefined): void {
  if (!Array.isArray(sourceTexts) || sourceTexts.length === 0) {
    return;
  }
  if (!Array.isArray(target.sourceTexts)) {
    target.sourceTexts = [];
  }

  for (const text of sourceTexts) {
    if (typeof text !== 'string') {
      continue;
    }
    if (!target.sourceTexts.includes(text)) {
      target.sourceTexts.push(text);
    }
  }
}

function ingestParticipants({
  parsedParticipants,
  participantsByUserId,
  normalizedAuthor,
}: {
  parsedParticipants: QuoteParticipant[];
  participantsByUserId: Map<string, QuoteParticipant>;
  normalizedAuthor: string;
}): IngestParticipantsResult {
  const uniqueBefore = participantsByUserId.size;
  let duplicatesSkipped = 0;
  let excludedAuthorCount = 0;

  for (const participant of parsedParticipants) {
    if (normalizeHandle(participant.screenName) === normalizedAuthor) {
      excludedAuthorCount += 1;
      continue;
    }

    const existing = participantsByUserId.get(participant.userId);
    if (existing) {
      duplicatesSkipped += 1;
      appendSourceTexts(existing, participant.sourceTexts);
      continue;
    }

    participantsByUserId.set(participant.userId, {
      ...participant,
      sourceTexts: participant.sourceTexts.slice(),
    });
  }

  return {
    addedOnPage: participantsByUserId.size - uniqueBefore,
    duplicatesSkipped,
    excludedAuthorCount,
  };
}

function readPositiveInt(value: unknown, fallback: number, label: string): number {
  const raw = value == null ? fallback : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function getNoCursorTerminationReason(parsed: ParsedQuoteSearchPage): TerminationReason {
  return parsed.participants.length === 0 && parsed.warnings > 0
    ? TERMINATION_REASONS.INVALID_OR_EMPTY_PAYLOAD
    : TERMINATION_REASONS.END_OF_TIMELINE;
}

function isRepeatedSignature(
  pageSignature: string,
  seenPageSignatures: Map<string, number>,
  threshold: number
): boolean {
  if (!pageSignature) {
    return false;
  }

  const signatureCount = (seenPageSignatures.get(pageSignature) || 0) + 1;
  seenPageSignatures.set(pageSignature, signatureCount);
  return signatureCount >= threshold;
}

function createDefaultSearchStrategies({
  tweetId,
  authorScreenName,
  pageSize,
}: {
  tweetId: string;
  authorScreenName?: string | null;
  pageSize: number;
}): QuoteSearchStrategy[] {
  const strategies: QuoteSearchStrategy[] = [
    {
      rawQuery: `quoted_tweet_id:${tweetId}`,
      querySource: 'tdqt',
      product: 'Top',
      count: pageSize,
    },
    {
      rawQuery: `quoted_tweet_id:${tweetId}`,
      querySource: 'typed_query',
      product: 'Latest',
      count: pageSize,
    },
  ];

  const author = normalizeHandle(authorScreenName);
  if (author) {
    const quoteUrlPageSize = Math.max(pageSize, DEFAULT_QUOTE_URL_QUERY_PAGE_SIZE);
    strategies.push(
      {
        rawQuery: `url:"https://x.com/${author}/status/${tweetId}" filter:quote`,
        querySource: 'typed_query',
        product: 'Latest',
        count: quoteUrlPageSize,
      },
      {
        rawQuery: `url:"https://twitter.com/${author}/status/${tweetId}" filter:quote`,
        querySource: 'typed_query',
        product: 'Latest',
        count: quoteUrlPageSize,
      }
    );
  }

  return strategies;
}

function dedupeSearchStrategies(strategies: QuoteSearchStrategy[]): QuoteSearchStrategy[] {
  const deduped: QuoteSearchStrategy[] = [];
  const seen = new Set<string>();

  for (const strategy of strategies) {
    const key = `${strategy.rawQuery}|||${strategy.querySource}|||${strategy.product}|||${strategy.count}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(strategy);
  }

  return deduped;
}

function resolveSearchStrategies({
  tweetId,
  authorScreenName,
  pageSize,
  querySource,
  product,
}: {
  tweetId: string;
  authorScreenName?: string | null;
  pageSize: number;
  querySource: string | null;
  product: string | null;
}): QuoteSearchStrategy[] {
  const defaultStrategies = createDefaultSearchStrategies({
    tweetId,
    authorScreenName,
    pageSize,
  });

  if (!querySource && !product) {
    return dedupeSearchStrategies(defaultStrategies);
  }

  const primaryStrategy = defaultStrategies[0];
  if (!primaryStrategy) {
    return [];
  }

  const patchedStrategies: QuoteSearchStrategy[] = [
    {
      ...primaryStrategy,
      querySource: querySource || primaryStrategy.querySource,
      product: product || primaryStrategy.product,
    },
    ...defaultStrategies.slice(1),
  ];

  return dedupeSearchStrategies(patchedStrategies);
}

function shouldFallbackToNextStrategy(reason: TerminationReason): boolean {
  return reason !== TERMINATION_REASONS.MAX_PAGES && reason !== TERMINATION_REASONS.UNKNOWN;
}

async function collectQuotes(options: CollectQuotesOptions): Promise<SourceCollectionResult<QuoteParticipant>> {
  const {
    tweetId,
    authorScreenName,
    operationId,
    querySource,
    product,
    features,
    headers,
    pageSize = 20,
    maxPages = DEFAULT_MAX_PAGES,
    maxNoGrowthPages = DEFAULT_MAX_NO_GROWTH_PAGES,
    maxRepeatPageSignatures = DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
    fetchPage = fetchSearchTimelinePage as SearchTimelineFetcher,
    onProgress,
    onRetry,
  } = options;

  if (!tweetId) {
    throw new Error('tweetId is required for quote collection.');
  }
  if (!operationId) {
    throw new Error('SearchTimeline operationId is required for quote collection.');
  }

  const safeMaxPages = readPositiveInt(maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const safePageSize = readPositiveInt(pageSize, 20, 'pageSize');
  const safeMaxNoGrowthPages = readPositiveInt(maxNoGrowthPages, DEFAULT_MAX_NO_GROWTH_PAGES, 'maxNoGrowthPages');
  const safeMaxRepeatPageSignatures = readPositiveInt(
    maxRepeatPageSignatures,
    DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
    'maxRepeatPageSignatures'
  );
  const querySourceOverride = normalizeNonEmptyString(querySource);
  const productOverride = normalizeNonEmptyString(product);
  const searchStrategies = resolveSearchStrategies({
    tweetId,
    authorScreenName,
    pageSize: safePageSize,
    querySource: querySourceOverride,
    product: productOverride,
  });

  const participantsByUserId = new Map<string, QuoteParticipant>();
  const normalizedAuthor = normalizeHandle(authorScreenName);

  let pagesFetched = 0;
  let totalCollectedRaw = 0;
  let duplicatesSkipped = 0;
  let excludedAuthorCount = 0;
  let schemaWarnings = 0;
  let loopDetected = false;
  let noGrowthStreak = 0;
  let terminationReason: TerminationReason = TERMINATION_REASONS.UNKNOWN;

  let strategyIndex = 0;
  while (strategyIndex < searchStrategies.length) {
    const strategy = searchStrategies[strategyIndex];
    if (!strategy) {
      break;
    }
    const seenCursors = new Set<string>();
    const seenPageSignatures = new Map<string, number>();

    let cursor: string | null = null;
    let stageNoGrowthStreak = 0;
    let stageTerminationReason: TerminationReason = TERMINATION_REASONS.UNKNOWN;

    while (true) {
      if (pagesFetched >= safeMaxPages) {
        terminationReason = TERMINATION_REASONS.MAX_PAGES;
        break;
      }

      pagesFetched += 1;
      const { payload } = await fetchPage({
        operationId,
        rawQuery: strategy.rawQuery,
        count: strategy.count,
        cursor,
        querySource: strategy.querySource,
        product: strategy.product,
        features,
        headers,
        onRetry,
      });

      const parsed = parseQuoteSearchPage(payload, tweetId);
      schemaWarnings += parsed.warnings;
      totalCollectedRaw += parsed.participants.length;

      const ingest = ingestParticipants({
        parsedParticipants: parsed.participants,
        participantsByUserId,
        normalizedAuthor,
      });
      duplicatesSkipped += ingest.duplicatesSkipped;
      excludedAuthorCount += ingest.excludedAuthorCount;
      stageNoGrowthStreak = ingest.addedOnPage > 0 ? 0 : stageNoGrowthStreak + 1;

      const repeatedSignatureDetected = isRepeatedSignature(
        parsed.pageSignature,
        seenPageSignatures,
        safeMaxRepeatPageSignatures
      );

      onProgress?.({
        pagesFetched,
        totalCollectedRaw,
        totalUnique: participantsByUserId.size,
        addedOnPage: ingest.addedOnPage,
        noGrowthStreak: stageNoGrowthStreak,
        nextCursor: parsed.bottomCursor,
      });

      if (!parsed.bottomCursor) {
        stageTerminationReason = getNoCursorTerminationReason(parsed);
        break;
      }

      if (parsed.bottomCursor === cursor || seenCursors.has(parsed.bottomCursor)) {
        loopDetected = true;
        stageTerminationReason = TERMINATION_REASONS.CURSOR_CYCLE;
        break;
      }

      if (repeatedSignatureDetected) {
        loopDetected = true;
        stageTerminationReason = TERMINATION_REASONS.REPEATED_PAGE;
        break;
      }

      if (stageNoGrowthStreak >= safeMaxNoGrowthPages) {
        stageTerminationReason = TERMINATION_REASONS.NO_GROWTH;
        break;
      }

      seenCursors.add(parsed.bottomCursor);
      cursor = parsed.bottomCursor;
    }

    noGrowthStreak = stageNoGrowthStreak;

    if (terminationReason === TERMINATION_REASONS.MAX_PAGES) {
      break;
    }

    const hasNextStrategy = strategyIndex + 1 < searchStrategies.length;
    if (hasNextStrategy && shouldFallbackToNextStrategy(stageTerminationReason)) {
      strategyIndex += 1;
      continue;
    }

    terminationReason = stageTerminationReason;
    break;
  }

  if (terminationReason === TERMINATION_REASONS.UNKNOWN) {
    terminationReason =
      pagesFetched === 0 ? TERMINATION_REASONS.INVALID_OR_EMPTY_PAYLOAD : TERMINATION_REASONS.END_OF_TIMELINE;
  }

  return {
    participants: Array.from(participantsByUserId.values()),
    metrics: {
      pagesFetched,
      totalCollectedRaw,
      totalUnique: participantsByUserId.size,
      duplicatesSkipped,
      excludedAuthorCount,
      schemaWarnings,
      loopDetected,
      noGrowthStreak,
      terminationReason,
    },
  };
}

export {
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_NO_GROWTH_PAGES,
  DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
  DEFAULT_QUOTE_URL_QUERY_PAGE_SIZE,
  TERMINATION_REASONS,
  extractTimelineEntries,
  parseQuoteSearchPage,
  collectQuotes,
};
