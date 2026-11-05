# DATA.md — status.json / board.json 형식

3D 사무실 작업현황 화면이 읽는 정적 파일 두 개의 형식 문서다.
## 1. 합의 요약
- 이 장(1~8장)은 데이터 파일 형식이다. 화면은 정적 파일 `status.json`과 `board.json`을 몇 초마다 읽는다. 공개판은 서버 없는 정적 파일만 쓴다. 로그인과 작업 지시를 위한 서버(`server.js`)는 서버 모드에서만 쓰고, 그 계약은 9장에 있다.
- `status.json`: meta, agents, tasks, events만 둔다. 자주 바뀐다.
- `board.json`: MVP 요약(mvp[])과 구역별 담당표(zones[]). 갱신 주기가 달라(드물게 바뀜) 별도 파일로 분리했다.
- 갱신은 `update.js`가 한다.
  - `node update.js event --from gpt --to claude --title '…'`
  - `node update.js progress W1 60`
  - `node update.js state gpt working '…'`
- 같은 내용을 `events.jsonl`에 한 줄씩 남긴다(전체 기록). `status.json`에는 최근 30개만 둔다. 쓰기는 임시 파일 후 이름 변경(원자적)이다.
- 저장 금지: 대화 원문, 토큰, 키, 이메일, 주소. 제목과 한 줄 요약(최대 80자)만 저장한다.
- 코드 작성: 각자 자기 코드를 직접 작성하고 상대가 교차 검증한다.

## 2. status.json 구조

### meta
| 필드 | 형식 | 설명 |
|---|---|---|
| project | 문자열 | 프로젝트 이름 |
| updatedAt | ISO8601 KST | 예: `2026-11-05T14:30:00+09:00` |
| schemaVersion | 정수 | 현재 1 |

### agents[]
| 필드 | 형식 | 설명 |
|---|---|---|
| id | `chief`\|`claude`\|`gpt` | 에이전트 ID (책상 3개) |
| name | 문자열 | 표시 이름 |
| role | 문자열 | 역할 |
| status | `working`\|`idle`\|`blocked` | 상태 (idle = 대기) |
| currentTaskId | 문자열\|null | 진행 중인 작업 ID |
| note | 문자열(≤80자) | 한 줄 메모 |
| model | 문자열(선택) | 모델 이름 |

사용자 자리(`desks`)는 이번 MVP에서 뺐다. 나중에 추가할 수 있게 비워 둔 확장 자리일 뿐, 지금은 파일에 넣지 않는다.

### tasks[]
| 필드 | 형식 | 설명 |
|---|---|---|
| id | 문자열 | 샘플 프로젝트 `T1`~`T8`, 작업현황 자체 작업 `W1`~ |
| title | 문자열(≤80자) | 작업 제목 |
| ownerAgentId | 문자열 | agents의 id |
| zone | 문자열 | board.json zones의 id |
| progress | 정수 0~100 | 진행률 |
| state | `todo`\|`doing`\|`done`\|`blocked` | 작업 상태 |
| updatedAt | ISO8601 KST | 마지막 갱신 |

### events[]
| 필드 | 형식 | 설명 |
|---|---|---|
| id | 정수 | 증가하는 번호 |
| at | ISO8601 KST | 발생 시각 |
| from, to | 문자열 | agents id 또는 `board` |
| title | 문자열(≤80자) | 제목 |
| summary | 문자열(≤80자) | 한 줄 요약 |
| taskId | 문자열\|null | 관련 작업 |
| kind | `doc`\|`ask`\|`reply`\|`report` | 종류 |

### status.json 검증 규칙
1. 최상위 키 `meta, agents, tasks, events`는 모두 필수다. 다른 키(`board` 등)는 두지 않는다.
2. 필수 필드(`model`만 선택)와 enum 허용값을 지킨다. `progress`는 0~100 정수, `note`·`title`·`summary`는 80자 이하다.
3. `events[].id`는 단조 증가·중복 없음, 최대 30개(오래된 것부터 버림).
4. `tasks[].id`는 중복이 없고, `ownerAgentId`는 `agents`에 있는 id여야 한다.
5. `agents[].currentTaskId`와 `events[].taskId`는 null이거나 `tasks`에 있어야 한다.
6. `state`가 `done`이면 `progress`는 100이다.
7. 검증에 실패하면 `update.js`는 파일을 바꾸지 않고 오류로 끝낸다.

