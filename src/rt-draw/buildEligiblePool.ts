import type { DrawFilterInput, RtParticipant, SourceMatchMode } from '@shared/rtDraw';

const SOURCE_KEYS = Object.freeze(['rt', 'quote', 'reply'] as const);
const SOURCE_MATCH_MODES = Object.freeze({
  ALL: 'all',
  ANY: 'any',
} as const);

type SourceKeyTuple = (typeof SOURCE_KEYS)[number];

interface SourceParticipantsInput {
  rt?: unknown;
  quote?: unknown;
  reply?: unknown;
}

interface BuildEligiblePoolOptions {
  sourceParticipants?: SourceParticipantsInput;
  selectedSources?: Partial<Record<SourceKeyTuple, boolean>>;
  sourceMatchMode?: SourceMatchMode | string | null;
  authorScreenName?: string | null;
  keyword?: string | null;
  filters?: DrawFilterInput | null;
}

interface BuildEligiblePoolFilters {
  requireParticipantFollowsAuth: boolean;
  requireAuthFollowsParticipant: boolean;
  minFollowersEnabled: boolean;
  minFollowers: number;
  excludeDefaultProfile: boolean;
  excludeDefaultProfileImage: boolean;
}

interface BuildEligiblePoolStats {
  selectedSources: SourceKeyTuple[];
  sourceMatchMode: SourceMatchMode;
  sourceUniqueBeforeAuthor: Record<SourceKeyTuple, number>;
  sourceUniqueAfterAuthor: Record<SourceKeyTuple, number>;
  authorExcludedBySource: Record<SourceKeyTuple, number>;
  intersectionCount: number;
  afterKeywordCount: number;
  afterProfileCount: number;
  excludedByKeyword: number;
  excludedByProfile: number;
}

interface BuildEligiblePoolResult {
  eligibleParticipants: RtParticipant[];
  stats: BuildEligiblePoolStats;
}

type SanitizedParticipant = Omit<RtParticipant, 'sourceTexts'> & {
  sourceTexts: string[];
};

interface MergedCandidate extends Omit<RtParticipant, 'sourceTexts'> {
  sourcePresence: Record<SourceKeyTuple, boolean>;
  sourceTexts: {
    quote: string[];
    reply: string[];
  };
}

type SourceMap = Map<string, SanitizedParticipant>;
type SourceMaps = Record<SourceKeyTuple, SourceMap>;

