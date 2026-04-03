import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  resolveTwitterConfig,
  buildEligiblePool,
  collectFavoriters,
  collectQuotes,
  collectReplies,
  collectRetweeters,
  drawWinners,
  parseTweetUrl,
  fetchFavoritersPage,
  fetchRetweetersPage,
  fetchSearchTimelinePage,
  fetchTweetDetailPage,
  makeHeaders,
} from '@rt/index';
import { loadEnvFileIfPresent } from '@main/loadEnvFile';
import { toKoreanMessage, toRetryMessage, mapTerminationReason } from '@main/messageCatalog';
import { IPC_CHANNELS } from '@shared/ipc.channels';
import type {
  BuildEligiblePoolResult,
  BuildEligiblePoolStats,
  DrawFilters,
  DrawProgressEvent,
  ParsedDrawRunInput,
  LegalDocumentsResponse,
  RetryInfo,
  RtDrawResult,
  SaveResultImageRequest,
  SaveResultImageResponse,
  SearchTimelineBodyOptions,
  SearchTimelineUrlOptions,
  SourceCollectionProgress,
  SourceCollectionResult,
  SourceKey,
  SourceMatchMode,
  SourceSelection,
  SourceStat,
  FavoritersUrlOptions,
  RetweetersUrlOptions,
  TweetDetailUrlOptions,
  WindowResizeHeightResponse,
  WindowStateGetResponse,
  WindowStatePayload,
} from '@shared/rtDraw';

const DEFAULT_RT_PAGE_SIZE = 100;
const DEFAULT_QUOTE_PAGE_SIZE = 20;
const APP_TITLE = 'TweetPick';
const RESULT_IMAGE_PREFIX = 'rt-draw-result';
const WINDOW_STATE_CHANNEL = IPC_CHANNELS.APP_WINDOW_STATE;
const IS_CUSTOM_CHROME_PLATFORM = process.platform !== 'darwin';

const WINDOW_BOUNDS = Object.freeze({
  width: 800,
  height: 760,
  minWidth: 800,
  maxWidth: 800,
  minHeight: 640,
});
const RESULT_IMAGE_VIEWPORT_WIDTH = 760;
const RESULT_IMAGE_MIN_HEIGHT = 320;
const ENV_FILE_PATH = path.join(process.cwd(), '.env');
const BUILD_TWITTER_CONFIG_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'twitter-config.json')
  : path.join(process.cwd(), 'build', 'twitter-config.json');
const HTML_ESCAPE_MAP = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

type JsonRecord = Record<string, unknown>;

interface BuildTwitterConfigFile {
  twitter?: {
    bearerToken?: string | null;
    retweetersOperationId?: string | null;
    favoritersOperationId?: string | null;
    searchTimelineOperationId?: string | null;
    tweetDetailOperationId?: string | null;
    featuresJson?: string | null;
    fieldTogglesJson?: string | null;
  } | null;
}

interface BuildTwitterConfigOptions {
  bearerToken?: string;
  retweetersOperationId?: string;
  favoritersOperationId?: string;
  searchTimelineOperationId?: string;
  tweetDetailOperationId?: string;
  featuresJson?: string;
  fieldTogglesJson?: string;
}

function readNonEmptyBuildConfigValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBuildTwitterConfig(): BuildTwitterConfigOptions | null {
  if (!existsSync(BUILD_TWITTER_CONFIG_PATH)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(BUILD_TWITTER_CONFIG_PATH, 'utf8')) as BuildTwitterConfigFile;
    const twitter = parsed && typeof parsed === 'object' && parsed.twitter && typeof parsed.twitter === 'object' ? parsed.twitter : null;
    if (!twitter) {
      return null;
    }

    return {
      bearerToken: readNonEmptyBuildConfigValue(twitter.bearerToken) ?? undefined,
      retweetersOperationId: readNonEmptyBuildConfigValue(twitter.retweetersOperationId) ?? undefined,
      favoritersOperationId: readNonEmptyBuildConfigValue(twitter.favoritersOperationId) ?? undefined,
      searchTimelineOperationId: readNonEmptyBuildConfigValue(twitter.searchTimelineOperationId) ?? undefined,
      tweetDetailOperationId: readNonEmptyBuildConfigValue(twitter.tweetDetailOperationId) ?? undefined,
      featuresJson: readNonEmptyBuildConfigValue(twitter.featuresJson) ?? undefined,
      fieldTogglesJson: readNonEmptyBuildConfigValue(twitter.fieldTogglesJson) ?? undefined,
    };
  } catch {
    return null;
  }
}