## 3. board.json 스키마
| 필드 | 형식 | 설명 |
|---|---|---|
| mvp[] | `{ id, title, status }` | MVP 요약. status는 `in`\|`out`\|`pending` |
| zones[] | `{ id, name, ownerAgentId, taskIds[] }` | 구역별 담당표 |

### board.json 검증 규칙
1. 최상위 키 `mvp, zones`는 필수 배열이다.
2. `mvp[].id`, `zones[].id`는 각각 중복이 없고, `status`는 허용값만 쓴다.
3. `zones[].ownerAgentId`는 `chief|claude|gpt` 중 하나다.
4. 교차 확인(경고만, 거부 아님): `taskIds`와 `tasks[].zone`이 서로 맞는지 `update.js`가 확인해 경고한다.
5. 검증 실패 시 파일을 바꾸지 않는다.

## 4. 예시
`T3`~`T8`의 제목은 임시이며 실제 0단계 목록과 다르면 고친다.
### status.json
```json
{
  "meta": { "project": "샘플 프로젝트 · 작업현황", "updatedAt": "2026-11-05T14:30:00+09:00", "schemaVersion": 1 },
  "agents": [
    { "id": "chief", "name": "총괄", "role": "조율·결정", "status": "working", "currentTaskId": "T2", "note": "MVP 범위 확정 중", "model": "예시 모델 A" },
    { "id": "claude", "name": "Claude", "role": "설계·문서·패널", "status": "working", "currentTaskId": "W4", "note": "DATA.md 수정 중", "model": "예시 모델 B" },
    { "id": "gpt", "name": "GPT", "role": "구현·3D 장면", "status": "working", "currentTaskId": "W1", "note": "update.js 작성 중" }
  ],
  "tasks": [
    { "id": "T1", "title": "0단계 범위 문서", "ownerAgentId": "claude", "zone": "z-plan", "progress": 100, "state": "done", "updatedAt": "2026-11-05T11:00:00+09:00" },
    { "id": "T2", "title": "MVP 범위 확정", "ownerAgentId": "chief", "zone": "z-plan", "progress": 50, "state": "doing", "updatedAt": "2026-11-05T14:00:00+09:00" },
    { "id": "T3", "title": "사용자 시나리오", "ownerAgentId": "claude", "zone": "z-plan", "progress": 100, "state": "done", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "T4", "title": "화면 흐름 초안", "ownerAgentId": "claude", "zone": "z-plan", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "T5", "title": "데이터 모델 초안", "ownerAgentId": "gpt", "zone": "z-build", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "T6", "title": "기술 스택 비교", "ownerAgentId": "gpt", "zone": "z-build", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "T7", "title": "개발 환경 점검", "ownerAgentId": "gpt", "zone": "z-build", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "T8", "title": "0단계 최종 점검", "ownerAgentId": "chief", "zone": "z-plan", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T12:00:00+09:00" },
    { "id": "W1", "title": "update.js 작성", "ownerAgentId": "gpt", "zone": "z-scene", "progress": 60, "state": "doing", "updatedAt": "2026-11-05T14:29:00+09:00" },
    { "id": "W2", "title": "3D 장면·파일 로더", "ownerAgentId": "gpt", "zone": "z-scene", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T13:00:00+09:00" },
    { "id": "W3", "title": "메인보드·게시판·로그 패널", "ownerAgentId": "claude", "zone": "z-panel", "progress": 0, "state": "todo", "updatedAt": "2026-11-05T13:00:00+09:00" },
    { "id": "W4", "title": "DATA.md 형식 문서", "ownerAgentId": "claude", "zone": "z-panel", "progress": 80, "state": "doing", "updatedAt": "2026-11-05T14:25:00+09:00" }
  ],
  "events": [
    { "id": 11, "at": "2026-11-05T14:10:00+09:00", "from": "claude", "to": "gpt", "title": "DATA.md 초안 전달", "summary": "status.json 형식 공유", "taskId": "W4", "kind": "doc" },
    { "id": 12, "at": "2026-11-05T14:20:00+09:00", "from": "gpt", "to": "claude", "title": "update.js 명령 확인", "summary": "event·progress·state 3종 확정 요청", "taskId": "W1", "kind": "ask" },
    { "id": 13, "at": "2026-11-05T14:29:00+09:00", "from": "gpt", "to": "board", "title": "W1 진행률 60%", "summary": "원자적 쓰기까지 구현", "taskId": "W1", "kind": "report" }
  ]
}
```

