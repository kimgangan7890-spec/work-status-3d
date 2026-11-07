// 에이전트 색(DESIGN4.md §5). 장면 옷색과 보드 색 막대가 같은 함수를 쓴다.
import { teamsOf } from "./teams.js";

// 공개 빌드(__PUBLIC__)에서는 처음 세 명의 고정 id를 번들에 남기지 않는다(공개 샘플은 lead/designer/developer라 쓰지 않는다).
// node 스크립트처럼 __PUBLIC__가 정의되지 않은 곳에서는 비공개판과 같게 동작한다.
const PUBLIC_BUILD = typeof __PUBLIC__ !== "undefined" && __PUBLIC__;
export const FIXED_COLOR = PUBLIC_BUILD ? {} : { chief: "#2E3A59", claude: "#3E5A45", gpt: "#9CC3E6" }; // DESIGN3.md §5, 바꾸지 않는다
// 머리 모양 종류. 고정 3명은 자기 모양(part=옆가르마, tall=높은 머리, crop=짧은 머리), 나머지는 책상 순번대로 돌린다.
export const FIXED_HAIR = PUBLIC_BUILD ? {} : { chief: "part", claude: "tall", gpt: "crop" };
const ROTATE_HAIR = ["alt1", "alt2", "other"];
/** 에이전트 id·책상 순번 → 머리 모양 종류. 종류 이름은 에이전트 id와 무관하다. */
export function hairKindFor(id, index) {
  return Object.hasOwn(FIXED_HAIR, id) ? FIXED_HAIR[id] : ROTATE_HAIR[(((index | 0) % 3) + 3) % 3];
}
/** 머리 모양 종류 → 머리 덮개 세로 비율 추가분 */
export const HAIR_CAP = { tall: 0.2, crop: 0.1, alt1: 0.18, alt2: 0.12 };
export const HAIR_CAP_DEFAULT = 0.15; // part·other
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
      if (Object.hasOwn(FIXED_COLOR, id)) out.set(id, FIXED_COLOR[id]);
      else out.set(id, grouped ? hsl(TEAM_HUE[ti % TEAM_HUE.length], 38, 36 + (ai % 4) * 7) : COLOR_FALLBACK);
    });
  });
  return out;
}
