import { createStore } from "./scene/store.js";
import { createOffice } from "./scene/office.js";

const canvas = document.getElementById("scene");
const hud = document.getElementById("hud");
const office = createOffice(canvas);
const base = import.meta.env.BASE_URL;
const store = createStore({ url: `${base}status.json`, boardUrl: `${base}board.json` });

// 팀 탭의 선택을 전달한다. 층 화면에서는 선택을 기억하고 방 화면에서는 해당 방으로 바꾼다.
window.addEventListener("team:change", (e) => office.setTeam?.(e.detail?.teamId));

// 층 전체/방 화면 상태(panels/view.js)를 장면에 알린다. 장면 API가 없으면 아무 일도 하지 않는다.
window.addEventListener("view:change", (e) => office.setView?.(e.detail));
office.onRoomClick?.((teamId) => {
  window.dispatchEvent(new CustomEvent("room:click", { detail: { teamId } }));
  window.__view?.enter?.(teamId); // 패널 상태(탭·카드)도 같은 방으로 맞춘다
});

store.on("state", ({ state }) => {
  document.body.classList.remove("pre-login");
  office.syncState(state);
  hud.textContent = `${state.meta.project} · 갱신 ${state.meta.updatedAt.slice(11, 19)}`;
  hud.classList.remove("err");
  window.__ready = true;
});
store.on("board", ({ board }) => office.syncBoard(board));
store.on("events", (events) => events.forEach((ev, i) => setTimeout(() => office.playEvent(ev), i * 600)));
store.on("error", (msg) => {
  // 로그인 전의 401은 오류가 아니라 정상 흐름이다. 안내만 보여 주고 빨간 경고는 쓰지 않는다.
  if (/HTTP 401/.test(msg) && !store.state) {
    document.body.classList.add("pre-login"); // 로그인 전에는 빈 3D 화면과 로그를 숨긴다
    hud.textContent = matchMedia("(max-width: 600px)").matches ? "아래 지시 탭에서 암호를 입력하면 현황이 보여요" : "암호를 입력하면 현황이 보여요";
    hud.classList.remove("err"); return;
  }
  hud.textContent = `상태 읽기 실패(직전 화면 유지): ${msg}`; hud.classList.add("err");
});

// 패널은 src/panels/index.js가 있으면 연결한다.
// mountPanels(store, 요소): store.on("state"|"board"|"events", cb)로 파싱·검증된 객체를 받는다. 패널은 fetch하지 않는다.
const panels = import.meta.glob("./panels/index.js", { eager: true });
for (const mod of Object.values(panels)) mod.mountPanels?.(store, document.getElementById("panels"), { publicMode: __PUBLIC__, office });

// 서버 모드: 로그인 전에는 데이터(status.json·board.json)를 요청하지 않고 3D 장면·로그도 그리지 않는다(로그인 화면만).
// 공개 정적 빌드와 정적 호스팅(/api/session이 없음)은 로그인이 없으니 바로 시작한다.
async function boot() {
  const buildPublic = typeof __PUBLIC__ !== "undefined" && __PUBLIC__;
  if (!buildPublic) {
    document.body.classList.add("pre-login"); // 세션을 확인하는 동안에도 빈 장면이 번쩍이지 않게 먼저 숨긴다
    let status = 0;
    try { status = (await fetch("/api/session", { credentials: "same-origin", cache: "no-store" })).status; } catch { status = 0; }
    if (status === 401) {
      hud.textContent = matchMedia("(max-width: 600px)").matches ? "아래 지시 탭에서 암호를 입력하면 현황이 보여요" : "암호를 입력하면 현황이 보여요";
      hud.classList.remove("err");
      return; // 로그인하면 지시 패널이 화면을 새로 불러온다
    }
    document.body.classList.remove("pre-login");
  }
  store.start();
}
boot();
window.__office = office; window.__store = store;
