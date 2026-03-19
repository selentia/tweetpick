import { fetchTweetDetailPage } from '@rt/twitter/fetchTweetDetailPage';
import type {
  GraphqlPageResponse,
  RetryHandlerInfo,
  RtParticipant,
  SourceCollectionProgress,
  SourceCollectionResult,
  TweetDetailUrlOptions,
} from '@shared/rtDraw';

const DEFAULT_MAX_PAGES = 160;
const DEFAULT_MAX_NO_GROWTH_PAGES = 8;

interface CursorTask {
  cursor: string | null;
  referrer: string;
  controllerData: string;
}

const DEFAULT_START_REFS: Readonly<CursorTask> = Object.freeze({
  cursor: null,
  referrer: 'tweet',
  controllerData: '',
});

const TERMINATION_REASONS = Object.freeze({
  UNKNOWN: 'unknown',
  MAX_PAGES: 'max_pages',
  END_OF_TIMELINE: 'end_of_timeline',
  INVALID_OR_EMPTY_PAYLOAD: 'invalid_or_empty_payload',
  CURSOR_CYCLE: 'cursor_cycle',
  NO_GROWTH: 'no_growth',
});

interface ReplyUserCore {
  screen_name?: unknown;
  name?: unknown;
}

interface ReplyUserLegacy {
  friends_count?: unknown;
  followers_count?: unknown;
  default_profile?: unknown;
  default_profile_image?: unknown;
}

interface ReplyRelationshipPerspectives {
  followed_by?: unknown;
  following?: unknown;
}

interface ReplyUserResult {
  rest_id?: unknown;
  core?: ReplyUserCore | null;
  legacy?: ReplyUserLegacy | null;
  relationship_perspectives?: ReplyRelationshipPerspectives | null;
}

interface ReplyTweetLegacy {
  in_reply_to_status_id_str?: unknown;
  full_text?: unknown;
}

interface ReplyTweetResult {
  __typename?: unknown;
  core?: {
    user_results?: {
      result?: ReplyUserResult | null;
    } | null;
  } | null;
  legacy?: ReplyTweetLegacy | null;
}

interface ReplyTweetWithVisibilityResults {
  __typename?: unknown;
  tweet?: ReplyTweetResult | null;
}

type ReplyTweetGraphqlResult = ReplyTweetResult | ReplyTweetWithVisibilityResults;

interface ClientEventInfoCarrier {
  clientEventInfo?: {
    details?: {
      timelinesDetails?: {
        controllerData?: unknown;
      } | null;
    } | null;
  } | null;
}

interface ReplyTimelineCursorContent {
  value?: unknown;
  cursorType?: unknown;
}

interface ReplyTimelineItemContent extends ClientEventInfoCarrier {
  itemType?: unknown;
  tweet_results?: {
    result?: ReplyTweetGraphqlResult | null;
  } | null;
  value?: unknown;
  cursorType?: unknown;
}

interface ReplyModuleItem extends ClientEventInfoCarrier {
  item?: ClientEventInfoCarrier & {
    itemContent?: ReplyTimelineItemContent | null;
  } | null;
}

interface ReplyEntryContent extends ClientEventInfoCarrier {
  entryType?: unknown;
  cursorType?: unknown;
  value?: unknown;
  itemContent?: ReplyTimelineItemContent | null;
  items?: ReplyModuleItem[] | null;
}

interface ReplyDetailEntry {
  content?: ReplyEntryContent | null;
}

interface ReplyDetailInstruction {
  entries?: ReplyDetailEntry[] | null;
}

interface ReplyDetailPayload {
  data?: {
    threaded_conversation_with_injections_v2?: {
      instructions?: ReplyDetailInstruction[] | null;
    } | null;
  } | null;
}

interface ReplyParticipant extends RtParticipant {
  sourceTexts: string[];
  rawUser: ReplyUserResult;
  rawTweet: ReplyTweetResult;
}

interface CursorEntry {
  value: string;
  cursorType: string;
  referrer: string;
  controllerData: string;
}

interface ParsedReplyDetailPage {
  participants: ReplyParticipant[];
  cursors: CursorEntry[];
  warnings: number;
}

interface IngestParticipantsResult {
  addedOnPage: number;
  duplicatesSkipped: number;
  excludedAuthorCount: number;
}

type FetchTweetDetailPageOptions = Omit<TweetDetailUrlOptions, 'cursor' | 'referrer' | 'controllerData'> & {
  cursor: string | null;
  referrer: string;
  controllerData: string;
  headers?: HeadersInit;
  onRetry?: (retry: RetryHandlerInfo) => void;
};

type TweetDetailFetcher = (
  options: FetchTweetDetailPageOptions
) => Promise<GraphqlPageResponse<ReplyDetailPayload>>;