interface ResultImageRow {
  screenName: string;
  name: string;
}

interface ResultImageData {
  tweetLink: string;
  winnersRequested: number;
  eligibleCount: number;
  winners: ResultImageRow[];
}

type AppWindow = BrowserWindow | null;

type RetweetersFetchOptions = RetweetersUrlOptions & {
  headers?: HeadersInit;
  onRetry?: (retryInfo: RetryInfo) => void;
};

type FavoritersFetchOptions = FavoritersUrlOptions & {
  headers?: HeadersInit;
  onRetry?: (retryInfo: RetryInfo) => void;
};

type SearchTimelineFetchOptions = SearchTimelineUrlOptions &
  SearchTimelineBodyOptions & {
    headers?: HeadersInit;
    onRetry?: (retryInfo: RetryInfo) => void;
  };

type TweetDetailFetchOptions = TweetDetailUrlOptions & {
  headers?: HeadersInit;
  onRetry?: (retryInfo: RetryInfo) => void;
};

loadEnvFileIfPresent(ENV_FILE_PATH);
const BUILD_TWITTER_CONFIG = readBuildTwitterConfig();

let mainWindow: AppWindow = null;
let infoWindow: AppWindow = null;
let legalWindow: AppWindow = null;

const LEGAL_DOC_FILENAMES = Object.freeze({
  notice: 'NOTICE',
  license: 'LICENSE',
});

function normalizeLegalText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').trim();
}

