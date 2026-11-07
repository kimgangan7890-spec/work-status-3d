# GitHub 자동 연결 계약 v1.0.1 (M0)

공통 타입은 `index.js`의 JSDoc으로 import한다. `fixtures.js`는 S3 독립 개발용 가짜 지표다. React·TypeScript 변환이나 서버 import가 필요하지 않다. AuthService는 서버 내부에서만 구현하며 화면에 토큰을 반환하지 않는다. 이벤트는 어댑터가 정규화하고 Bus는 전달만 한다. 에이전트 어댑터는 status.json만 읽고 지시함은 읽지 않는다.

projectId는 기존 규칙을 유지한다. 신규 GitHub 연결은 `gh-${repoId.toString(36)}`, 기존 수동 프로젝트 연결은 기존 ID를 유지한다. 같은 repoId의 중복 연결은 거부한다. 저장소 이름·소유자가 바뀌어도 projectId는 다시 만들지 않는다.

activityRatio는 log1p(commits30d)/log1p(maxC), maxC가 0이면 모두 0. 층수는 S3가 12~22층 범위에 매핑한다. 서버는 원시 지표와 비율만 제공한다. budget 우선순위는 relay > activity_sync > discovery. 304는 기존 값을 유지한다. 예산 부족은 기존 값과 마지막 성공 시각을 보존하고 stale/budget으로 알린다.

연결 기능은 기존 DASH_PASSWORD 인증 안에 추가하며 기존 정적 실행·JSON 기능을 제거하지 않는다. WORK3D_SECRET_KEY는 토큰 저장 기능에만 필수다. M1은 PAT와 폴링, Device Flow/refresh는 M2, SSE는 M3, manifest/배포용 웹훅은 M4다.

## S0 정정 v1.0.1

기본 조회는 repo 정보·commits·pulls·Actions runs의 4개다. issues 목록은 M2로 미루며 M1은 GitHub 이벤트 없이 지표 스냅샷만 갱신한다. CI는 workflows 목록도 ETag로 조회하고 active인 항목만 집계한다. 최근 20개 실행에 없는 active workflow는 workflow별 최신 실행을 추가 조회한다. 그 결과는 workflows/runs의 ETag가 바뀔 때 재조회하며, 예산이 부족하면 기존 지표를 유지하고 stale이다.

PAT는 세션별로 격리한다. 캐시·진행 요청·프로젝트 선택 키는 (credentialId, repoId)이며 같은 저장소도 다른 세션의 결과를 재사용하지 않는다. credentialId는 연결마다 새로 만든다. 실제 호출 총예산은 같은 토큰이 여러 세션에서 쓰일 경우에도 공유한다. 종료·만료·연결 해제 시 폴링·캐시·암호화 토큰을 삭제한다. 서버 재시작은 기존 DASH 세션 종료이며 다시 연결해야 한다.

토큰 암호화는 32바이트 WORK3D_SECRET_KEY(base64 또는 64자 hex)로 AES-256-GCM을 사용한다. 키는 파일에 저장하지 않는다. 키가 없거나 유효하지 않으면 연결 기능만 비활성화한다. 암호문 파일은 data/ 아래 0600, 원자적 교체로 저장한다. 다른 키의 암호문이나 변조 파일을 자동 덮어쓰지 않는다.

ETag 키에는 요청 경로·분기·쿼리를 포함한다. commits30d의 since가 이동해 URL이 바뀌면 이전 URL의 검증자를 재사용하지 않는다. 기본 브랜치 변경 시 커밋/CI 캐시를 무효화한다. Link에 next만 있고 last가 없으면 본문 1개를 전체 개수로 오인하지 않고 기존 값을 유지한다. 워크플로 목록도 페이지 끝까지 확인하며 완료하지 못하면 ok로 표시하지 않는다.

## M1 HTTP 연결 (기존 DASH_PASSWORD 세션 필수)

