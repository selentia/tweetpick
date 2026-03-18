import { fetchRetweetersPage } from '@rt/twitter/fetchRetweetersPage';
import type {
  GraphqlPageResponse,
  RetweetersUrlOptions,
  RetryHandlerInfo,
  RtParticipant,
  SourceCollectionMetrics,
  SourceCollectionProgress,
  SourceCollectionResult,
} from '@shared/rtDraw';

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_NO_GROWTH_PAGES = 5;
const DEFAULT_MAX_REPEAT_PAGE_SIGNATURES = 3;
const DEFAULT_MAX_TRANSIENT_EMPTY_PAGES = 2;

const TERMINATION_REASONS = Object.freeze({
  UNKNOWN: 'unknown',
  MAX_PAGES: 'max_pages',
  END_OF_TIMELINE: 'end_of_timeline',
  INVALID_OR_EMPTY_PAYLOAD: 'invalid_or_empty_payload',
  CURSOR_CYCLE: 'cursor_cycle',
  REPEATED_PAGE: 'repeated_page',
  NO_GROWTH: 'no_growth',
});

interface RetweeterUserCore {
  screen_name?: unknown;
  name?: unknown;
}

interface RetweeterUserLegacy {
  screen_name?: unknown;
  friends_count?: unknown;
  followers_count?: unknown;
  default_profile?: unknown;
  default_profile_image?: unknown;
}

interface RetweeterRelationshipPerspectives {
  followed_by?: unknown;
  following?: unknown;
}

interface RetweeterPrivacy {
  protected?: unknown;
}

interface RetweeterUserResult {
  __typename?: unknown;
  rest_id?: unknown;
  core?: RetweeterUserCore | null;
  legacy?: RetweeterUserLegacy | null;
  relationship_perspectives?: RetweeterRelationshipPerspectives | null;
  privacy?: RetweeterPrivacy | null;
}

interface RetweetersTimelineItemContent {
  user_results?: {
    result?: RetweeterUserResult | null;
  } | null;
}

interface RetweetersEntryContent {
  entryType?: unknown;
  cursorType?: unknown;
  value?: unknown;
  itemContent?: RetweetersTimelineItemContent | null;
}

interface RetweetersTimelineEntry {
  content?: RetweetersEntryContent | null;
}

interface RetweetersTimelineInstruction {
  entries?: RetweetersTimelineEntry[] | null;
}

interface RetweetersPayload {
  data?: {
    retweeters_timeline?: {
      timeline?: {
        instructions?: RetweetersTimelineInstruction[] | null;
      } | null;
    } | null;
  } | null;
}

interface RetweeterParticipant extends RtParticipant {
  sourceTexts: string[];
  protected: boolean;
  raw: RetweeterUserResult;
}

interface ParsedRetweetersPage {
  participants: RetweeterParticipant[];
  bottomCursor: string | null;
  pageSignature: string;
  warnings: number;
}

interface IngestParticipantsResult {
  addedOnPage: number;
  duplicatesSkipped: number;
  excludedAuthorCount: number;
}

interface CollectionState {
  pagesFetched: number;
  totalCollectedRaw: number;
  duplicatesSkipped: number;
  excludedAuthorCount: number;
  schemaWarnings: number;
  loopDetected: boolean;
  noGrowthStreak: number;
  transientEmptyRetries: number;
  terminationReason: string;
}

type FetchRetweetersPageOptions = Omit<RetweetersUrlOptions, 'cursor'> & {
  cursor: string | null;
  headers?: HeadersInit;
  onRetry?: (retry: RetryHandlerInfo) => void;
};

type RetweetersFetcher = (options: FetchRetweetersPageOptions) => Promise<GraphqlPageResponse<RetweetersPayload>>;

interface CollectRetweetersOptions {
  tweetId: string;
  authorScreenName?: string | null;
  pageSize?: number;
  operationId: string;
  features?: Record<string, unknown>;
  headers?: HeadersInit;
  fetchPage?: RetweetersFetcher;
  onProgress?: (payload: SourceCollectionProgress) => void;
  maxPages?: number;
  maxNoGrowthPages?: number;
  maxRepeatPageSignatures?: number;
  maxTransientEmptyPages?: number;
}

