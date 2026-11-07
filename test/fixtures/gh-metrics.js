// S3(화면)가 S2 완성 전까지 쓰는 가짜 데이터. 계약 v1.0.2 모양 그대로. 실제 저장소 이름·계정 없음.
export const FAKE_CONNECTION = { connected: true, method: "pat", login: "octo-demo", scopesOk: true };
export const FAKE_DISCONNECTED = { connected: false, scopesOk: false };
export const FAKE_EXPIRED = { connected: false, method: "pat", scopesOk: false, error: "expired" };

// GET /api/github/repos 의 RepoRef 모양
export const FAKE_REPOS = [
  { repoId: 1001, fullName: "octo-demo/alpha", defaultBranch: "main", isPrivate: true },
  { repoId: 1002, fullName: "octo-demo/beta", defaultBranch: "main", isPrivate: false },
  { repoId: 1003, fullName: "octo-demo/gamma", defaultBranch: "dev", isPrivate: true },
];
// GET /api/github/projects 의 ProjectRef 모양(alpha만 이미 연결됨)
export const FAKE_PROJECTS = [{ projectId: "gh-rt", github: FAKE_REPOS[0] }];
// 연결 직후: 아직 지표 확인 전이라 scopesOk=false가 정상
export const FAKE_CONNECTED_UNVERIFIED = { connected: true, method: "pat", login: "octo-demo", scopesOk: false };

const sync = (status, extra = {}) => ({ mode: "polling", status, lastSuccessfulSyncAt: "2026-11-07T10:00:00Z", ...extra });

/** 상태별 대표 사례: 바쁨·조용함·CI 실패·오래됨·오류·커밋 0. */
export const FAKE_METRICS = [
  { projectId: "gh-rt", commits30d: 120, activityRatio: 1, openPRs: 4, openIssues: 7, ci: "passing", ciBranch: "main", sync: sync("ok") },
  { projectId: "gh-ru", commits30d: 9, activityRatio: Math.log1p(9) / Math.log1p(120), openPRs: 0, openIssues: 2, ci: "failing", ciBranch: "main", sync: sync("ok") },
  { projectId: "gh-rv", commits30d: 30, activityRatio: Math.log1p(30) / Math.log1p(120), openPRs: 1, openIssues: 0, ci: "running", ciBranch: "main", sync: sync("syncing") },
  { projectId: "gh-rw", commits30d: 2, activityRatio: Math.log1p(2) / Math.log1p(120), openPRs: 0, openIssues: 0, ci: "none", sync: sync("stale", { error: "budget" }) },
  { projectId: "gh-rx", commits30d: 0, activityRatio: 0, openPRs: 0, openIssues: 0, ci: "unknown", sync: { mode: "polling", status: "error", error: "auth" } },
];
