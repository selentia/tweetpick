export type SourceKey = 'rt' | 'quote' | 'reply';
export type SourceMatchMode = 'all' | 'any';

export type SourceSelection = Record<SourceKey, boolean>;

export interface DrawFilterFlags {
  requireParticipantFollowsAuth: boolean;
  requireAuthFollowsParticipant: boolean;
  minFollowersEnabled: boolean;
  excludeDefaultProfile?: boolean;
  excludeDefaultProfileImage?: boolean;
}

export interface DrawFilterShape<TMinFollowers> extends Required<DrawFilterFlags> {
  keyword: string;
  minFollowers: TMinFollowers;
}

export type DrawFilterInput = Partial<DrawFilterShape<number | null>>;
export type DrawFilters = DrawFilterShape<number>;

export interface DrawRequestIdentity {
  authToken: string;
  ct0: string;
  tweetUrl: string;
}

export interface DrawRunInput extends DrawRequestIdentity {
  winners: number;
  sources: SourceSelection;
  sourceMatchMode?: SourceMatchMode;
  filters?: DrawFilterInput;
}

export interface ParsedDrawRunInput extends DrawRequestIdentity {
  winnersRequested: number;
  sources: SourceSelection;
  sourceMatchMode: SourceMatchMode;
  filters: DrawFilters;
}

export interface ParticipantIdentity {
  userId: string;
  screenName: string;
  name: string;
}

export interface ParticipantRelationshipState {
  followedByAuth: boolean | null;
  followingAuth: boolean | null;
}

export interface ParticipantFollowCounts {
  followingCount: number | null;
  followersCount: number | null;
}

export interface ParticipantProfileFlags {
  defaultProfile: boolean | null;
  defaultProfileImage: boolean | null;
}

export interface ParticipantProfile
  extends ParticipantIdentity,
    ParticipantRelationshipState,
    ParticipantFollowCounts,
    ParticipantProfileFlags {}

export interface ParticipantSourceData {
  sourceTexts?: string[];
  protected?: boolean;
  raw?: unknown;
  rawUser?: unknown;
  rawTweet?: unknown;
}

export interface RtParticipant extends ParticipantProfile, ParticipantSourceData {}

export type EligibleParticipant = ParticipantProfile;

export interface BuildEligiblePoolOptions {
  sourceParticipants?: Partial<Record<SourceKey, unknown[] | null | undefined>> | null;
  selectedSources?: Partial<SourceSelection> | null;
  sourceMatchMode?: SourceMatchMode | null;
  authorScreenName?: string | null;
  keyword?: string | null;
  filters?: DrawFilterInput | null;
}

export type SourceCountByKey = Record<SourceKey, number>;

export interface FilterStats {
  intersectionCount: number;
  afterKeywordCount: number;
  afterProfileCount: number;
  excludedByKeyword: number;
  excludedByProfile: number;
}

export interface BuildEligiblePoolStats extends FilterStats {
  selectedSources: SourceKey[];
  sourceMatchMode: SourceMatchMode;
  sourceUniqueBeforeAuthor: Record<SourceKey, number>;
  sourceUniqueAfterAuthor: Record<SourceKey, number>;
  authorExcludedBySource: Record<SourceKey, number>;
}

export interface BuildEligiblePoolResult {
  eligibleParticipants: EligibleParticipant[];
  stats: BuildEligiblePoolStats;
}

export interface ParsedTweetUrl {
  tweetId: string;
  author: string;
}

export interface DrawResult {
  seed: string;
  winners: RtParticipant[];
}

export interface SourceCollectionCounters {
  pagesFetched: number;
  totalCollectedRaw: number;
  totalUnique: number;
}

export interface SourceCollectionDiagnostics {
  duplicatesSkipped: number;
  excludedAuthorCount: number;
  schemaWarnings: number;
  loopDetected: boolean;
  terminationReason: string;
}

export interface SourceCollectionMetrics extends SourceCollectionCounters, SourceCollectionDiagnostics {
  noGrowthStreak?: number;
  transientEmptyRetries?: number;
}

export interface SourceCollectionResult<TParticipant extends RtParticipant = RtParticipant> {
  participants: TParticipant[];
  metrics: SourceCollectionMetrics;
}

export interface SourceCollectionProgress extends SourceCollectionCounters {
  addedOnPage: number;
  noGrowthStreak?: number;
  nextCursorCount?: number;
  nextCursor?: string | null;
  transientEmptyRetry?: boolean;
}

export interface RetryState<TReason extends string = string> {
  reason: TReason;
  attempt: number;
  waitMs: number;
}

export type GraphqlRetryReason = 'timeout' | 'network' | 'rate-limit' | 'request-timeout' | 'server' | 'invalid-json' | 'graphql-error';
export type RetryInfo = RetryState;
export type RetryHandlerInfo = RetryState<GraphqlRetryReason>;