- GET /api/github/connection → ConnectionInfo. 저장형 연결 기능 비활성화는 HTTP 503 + {code:"CONNECTION_DISABLED"}.
- POST /api/github/connect {token} → ConnectionInfo. 사용자 정보 확인 후 저장하며 실패 시 기존 연결을 유지한다.
- POST /api/github/disconnect → {ok:true}. 로컬 연결 삭제이며 GitHub PAT 자체 폐기는 아니다.
- GET /api/github/repos → {repos:RepoRef[]}.
- GET /api/github/projects → {projects:ProjectRef[]}.
- POST /api/github/projects {repoId,projectId?} → {project:ProjectRef}. 기존 수동 projectId는 서버의 프로젝트 목록에 있어야 한다.
- POST /api/github/projects/remove {projectId} → {ok:true}.
- GET /api/github/metrics → {metrics:ProjectMetrics[]}.
- POST /api/github/sync → {metrics:ProjectMetrics[]} (수동 재조회).

POST는 기존 Origin 검사와 JSON 제한을 따른다. 응답에는 토큰·암호문·credentialId·upstream 원문을 넣지 않는다. ConnectionInfo.scopesOk는 선택한 저장소들의 필요한 리소스 접근을 실제 확인했을 때 true다. 연결 직후에는 아직 확인 전이라 false일 수 있다. API 오류는 {code:string}이며 Retry-After(초)를 429에 제공한다. 서버가 마지막 정상 스냅샷을 유지하면 마지막 성공 시각도 유지한다.

S3는 이 API·JSDoc·가짜 지표만 참조하고 서버 모듈을 import하지 않는다. S1은 auth/서버 접점, S2는 github/동기화 접점, S3는 기존 화면을 소유한다. 기존 DESIGN8 검토안과 다를 때 이번 사용자 확정 계약을 우선한다.


## M2 S1: Device Flow와 갱신 (서버 확장, S0 검토용)

`GITHUB_APP_CLIENT_ID`는 운영자가 등록한 GitHub App의 client ID다. 코드에 넣지 않는다. App에서 Device Flow와 사용자 토큰 만료를 켜고 필요한 저장소 읽기 권한을 설정한다. Device Flow로 발급한 토큰은 공식 규약에 따라 client secret 없이 갱신한다. GitHub가 반환한 만료 시각(통상 8시간) 30초 전부터 필요 시 갱신하며 동시 요청은 하나로 합친다. 갱신 실패·사용자 불일치 시 연결을 `expired`로 종료하고 캐시·토큰을 삭제한다.

- POST `/api/github/device/start` `{}` → `{userCode,verificationUri,expiresIn,interval}`. 비공개 device code는 서버에만 둔다.
- POST `/api/github/device/poll` `{}` → 202 `{status:"pending",retryAfterSec}` 또는 200 `{status:"connected",connection:ConnectionInfo}`. 같은 세션의 흐름만 조회한다. Retry-After와 slow_down을 지키며 브라우저가 빨리 조회해도 GitHub를 재호출하지 않는다.
- 흐름의 거절·만료·새 PAT 연결·연결 해제·로그아웃은 흐름을 취소한다. 인증이 완료되기 전에는 기존 연결을 유지한다.
- 새 HTTP 경로는 S0 소유 `ghcontract.js`에 아직 추가하지 않았다. 화면이 사용할 상수 추가는 S0 검토 뒤 반영한다.

암호화 정책은 M1과 같이 유지한다. 활성 세션의 refresh token도 같은 0600 AES-GCM 파일에 넣고, 재시작 시 모두 폐기한다. 대시보드 세션이 재시작마다 무효가 되므로 refresh token만 재시작 너머로 복원하지 않는다. 기존 PAT 보호 정책과 키 필수 조건을 유지하기 위해 파일을 제거하는 단순화는 하지 않았다.

`POST /api/github/connect` 오류 코드: 400 `INVALID_TOKEN`·`BAD_JSON`, 401 `AUTH`·`UNAUTHENTICATED`, 403 `BAD_ORIGIN`, 409 `ABORTED`, 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, 429 `TOO_MANY`·`RATE_LIMITED`·`BUDGET`, 503 `CONNECTION_DISABLED`·`CONNECTION_STORAGE_ERROR`, 502 `UPSTREAM`(권한 부족·통신·예상 밖 응답 등)·`CONNECTION_STORAGE_ERROR`(저장 실패). 원문이나 토큰을 반환하지 않으며 검증 실패 시 기존 연결을 보존한다.