### board.json
```json
{
  "mvp": [
    { "id": "M1", "title": "일정 등록", "status": "in" },
    { "id": "M2", "title": "알림", "status": "pending" },
    { "id": "M3", "title": "공유 캘린더", "status": "out" }
  ],
  "zones": [
    { "id": "z-plan", "name": "샘플 프로젝트 기획", "ownerAgentId": "claude", "taskIds": ["T1", "T2", "T3", "T4", "T8"] },
    { "id": "z-build", "name": "샘플 프로젝트 구현 준비", "ownerAgentId": "gpt", "taskIds": ["T5", "T6", "T7"] },
    { "id": "z-scene", "name": "3D 장면", "ownerAgentId": "gpt", "taskIds": ["W1", "W2"] },
    { "id": "z-panel", "name": "패널·문서", "ownerAgentId": "claude", "taskIds": ["W3", "W4"] }
  ]
}
```

## 5. 폴더 분담
- `src/scene/`: 3D 장면, `status.json`·`board.json` 읽기(로더), `update.js`.
- `src/panels/`: 메인보드·게시판·이벤트 로그 HTML 패널.
- 두 쪽은 서로의 폴더 파일을 수정하지 않는다. 같은 파일을 건드리지 않는다.

## 6. 패널 입력 규칙
- 패널이 받는 입력은 파싱·검증된 `status` 객체와 `board` 객체다.
- 패널은 `fetch`하지 않는다. 파일 읽기는 scene 쪽 로더가 하고, 결과를 패널에 props 또는 콜백으로 넘긴다.

## 7. 화면 쪽 규칙
- 3초마다 `status.json`을, 30초마다 `board.json`을 다시 읽는다.
- 파일이 없거나 깨졌거나 검증에 실패하면 직전 상태를 유지한다.
- 이전에 본 마지막 id보다 큰 이벤트만 서류 애니메이션으로 재생한다. 첫 로드의 기존 이벤트는 재생하지 않는다.
- `progress`는 값이 바뀌면 애니메이션으로 채운다.

## 8. 장면 구성안
- 기본 데이터는 에이전트 3명(책상 3개)이고, 에이전트를 추가하면 책상도 늘어난다. 메인보드(작업·구역 진행률)는 가운데/벽면, 게시판(`board.mvp`)은 옆 벽.
- 서류는 작은 평면 도형이다. 이벤트의 `from` 책상에서 `to` 책상 또는 보드로 이동한다. `kind`는 색이나 모양으로 구분한다.
- 책상 램프 색은 상태별: working 초록, idle 회색, blocked 빨강.

## 9. 작업 지시(commands) 형식
서버 `server.js`가 제공하는 API와 화면 `src/panels`의 계약이다.
### 9.1 인증
- `POST /api/login` 본문 `{"password":"…"}`
  - 200 `{"ok":true}` + 서명된 HttpOnly 쿠키
  - 401 `{"code":"BAD_PASSWORD"}`
  - 429 `{"code":"TOO_MANY","retryAfterSec":60}`
- `GET /api/session` → 200 `{"ok":true}` 또는 401.
- 암호는 환경변수에서만 읽는다. 코드·로그·파일·채팅·화면에 남기지 않는다.
- 화면은 암호를 저장하지 않는다. 메모리에서 바로 전송하고 입력값을 비운다.

### 9.2 POST /api/command
- 본문: `{"kind":"solo","to":"chief","text":"…"}` 또는 `{"kind":"team","to":"team","text":"…"}`
  - 개인 작업 지시: `kind:"solo"`, `to`는 `chief`|`claude`|`gpt` 중 한 명.
  - 공동 작업 지시: `kind:"team"`, `to`는 `"team"`(세 에이전트 모두에게 가는 지시).
  - `kind`를 생략하면 `solo`로 읽는다. `solo`인데 `to:"team"`이거나 `team`인데 `to`가 `"team"`이 아니면 400이다.
- 성공: 201 `{"command":{…}}`
- 오류는 `{"code":"…"}`:

| code | HTTP | 뜻 |
|---|---|---|
| UNAUTHENTICATED | 401 | 로그인 필요 |
| INVALID_KIND | 400 | `kind`가 `solo`·`team`이 아님 |
| INVALID_TO | 400 | 받는 사람이 허용값이 아니거나 `kind`와 `to` 조합이 틀림 |
| EMPTY_TEXT | 400 | 내용 없음 |
| TEXT_TOO_LONG | 400 | 300자 초과 |
| SECRET_LIKE | 400 | 키·토큰·이메일 모양 |
| TOO_MANY | 429 | 너무 자주 보냄 |

