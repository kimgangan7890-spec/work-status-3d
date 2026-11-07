import { createBuildings } from "./panels/buildings.js";
import { createStore } from "./scene/store.js";
import { createOffice } from "./scene/office.js";
import { createCampus } from "./panels/campus.js";
import { validateProjects } from "./shared/projects.js";
import { readDayMode } from "./panels/daymode.js";

const canvas = document.getElementById("scene");
const hud = document.getElementById("hud");
const office = createOffice(canvas);
const buildings = createBuildings(office, enterProject);
office.setDayMode(readDayMode()); // 하늘 시간: 자동·낮·밤(브라우저 편의값)
window.addEventListener("daymode:change", (e) => office.setDayMode(e.detail));
let campusCount = 0, enterSequence = 0, campusBooted = false, insideId = null;
const backCampus = document.createElement("button"); backCampus.type = "button"; backCampus.className = "campus-back"; backCampus.textContent = "← 단지"; backCampus.hidden = true;
hud.after(backCampus); backCampus.addEventListener("click", () => { enterSequence++; office.cancelApproach(); window.__view?.enterCampus(); });
async function enterProject(id) {
  const my = ++enterSequence;
  const ready = window.__view?.get().mode !== "campus" || await office.approachBuilding(id);
  if (!ready || my !== enterSequence || !window.__campus?.list().some(p => p.id === id)) return;
  const cur = window.__campus.current(), switching = !cur || cur.id !== id || !!cur.__stale;
  buildings.visit(id); insideId = id;
  if (window.__view?.get().mode === "campus") window.__view.leaveCampus({ switching }); // 방·층에서 카드를 눌렀을 때는 화면 상태를 건드리지 않는다(기존 동작)
  window.__campus.select(id, true);
}
// 이동 중 Esc: 진입을 취소하고 단지 전체 화면으로 되돌린다(view.js는 단지에서 Esc를 처리하지 않는다).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || !office.approaching()) return;
  const tag = String(e.target?.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  enterSequence++; office.cancelApproach(true); e.preventDefault();
});
office.onBuildingClick(enterProject);
const campusDesktop = () => (canvas.clientWidth || Math.max(0, innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--board-w")) || 0))) >= 600;
function configureCampus(list) {
  campusCount = list.length;
  office.setCampus(list); buildings.setProjects(list);
  window.__view?.configureCampus(campusCount, campusDesktop());
  // 단지를 첫 화면으로 여는 것은 처음 목록을 받았을 때만. 주기 재조회·자동으로 찾기로 2개가 되어도 보던 화면을 빼앗지 않는다(「← 단지」로 들어간다).
  if (!campusBooted) { campusBooted = true; if (campusCount >= 2 && campusDesktop()) window.__view?.enterCampus(); }
}
window.addEventListener("resize", () => { window.__view?.configureCampus(campusCount, campusDesktop()); backCampus.hidden = window.__view?.get().mode === "campus" || !window.__view?.canCampus(); });
const base = import.meta.env.BASE_URL;
const store = createStore({ url: `${base}status.json`, boardUrl: `${base}board.json` });

// 팀 탭의 선택을 전달한다. 층 화면에서는 선택을 기억하고 방 화면에서는 해당 방으로 바꾼다.
window.addEventListener("team:change", (e) => office.setTeam?.(e.detail?.teamId));

// 층 전체/방 화면 상태(panels/view.js)를 장면에 알린다. 장면 API가 없으면 아무 일도 하지 않는다.
window.addEventListener("view:change", (e) => {
  if (e.detail.mode === "campus") document.body.classList.remove("pre-login");
  office.setView(e.detail);
  const campus = e.detail.mode === "campus";
  window.__campus?.setCampusActive(campus);
  backCampus.hidden = campus || !window.__view?.canCampus();
  if (campus && insideId) { const cur = window.__campus?.current(); if (cur?.id === insideId && !cur.__stale) buildings.visit(insideId); insideId = null; } // 사무동 안에서 본 이벤트는 새 이벤트로 알리지 않는다
  if (campus) { hud.textContent = `${campusCount}개 사무동 · 프로젝트 단지`; document.body.classList.remove("pre-login"); window.__campus?.open(); }
});
office.onRoomClick?.((teamId) => {
  window.dispatchEvent(new CustomEvent("room:click", { detail: { teamId } }));
  window.__view?.enter?.(teamId); // 패널 상태(탭·카드)도 같은 방으로 맞춘다
});

store.on("state", ({ state }) => {
  document.body.classList.remove("pre-login");
  office.syncState(state);
  const text = window.__view?.get().mode === "campus" ? `${campusCount}개 사무동 · 프로젝트 단지` : `${state.meta.project} · 갱신 ${state.meta.updatedAt.slice(11, 19)}`;
  if (hud.textContent !== text) hud.textContent = text; // 같은 글이면 건드리지 않는다(3초마다 갱신)
  hud.classList.remove("err");
  window.__ready = true;
});
let epoch = 0; // 프로젝트를 바꾸면 올라가서, 이전 프로젝트 이벤트의 예약 재생을 버린다
store.on("events", (events) => { const my = epoch; events.forEach((ev, i) => setTimeout(() => { if (my === epoch) if (window.__view?.get().mode !== "campus") office.playEvent(ev); }, i * 600)); });
// 프로젝트 전환: 새 데이터가 오기 전까지 이전 프로젝트의 장면·로그를 숨긴다(실패해도 이전 화면이 새 프로젝트처럼 보이지 않게).
store.on("reset", () => { epoch++; if (window.__campus?.current()?.__stale) window.__view?.leaveCampus(); document.body.classList.add("pre-login"); });
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
  const projects = (await loadProjects(buildPublic)) ?? [];
  // 단지 선택 카드(2개 이상일 때 보임). 프로젝트가 있으면 저장된/첫 프로젝트로 store를 시작한다(선택 시 setSource).
  // 목록이 비어 있어도 만들어 둔다: 화면의 '자동으로 찾기'가 나중에 프로젝트를 채운다.
  window.__campus = createCampus({
    host: document.getElementById("panels"), projects, base, viaServer: !buildPublic,
    onEnter: enterProject,
    reload: () => loadProjects(buildPublic), // "목록 새로고침"과 주기 재조회: 실패하면 null(기존 목록 유지)
    onSelect: (p, src) => { window.__projectId = p.adhoc ? "@gh" : p.id; hud.textContent = `${p.name} 불러오는 중…`; hud.classList.remove("err"); window.__ready = false; store.setSource(src); }, // 자동으로 찾은 저장소는 지시를 받지 않는다("@gh")
    onHome: (src) => { window.__view?.leaveCampus(); window.__projectId = undefined; hud.textContent = "불러오는 중…"; hud.classList.remove("err"); window.__ready = false; store.setSource(src); }, // 자동으로 찾은 카드를 모두 닫고 기본 단일 화면으로
  });
  window.__campus.onSummaries(data => buildings.update(data));
  // 서버 모드(공개판 제외)에서 세션이 있을 때만: GitHub 지표를 카드에 붙인다. 번들러가 공개판에서는 이 블록과 모듈을 지운다.
  if (!buildPublic) import("./panels/ghcards.js").then(({ startGhCards }) => { window.__ghcards = startGhCards({ campus: window.__campus, onLook: (id, look) => office.setBuildingLook(id, look), onCi: (st) => office.setCiStatus(st) }); }).catch(() => { /* 지표 없이 계속 */ });
  window.__campus.onProjects(configureCampus);
  window.__campus.setCampusActive(window.__view?.get().mode === "campus");
  if (!projects.length) store.start();
  setInterval(() => { if (!document.hidden) window.__campus?.refresh?.({ silent: true }); }, PROJECTS_POLL_MS); // 새로고침 없이도 목록 변경을 따라간다
}

const PROJECTS_POLL_MS = 60000;
// 프로젝트 목록: 서버 모드는 /api/projects, 정적 공개판은 projects.json(없으면 단일 프로젝트로 기존 동작). 읽기에 실패하면 null을 돌려준다(없는 파일·빈 목록은 []).
async function loadProjects(buildPublic) {
  try {
    if (!buildPublic) {
      const r = await fetch("/api/projects", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) return null;
      const list = (await r.json()).projects;
      return Array.isArray(list) ? list.map((p) => ({ id: p.id, name: p.name, repo: p.remote ? "server/relay" : undefined })) : null;
    }
    const r = await fetch(`${base}projects.json`, { cache: "no-store" });
    if (r.status === 404) return []; // projects.json이 없으면 단일 프로젝트
    if (!r.ok) return null;
    const obj = await r.json();
    return validateProjects(obj, { allowPrivate: false }).length ? null : obj.projects;
  } catch { return null; }
}
boot();
window.__office = office; window.__store = store;
