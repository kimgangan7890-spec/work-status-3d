// 하늘 시간 전환(자동·낮·밤). 값은 이 브라우저의 편의 설정일 뿐이다: 저장이 막혀도 동작한다.
import { MODES } from "../scene/daylight.js";

const KEY = "office.daymode";
export const MODE_LABEL = { auto: "자동", day: "낮", night: "밤" };
export function readDayMode() { try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : "auto"; } catch { return "auto"; } }
export function writeDayMode(v) { try { localStorage.setItem(KEY, v); } catch { /* 저장이 막혀도 계속 */ } }
export const nextDayMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

/** 버튼 하나. 누르면 자동 → 낮 → 밤 → 자동. 바뀔 때마다 window에 "daymode:change"(detail = 모드)를 보낸다. */
export function createDayMode() {
  let mode = readDayMode();
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "ll-btn dm-btn";
  const paint = () => { btn.textContent = `하늘: ${MODE_LABEL[mode]}`; btn.setAttribute("aria-label", `하늘 시간 ${MODE_LABEL[mode]}(누르면 바뀜)`); };
  btn.addEventListener("click", () => { mode = nextDayMode(mode); writeDayMode(mode); paint(); window.dispatchEvent(new CustomEvent("daymode:change", { detail: mode })); });
  paint();
  return { root: btn, get mode() { return mode; } };
}
