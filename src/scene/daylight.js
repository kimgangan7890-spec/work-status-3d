// 낮·밤 값(DESIGN7 부록 D). 순수 함수: 시각 → 하늘·빛·안개·밤 정도. three·DOM 의존 없음.
// 6구간의 값을 정해 두고, 다음 구간 시작 1시간 전부터 선형 보간한다(수동 색 보간 — 대기 산란 모델 없음).
// 색은 0xRRGGBB 정수. 세기는 "낮 = 1" 기준의 상대값(장면이 자기 기준 세기에 곱한다).
const Z = (start, skyTop, skyBottom, ambColor, ambI, sunColor, sunI, fog, night, stars) => ({ start, skyTop, skyBottom, ambient: { color: ambColor, intensity: ambI }, sun: { color: sunColor, intensity: sunI }, fog, night, stars });
export const ZONES = Object.freeze([
  Z(5, 0x6a7fb8, 0xf5b89a, 0xffd5c0, 0.75, 0xffc79a, 0.6, 0xf0c0a8, 0.35, 0.25),   // 새벽 05–07
  Z(7, 0x7fb2ee, 0xdcebfa, 0xfff4e6, 0.95, 0xfff1d6, 1.0, 0xdcebfa, 0, 0),         // 아침 07–11
  Z(11, 0x8ec5ff, 0xe9f3ff, 0xffffff, 1.0, 0xffffff, 1.1, 0xe9f3ff, 0, 0),         // 오후 11–17
  Z(17, 0x5a6fb0, 0xffb27a, 0xffcfa3, 0.8, 0xff9a55, 0.8, 0xf0b890, 0.25, 0),      // 노을 17–19
  Z(19, 0x1f2650, 0x7a5a8a, 0x9aa6d8, 0.55, 0x8a8fd0, 0.3, 0x3a3f6a, 0.7, 0.6),    // 저녁 19–21
  Z(21, 0x0b1020, 0x1b2340, 0x8c9ad0, 0.42, 0x9fb4ff, 0.35, 0x151b33, 1, 1),       // 밤 21–05
]);
export const FIXED_MINUTES = Object.freeze({ day: 13 * 60, night: 23 * 60 });
export const MODES = Object.freeze(["auto", "day", "night"]);

const lerp = (a, b, t) => a + (b - a) * t;
const lerpHex = (a, b, t) => {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t), g = lerp((a >> 8) & 255, (b >> 8) & 255, t), bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** Date | 분(0~1439.x, 그 밖의 수는 하루 단위로 감김) | 그 밖(→ 낮 13:00)을 하루 안의 분으로. */
export function minutesOf(t) {
  let m;
  if (t instanceof Date) m = Number.isFinite(t.getTime()) ? t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60 : NaN;
  else m = typeof t === "number" ? t : NaN;
  if (!Number.isFinite(m)) return FIXED_MINUTES.day;
  return ((m % 1440) + 1440) % 1440;
}

/** 모드(auto·day·night)에 맞는 분. auto만 now를 쓴다. 모르는 모드는 auto. */
export function minutesFor(mode, now) {
  if (mode === "day") return FIXED_MINUTES.day;
  if (mode === "night") return FIXED_MINUTES.night;
  return minutesOf(now);
}

/**
 * @returns {{zone:number, skyTop:number, skyBottom:number, ambient:{color:number,intensity:number}, sun:{color:number,intensity:number,dir:number[]},
 *   fog:number, night:number, stars:number, body:{kind:"sun"|"moon", height:number, color:number}}}
 *   night: 0(낮)~1(한밤), stars: 별 투명도 0~1, body.height: 해/달 높이 0(지평선)~1(정점)
 */
export function daylight(t = new Date()) {
  const h = minutesOf(t) / 60;
  const hh = h < ZONES[0].start ? h + 24 : h; // 00~05시는 전날 밤 구간
  let i = ZONES.length - 1;
  for (let k = 0; k < ZONES.length - 1; k++) if (hh >= ZONES[k].start && hh < ZONES[k + 1].start) { i = k; break; }
  const a = ZONES[i], nextStart = i === ZONES.length - 1 ? ZONES[0].start + 24 : ZONES[i + 1].start;
  const b = ZONES[(i + 1) % ZONES.length];
  const k = hh >= nextStart - 1 ? hh - (nextStart - 1) : 0; // 다음 구간 시작 1시간 전부터 보간
  const mix = (x, y) => lerp(x, y, k), mixc = (x, y) => lerpHex(x, y, k);
  // 해(06~18시)와 달(18~06시)의 높이: 반원 호. 지평선에서 뜨고 진다.
  const sunUp = hh >= 6 && hh < 18, phase = sunUp ? (hh - 6) / 12 : (((hh - 18) % 24) + 24) % 24 / 12;
  const angle = phase * Math.PI, height = Math.sin(angle);
  const d = [Math.cos(angle), Math.max(0.12, height), -0.3], len = Math.hypot(...d);
  const sunColor = mixc(a.sun.color, b.sun.color);
  return {
    zone: i,
    skyTop: mixc(a.skyTop, b.skyTop), skyBottom: mixc(a.skyBottom, b.skyBottom),
    ambient: { color: mixc(a.ambient.color, b.ambient.color), intensity: mix(a.ambient.intensity, b.ambient.intensity) },
    sun: { color: sunColor, intensity: mix(a.sun.intensity, b.sun.intensity), dir: d.map((v) => v / len) },
    fog: mixc(a.fog, b.fog), night: mix(a.night, b.night), stars: mix(a.stars, b.stars),
    body: { kind: sunUp ? "sun" : "moon", height, color: sunColor },
  };
}