export interface ErrorLike {
  name?: unknown;
  message?: unknown;
}

export interface TwitterRequestErrorDetails {
  status?: number;
  url?: string;
  bodySnippet?: string;
  cause?: unknown;
}

export interface HeadersLike {
  get(name: string): string | null;
}

export type FetchImpl = typeof globalThis.fetch;

export interface GraphqlErrorLike {
  message?: unknown;
}

export interface GraphqlPageResponse<TPayload = unknown> {
  payload: TPayload;
  status: number;
  url: string;
}

export interface RequestGraphqlPageOptions {
  url: string;
  headers?: HeadersInit;
  method?: 'GET' | 'POST';
  body?: BodyInit | null;
  fetchImpl?: FetchImpl;
  maxRetries?: number;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (retry: RetryHandlerInfo) => void;
}

export interface RetweetersUrlOptions {
  operationId: string;
  tweetId: string;
  count: number;
  features?: Record<string, unknown>;
  enableRanking?: boolean;
  includePromotedContent?: boolean;
  cursor?: string | null;
}

export interface SearchTimelineUrlOptions {
  operationId: string;
}

export interface SearchTimelineBodyOptions {
  rawQuery: string;
  count?: number;
  cursor?: string | null;
  querySource?: string;
  product?: string;
  features?: Record<string, unknown>;
}

export interface TweetDetailUrlOptions {
  operationId: string;
  focalTweetId: string;
  cursor?: string | null;
  controllerData?: string;
  referrer?: string;
  rankingMode?: string;
  features?: Record<string, unknown>;
  fieldToggles?: Record<string, unknown>;
}

export interface SourceStat extends SourceCollectionCounters, SourceCollectionDiagnostics {
  selected: boolean;
  uniqueAfterAuthor: number;
  authorExcludedDuringMerge: number;
  terminationReasonKorean: string;
}

export interface RtDrawResult {
  tweetId: string;
  author: string;
  winnersRequested: number;
  drawResult: DrawResult;
  participantsCount: number;
  eligibleCount: number;
  selectedSources: SourceKey[];
  sourceMatchMode: SourceMatchMode;
  keyword: string;
  sourceStats: Record<SourceKey, SourceStat>;
  filterStats: FilterStats;
}

export interface DrawStatusProgressEvent {
  type: 'status';
  message: string;
}

export interface DrawRetryProgressEvent {
  type: 'retry';
  source: SourceKey;
  attempt: number;
  waitMs: number;
  message: string;
}

export interface DrawCollectSourceProgressEvent {
  type: 'collect-source';
  source: SourceKey;
  pagesFetched: number;
  totalUnique: number;
  totalCollectedRaw: number;
  addedOnPage: number;
  nextCursorCount: number;
  nextCursor: string | null;
}

export type DrawProgressEvent = DrawStatusProgressEvent | DrawRetryProgressEvent | DrawCollectSourceProgressEvent;

export interface DrawRunSuccessResponse {
  ok: true;
  result: RtDrawResult;
}

export interface DrawRunFailureResponse {
  ok: false;
  error: {
    message: string;
    debugMessage?: string;
  };
}

export type DrawRunResponse = DrawRunSuccessResponse | DrawRunFailureResponse;

export interface SaveResultImageRequest {
  result?: RtDrawResult;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SaveResultImageResponse {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  message?: string;
}

export type LegalDocumentsResponse =
  | {
      ok: true;
      notice: string;
      license: string;
    }
  | {
      ok: false;
      message: string;
    };

export interface WindowStatePayload {
  isMaximized: boolean;
  isCustomChrome: boolean;
  platform: string;
  appVersion: string;
}

export type WindowStateGetResponse = { ok: true; state: WindowStatePayload } | { ok: false };

export type WindowResizeHeightResponse =
  | { ok: true; height: number; changed: boolean }
  | { ok: false; reason?: string };

export interface RtDrawApi {
  runDraw(input: DrawRunInput): Promise<DrawRunResponse>;
  onProgress(handler: (payload: DrawProgressEvent) => void): () => void;
  openExternal(url: string): Promise<boolean>;
  getLegalDocuments(): Promise<LegalDocumentsResponse>;
  openInfoPage(): Promise<boolean>;
  openLegalPage(): Promise<boolean>;
  saveResultImage(payload: SaveResultImageRequest): Promise<SaveResultImageResponse>;
  minimizeWindow(): Promise<boolean>;
  toggleMaximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<boolean>;
  getWindowState(): Promise<WindowStateGetResponse>;
  resizeWindowHeight(height: number): Promise<WindowResizeHeightResponse>;
  onWindowState(handler: (payload: WindowStatePayload) => void): () => void;
}