Device Flow 추가 오류: `DEVICE_FLOW_UNAVAILABLE`(App 미설정·비활성), `NO_DEVICE_FLOW`(진행 중 흐름 없음), `DEVICE_DENIED`, `DEVICE_EXPIRED`, `OAUTH_UPSTREAM`. 인증 코드는 시작 응답 외에는 기록하지 않는다. 실제 GitHub App 연동은 운영자의 client ID 설정 뒤 별도 검증한다. 가짜 OAuth 서버에는 `GITHUB_OAUTH_BASE`, 가짜 REST 서버에는 `GITHUB_API_BASE`를 쓴다.


## M2 S2: 이벤트와 sync 응답 (서버 확장, S0 검토용)

`POST /api/github/sync`는 기존 `metrics`와 함께 `scopesOk:boolean`을 반환한다. GET metrics의 모양은 유지한다. `GET /api/github/events?since=<ISO시각>`는 `{events:WorkEvent[]}`를 반환한다. since를 생략하면 세션의 최근 200개이고, 잘못된 시각은 400 `BAD_SINCE`다. 같은 밀리초의 이벤트를 놓치지 않게 since 경계를 포함하므로 소비자는 eventId로 합친다. 프로세스 내 Bus는 복사해서 전달만 하며 세션별 Journal이 보관과 최근 이력의 eventId 중복 제거를 맡는다.

첫 성공 조회는 이벤트 기준선이며 과거 이력을 재생하지 않는다. 이후 issues는 `state=all&since=<마지막 성공 시각-1초>`로 페이지 끝까지 읽고 `pull_request` 필드는 이슈 변환에서 제외한다. PR은 별도로 all·updated 내림차순 목록을 읽되 마지막 성공 시각보다 오래된 항목을 지나면 멈춘다. 두 조회의 페이지당 100개·최대 20페이지를 완주하지 못하면 기존 지표와 커서를 유지하고 stale이다. 커밋 이벤트는 최근 기본 브랜치 head SHA가 바뀌었을 때 새 SHA를 알린다. 전체 커밋 이력이나 폴링 사이의 모든 중간 전환을 복구하는 감사 로그는 아니다.

GitHub 이슈 열림·닫힘, PR 열림·닫힘·병합, 대표 CI 변화와 에이전트 상태 변화를 WorkEvent로 정규화한다. 알려진 항목의 다시 열림을 감지하며 댓글 수정은 열림으로 취급하지 않는다. 이벤트에는 식별 번호·SHA·상태만 넣고 제목·본문·메모를 복사하지 않는다. 이벤트 조회까지 성공해야 스냅샷과 이벤트 커서를 함께 확정한다. 예산 부족·실패 뒤에는 다음 성공 시 다시 시도한다.

기존 수동 사무동에 연결된 경우에만 해당 설정의 status.json을 읽는다. 로컬은 DATA_DIR/status.json, 원격은 그 프로젝트의 repo·branch·dir를 사용하며 연결된 세션의 PAT/Device 토큰과 전용 캐시로 읽는다. inbox.json은 읽거나 실행하지 않는다. status.json이 없거나 계약이 잘못됐으면 에이전트 어댑터를 건너뛴다. working/idle/blocked를 각각 agent_working/agent_idle/agent_needs_approval로 바꾸고, blocked에는 meta.reason="blocked"를 넣는다. 마지막 매핑은 실제 승인 요청과 일반 막힘을 화면에서 구분할 때 참고한다.

연결 해제·로그아웃·세션 만료·갱신 실패 시 지표·진행 요청·토큰과 이벤트 이력을 함께 없앤다. 프로젝트 제거 시 해당 프로젝트 이력도 제거한다. 이벤트 조회는 같은 DASH 세션에서만 가능하고 인증 ID를 입력으로 받지 않는다. S0 소유 ghcontract.js의 events/device 경로 상수 추가와 Device Flow 화면 연결은 별도 검토 항목이다. SSE는 M3이며 M2에는 포함하지 않는다.
