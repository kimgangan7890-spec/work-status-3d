import { buildTeamTabs, pickTeam, teamsOf } from "./model.js";

// 팀 탭(DESIGN4.md §3-2). 팀이 2개 미만이면 아무것도 그리지 않는다. 사용자 데이터는 textContent로만 넣는다.
const KEY = "office.team";
const FLASH_MS = 1200;

function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }
function writeSaved(v) { try { localStorage.setItem(KEY, v); } catch { /* 저장이 막혀도 계속 */ } }

export function createTeamTabs(store, host, opts = {}) {
  const view = opts.view ?? null; // 없으면 지금 동작 그대로
  const nav = document.createElement("nav");
  nav.className = "teamtabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "팀");
  nav.hidden = true;
  host.append(nav);

  let selected = null;
  const flashUntil = new Map(); // teamId -> 만료(ms)
  const listeners = [];

  function announce() {
    for (const fn of listeners) fn(selected);
    window.dispatchEvent(new CustomEvent("team:change", { detail: { teamId: selected } }));
  }
  function select(id) {
    const next = store.state ? pickTeam(store.state, id) : id;
    if (next === selected) return;
    selected = next; writeSaved(next); draw(); announce();
  }
  let lastSig = "";
  function draw() {
    const status = store.state;
    const tabs = status ? buildTeamTabs(status, selected) : [];
    const now = Date.now();
    // 바뀐 게 없으면 다시 그리지 않는다(3초마다 갱신돼도 누르는 도중 버튼이 사라지지 않게).
    const vmode = view && tabs.length >= 2 ? view.get().mode : "room";
    const sig = vmode + JSON.stringify(tabs.map((t) => [t.id, t.name, t.count, t.dot, t.selected, (flashUntil.get(t.id) ?? 0) > now && !t.selected]));
    if (sig === lastSig) return;
    lastSig = sig;
    nav.hidden = tabs.length === 0 || vmode === "floor"; // 층 전체 화면에서는 이름표가 같은 일을 한다
    nav.replaceChildren();
    if (view && tabs.length >= 2 && vmode === "room") {
      const back = document.createElement("button");
      back.type = "button"; back.className = "tt tt-back"; back.textContent = "← 층 전체";
      back.addEventListener("click", () => view.back());
      nav.append(back);
    }
    for (const t of tabs) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tt " + t.dot + (t.selected ? " on" : "") + ((flashUntil.get(t.id) ?? 0) > now && !t.selected ? " flash" : "");
      b.dataset.teamId = t.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t.selected));
      b.setAttribute("aria-label", `${t.name}, ${t.count}명, ${t.dotLabel}`);
      const dot = document.createElement("i"); dot.className = "tt-dot";
      const name = document.createElement("span"); name.textContent = t.name;
      b.append(dot, name);
      b.addEventListener("click", () => (view ? view.enter(t.id) : select(t.id)));
      nav.append(b);
    }
  }

  view?.onChange(() => draw());
  store.on("state", () => {
    const status = store.state;
    const next = status ? pickTeam(status, selected ?? readSaved()) : null;
    const changed = next !== selected;
    selected = next;
    draw();
    if (changed) announce();
  });
  // 보고 있지 않은 팀에서 오간 문서는 그 팀 탭이 깜빡인다.
  store.on("events", (events) => {
    const status = store.state;
    if (!status) return;
    const ts = teamsOf(status);
    const teamOf = (id) => ts.find((t) => t.agentIds.includes(id))?.id;
    for (const ev of events) for (const id of [teamOf(ev.from), teamOf(ev.to)]) {
      if (id && id !== selected) flashUntil.set(id, Date.now() + FLASH_MS);
    }
    draw();
    setTimeout(draw, FLASH_MS + 50);
  });

  window.__teams = { selected: () => selected, select };
  return { root: nav, selected: () => selected, select, onChange: (fn) => listeners.push(fn) };
}
