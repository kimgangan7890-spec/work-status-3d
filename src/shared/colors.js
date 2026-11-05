// 에이전트 색(DESIGN4.md §5). 장면 옷색과 보드 색 막대가 같은 함수를 쓴다.
import { teamsOf } from "./teams.js";

export const FIXED_COLOR = { chief: "#2E3A59", claude: "#3E5A45", gpt: "#9CC3E6" }; // DESIGN3.md §5, 바꾸지 않는다
export const COLOR_FALLBACK = "#8a90a0"; // 팀 정보가 없을 때 모르는 에이전트
const TEAM_HUE = [18, 275, 45, 340, 170, 100, 225, 0]; // 팀 순서별 색상(도)

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** status → Map(에이전트 id → "#RRGGBB"). 고정 3명은 그대로, 나머지는 팀 순서 팔레트 + 팀 안 순번으로 명도만 다르게. */
export function agentColors(status) {
  const out = new Map();
  const grouped = Array.isArray(status?.teams) && status.teams.length > 0;
  const teams = teamsOf(status);
  teams.forEach((t, ti) => {
    t.agentIds.forEach((id, ai) => {
      if (FIXED_COLOR[id]) out.set(id, FIXED_COLOR[id]);
      else out.set(id, grouped ? hsl(TEAM_HUE[ti % TEAM_HUE.length], 38, 36 + (ai % 4) * 7) : COLOR_FALLBACK);
    });
  });
  return out;
}

export function agentColor(status, id) {
  return agentColors(status).get(id) ?? FIXED_COLOR[id] ?? COLOR_FALLBACK;
}