async function readLegalDocumentText(fileName: string): Promise<string | null> {
  const candidates = [
    path.join(app.getAppPath(), fileName),
    path.join(process.cwd(), fileName),
    path.join(process.resourcesPath, fileName),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const text = await fs.readFile(candidate, 'utf8');
      const normalized = normalizeLegalText(text);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function parsePositiveInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseMinCount(value: unknown, fallback: number, label: string): number {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseSources(rawSources: unknown): SourceSelection {
  const safe = isRecord(rawSources) ? rawSources : {};
  const parsed: SourceSelection = {
    rt: safe.rt !== false,
    quote: safe.quote === true,
    reply: safe.reply === true,
    like: safe.like === true,
  };

  if (!parsed.rt && !parsed.quote && !parsed.reply && !parsed.like) {
    throw new Error('At least one source must be selected.');
  }

  return parsed;
}

function parseSourceMatchMode(rawMode: unknown): SourceMatchMode {
  return rawMode === 'all' || rawMode === 'any' ? rawMode : 'any';
}

function parseFilters(rawFilters: unknown): DrawFilters {
  const safe = isRecord(rawFilters) ? rawFilters : {};
  const minFollowersEnabled = safe.minFollowersEnabled === true;
  const minFollowers = minFollowersEnabled ? parseMinCount(safe.minFollowers, 50, 'minFollowers') : 50;

  return {
    keyword: String(safe.keyword || '').trim(),
    requireParticipantFollowsAuth: safe.requireParticipantFollowsAuth === true,
    requireAuthFollowsParticipant: safe.requireAuthFollowsParticipant === true,
    minFollowersEnabled,
    minFollowers,
    excludeDefaultProfile: safe.excludeDefaultProfile === true,
    excludeDefaultProfileImage: safe.excludeDefaultProfileImage === true,
  };
}

function parseRunInput(input: unknown): ParsedDrawRunInput {
  const safe = isRecord(input) ? input : {};
  return {
    authToken: String(safe.authToken || '').trim(),
    ct0: String(safe.ct0 || '').trim(),
    tweetUrl: String(safe.tweetUrl || '').trim(),
    winnersRequested: parsePositiveInt(safe.winners, 'winners'),
    sources: parseSources(safe.sources),
    sourceMatchMode: parseSourceMatchMode(safe.sourceMatchMode),
    filters: parseFilters(safe.filters),
  };
}

function emitSourceProgress(
  sendProgress: ((progress: DrawProgressEvent) => void) | undefined,
  source: SourceKey,
  progress: SourceCollectionProgress
): void {
  if (typeof sendProgress !== 'function') {
    return;
  }

  sendProgress({
    type: 'collect-source',
    source,
    pagesFetched: Number(progress.pagesFetched) || 0,
    totalUnique: Number(progress.totalUnique) || 0,
    totalCollectedRaw: Number(progress.totalCollectedRaw) || 0,
    addedOnPage: Number(progress.addedOnPage) || 0,
    nextCursorCount: Number(progress.nextCursorCount) || 0,
    nextCursor: progress.nextCursor || null,
  });
}

function emitRetryProgress(
  sendProgress: ((progress: DrawProgressEvent) => void) | undefined,
  source: SourceKey,
  retryInfo: RetryInfo
): void {
  if (typeof sendProgress !== 'function') {
    return;
  }

  sendProgress({
    type: 'retry',
    source,
    attempt: retryInfo.attempt,
    waitMs: retryInfo.waitMs,
    message: toRetryMessage(retryInfo.reason),
  });
}

function createEmptyCollectionResult(): SourceCollectionResult {
  return {
    participants: [],
    metrics: {
      pagesFetched: 0,
      totalCollectedRaw: 0,
      totalUnique: 0,
      duplicatesSkipped: 0,
      excludedAuthorCount: 0,
      schemaWarnings: 0,
      loopDetected: false,
      terminationReason: 'unknown',
    },
  };
}

function buildSourceStat(
  sourceKey: SourceKey,
  selected: boolean,
  collectionResult: SourceCollectionResult,
  poolStats: BuildEligiblePoolStats
): SourceStat {
  const metrics = collectionResult.metrics;
  const sourceAfterAuthor =
    poolStats && poolStats.sourceUniqueAfterAuthor && Number.isFinite(poolStats.sourceUniqueAfterAuthor[sourceKey])
      ? poolStats.sourceUniqueAfterAuthor[sourceKey]
      : 0;
  const authorExcludedBySource =
    poolStats && poolStats.authorExcludedBySource && Number.isFinite(poolStats.authorExcludedBySource[sourceKey])
      ? poolStats.authorExcludedBySource[sourceKey]
      : 0;
  const terminationReason = typeof metrics.terminationReason === 'string' ? metrics.terminationReason : 'unknown';

  return {
    selected,
    pagesFetched: Number(metrics.pagesFetched) || 0,
    totalCollectedRaw: Number(metrics.totalCollectedRaw) || 0,
    totalUnique: Number(metrics.totalUnique) || 0,
    duplicatesSkipped: Number(metrics.duplicatesSkipped) || 0,
    excludedAuthorCount: Number(metrics.excludedAuthorCount) || 0,
    schemaWarnings: Number(metrics.schemaWarnings) || 0,
    loopDetected: metrics.loopDetected === true,
    uniqueAfterAuthor: sourceAfterAuthor,
    authorExcludedDuringMerge: authorExcludedBySource,
    terminationReason,
    terminationReasonKorean: mapTerminationReason(terminationReason),
  };
}

async function runRtDraw(input: unknown, sendProgress: (progress: DrawProgressEvent) => void): Promise<RtDrawResult> {
  const parsedInput = parseRunInput(input);
  const config = resolveTwitterConfig(BUILD_TWITTER_CONFIG || undefined);

  const headers = makeHeaders({
    authToken: parsedInput.authToken,
    ct0: parsedInput.ct0,
    bearerToken: config.bearerToken,
  });

  const { tweetId, author } = parseTweetUrl(parsedInput.tweetUrl);
  const sourceResultByKey = {
    rt: createEmptyCollectionResult(),
    like: createEmptyCollectionResult(),
    quote: createEmptyCollectionResult(),
    reply: createEmptyCollectionResult(),
  };

  sendProgress({
    type: 'status',
    message: '참여자 수집을 시작합니다.',
  });

  if (parsedInput.sources.rt) {
    sourceResultByKey.rt = await collectRetweeters({
      tweetId,
      authorScreenName: author,
      pageSize: DEFAULT_RT_PAGE_SIZE,
      operationId: config.retweetersOperationId,
      features: config.features,
      headers,
      fetchPage: (options: RetweetersFetchOptions) =>
        fetchRetweetersPage({
          ...options,
          onRetry: (retryInfo: RetryInfo) => emitRetryProgress(sendProgress, 'rt', retryInfo),
        }),
      onProgress: (progress: SourceCollectionProgress) => {
        emitSourceProgress(sendProgress, 'rt', progress);
      },
    });
  }

  if (parsedInput.sources.like) {
    sourceResultByKey.like = await collectFavoriters({
      tweetId,
      authorScreenName: author,
      pageSize: DEFAULT_RT_PAGE_SIZE,
      operationId: config.favoritersOperationId,
      features: config.features,
      headers,
      fetchPage: (options: FavoritersFetchOptions) =>
        fetchFavoritersPage({
          ...options,
          onRetry: (retryInfo: RetryInfo) => emitRetryProgress(sendProgress, 'like', retryInfo),
        }),
      onProgress: (progress: SourceCollectionProgress) => {
        emitSourceProgress(sendProgress, 'like', progress);
      },
    });
  }

  if (parsedInput.sources.quote) {
    sourceResultByKey.quote = await collectQuotes({
      tweetId,
      authorScreenName: author,
      pageSize: DEFAULT_QUOTE_PAGE_SIZE,
      operationId: config.searchTimelineOperationId,
      features: config.features,
      headers,
      fetchPage: (options: SearchTimelineFetchOptions) =>
        fetchSearchTimelinePage({
          ...options,
          onRetry: (retryInfo: RetryInfo) => emitRetryProgress(sendProgress, 'quote', retryInfo),
        }),
      onProgress: (progress: SourceCollectionProgress) => {
        emitSourceProgress(sendProgress, 'quote', progress);
      },
    });
  }

  if (parsedInput.sources.reply) {
    sourceResultByKey.reply = await collectReplies({
      tweetId,
      authorScreenName: author,
      operationId: config.tweetDetailOperationId,
      features: config.features,
      fieldToggles: config.fieldToggles,
      headers,
      fetchPage: (options: TweetDetailFetchOptions) =>
        fetchTweetDetailPage({
          ...options,
          onRetry: (retryInfo: RetryInfo) => emitRetryProgress(sendProgress, 'reply', retryInfo),
        }),
      onProgress: (progress: SourceCollectionProgress) => {
        emitSourceProgress(sendProgress, 'reply', progress);
      },
    });
  }

  const sourceParticipants = {
    rt: sourceResultByKey.rt.participants,
    like: sourceResultByKey.like.participants,
    quote: sourceResultByKey.quote.participants,
    reply: sourceResultByKey.reply.participants,
  };

  const pool: BuildEligiblePoolResult = buildEligiblePool({
    sourceParticipants,
    selectedSources: parsedInput.sources,
    sourceMatchMode: parsedInput.sourceMatchMode,
    authorScreenName: author,
    keyword: parsedInput.filters.keyword,
    filters: parsedInput.filters,
  });

  const eligibleParticipants = pool.eligibleParticipants;
  if (eligibleParticipants.length < parsedInput.winnersRequested) {
    throw new Error(
      `Not enough participants. requested=${parsedInput.winnersRequested}, available=${eligibleParticipants.length}`
    );
  }

  const drawResult = drawWinners({
    participants: eligibleParticipants,
    winners: parsedInput.winnersRequested,
  });

  sendProgress({
    type: 'status',
    message: '추첨이 완료되었습니다.',
  });

  return {
    tweetId,
    author,
    winnersRequested: parsedInput.winnersRequested,
    drawResult,
    participantsCount: pool.stats.intersectionCount,
    eligibleCount: pool.stats.afterProfileCount,
    selectedSources: pool.stats.selectedSources,
    sourceMatchMode: parsedInput.sourceMatchMode,
    keyword: parsedInput.filters.keyword,
    sourceStats: {
      rt: buildSourceStat('rt', parsedInput.sources.rt, sourceResultByKey.rt, pool.stats),
      like: buildSourceStat('like', parsedInput.sources.like, sourceResultByKey.like, pool.stats),
      quote: buildSourceStat('quote', parsedInput.sources.quote, sourceResultByKey.quote, pool.stats),
      reply: buildSourceStat('reply', parsedInput.sources.reply, sourceResultByKey.reply, pool.stats),
    },
    filterStats: {
      intersectionCount: pool.stats.intersectionCount,
      afterKeywordCount: pool.stats.afterKeywordCount,
      afterProfileCount: pool.stats.afterProfileCount,
      excludedByKeyword: pool.stats.excludedByKeyword,
      excludedByProfile: pool.stats.excludedByProfile,
    },
  };
}

function isSafeExternalUrl(url: unknown): boolean {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCaptureBounds(raw: unknown): { x: number; y: number; width: number; height: number } | null {
  const safe = isRecord(raw) ? raw : {};
  const x = Number(safe.x);
  const y = Number(safe.y);
  const width = Number(safe.width);
  const height = Number(safe.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
  };
}

function toAutoResizableHeight(desiredHeightRaw: unknown): number | null {
  const desiredHeight = Number(desiredHeightRaw);
  if (!Number.isFinite(desiredHeight)) {
    return null;
  }
  return Math.max(WINDOW_BOUNDS.minHeight, Math.round(desiredHeight));
}

function escapeHtml(value: unknown): string {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPE_MAP[char as keyof typeof HTML_ESCAPE_MAP] ?? char
  );
}

function formatCountLabel(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '0명';
  }
  return `${number.toLocaleString('ko-KR')}명`;
}

function resolveResultImageData(rawResult: unknown): ResultImageData | null {
  if (!isRecord(rawResult)) {
    return null;
  }

  const drawResult = isRecord(rawResult.drawResult) ? rawResult.drawResult : null;
  if (!drawResult || !Array.isArray(drawResult.winners)) {
    return null;
  }

  const winners = drawResult.winners.map((winner: unknown) => {
    const safeWinner = isRecord(winner) ? winner : {};
    return {
      screenName: String(safeWinner.screenName || ''),
      name: String(safeWinner.name || ''),
    };
  });

  const author = String(rawResult.author || '').trim();
  const tweetId = String(rawResult.tweetId || '').trim();
  const tweetLink = author && tweetId ? `https://x.com/${author}/status/${tweetId}` : '-';
  const winnersRequested = Number.isFinite(Number(rawResult.winnersRequested))
    ? Number(rawResult.winnersRequested)
    : winners.length;
  const eligibleCount = Number.isFinite(Number(rawResult.eligibleCount)) ? Number(rawResult.eligibleCount) : 0;

  return {
    tweetLink,
    winnersRequested,
    eligibleCount,
    winners,
  };
}

function buildResultImageHtml(rawResult: unknown): string {
  const result = resolveResultImageData(rawResult);
  if (!result) {
    throw new Error('Invalid result payload for image rendering.');
  }

  const rowsHtml =
    result.winners.length === 0
      ? '<tr><td colspan="3" class="empty">당첨자가 없습니다.</td></tr>'
      : result.winners
          .map((winner, index) => {
            const rank = index + 1;
            const idText = winner.screenName ? `@${winner.screenName}` : '(아이디 없음)';
            return [
              '<tr>',
              `<td>${rank}</td>`,
              `<td>${escapeHtml(idText)}</td>`,
              `<td>${escapeHtml(winner.name || '-')}</td>`,
              '</tr>',
            ].join('');
          })
          .join('');

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>추첨 결과 이미지</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        background: #f3f5fb;
        color: #1a2533;
        font-family: "Segoe UI", "Malgun Gothic", "Noto Sans KR", sans-serif;
      }
      .sheet {
        width: ${RESULT_IMAGE_VIEWPORT_WIDTH}px;
        margin: 0 auto;
        padding: 10px;
      }
      .panel {
        border: 1px solid #c8d5e6;
        border-radius: 8px;
        background: #ffffff;
        padding: 8px;
      }
      .title {
        margin: 0 0 6px;
        font-size: 20px;
        font-weight: 700;
        color: #325c88;
      }
      .summary {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        row-gap: 4px;
        column-gap: 6px;
        margin-bottom: 8px;
      }
      .summary .label {
        font-size: 14px;
        font-weight: 600;
        color: #6f8297;
      }
      .summary .value {
        font-size: 15px;
        font-weight: 600;
        color: #1d2f43;
        word-break: break-all;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
      }
      thead {
        background: #edf4fd;
      }
      th,
      td {
        text-align: left;
        padding: 6px 7px;
        border-bottom: 1px solid #dbe6f3;
        color: rgba(32, 48, 68, 0.92);
      }
      tbody tr:nth-child(even) {
        background: #f8fbff;
      }
      td.empty {
        text-align: center;
        color: #5a6b80;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="panel">
        <h1 class="title">추첨 결과</h1>
        <div class="summary">
          <div class="label">기준 트윗</div>
          <div class="value">${escapeHtml(result.tweetLink)}</div>
          <div class="label">참여자</div>
          <div class="value">${escapeHtml(formatCountLabel(result.eligibleCount))}</div>
          <div class="label">추첨 인원</div>
          <div class="value">${escapeHtml(formatCountLabel(result.winnersRequested))}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>아이디</th>
              <th>닉네임</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

async function renderResultImageBuffer(rawResult: unknown): Promise<Buffer> {
  const captureWindow = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: RESULT_IMAGE_VIEWPORT_WIDTH,
    height: RESULT_IMAGE_MIN_HEIGHT,
    backgroundColor: '#f3f5fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const html = buildResultImageHtml(rawResult);
    await captureWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);

    await captureWindow.webContents.executeJavaScript(
      `(async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        return true;
      })();`,
      true
    );

    const captureSize = await captureWindow.webContents.executeJavaScript(
      `({
        width: Math.ceil(document.documentElement.scrollWidth),
        height: Math.ceil(document.documentElement.scrollHeight)
      })`,
      true
    );

    const width = Math.max(1, Number(captureSize && captureSize.width) || RESULT_IMAGE_VIEWPORT_WIDTH);
    const height = Math.max(1, Number(captureSize && captureSize.height) || RESULT_IMAGE_MIN_HEIGHT);
    captureWindow.setContentSize(width, height, false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const image = await captureWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width,
      height,
    });
    if (!image || image.isEmpty()) {
      throw new Error('Failed to render result image.');
    }

    return image.toPNG();
  } finally {
    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy();
    }
  }
}

