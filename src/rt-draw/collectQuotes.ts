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

const TERMINATION_REASONS = Object.freeze({
  UNKNOWN: 'unknown',
  MAX_PAGES: 'max_pages',
  END_OF_TIMELINE: 'end_of_timeline',
  INVALID_OR_EMPTY_PAYLOAD: 'invalid_or_empty_payload',
  CURSOR_CYCLE: 'cursor_cycle',
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
  core?: QuoteTweetCore | null;
  legacy?: QuoteTweetLegacy | null;
}

interface SearchTimelineEntryContent {
  entryType?: unknown;
  cursorType?: unknown;
  value?: unknown;
  itemContent?: {
    tweet_results?: {
      result?: QuoteTweetResult | null;
    } | null;
  } | null;
}

interface SearchTimelineEntry {
  content?: SearchTimelineEntryContent | null;
}

interface SearchTimelineInstruction {
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
  warnings: number;
}

interface IngestParticipantsResult {
  addedOnPage: number;
  duplicatesSkipped: number;
  excludedAuthorCount: number;
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
  features?: Record<string, unknown>;
  headers?: HeadersInit;
  pageSize?: number;
  maxPages?: number;
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

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  }

  return {
    entries,
    warnings: 0,
  };
}

function extractTweetResultFromEntry(entry: SearchTimelineEntry | null | undefined): QuoteTweetResult | null {
  return entry?.content?.itemContent?.tweet_results?.result ?? null;
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

async function collectQuotes(options: CollectQuotesOptions): Promise<SourceCollectionResult<QuoteParticipant>> {
  const {
    tweetId,
    authorScreenName,
    operationId,
    features,
    headers,
    pageSize = 20,
    maxPages = DEFAULT_MAX_PAGES,
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
  const participantsByUserId = new Map<string, QuoteParticipant>();
  const seenCursors = new Set<string>();
  const normalizedAuthor = normalizeHandle(authorScreenName);

  let pagesFetched = 0;
  let totalCollectedRaw = 0;
  let duplicatesSkipped = 0;
  let excludedAuthorCount = 0;
  let schemaWarnings = 0;
  let loopDetected = false;
  let terminationReason: string = TERMINATION_REASONS.UNKNOWN;
  let cursor: string | null = null;

  while (true) {
    if (pagesFetched >= safeMaxPages) {
      terminationReason = TERMINATION_REASONS.MAX_PAGES;
      break;
    }

    pagesFetched += 1;
    const { payload } = await fetchPage({
      operationId,
      rawQuery: `quoted_tweet_id:${tweetId}`,
      count: pageSize,
      cursor,
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

    onProgress?.({
      pagesFetched,
      totalCollectedRaw,
      totalUnique: participantsByUserId.size,
      addedOnPage: ingest.addedOnPage,
      nextCursor: parsed.bottomCursor,
    });

    if (!parsed.bottomCursor) {
      terminationReason =
        parsed.warnings > 0 ? TERMINATION_REASONS.INVALID_OR_EMPTY_PAYLOAD : TERMINATION_REASONS.END_OF_TIMELINE;
      break;
    }

    if (parsed.bottomCursor === cursor || seenCursors.has(parsed.bottomCursor)) {
      loopDetected = true;
      terminationReason = TERMINATION_REASONS.CURSOR_CYCLE;
      break;
    }

    seenCursors.add(parsed.bottomCursor);
    cursor = parsed.bottomCursor;
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
      terminationReason,
    },
  };
}

export { DEFAULT_MAX_PAGES, TERMINATION_REASONS, extractTimelineEntries, parseQuoteSearchPage, collectQuotes };
