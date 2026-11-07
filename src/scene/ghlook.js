// GitHub 지표 → 사무동 외관 (DESIGN9 §6). 순수 함수, DOM·three 의존 없음.
export const FLOORS_MIN = 12; // DESIGN7 부록 B: 최고 동 12~22층
export const FLOORS_MAX = 22;
const LIT_HALF = 8; // 열린 PR+이슈가 8개일 때 불빛 비율 0.5

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * @param {import("../shared/ghcontract.js").ProjectMetrics} m
 * @returns {{floors:number, litRatio:number, roof:"alert"|"busy"|"normal", dim:boolean}}
 */
export function toBuildingLook(m) {
  const x = m ?? {};
  const floors = Math.round(FLOORS_MIN + clamp01(x.activityRatio) * (FLOORS_MAX - FLOORS_MIN));
  // 포화형 n/(n+8): 0에서 시작해 1에 수렴하므로 상한(1)이 있고, 적은 수에서도 변화가 보인다.
  const raw = (Number.isFinite(x.openPRs) ? Math.max(0, x.openPRs) : 0) + (Number.isFinite(x.openIssues) ? Math.max(0, x.openIssues) : 0);
  const litRatio = raw / (raw + LIT_HALF);
  const roof = x.ci === "failing" ? "alert" : x.ci === "running" || x.ci === "pending" ? "busy" : "normal";
  const st = x.sync?.status;
  const dim = st === "stale" || st === "error";
  return { floors, litRatio, roof, dim };
}