function getDefaultImagePath(): string {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const filename = `${RESULT_IMAGE_PREFIX}-${date}-${time}.png`;

  try {
    return path.join(app.getPath('pictures'), filename);
  } catch (error) {
    try {
      return path.join(app.getPath('documents'), filename);
    } catch (fallbackError) {
      return path.join(process.cwd(), filename);
    }
  }
}

function toWindowStatePayload(targetWindow: BrowserWindow): WindowStatePayload {
  return {
    isMaximized: targetWindow.isMaximized(),
    isCustomChrome: IS_CUSTOM_CHROME_PLATFORM,
    platform: process.platform,
    appVersion: app.getVersion(),
  };
}

function emitWindowState(targetWindow: AppWindow): void {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send(WINDOW_STATE_CHANNEL, toWindowStatePayload(targetWindow));
}

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    ...WINDOW_BOUNDS,
    show: false,
    frame: !IS_CUSTOM_CHROME_PLATFORM,
    backgroundColor: '#f3f5fb',
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const currentWindow = mainWindow;

  currentWindow.once('ready-to-show', () => {
    currentWindow.show();
  });

  if (IS_CUSTOM_CHROME_PLATFORM) {
    currentWindow.on('maximize', () => {
      emitWindowState(currentWindow);
    });

    currentWindow.on('unmaximize', () => {
      emitWindowState(currentWindow);
    });
  }

  currentWindow.webContents.on('did-finish-load', () => {
    emitWindowState(currentWindow);
  });

  currentWindow.on('closed', () => {
    if (mainWindow === currentWindow) {
      mainWindow = null;
    }
  });

  currentWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  return currentWindow;
}

