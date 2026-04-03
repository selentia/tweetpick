# TweetPick (트윗픽)

![Verify](https://img.shields.io/badge/verify-pass-brightgreen)
![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/selentia/tweetpick/main/badges/coverage.json)
![Coverage Threshold](https://img.shields.io/badge/threshold-S%2FL%2FF%2085%25%20%7C%20B%2070%25-blue)

## 소개

TweetPick은 X(구 트위터) 게시물 참여자 중에서 무작위로 당첨자를 뽑는 프로그램입니다.

다음 참여 유형을 지원합니다.

- 리트윗
- 답글
- 인용 트윗

인증된 세션으로 참여자를 수집한 뒤, 지정한 필터 조건에 따라 로컬에서 당첨자를 추첨합니다.

## 지원 환경

- 공식 지원: Windows 10/11 (x64)
- macOS 릴리스 산출물 제공: `macos-14` 러너 기준 단일 아키텍처
- 배포 형식:
  - Windows: portable `.exe`
  - macOS: `.zip` (압축 해제 후 `.app` 실행)
- Linux는 공식 지원하지 않습니다.

## 주요 기능

- 한 화면에서 설정, 실행, 결과 확인까지 가능
- 참여 소스 선택
  - 리트윗
  - 답글
  - 인용 트윗
- 필터 옵션
  - 소스별 교집합/합집합
  - 최소 팔로워 수
  - 키워드 포함
- 결과 출력
  - 당첨자 목록 텍스트 복사
  - 결과 이미지 저장
  - 진행 로그 및 소스별 통계 표시

## 빠른 시작

1. 최신 릴리스를 다운로드합니다.
2. OS에 맞는 릴리스 자산을 실행합니다.
   - Windows: `TweetPick.exe`
   - macOS: `TweetPick.zip` 압축 해제 후 `TweetPick.app`
3. X에 로그인된 상태에서 `auth_token`, `ct0` 값을 준비합니다.
4. 트윗 URL과 추첨 조건을 입력합니다.
5. 추첨을 실행한 뒤 결과를 복사하거나 저장합니다.

## 보안 안내

- 릴리스는 GitHub Actions로 빌드되며 GitHub Releases에 배포됩니다.
- 인증 정보(`auth_token`, `ct0`, bearer token)는 로컬 입력값 또는 로컬 환경 변수로만 사용됩니다.
- 추첨 자체는 로컬에서 수행되지만, 참여자 수집을 위한 요청은 X 엔드포인트로 전송됩니다.
- 쿠키 값과 `.env` 파일은 절대 다른 사람과 공유하지 마세요.
- 릴리스 자산에는 무결성 확인용 `.sha256` 파일이 함께 포함됩니다.
- macOS 빌드는 서명/notarization 미적용 상태이므로 첫 실행 시 Gatekeeper 경고가 나타날 수 있으며, 사용자 수동 허용이 필요할 수 있습니다.

SHA256 확인 예시:

```powershell
certutil -hashfile "TweetPick.exe" SHA256
```

```bash
shasum -a 256 "TweetPick.zip"
```

## 소스에서 빌드하기

요구 사항:

- Node.js `>=22.13 <23`
- npm
- Windows 10/11 (x64) 또는 macOS

환경 변수(`.env`):

- 필수
  - `TWITTER_BEARER`
  - `TWITTER_RETWEETERS_OP_ID`
  - `TWITTER_FAVORITERS_OP_ID`
  - `TWITTER_SEARCH_TIMELINE_OP_ID`
  - `TWITTER_TWEET_DETAIL_OP_ID`
- 선택
  - `TWITTER_RETWEETERS_FEATURES_JSON`
  - `TWITTER_TWEET_DETAIL_FIELD_TOGGLES_JSON`

명령어:

```bash
npm install
npm run verify
npm run build
```

Windows 패키지:

```bash
npm run dist:win
```

macOS 패키지:

```bash
npm run dist:mac
```

## 스크립트

- `npm run dev`: 빌드 후 앱 실행
- `npm run clean`: `dist`, `release`, `coverage` 정리
- `npm run build`: 타입 체크 + 컴파일 + 렌더러 자산 복사
- `npm run dist:win`: Windows portable 패키지 빌드
- `npm run dist:mac`: macOS `.zip`(내부 `.app`) 패키지 빌드
- `npm run dist`: `npm run dist:win` alias (하위 호환)
- `npm run format`: Prettier 포맷 적용
- `npm run lint`: 정적 분석
- `npm run typecheck`: TypeScript 검사
- `npm run test`: Vitest watch 모드
- `npm run test:run`: 테스트 1회 실행
- `npm run test:coverage`: 커버리지 및 임계치 검사
- `npm run verify`: lint + typecheck + sync 검사 + coverage 게이트

## CI/CD

GitHub Actions 워크플로:

- Actions env/secrets 필수 키:
  - `TWITTER_BEARER`
  - `TWITTER_RETWEETERS_OP_ID`
  - `TWITTER_FAVORITERS_OP_ID`
  - `TWITTER_SEARCH_TIMELINE_OP_ID`
  - `TWITTER_TWEET_DETAIL_OP_ID`

- `CI (Verify + Build)` (`.github/workflows/ci.yml`)
  - 트리거: `main` 브랜치 push, `main` 대상 PR, `v*` 태그 push
  - 실행 순서: `npm ci` -> `npm run verify` -> `npm run build`
- `Build & Release (Windows + macOS)` (`.github/workflows/release.yml`)
  - 트리거: `v*` 태그 push, 수동 실행
  - 실행 순서:
    - Windows: `npm ci` -> `npm run verify` -> `npm run dist:win`
    - macOS: `npm ci` -> `npm run verify` -> `npm run dist:mac`
  - 결과물: `release/*.exe`, `release/*.zip`, `release/*.sha256` 업로드 및 GitHub Release 게시

## 패키징 참고

- 배포 대상: Windows portable executable, macOS zip (`.app` 포함)
- 빌드 리소스 디렉터리: `build/`
- Windows 아이콘: `build/icon.ico`
- `scripts/run-dist.mjs`는 Windows(`npm run dist:win`) 패키징 전에 아이콘 파일 존재 여부를 확인합니다.
- macOS 패키징은 `npm run dist:mac`에서 `electron-builder --mac zip`으로 생성합니다.
- 소스맵(`*.map`)은 패키지 결과물에 포함되지 않습니다.

## 라이선스

- 앱 라이선스: Apache-2.0 (LICENSE, NOTICE 참고)
