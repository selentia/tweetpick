const DEFAULT_ERROR_MESSAGE = '추첨 중 오류가 발생했습니다. 입력값을 확인한 뒤 다시 시도해 주세요.';
const DEFAULT_RETRY_MESSAGE = '일시적 오류로 재시도합니다.';
const DEFAULT_TERMINATION_REASON = '알 수 없음';

const ERROR_MESSAGE_RULES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['`--auth-token` is required.', 'auth_token을 입력해 주세요.'],
  ['`--ct0` is required.', 'ct0를 입력해 주세요.'],
  ['`--tweet-url` is required.', '트윗 링크를 입력해 주세요.'],
  ['`--tweet-url` must be a valid URL.', '트윗 링크 형식이 올바르지 않습니다.'],
  ['`--tweet-url` must point to x.com or twitter.com.', '트윗 링크는 x.com 또는 twitter.com 이어야 합니다.'],
  ['Could not find `/status/{tweetId}`', '트윗 링크에서 status ID를 찾지 못했습니다.'],
  ['Extracted tweetId is invalid', '트윗 링크의 status ID가 올바르지 않습니다.'],
  ['Could not infer tweet author', '트윗 작성자 정보를 링크에서 확인하지 못했습니다.'],
  ['At least one source must be selected.', '참여 소스를 1개 이상 선택해 주세요.'],
  ['winners must be a positive integer', '당첨 인원은 1 이상의 숫자여야 합니다.'],
  ['minFollowers must be a non-negative integer', '팔로워 최소값은 0 이상의 정수여야 합니다.'],
  ['Authentication failed', '인증에 실패했습니다. auth_token 또는 ct0가 유효한지 확인해 주세요.'],
  ['Rate limited', '요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.'],
  ['Request failed with status 404.', 'X API 경로를 찾지 못했습니다. operation id가 만료되었을 수 있습니다.'],
  ['Network error', '네트워크 오류가 발생했습니다. 인터넷 연결을 확인해 주세요.'],
  ['timed out', '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'],
  ['Server error', 'X 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'],
  ['GraphQL returned errors', 'X GraphQL 응답에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'],
  ['Not enough participants', '추첨 가능한 참여자가 부족합니다. 당첨 인원을 줄여 주세요.'],
  [
    'Missing required Twitter configuration',
    'Twitter 설정 env가 누락되었습니다. .env 파일에 TWITTER_BEARER, TWITTER_RETWEETERS_OP_ID, TWITTER_FAVORITERS_OP_ID, TWITTER_SEARCH_TIMELINE_OP_ID, TWITTER_TWEET_DETAIL_OP_ID를 설정해 주세요.',
  ],
  ['requestTimeoutMs must be a positive integer', '내부 요청 설정이 올바르지 않습니다.'],
]);

const RETRY_REASON_MESSAGES = Object.freeze({
  'rate-limit': '요청 제한으로 잠시 대기 후 재시도합니다.',
  timeout: '응답 지연으로 재시도합니다.',
  'request-timeout': '응답 지연으로 재시도합니다.',
  server: '서버 오류로 재시도합니다.',
  'graphql-error': '일시적 GraphQL 오류로 재시도합니다.',
  'invalid-json': '응답 파싱 실패로 재시도합니다.',
});

const TERMINATION_REASON_MESSAGES = Object.freeze({
  end_of_timeline: '목록 끝',
  max_pages: '최대 페이지 도달',
  cursor_cycle: '커서 순환 감지',
  repeated_page: '반복 페이지 감지',
  no_growth: '수집 증가 없음',
  invalid_or_empty_payload: '빈 응답 또는 스키마 불일치',
});

type RetryReason = keyof typeof RETRY_REASON_MESSAGES;
type TerminationReason = keyof typeof TERMINATION_REASON_MESSAGES;

function hasOwnKey<T extends object>(target: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function resolveMappedMessage<T extends Record<string, string>>(map: T, key: string, fallback: string): string {
  const mapped = hasOwnKey(map, key) ? map[key] : undefined;
  return mapped ?? fallback;
}

function toNotEnoughParticipantsMessage(rawMessage: unknown): string {
  const baseMessage = '추첨 가능한 참여자가 부족합니다. 당첨 인원을 줄여 주세요.';
  const matched = String(rawMessage || '').match(/requested=(\d+)\s*,\s*available=(\d+)/i);
  if (!matched) {
    return baseMessage;
  }

  const requested = Number(matched[1]);
  const available = Number(matched[2]);
  if (!Number.isFinite(requested) || !Number.isFinite(available)) {
    return baseMessage;
  }

  return `${baseMessage} (추첨 인원: ${requested}명 / 대상 인원: ${available}명)`;
}

function toKoreanMessage(error: unknown): string {
  const raw = error && typeof error === 'object' && 'message' in error ? String(error.message || '') : '';
  if (raw.includes('Not enough participants')) {
    return toNotEnoughParticipantsMessage(raw);
  }

  const matchedRule = ERROR_MESSAGE_RULES.find(([fragment]) => raw.includes(fragment));
  return matchedRule ? matchedRule[1] : DEFAULT_ERROR_MESSAGE;
}

function toRetryMessage(reason: string): string {
  return resolveMappedMessage(RETRY_REASON_MESSAGES, reason as RetryReason, DEFAULT_RETRY_MESSAGE);
}

function mapTerminationReason(reason: string): string {
  return resolveMappedMessage(TERMINATION_REASON_MESSAGES, reason as TerminationReason, DEFAULT_TERMINATION_REASON);
}

export {
  ERROR_MESSAGE_RULES,
  RETRY_REASON_MESSAGES,
  TERMINATION_REASON_MESSAGES,
  toKoreanMessage,
  toRetryMessage,
  mapTerminationReason,
};