interface IngestParticipantsArgs {
  parsedParticipants: RetweeterParticipant[];
  participantsByUserId: Map<string, RetweeterParticipant>;
  normalizedAuthor: string;
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

function toParticipant(user: RetweeterUserResult | null | undefined): RetweeterParticipant | null {
  if (!user || (user.__typename && user.__typename !== 'User')) {
    return null;
  }

  const legacy = user.legacy ?? null;
  const relationship = user.relationship_perspectives ?? null;
  const privacy = user.privacy ?? null;

  const userId = user.rest_id ? String(user.rest_id) : '';
  const screenName = user.core?.screen_name
    ? String(user.core.screen_name)
    : legacy?.screen_name
      ? String(legacy.screen_name)
      : '';

  if (!userId || !screenName) {
    return null;
  }

  return {
    userId,
    screenName,
    name: user.core?.name ? String(user.core.name) : '',
    followedByAuth: relationship?.followed_by === true,
    followingAuth: relationship?.following === true,
    followingCount: toNumberOrNull(legacy?.friends_count),
    followersCount: toNumberOrNull(legacy?.followers_count),
    defaultProfile: typeof legacy?.default_profile === 'boolean' ? legacy.default_profile : null,
    defaultProfileImage: typeof legacy?.default_profile_image === 'boolean' ? legacy.default_profile_image : null,
    sourceTexts: [],
    protected: privacy?.protected === true,
    raw: user,
  };
}

function extractTimelineEntries(payload: RetweetersPayload | null | undefined): {
  entries: RetweetersTimelineEntry[];
  warnings: number;
} {
  const instructions = payload?.data?.retweeters_timeline?.timeline?.instructions;

  if (!Array.isArray(instructions)) {
    return {
      entries: [],
      warnings: 1,
    };
  }

  const entries: RetweetersTimelineEntry[] = [];
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

function parseRetweetersPage(payload: RetweetersPayload | null | undefined): ParsedRetweetersPage {
  const { entries, warnings: entryWarnings } = extractTimelineEntries(payload);
  let warnings = entryWarnings;
  let bottomCursor: string | null = null;
  const participants: RetweeterParticipant[] = [];

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

    const user = content.itemContent?.user_results?.result ?? null;
    const participant = toParticipant(user);
    if (!participant) {
      warnings += 1;
      continue;
    }

    participants.push(participant);
  }

  const pageSignature = participants.map((participant) => participant.userId).join(',');

  return {
    participants,
    bottomCursor,
    pageSignature,
    warnings,
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

function readNonNegativeInt(value: unknown, fallback: number, label: string): number {
  const raw = value == null ? fallback : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function createCollectionState(): CollectionState {
  return {
    pagesFetched: 0,
    totalCollectedRaw: 0,
    duplicatesSkipped: 0,
    excludedAuthorCount: 0,
    schemaWarnings: 0,
    loopDetected: false,
    noGrowthStreak: 0,
    transientEmptyRetries: 0,
    terminationReason: TERMINATION_REASONS.UNKNOWN,
  };
}

function notifyProgress(
  onProgress: ((payload: SourceCollectionProgress) => void) | undefined,
  payload: SourceCollectionProgress
): void {
  if (typeof onProgress === 'function') {
    onProgress(payload);
  }
}

function isTransientEmptyPage(parsed: ParsedRetweetersPage): boolean {
  return parsed.participants.length === 0 && !parsed.bottomCursor && parsed.warnings > 0;
}

function ingestParticipants({
  parsedParticipants,
  participantsByUserId,
  normalizedAuthor,
}: IngestParticipantsArgs): IngestParticipantsResult {
  const uniqueBefore = participantsByUserId.size;
  let duplicatesSkipped = 0;
  let excludedAuthorCount = 0;

  for (const participant of parsedParticipants) {
    if (normalizeHandle(participant.screenName) === normalizedAuthor) {
      excludedAuthorCount += 1;
      continue;
    }

    if (participantsByUserId.has(participant.userId)) {
      duplicatesSkipped += 1;
      continue;
    }

    participantsByUserId.set(participant.userId, participant);
  }

  return {
    addedOnPage: participantsByUserId.size - uniqueBefore,
    duplicatesSkipped,
    excludedAuthorCount,
  };
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

function getNoCursorTerminationReason(parsed: ParsedRetweetersPage): string {
  return parsed.participants.length === 0 && parsed.warnings > 0
    ? TERMINATION_REASONS.INVALID_OR_EMPTY_PAYLOAD
    : TERMINATION_REASONS.END_OF_TIMELINE;
}

function toMetrics(
  state: CollectionState,
  participantsByUserId: Map<string, RetweeterParticipant>
): SourceCollectionMetrics {
  return {
    pagesFetched: state.pagesFetched,
    totalCollectedRaw: state.totalCollectedRaw,
    totalUnique: participantsByUserId.size,
    duplicatesSkipped: state.duplicatesSkipped,
    excludedAuthorCount: state.excludedAuthorCount,
    schemaWarnings: state.schemaWarnings,
    loopDetected: state.loopDetected,
    noGrowthStreak: state.noGrowthStreak,
    transientEmptyRetries: state.transientEmptyRetries,
    terminationReason: state.terminationReason,
  };
}

async function collectRetweeters(
  options: CollectRetweetersOptions
): Promise<SourceCollectionResult<RetweeterParticipant>> {
  const {
    tweetId,
    authorScreenName,
    pageSize = 20,
    operationId,
    features,
    headers,
    fetchPage = fetchRetweetersPage as RetweetersFetcher,
    onProgress,
    maxPages = DEFAULT_MAX_PAGES,
    maxNoGrowthPages = DEFAULT_MAX_NO_GROWTH_PAGES,
    maxRepeatPageSignatures = DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
    maxTransientEmptyPages = DEFAULT_MAX_TRANSIENT_EMPTY_PAGES,
  } = options;

  if (!tweetId) {
    throw new Error('tweetId is required for retweeter collection.');
  }
  if (!operationId) {
    throw new Error('operationId is required for retweeter collection.');
  }

  const safeMaxPages = readPositiveInt(maxPages, DEFAULT_MAX_PAGES, 'maxPages');
  const safeMaxNoGrowthPages = readPositiveInt(maxNoGrowthPages, DEFAULT_MAX_NO_GROWTH_PAGES, 'maxNoGrowthPages');
  const safeMaxRepeatPageSignatures = readPositiveInt(
    maxRepeatPageSignatures,
    DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
    'maxRepeatPageSignatures'
  );
  const safeMaxTransientEmptyPages = readNonNegativeInt(
    maxTransientEmptyPages,
    DEFAULT_MAX_TRANSIENT_EMPTY_PAGES,
    'maxTransientEmptyPages'
  );

  const normalizedAuthor = normalizeHandle(authorScreenName);
  const participantsByUserId = new Map<string, RetweeterParticipant>();
  const seenBottomCursors = new Set<string>();
  const seenPageSignatures = new Map<string, number>();
  const state = createCollectionState();

  let cursor: string | null = null;

  while (true) {
    if (state.pagesFetched >= safeMaxPages) {
      state.terminationReason = TERMINATION_REASONS.MAX_PAGES;
      break;
    }

    state.pagesFetched += 1;

    const { payload } = await fetchPage({
      tweetId,
      count: pageSize,
      cursor,
      operationId,
      features,
      headers,
    });

    const parsed = parseRetweetersPage(payload);

    if (isTransientEmptyPage(parsed)) {
      if (state.transientEmptyRetries < safeMaxTransientEmptyPages) {
        state.transientEmptyRetries += 1;
        notifyProgress(onProgress, {
          pagesFetched: state.pagesFetched,
          totalCollectedRaw: state.totalCollectedRaw,
          totalUnique: participantsByUserId.size,
          addedOnPage: 0,
          noGrowthStreak: state.noGrowthStreak,
          nextCursor: cursor || null,
          transientEmptyRetry: true,
        });
        continue;
      }
    } else {
      state.transientEmptyRetries = 0;
    }

    state.schemaWarnings += parsed.warnings;
    state.totalCollectedRaw += parsed.participants.length;

    const { addedOnPage, duplicatesSkipped, excludedAuthorCount } = ingestParticipants({
      parsedParticipants: parsed.participants,
      participantsByUserId,
      normalizedAuthor,
    });
    state.duplicatesSkipped += duplicatesSkipped;
    state.excludedAuthorCount += excludedAuthorCount;
    state.noGrowthStreak = addedOnPage > 0 ? 0 : state.noGrowthStreak + 1;

    const repeatedSignatureDetected = isRepeatedSignature(
      parsed.pageSignature,
      seenPageSignatures,
      safeMaxRepeatPageSignatures
    );

    notifyProgress(onProgress, {
      pagesFetched: state.pagesFetched,
      totalCollectedRaw: state.totalCollectedRaw,
      totalUnique: participantsByUserId.size,
      addedOnPage,
      noGrowthStreak: state.noGrowthStreak,
      nextCursor: parsed.bottomCursor || null,
    });

    if (!parsed.bottomCursor) {
      state.terminationReason = getNoCursorTerminationReason(parsed);
      break;
    }

    if (parsed.bottomCursor === cursor || seenBottomCursors.has(parsed.bottomCursor)) {
      state.loopDetected = true;
      state.terminationReason = TERMINATION_REASONS.CURSOR_CYCLE;
      break;
    }

    if (repeatedSignatureDetected) {
      state.loopDetected = true;
      state.terminationReason = TERMINATION_REASONS.REPEATED_PAGE;
      break;
    }

    if (state.noGrowthStreak >= safeMaxNoGrowthPages) {
      state.terminationReason = TERMINATION_REASONS.NO_GROWTH;
      break;
    }

    seenBottomCursors.add(parsed.bottomCursor);
    cursor = parsed.bottomCursor;
  }

  return {
    participants: Array.from(participantsByUserId.values()),
    metrics: toMetrics(state, participantsByUserId),
  };
}

export {
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_NO_GROWTH_PAGES,
  DEFAULT_MAX_REPEAT_PAGE_SIGNATURES,
  DEFAULT_MAX_TRANSIENT_EMPTY_PAGES,
  extractTimelineEntries,
  parseRetweetersPage,
  collectRetweeters,
};