interface CollectRepliesOptions {
  tweetId: string;
  authorScreenName?: string | null;
  operationId: string;
  features?: Record<string, unknown>;
  fieldToggles?: Record<string, unknown>;
  headers?: HeadersInit;
  maxPages?: number;
  maxNoGrowthPages?: number;
  fetchPage?: TweetDetailFetcher;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapReplyTweetResult(result: ReplyTweetGraphqlResult | null | undefined): ReplyTweetResult | null {
  if (!isRecord(result)) {
    return null;
  }

  if (result.__typename === 'TweetWithVisibilityResults') {
    const wrappedTweet = (result as ReplyTweetWithVisibilityResults).tweet;
    return isRecord(wrappedTweet) ? (wrappedTweet as ReplyTweetResult) : null;
  }

  if ('tweet' in result) {
    const wrappedTweet = (result as ReplyTweetWithVisibilityResults).tweet;
    if (isRecord(wrappedTweet)) {
      return wrappedTweet as ReplyTweetResult;
    }
  }

  return result as ReplyTweetResult;
}

function extractUserFromTweet(tweet: ReplyTweetResult | null | undefined): ReplyUserResult | null {
  return tweet?.core?.user_results?.result ?? null;
}

function toParticipant(tweet: ReplyTweetResult | null | undefined): ReplyParticipant | null {
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

function getControllerDataFromClientEventInfo(raw: ClientEventInfoCarrier | null | undefined): string {
  const controllerData = raw?.clientEventInfo?.details?.timelinesDetails?.controllerData;
  return typeof controllerData === 'string' ? controllerData : '';
}

function toCursorEntry(
  cursorContent: ReplyTimelineCursorContent | null | undefined,
  rawEntry: ClientEventInfoCarrier | null | undefined,
  fallbackControllerData = ''
): CursorEntry | null {
  if (!cursorContent || typeof cursorContent.value !== 'string') {
    return null;
  }

  const cursorType = String(cursorContent.cursorType || '');
  const isRelevant = cursorType === 'Bottom' || cursorType === 'ShowMore' || cursorType === 'ShowMoreThreads';
  if (!isRelevant) {
    return null;
  }

  const controllerData = getControllerDataFromClientEventInfo(rawEntry) || fallbackControllerData || '';
  return {
    value: cursorContent.value,
    cursorType,
    referrer: 'tweet',
    controllerData,
  };
}

function pushTweetIfDirectReply({
  tweet,
  focalTweetId,
  participants,
  warningsRef,
}: {
  tweet: ReplyTweetResult | null | undefined;
  focalTweetId: string;
  participants: ReplyParticipant[];
  warningsRef: { value: number };
}): void {
  if (!tweet || !tweet.legacy) {
    warningsRef.value += 1;
    return;
  }

  const inReplyToStatusId = String(tweet.legacy.in_reply_to_status_id_str || '');
  if (inReplyToStatusId !== String(focalTweetId)) {
    return;
  }

  const participant = toParticipant(tweet);
  if (!participant) {
    warningsRef.value += 1;
    return;
  }
  participants.push(participant);
}

function parseReplyDetailPage(
  payload: ReplyDetailPayload | null | undefined,
  focalTweetId: string
): ParsedReplyDetailPage {
  const instructions = payload?.data?.threaded_conversation_with_injections_v2?.instructions;

  if (!Array.isArray(instructions)) {
    return {
      participants: [],
      cursors: [],
      warnings: 1,
    };
  }

  const participants: ReplyParticipant[] = [];
  const cursors: CursorEntry[] = [];
  const warningsRef = { value: 0 };

  for (const instruction of instructions) {
    if (!instruction || !Array.isArray(instruction.entries)) {
      continue;
    }

    for (const entry of instruction.entries) {
      const content = entry?.content;
      if (!content) {
        continue;
      }

      const entryControllerData = getControllerDataFromClientEventInfo(content);

      if (content.entryType === 'TimelineTimelineCursor') {
        const cursorEntry = toCursorEntry(content, content, entryControllerData);
        if (cursorEntry) {
          cursors.push(cursorEntry);
        }
        continue;
      }

      if (content.entryType === 'TimelineTimelineItem') {
        const tweet = unwrapReplyTweetResult(content.itemContent?.tweet_results?.result ?? null);
        pushTweetIfDirectReply({
          tweet,
          focalTweetId,
          participants,
          warningsRef,
        });
        continue;
      }

      if (content.entryType !== 'TimelineTimelineModule' || !Array.isArray(content.items)) {
        continue;
      }

      for (const moduleItem of content.items) {
        const item = moduleItem?.item;
        if (!item?.itemContent) {
          continue;
        }

        if (item.itemContent.itemType === 'TimelineTweet') {
          const tweet = unwrapReplyTweetResult(item.itemContent.tweet_results?.result ?? null);
          pushTweetIfDirectReply({
            tweet,
            focalTweetId,
            participants,
            warningsRef,
          });
          continue;
        }

        if (item.itemContent.itemType === 'TimelineTimelineCursor') {
          const cursorEntry = toCursorEntry(item.itemContent, item, entryControllerData);
          if (cursorEntry) {
            cursors.push(cursorEntry);
          }
        }
      }
    }
  }

  return {
    participants,
    cursors,
    warnings: warningsRef.value,
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
  parsedParticipants: ReplyParticipant[];
  participantsByUserId: Map<string, ReplyParticipant>;
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

async function collectReplies(options: CollectRepliesOptions): Promise<SourceCollectionResult<ReplyParticipant>> {
  const {
    tweetId,
    authorScreenName,
    operationId,
    features,
    fieldToggles,
    headers,
    maxPages = DEFAULT_MAX_PAGES,
    maxNoGrowthPages = DEFAULT_MAX_NO_GROWTH_PAGES,
    fetchPage = fetchTweetDetailPage as TweetDetailFetcher,
    onProgress,
    onRetry,
  } = options;

  if (!tweetId) {
    throw new Error('tweetId is required for reply collection.');
  }
  if (!operationId) {
    throw new Error('TweetDetail operationId is required for reply collection.');
  }

  const safeMaxPages = readPositiveInt(maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const safeMaxNoGrowthPages = readPositiveInt(maxNoGrowthPages, DEFAULT_MAX_NO_GROWTH_PAGES, 'maxNoGrowthPages');
  const normalizedAuthor = normalizeHandle(authorScreenName);
  const participantsByUserId = new Map<string, ReplyParticipant>();

  const pendingCursorQueue: CursorTask[] = [{ ...DEFAULT_START_REFS }];
  const seenCursorValues = new Set<string>();

  let pagesFetched = 0;
  let totalCollectedRaw = 0;
  let duplicatesSkipped = 0;
  let excludedAuthorCount = 0;
  let schemaWarnings = 0;
  let loopDetected = false;
  let noGrowthStreak = 0;
  let terminationReason: string = TERMINATION_REASONS.UNKNOWN;

  while (pendingCursorQueue.length > 0) {
    if (pagesFetched >= safeMaxPages) {
      terminationReason = TERMINATION_REASONS.MAX_PAGES;
      break;
    }

    const cursorTask = pendingCursorQueue.shift() ?? DEFAULT_START_REFS;
    pagesFetched += 1;

    const { payload } = await fetchPage({
      operationId,
      focalTweetId: tweetId,
      cursor: cursorTask.cursor,
      referrer: cursorTask.referrer,
      controllerData: cursorTask.controllerData,
      features,
      fieldToggles,
      headers,
      onRetry,
    });

    const parsed = parseReplyDetailPage(payload, tweetId);
    schemaWarnings += parsed.warnings;
    totalCollectedRaw += parsed.participants.length;

    const ingest = ingestParticipants({
      parsedParticipants: parsed.participants,
      participantsByUserId,
      normalizedAuthor,
    });
    duplicatesSkipped += ingest.duplicatesSkipped;
    excludedAuthorCount += ingest.excludedAuthorCount;
    noGrowthStreak = ingest.addedOnPage > 0 ? 0 : noGrowthStreak + 1;

    for (const cursorEntry of parsed.cursors) {
      if (seenCursorValues.has(cursorEntry.value)) {
        loopDetected = true;
        continue;
      }

      seenCursorValues.add(cursorEntry.value);
      pendingCursorQueue.push({
        cursor: cursorEntry.value,
        referrer: cursorEntry.referrer || 'tweet',
        controllerData: cursorEntry.controllerData || '',
      });
    }

    onProgress?.({
      pagesFetched,
      totalCollectedRaw,
      totalUnique: participantsByUserId.size,
      addedOnPage: ingest.addedOnPage,
      noGrowthStreak,
      nextCursorCount: pendingCursorQueue.length,
    });

    if (noGrowthStreak >= safeMaxNoGrowthPages) {
      terminationReason = TERMINATION_REASONS.NO_GROWTH;
      break;
    }
  }

  if (terminationReason === TERMINATION_REASONS.UNKNOWN) {
    if (loopDetected) {
      terminationReason = TERMINATION_REASONS.CURSOR_CYCLE;
    } else if (pendingCursorQueue.length === 0) {
      terminationReason =
        pagesFetched === 0 || schemaWarnings > 0
          ? TERMINATION_REASONS.INVALID_OR_EMPTY_PAYLOAD
          : TERMINATION_REASONS.END_OF_TIMELINE;
    }
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

export { DEFAULT_MAX_PAGES, DEFAULT_MAX_NO_GROWTH_PAGES, TERMINATION_REASONS, parseReplyDetailPage, collectReplies };