### 9.3 GET /api/commands와 command 객체
- 200 `{"commands":[…]}` 최근 50개, 최신순.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | 정수 | 증가 번호 |
| at | 문자열 | KST ISO8601 (`+09:00`) |
| kind | 문자열 | `solo`\|`team`. 없는 옛 기록은 `solo`로 읽는다 |
| to | 문자열 | `solo`면 `chief`\|`claude`\|`gpt`, `team`이면 `team` |
| text | 문자열(≤300자) | 지시 원문 |
| state | 문자열 | `pending`\|`delivered`\|`done` |
| needsApproval | 불리언 | 삭제·배포·결제·외부 발송 단어가 있으면 true |
| deliveredAt | 문자열\|null | 전달 시각 |
| doneAt | 문자열\|null | 완료 시각 |
| note | 문자열(≤80자, 선택) | 지시를 처리한 쪽이 남기는 메모 |

```json
{
  "id": 7,
  "at": "2026-11-05T14:03:00+09:00",
  "kind": "solo",
  "to": "claude",
  "text": "게시판 문구를 더 짧게 다듬어 줘",
  "state": "delivered",
  "needsApproval": false,
  "deliveredAt": "2026-11-05T14:06:00+09:00",
  "doneAt": null,
  "note": "Claude에게 전달함"
}
```
- 공동 작업 지시 예: `{"id":8,"kind":"team","to":"team","text":"오늘 안에 공개판 점검을 끝내 줘",…}`. 공동 지시는 그 팀(또는 모두)이 함께 보는 곳에 올리고, 개인 지시는 해당 에이전트에게 보낸다. 상태·파일·300자 제한·승인 필요 단어 규칙은 두 종류가 같다.
- 상태 전이는 `pending→delivered→done`만 허용한다. 되돌리기는 없다.
- 저장은 `inbox.json`(배열, 최신 200개 상한)이다. 서버만 쓰고(임시 파일 후 이름 변경), 화면은 읽기만 한다. 전이는 같은 id의 `state`를 바꿔 다시 저장한다. `read` 상태는 쓰지 않는다. 화면 표기: pending=대기, delivered=전달됨, done=처리됨.
- 지시 원문 외에 암호·쿠키는 절대 저장하지 않는다.
### 9.4 상태 변경 명령 (운영자용)
- `node update.js command-state <id> delivered|done [--note '…']`
- `update.js`가 처리한다. 서버가 꺼져 있어도 `inbox.json`을 직접 갱신한다.
### 9.5 화면 규칙
- 로그인 전에는 3D와 패널 대신 로그인 폼만 보인다.
- 정적 dev 모드에서 `/api/session`이 404면 지시 패널을 숨기고 MVP 패널은 그대로 둔다.
- 지시 패널: 종류 선택 버튼 2개(개인·공동), 받는 사람 버튼(에이전트마다 하나, 팀이 2개 이상이면 팀 전체 버튼도), 입력창(300자 카운터), 전송, 지시 목록(종류, 받는 사람, 시각, 상태 칩 대기/전달됨/처리됨, 승인 필요 표시).
  - 기본 선택은 개인이다. 공동을 고르면 받는 사람 버튼이 사라지고 "모두에게"가 표시된다. 다시 개인을 고르면 직전에 고른 받는 사람이 돌아온다.
  - 목록 카드에는 "개인 · 받는 사람 이름" 또는 "공동 · 모두에게"를 표시한다.
- 안내문: '실시간이 아니라 전달에 몇 분 걸릴 수 있어요', '암호·토큰·키는 입력하지 마세요'.
- `needsApproval` 지시에는 '삭제·배포·결제는 사용자 확인 후에만 실행돼요'를 표시한다.
- `/api/commands`는 5초마다 폴링한다. 모든 텍스트는 `textContent`로만 넣는다.

### 9.6 서버 노출
- 서버는 `127.0.0.1`만 연다. 외부에 열고 싶다면 직접 정하세요(터널·리버스 프록시 등). 이 코드에는 터널 코드를 넣지 않는다.

### 9.7 보안 규칙
- 모든 POST는 `Origin`과 `Host`가 같은 출처인지 검사한다. 정적 파일과 API는 같은 서버가 내보내므로 CORS는 쓰지 않는다. 로그인 후 서명 쿠키 필수, 분당 횟수 제한(TOO_MANY), 본문 300자, `update.js`의 키·토큰·이메일 거부 규칙 재사용.
- inbox 글은 사용자 지시로만 전달하고 명령으로 실행하지 않는다. 삭제·배포·결제는 사용자 확인 후에만 한다.
- 화면 위치: 입력은 화면 아래 가운데 한 줄 바(받는 사람 선택, 입력, 남은 글자 수, 전송), 지시 목록(대기 카드)은 게시판 패널 안. 모바일(600px 이하)은 '지시' 탭 시트 안에 같은 내용을 둔다.

