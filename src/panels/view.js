import { teamsOf } from "./model.js";

// 화면 상태 floor(층 전체) / room(한 팀 방). DESIGN5-panels.md §2. 이 파일이 유일한 소유자다.
/**
 * deps: {office?, doc?, win?, select?}
 *  - select(teamId): 팀 선택(teams.js의 select). 없으면 window.__teams.select.
 *  - office는 쓰지 않는다(장면 연결은 main.js가 view:change로 한다). 받아만 둔다.
 */
export function createView(store, deps = {}) {
  const doc = deps.doc ?? globalThis.document;
  const win = deps.win ?? globalThis.window;
  const listeners = [];
  let mode = "room";
  let teamId = null;
  let started = false; // 첫 상태를 받기 전에는 지금 화면(room)처럼 둔다

  const teams = () => (store.state ? teamsOf(store.state) : []);
  const select = (id) => (deps.select ?? win?.__teams?.select)?.(id);

  function publish() {
    if (doc?.body) doc.body.dataset.view = mode;
    const detail = { mode, teamId: mode === "room" ? teamId : null };
    for (const fn of listeners) fn(detail);
    win?.dispatchEvent?.(new CustomEvent("view:change", { detail }));
  }
  function set(m, id) {
    const t = m === "room" ? id : null;
    if (m === mode && t === (mode === "room" ? teamId : null) && started) return;
    mode = m; teamId = t; started = true; publish();
  }

  // 상태가 바뀔 때마다 보정: 팀이 2개 미만이면 층 전체 화면이 없다. 보고 있던 팀이 없어졌으면 안전한 쪽으로.
  function reconcile() {
    const ts = teams();
    if (!store.state) return;
    if (!started) { ts.length >= 2 ? set("floor") : set("room", ts[0]?.id ?? null); return; }
    if (ts.length < 2) { if (mode !== "room" || teamId !== (ts[0]?.id ?? null)) set("room", ts[0]?.id ?? null); return; }
    if (mode === "room" && !ts.some((t) => t.id === teamId)) set("floor");
  }

  function enter(id) {
    const ts = teams();
    if (!ts.some((t) => t.id === id)) return false;
    select(id);
    set("room", id);
    return true;
  }
  function back() {
    if (mode !== "room" || teams().length < 2) return false;
    set("floor");
    return true;
  }

  if (doc?.body) doc.body.dataset.view = mode;
  store.on?.("state", reconcile);
  if (store.state) reconcile();
  doc?.addEventListener?.("keydown", (e) => {
    if (e.key !== "Escape" || mode !== "room") return;
    const tag = String(e.target?.tagName ?? "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    back();
  });

  // 방 안에서 팀이 바뀌면(탭·저장값 보정 등) 방 상태의 teamId도 따라간다. 층 전체일 때는 무시.
  win?.addEventListener?.("team:change", (e) => {
    const id = e?.detail?.teamId;
    if (mode === "room" && started && id && id !== teamId && teams().some((t) => t.id === id)) set("room", id);
  });

  const api = {
    get: () => ({ mode, teamId: mode === "room" ? teamId : null }),
    enter, back,
    canFloor: () => teams().length >= 2,
    onChange: (fn) => listeners.push(fn),
  };
  if (win) win.__view = { get: api.get, enter, back };
  return api;
}