function normalizeHandle(handle: unknown): string {
  if (!handle) {
    return '';
  }
  return String(handle).trim().replace(/^@+/, '').toLowerCase();
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolOrNull(value: unknown): boolean | null {
  if (value === true || value === false) {
    return value;
  }
  return null;
}

function sanitizeParticipant(raw: unknown): SanitizedParticipant | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const userId = candidate.userId ? String(candidate.userId) : '';
  const screenName = candidate.screenName ? String(candidate.screenName) : '';
  if (!userId || !screenName) {
    return null;
  }

  return {
    userId,
    screenName,
    name: candidate.name ? String(candidate.name) : '',
    followedByAuth: toBoolOrNull(candidate.followedByAuth),
    followingAuth: toBoolOrNull(candidate.followingAuth),
    followingCount: toFiniteNumberOrNull(candidate.followingCount),
    followersCount: toFiniteNumberOrNull(candidate.followersCount),
    defaultProfile: toBoolOrNull(candidate.defaultProfile),
    defaultProfileImage: toBoolOrNull(candidate.defaultProfileImage),
    sourceTexts: Array.isArray(candidate.sourceTexts)
      ? candidate.sourceTexts.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function toSourceMap(participants: unknown): SourceMap {
  const map = new Map<string, SanitizedParticipant>();
  if (!Array.isArray(participants)) {
    return map;
  }

  for (const raw of participants) {
    const participant = sanitizeParticipant(raw);
    if (!participant) {
      continue;
    }

    const existing = map.get(participant.userId);
    if (existing) {
      for (const text of participant.sourceTexts) {
        if (!existing.sourceTexts.includes(text)) {
          existing.sourceTexts.push(text);
        }
      }
      continue;
    }

    map.set(participant.userId, participant);
  }

  return map;
}

function asSelectedSourceKeys(selectedSources: BuildEligiblePoolOptions['selectedSources']): SourceKeyTuple[] {
  const keys: SourceKeyTuple[] = [];
  for (const source of SOURCE_KEYS) {
    if (selectedSources && selectedSources[source] === true) {
      keys.push(source);
    }
  }
  return keys;
}

function intersectUserIds(sourceMaps: SourceMaps, selectedSourceKeys: SourceKeyTuple[]): string[] {
  if (selectedSourceKeys.length === 0) {
    return [];
  }

  const firstSource = selectedSourceKeys[0];
  if (firstSource === undefined) {
    return [];
  }
  const rest = selectedSourceKeys.slice(1);
  const baseMap = sourceMaps[firstSource];
  if (!baseMap || baseMap.size === 0) {
    return [];
  }

  const ids: string[] = [];
  for (const userId of baseMap.keys()) {
    let include = true;
    for (const source of rest) {
      const sourceMap = sourceMaps[source];
      if (!sourceMap || !sourceMap.has(userId)) {
        include = false;
        break;
      }
    }

    if (include) {
      ids.push(userId);
    }
  }
  return ids;
}

function unionUserIds(sourceMaps: SourceMaps, selectedSourceKeys: SourceKeyTuple[]): string[] {
  const userIds = new Set<string>();
  for (const source of selectedSourceKeys) {
    const sourceMap = sourceMaps[source];
    if (!sourceMap) {
      continue;
    }
    for (const userId of sourceMap.keys()) {
      userIds.add(userId);
    }
  }
  return Array.from(userIds);
}

function toSourceMatchMode(mode: unknown): SourceMatchMode {
  return mode === SOURCE_MATCH_MODES.ALL || mode === SOURCE_MATCH_MODES.ANY ? mode : SOURCE_MATCH_MODES.ALL;
}

function mergeByFirstDefined<K extends keyof SanitizedParticipant>(
  records: Array<SanitizedParticipant | null | undefined>,
  key: K
): SanitizedParticipant[K] | null {
  for (const record of records) {
    if (!record) {
      continue;
    }
    const value = record[key];
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function mergeUserRecords(recordsBySource: Partial<Record<SourceKeyTuple, SanitizedParticipant | null>>): MergedCandidate | null {
  const records = Object.values(recordsBySource).filter(Boolean) as SanitizedParticipant[];
  if (records.length === 0) {
    return null;
  }

  return {
    userId: String(mergeByFirstDefined(records, 'userId') || ''),
    screenName: String(mergeByFirstDefined(records, 'screenName') || ''),
    name: String(mergeByFirstDefined(records, 'name') || ''),
    followedByAuth: mergeByFirstDefined(records, 'followedByAuth'),
    followingAuth: mergeByFirstDefined(records, 'followingAuth'),
    followingCount: mergeByFirstDefined(records, 'followingCount'),
    followersCount: mergeByFirstDefined(records, 'followersCount'),
    defaultProfile: mergeByFirstDefined(records, 'defaultProfile'),
    defaultProfileImage: mergeByFirstDefined(records, 'defaultProfileImage'),
    sourcePresence: {
      rt: Boolean(recordsBySource.rt),
      quote: Boolean(recordsBySource.quote),
      reply: Boolean(recordsBySource.reply),
    },
    sourceTexts: {
      quote:
        recordsBySource.quote && Array.isArray(recordsBySource.quote.sourceTexts)
          ? recordsBySource.quote.sourceTexts.slice()
          : [],
      reply:
        recordsBySource.reply && Array.isArray(recordsBySource.reply.sourceTexts)
          ? recordsBySource.reply.sourceTexts.slice()
          : [],
    },
  };
}

function matchKeyword(participant: MergedCandidate, selectedSourceKeys: SourceKeyTuple[], keywordLower: string): boolean {
  if (!keywordLower) {
    return true;
  }

  for (const source of selectedSourceKeys) {
    if (source !== 'quote' && source !== 'reply') {
      continue;
    }
    if (!participant.sourcePresence || participant.sourcePresence[source] !== true) {
      continue;
    }

    const sourceTexts = participant.sourceTexts[source];
    const hasMatch =
      Array.isArray(sourceTexts) && sourceTexts.some((text) => String(text).toLowerCase().includes(keywordLower));
    if (!hasMatch) {
      return false;
    }
  }

  return true;
}

function toMinCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function passProfileFilters(participant: MergedCandidate, filters: BuildEligiblePoolFilters): boolean {
  const {
    requireParticipantFollowsAuth,
    requireAuthFollowsParticipant,
    minFollowersEnabled,
    minFollowers,
    excludeDefaultProfile,
    excludeDefaultProfileImage,
  } = filters;

  if (requireParticipantFollowsAuth) {
    if (participant.followedByAuth !== true) {
      return false;
    }
  }

  if (requireAuthFollowsParticipant) {
    if (participant.followingAuth !== true) {
      return false;
    }
  }

  if (minFollowersEnabled) {
    const followersCount = participant.followersCount;
    if (typeof followersCount !== 'number' || !Number.isFinite(followersCount) || followersCount < minFollowers) {
      return false;
    }
  }

  if (excludeDefaultProfile) {
    if (participant.defaultProfile !== false) {
      return false;
    }
  }

  if (excludeDefaultProfileImage) {
    if (participant.defaultProfileImage !== false) {
      return false;
    }
  }

  return true;
}

function buildEligiblePool(options: BuildEligiblePoolOptions): BuildEligiblePoolResult {
  const { sourceParticipants, selectedSources, sourceMatchMode, authorScreenName, keyword, filters } = options;

  const selectedSourceKeys = asSelectedSourceKeys(selectedSources);
  if (selectedSourceKeys.length === 0) {
    throw new Error('At least one source must be selected.');
  }

  const normalizedAuthor = normalizeHandle(authorScreenName);
  const sourceMaps: SourceMaps = {
    rt: toSourceMap(sourceParticipants && sourceParticipants.rt),
    quote: toSourceMap(sourceParticipants && sourceParticipants.quote),
    reply: toSourceMap(sourceParticipants && sourceParticipants.reply),
  };

  const authorExcludedBySource: Record<SourceKeyTuple, number> = { rt: 0, quote: 0, reply: 0 };
  const sourceUniqueBeforeAuthor: Record<SourceKeyTuple, number> = {
    rt: sourceMaps.rt.size,
    quote: sourceMaps.quote.size,
    reply: sourceMaps.reply.size,
  };

  for (const source of SOURCE_KEYS) {
    const map = sourceMaps[source];
    for (const [userId, participant] of map.entries()) {
      if (normalizeHandle(participant.screenName) === normalizedAuthor) {
        authorExcludedBySource[source] += 1;
        map.delete(userId);
      }
    }
  }

  const sourceUniqueAfterAuthor: Record<SourceKeyTuple, number> = {
    rt: sourceMaps.rt.size,
    quote: sourceMaps.quote.size,
    reply: sourceMaps.reply.size,
  };

  const normalizedSourceMatchMode = toSourceMatchMode(sourceMatchMode);
  const candidateIds =
    normalizedSourceMatchMode === SOURCE_MATCH_MODES.ANY
      ? unionUserIds(sourceMaps, selectedSourceKeys)
      : intersectUserIds(sourceMaps, selectedSourceKeys);

  const mergedCandidates: MergedCandidate[] = [];
  for (const userId of candidateIds) {
    const merged = mergeUserRecords({
      rt: sourceMaps.rt.get(userId) || null,
      quote: sourceMaps.quote.get(userId) || null,
      reply: sourceMaps.reply.get(userId) || null,
    });

    if (merged) {
      mergedCandidates.push(merged);
    }
  }

  const keywordLower = String(keyword || '')
    .trim()
    .toLowerCase();
  const afterKeyword: MergedCandidate[] = [];
  let excludedByKeyword = 0;

  for (const participant of mergedCandidates) {
    if (!matchKeyword(participant, selectedSourceKeys, keywordLower)) {
      excludedByKeyword += 1;
      continue;
    }
    afterKeyword.push(participant);
  }

  const normalizedFilters: BuildEligiblePoolFilters = {
    requireParticipantFollowsAuth: Boolean(filters && filters.requireParticipantFollowsAuth),
    requireAuthFollowsParticipant: Boolean(filters && filters.requireAuthFollowsParticipant),
    minFollowersEnabled: Boolean(filters && filters.minFollowersEnabled),
    minFollowers: toMinCount(filters && filters.minFollowers, 50),
    excludeDefaultProfile: Boolean(filters && filters.excludeDefaultProfile),
    excludeDefaultProfileImage: Boolean(filters && filters.excludeDefaultProfileImage),
  };

  const eligibleParticipants: RtParticipant[] = [];
  let excludedByProfile = 0;

  for (const participant of afterKeyword) {
    if (!passProfileFilters(participant, normalizedFilters)) {
      excludedByProfile += 1;
      continue;
    }

    eligibleParticipants.push({
      userId: participant.userId,
      screenName: participant.screenName,
      name: participant.name,
      followedByAuth: participant.followedByAuth,
      followingAuth: participant.followingAuth,
      followingCount: participant.followingCount,
      followersCount: participant.followersCount,
      defaultProfile: participant.defaultProfile,
      defaultProfileImage: participant.defaultProfileImage,
    });
  }

  return {
    eligibleParticipants,
    stats: {
      selectedSources: selectedSourceKeys,
      sourceMatchMode: normalizedSourceMatchMode,
      sourceUniqueBeforeAuthor,
      sourceUniqueAfterAuthor,
      authorExcludedBySource,
      intersectionCount: mergedCandidates.length,
      afterKeywordCount: afterKeyword.length,
      afterProfileCount: eligibleParticipants.length,
      excludedByKeyword,
      excludedByProfile,
    },
  };
}

export { SOURCE_KEYS, SOURCE_MATCH_MODES, buildEligiblePool, normalizeHandle };
export type { BuildEligiblePoolOptions, BuildEligiblePoolResult };
