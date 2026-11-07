// GitHub 활동 동기화 — 화면 쪽 계약 상수 (DESIGN9.md, v1.0.2). S0 소유.
// 타입 정의의 기준은 contracts/index.js(서버·화면 공통 JSDoc). 계산 함수는 서버(src/server/activity.js)에만 둔다.
// 이 파일은 화면이 부르는 HTTP 경로와 상태 값만 담는다. 토큰은 여기에 없다.

export const GH_CONTRACT_VERSION = "1.1.0";
export const MAX_GH_PROJECTS = 12;
export const CI_STATES = Object.freeze(["passing", "failing", "pending", "running", "unknown", "none"]);
export const SYNC_STATES = Object.freeze(["ok", "syncing", "stale", "error"]);
export const CONN_ERRORS = Object.freeze(["expired", "revoked", "rate_limited"]);

/**
 * 서버 모드 전용(같은 출처, DASH_PASSWORD 세션 필요). POST는 기존 Origin 검사를 따른다.
 * 오류 응답은 {code}. 연결 기능이 꺼져 있으면 503 {code:"CONNECTION_DISABLED"}. 429는 Retry-After(초).
 */
export const GH_API = Object.freeze({
  connection: "/api/github/connection",          // GET → ConnectionInfo
  connect: "/api/github/connect",                // POST {token} → ConnectionInfo (실패해도 기존 연결 유지)
  disconnect: "/api/github/disconnect",          // POST → {ok:true}
  repos: "/api/github/repos",                    // GET → {repos: RepoRef[]}
  projects: "/api/github/projects",              // GET → {projects: ProjectRef[]} · POST {repoId, projectId?} → {project}
  removeProject: "/api/github/projects/remove",  // POST {projectId} → {ok:true}
  metrics: "/api/github/metrics",                // GET → {metrics: ProjectMetrics[]}
  sync: "/api/github/sync",                      // POST → {metrics, scopesOk} (선택 직후 바로 조회)
  deviceStart: "/api/github/device/start",       // POST {} → {userCode, verificationUri, expiresIn, interval} (device code는 서버에만)
  devicePoll: "/api/github/device/poll",         // POST {} → 202 {status:"pending", retryAfterSec} | 200 {status:"connected", connection}
  events: "/api/github/events",                  // GET ?since=<ISO> → {events: WorkEvent[]} (세션별 최근 200, since 경계 포함 → eventId로 합칠 것)
});
// /api/projects(수동 사무동 목록)는 저장소 주소를 의도적으로 싣지 않는다(test/projects.test.js). 화면은 저장소↔사무동 자동 짝짓기를 하지 않는다.
// WorkEvent kind "agent_needs_approval"은 status.json의 blocked에서도 온다(meta.reason="blocked"). 화면은 "막힘"으로 표시하고 승인 요청으로 단정하지 않는다.

/** 신규 GitHub 연결 사무동 id 규칙(서버 activity.js와 같음). 화면에서 미리 표시할 때만 쓴다. */
export const projectIdFromRepoId = (repoId) => `gh-${repoId.toString(36)}`;
