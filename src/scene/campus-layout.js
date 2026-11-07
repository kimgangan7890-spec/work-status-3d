// 프로젝트 대지 16×18, 대지 사이 도로. 모든 줄을 가운데에 정렬한다.
export const BUILDING = { width: 16, depth: 18, gap: 6, max: 12 };
export function layoutCampus(n) {
  const count = Math.max(0, Math.min(12, Math.floor(Number(n) || 0)));
  const cols = count <= 3 ? count : count === 4 ? 2 : count <= 6 ? 3 : 4;
  const rows = cols ? Math.ceil(count / cols) : 0, buildings = [];
  for (let row = 0; row < rows; row++) {
    const size = Math.min(cols, count - row * cols);
    for (let col = 0; col < size; col++) buildings.push({ index: buildings.length, row, col, x: (col - (size - 1) / 2) * 22, z: (row - (rows - 1) / 2) * 26 });
  }
  return { buildings, bounds: { minX: cols ? -(cols - 1) * 11 - 10 : 0, maxX: cols ? (cols - 1) * 11 + 10 : 0, minZ: rows ? -(rows - 1) * 13 - 12 : 0, maxZ: rows ? (rows - 1) * 13 + 12 : 0 } };
}

// 최고 동 12~22층. 2동에서는 층 차이 4와 높이 비 1.3을 함께 지키도록 최고 19층까지.
// look(외부 지표)이 층수를 주면 에이전트·작업 수 대신 그 값을 최고 동 층수로 쓴다(승인된 결합 규칙). 동 사이 차이 규칙은 그대로.
export function towerLayout(summary = {}, look = null) {
  summary ??= {};
  const count = Math.max(1, Math.min(3, Math.floor(Number(summary.teams) || 1)));
  const cap = count === 2 ? 19 : 22, fromLook = Number.isFinite(look?.floors);
  const highest = fromLook ? Math.min(cap, Math.max(12, Math.round(look.floors))) : Math.min(cap, 12 + Math.floor(((summary.agents || 0) + (summary.tasks || 0)) / 3));
  const offsets = count === 1 ? [[0, 0]] : count === 2 ? [[-3, -3], [3, 3]] : [[-4, -4], [3, -1], [-3, 5]];
  return offsets.map(([x, z], i) => {
    const floors = highest - i * (count === 2 ? 4 : highest >= 17 ? 3 : 2);
    const height = floors * (i === 0 ? 0.6 : 0.55), totalHeight = height + 1.95, width = totalHeight / 4;
    return { x, z, floors, height, totalHeight, width, depth: width * 2 };
  });
}

const ROOF_COLORS = { alert: 0xd9534f, busy: 0x4f8fd6 };
const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
export const LIT_MIN = 0.25; // 지표가 있는 건물도 창이 최소 25%는 켜져 있다(전체가 검게 보이지 않게)
export const DIM_DESAT = 0.65;  // stale/error: 휘도를 보존한 회색과 이 비율로 섞는다(어둡게 하지 않고 채도만 낮춤)
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** 색(0xRRGGBB)을 휘도 보존 회색 쪽으로 amount만큼 섞는다. 순수 함수. */
export function desaturate(hex, amount) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255, y = luma(r, g, b);
  const mix = c => Math.max(0, Math.min(255, Math.round(c + (y - c) * amount)));
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
/**
 * 외부 지표 look({floors, litRatio, roof, dim}) → 3D 속성. 순수 함수. look이 없으면 null(= 지금 외관 그대로).
 * lit: 켜진 창 비율(최소 LIT_MIN), roofColor: 옥탑 띠·설비 색(없으면 프로젝트 악센트 유지), desat: 탈채도 비율(dim이면 DIM_DESAT)
 */
export function lookProps(look) {
  if (!look || typeof look !== "object") return null;
  return { lit: LIT_MIN + (1 - LIT_MIN) * clamp01(look.litRatio), roofColor: ROOF_COLORS[look.roof] ?? null, desat: look.dim ? DIM_DESAT : 0 };
}