function createInfoWindow(parentWindow: BrowserWindow | null): BrowserWindow {
  if (infoWindow && !infoWindow.isDestroyed()) {
    infoWindow.focus();
    return infoWindow;
  }

  infoWindow = new BrowserWindow({
    width: 620,
    height: 560,
    minWidth: 560,
    minHeight: 500,
    show: false,
    parent: parentWindow || undefined,
    backgroundColor: '#f3f5fb',
    title: '이용 방법 안내',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  infoWindow.once('ready-to-show', () => {
    if (infoWindow && !infoWindow.isDestroyed()) {
      infoWindow.show();
      infoWindow.focus();
    }
  });

  infoWindow.on('closed', () => {
    infoWindow = null;
  });

  infoWindow.loadFile(path.join(__dirname, '../renderer/info.html'));
  return infoWindow;
}

function createLegalWindow(parentWindow: BrowserWindow | null): BrowserWindow {
  if (legalWindow && !legalWindow.isDestroyed()) {
    legalWindow.focus();
    return legalWindow;
  }

  legalWindow = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 620,
    minHeight: 520,
    show: false,
    parent: parentWindow || undefined,
    backgroundColor: '#f3f5fb',
    title: '라이선스',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  legalWindow.once('ready-to-show', () => {
    if (legalWindow && !legalWindow.isDestroyed()) {
      legalWindow.show();
      legalWindow.focus();
    }
  });

  legalWindow.on('closed', () => {
    legalWindow = null;
  });

  legalWindow.loadFile(path.join(__dirname, '../renderer/legal.html'));
  return legalWindow;
}

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.DRAW_RUN, async (event, payload: unknown) => {
    try {
      const result = await runRtDraw(payload, (progress: DrawProgressEvent) => {
        event.sender.send(IPC_CHANNELS.DRAW_PROGRESS, progress);
      });

      return {
        ok: true,
        result,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: toKoreanMessage(error),
          debugMessage:
            process.env.NODE_ENV === 'development' && isRecord(error) && typeof error.message === 'string'
              ? error.message
              : undefined,
        },
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_, url: unknown): Promise<boolean> => {
    if (!isSafeExternalUrl(url)) {
      return false;
    }

    await shell.openExternal(String(url));
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.APP_LEGAL_DOCUMENTS_GET, async (): Promise<LegalDocumentsResponse> => {
    try {
      const [notice, license] = await Promise.all([
        readLegalDocumentText(LEGAL_DOC_FILENAMES.notice),
        readLegalDocumentText(LEGAL_DOC_FILENAMES.license),
      ]);

      if (!notice || !license) {
        return {
          ok: false,
          message: '라이선스 문서를 불러오지 못했습니다.',
        };
      }

      return {
        ok: true,
        notice,
        license,
      };
    } catch {
      return {
        ok: false,
        message: '라이선스 문서를 불러오지 못했습니다.',
      };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_SAVE_RESULT_IMAGE,
    async (event, payload: SaveResultImageRequest): Promise<SaveResultImageResponse> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return {
          ok: false,
          message: '창 정보를 확인하지 못했습니다.',
        };
      }

      try {
        let pngBuffer: Buffer | null = null;
        const resultPayload =
          payload && isRecord(payload) && payload.result && isRecord(payload.result) ? payload.result : null;

        if (resultPayload) {
          pngBuffer = await renderResultImageBuffer(resultPayload);
        } else {
          const captureRect = parseCaptureBounds(payload);
          if (!captureRect) {
            return {
              ok: false,
              message: '저장할 영역이 올바르지 않습니다.',
            };
          }

          const image = await event.sender.capturePage(captureRect);
          if (!image || image.isEmpty()) {
            return {
              ok: false,
              message: '이미지 생성에 실패했습니다.',
            };
          }
          pngBuffer = image.toPNG();
        }

        if (!pngBuffer || pngBuffer.length === 0) {
          return {
            ok: false,
            message: '이미지 생성에 실패했습니다.',
          };
        }

        const saveResult = await dialog.showSaveDialog(window, {
          title: '이미지 저장',
          defaultPath: getDefaultImagePath(),
          filters: [
            {
              name: 'PNG 이미지',
              extensions: ['png'],
            },
          ],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });

        if (saveResult.canceled || !saveResult.filePath) {
          return {
            ok: false,
            canceled: true,
          };
        }

        await fs.writeFile(saveResult.filePath, pngBuffer);
        return {
          ok: true,
          path: saveResult.filePath,
        };
      } catch {
        return {
          ok: false,
          message: '이미지 저장 중 오류가 발생했습니다.',
        };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_INFO_PAGE, async (event): Promise<boolean> => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      createInfoWindow(parentWindow || null);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_OPEN_LEGAL_PAGE, async (event): Promise<boolean> => {
    try {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      createLegalWindow(parentWindow || null);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_MINIMIZE, async (event): Promise<boolean> => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }

    targetWindow.minimize();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE, async (event): Promise<boolean> => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }

    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.APP_WINDOW_RESIZE_HEIGHT,
    async (event, payload: { height?: number } | null): Promise<WindowResizeHeightResponse> => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      if (!targetWindow || targetWindow.isDestroyed()) {
        return {
          ok: false,
        };
      }

      if (targetWindow.isMaximized() || targetWindow.isFullScreen()) {
        return {
          ok: false,
          reason: 'window_not_resizable',
        };
      }

      const nextHeight = toAutoResizableHeight(payload && payload.height);
      if (nextHeight === null) {
        return {
          ok: false,
          reason: 'invalid_height',
        };
      }

      const [contentWidth, currentContentHeight] = targetWindow.getContentSize() as [number, number];
      if (currentContentHeight === nextHeight) {
        return {
          ok: true,
          height: currentContentHeight,
          changed: false,
        };
      }

      targetWindow.setContentSize(contentWidth, nextHeight, true);
      emitWindowState(targetWindow);
      return {
        ok: true,
        height: nextHeight,
        changed: true,
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_CLOSE, async (event): Promise<boolean> => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return false;
    }

    targetWindow.close();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.APP_WINDOW_STATE_GET, async (event): Promise<WindowStateGetResponse> => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return {
        ok: false,
      };
    }

    return {
      ok: true,
      state: toWindowStatePayload(targetWindow),
    };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