## 10. 팀과 에이전트 늘리기 (선택 필드, 설계: DESIGN4.md)
아래는 모두 **선택**이다. 없으면 1~9장 그대로 동작하고 화면도 지금과 같다.

### 10.1 status.json
| 위치 | 형식 | 설명 |
|---|---|---|
| 최상위 `teams[]` | `{ id, name, order? }` | 팀 목록. `name` 20자 이하, `order`는 정수(없으면 배열 순서). 선택 키이며 이 키를 두어도 1장의 "최상위 필수 키 4개" 규칙은 같다. |
| `agents[].teamId` | 문자열 | 속한 팀 id. 없으면 기본 팀 `main`. `teams`가 있으면 목록에 있는 id여야 한다. |
| `agents[].id` | 정규식 `^[a-z][a-z0-9_-]{0,23}$` | 고정 3개(`chief`/`claude`/`gpt`) 대신 이 형식이면 허용. 전체에서 유일. |
- 팀 `id`도 같은 정규식이다. 한도: 팀 8개, 팀당 에이전트 8명, 전체 24명. 어기면 `update.js`는 파일을 바꾸지 않고 오류로 끝낸다.
- `teams`가 없거나 팀이 1개면 탭을 그리지 않는다(지금 화면 그대로).

### 10.2 board.json
- `zones[].teamId`: 선택. `zones[].ownerAgentId`는 위 `agents[].id` 정규식만 검사한다.

### 10.3 지시(commands)
- `kind:"solo"`: `to`는 에이전트 id.
- `kind:"team"`: `to`는 `"team"`(전체, 기존과 같음) 또는 `"team:<팀id>"`(그 팀 전체).
- 서버가 `team:<id>`를 어느 에이전트·방에 전달할지는 서버 쪽 일이며 이 계약에 없다. 저장 형식(9.3)은 그대로이고 `to` 문자열만 늘었다.

### 10.4 화면 규칙 요약
- 장면: 선택된 팀만 보인다. 4명까지 한 줄, 5~8명은 두 줄. `window.__office.setTeam(id)`로 바꾼다.
- 팀 탭: 팀이 2개 이상일 때만. 점 색은 막힘 > 일하는 중 > 대기. 선택은 `localStorage`(`office.team`)에 기억하고 바뀌면 `window`에 `team:change`(`detail.teamId`)를 보낸다.
- 보드: 팀 묶음(머리글 `이름 · N명 · 일하는 중 a / 막힘 b`), 선택한 팀만 펼침. 다른 팀과 오간 로그에는 팀 이름을 붙인다.
- 색: `src/shared/colors.js`의 `agentColors(status)`가 장면과 보드에 같은 값을 준다. 고정 3명은 지금 색 그대로.
- 층 전체/방 화면: 팀이 2개 이상이면 첫 화면은 층 전체(방마다 이름표), 이름표나 방을 누르면 그 팀 방으로 확대된다. 되돌아가기는 「← 층 전체」 버튼 또는 `Esc`. 팀이 0~1개면 층 전체 화면이 없고 지금 화면 그대로다. 화면 상태가 바뀌면 `window`에 `view:change`(`detail.mode`는 `floor`|`room`, `detail.teamId`)를 보낸다.
- 방 안 보드: 맨 위에 팀 머리글 카드(이름·인원·일하는 중/막힘)와 「팀 공동 지시」(`team:<id>`), 에이전트 카드마다 「지시」 버튼. 버튼은 입력창을 미리 맞출 뿐 보내는 형식은 9장 그대로이고, 로그인 전·공개판에서는 보이지 않는다.
- 빈 방: `teams[]`에 있는 팀은 에이전트가 0명이어도 "빈 방"으로 나온다(새 팀을 만든 직후 바로 볼 수 있게). 예외는 기본 팀 `main`뿐이고, 비어 있으면 숨긴다. 방 수는 팀 수 한도(8)에 포함된다.
- 이 화면 규칙은 새 데이터 필드를 만들지 않는다. 기존 `teams[]`, `agents[].teamId`와 한도(팀 8·팀당 8명·전체 24)만 쓴다.
