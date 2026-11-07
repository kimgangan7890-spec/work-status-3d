import { hasNewEvent } from "./buildings.js";
import { sourcesOf, summarize } from "../shared/projects.js";
import { validateStatus } from "../shared/validate.js";
import { projectKey } from "../shared/discover.js";
import { MAX_PROJECTS } from "../shared/projects.js";

// 단지 화면: 프로젝트(사무동) 카드 목록. 카드를 누르면 그 프로젝트로 전환한다. 사용자 데이터는 textContent로만 넣는다.
const KEY = "office.project";
const SUMMARY_MS = 30000;
function summaryText(id, s) {
  let seen; try { seen = localStorage.getItem(`office.seen.${id}`); } catch { seen = null; }
  return `${s.agents}명 · ${s.progress == null ? "진행 정보 없음" : s.progress + "%"} · 일하는 중 ${s.working} · 막힘 ${s.blocked}${hasNewEvent(s, seen) ? " · 새 이벤트" : ""}`;
}
function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }
function writeSaved(v) { try { localStorage.setItem(KEY, v); } catch { /* 저장이 막혀도 계속 */ } }
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

/**
 * @param {{host:HTMLElement, projects?:Array, base:string, viaServer:boolean, onSelect:(project, sources)=>void, fetchFn?:Function}} o
 * 프로젝트가 2개 미만이면 카드 목록을 숨긴다(기존 화면 그대로). 프로젝트에 sources가 있으면(자동 찾기로 얻은 것) 그 주소를 쓴다.
 * onHome(sources): home()이 자동으로 찾은 카드를 모두 지운 뒤 남은 프로젝트가 없을 때 부른다(기본 단일 화면의 주소를 넘긴다).
 * reload(): projects.json을 다시 읽어 목록 배열을 돌려준다(읽기에 실패하면 null이나 예외). 있으면 "목록 새로고침" 동작(refresh)이 생긴다.
 * 반환: {root, select(id), current(), list(), setProjects(list, {selectId?}), markStale(), home(), refresh()}
 */
export function createCampus({ host, projects = [], base, viaServer, onSelect, onHome, onEnter, reload, fetchFn = (...a) => fetch(...a) }) {
  const root = el("section", "campus");
  const bar = el("button", "campus-bar"); bar.type = "button"; bar.setAttribute("aria-expanded", "false");
  const grid = el("div", "campus-grid"); grid.hidden = true;
  const foot = el("div", "campus-foot");
  const refreshBtn = el("button", "campus-refresh", "목록 새로고침"); refreshBtn.type = "button";
  const note = el("span", "campus-note"); note.setAttribute("role", "status");
  foot.append(refreshBtn, note); foot.hidden = !reload;
  root.append(bar, grid, foot);
  const hud = host.querySelector("#hud"); // 제목줄 바로 아래에 둔다
  hud ? hud.after(root) : host.prepend(root);

  const summaryListeners = new Set(), listListeners = new Set();
  let campusActive = false, summaryJob = null, generation = 0;
  let list = [], cards = new Map(); // id -> {card, sum, gh}
  const extras = new Map(); // id -> {text, cls}: 바깥(GitHub 지표 등)이 카드에 붙인 한 줄. 카드를 다시 만들어도 유지한다
  let current = null, timer = null;
  const srcOf = (p) => p.sources ?? sourcesOf(p, { base, viaServer });

  function drawBar() { bar.textContent = `${current?.name ?? "프로젝트"} ▾  (${list.length}개 사무동)`; }
  function build() {
    generation++;
    grid.replaceChildren(); cards = new Map();
    root.hidden = list.length < 2;
    for (const p of list) {
      const card = el("button", "campus-card"); card.type = "button";
      const sum = el("div", "campus-sum", "…");
      const gh = el("div", "campus-gh"); gh.hidden = true;
      card.append(el("div", "campus-name", p.name), sum, gh);
      card.addEventListener("click", () => onEnter ? onEnter(p.id) : select(p.id, true));
      grid.append(card); cards.set(p.id, { card, sum, gh }); paintExtra(p.id);
    }
    for (const fn of listListeners) fn(list.slice());
    if (campusActive) refreshSummaries();
  }

  function paintExtra(id) {
    const c = cards.get(id); if (!c) return;
    const x = extras.get(id);
    const cls = "campus-gh" + (x?.cls ? " " + x.cls : "");
    if (c.gh.className !== cls) c.gh.className = cls;
    const text = x?.text ?? "";
    if (c.gh.textContent !== text) c.gh.textContent = text;
    c.gh.hidden = !text;
  }
  /** 카드에 한 줄을 붙이거나(null이면 지운다). 같은 내용이면 DOM을 건드리지 않는다. */
  function decorate(id, x) { if (x) extras.set(id, { text: String(x.text ?? ""), cls: String(x.cls ?? "") }); else extras.delete(id); paintExtra(id); }

  function select(id, close) {
    const p = list.find((x) => x.id === id) ?? list[0];
    if (!p) return;
    const changed = current?.id !== p.id || current?.__stale;
    current = p; if (!p.adhoc) writeSaved(p.id); drawBar(); // 자동으로 찾은 카드는 새로고침하면 사라지니 저장하지 않는다(처음 화면으로·새로고침 때 보던 프로젝트로 돌아오게)
    for (const [pid, c] of cards) c.card.classList.toggle("on", pid === p.id);
    if (close) toggle(false);
    if (changed) onSelect(p, srcOf(p));
  }

  async function refreshSummaries() {
    if (summaryJob) return summaryJob;
    const my = generation;
    summaryJob = Promise.all(list.map(async (p) => {
      const c = cards.get(p.id);
      if (!c) return;
      try {
        const u = srcOf(p).url;
        const res = await fetchFn(`${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const st = await res.json();
        if (validateStatus(st).length) throw new Error("검증");
        if (my !== generation || cards.get(p.id) !== c) return;
        const s = summarize(st);
        for (const fn of summaryListeners) fn({ id: p.id, summary: s });
        c.sum.textContent = summaryText(p.id, s);
        c.sum.className = "campus-sum" + (s.blocked ? " warn" : "");
      } catch { if (my !== generation) return; for (const fn of summaryListeners) fn({ id: p.id, error: true }); c.sum.textContent = "읽지 못함"; c.sum.className = "campus-sum err"; }
    })).finally(() => { summaryJob = null; if (my !== generation && (campusActive || !grid.hidden)) refreshSummaries(); });
    return summaryJob;
  }
  function polling() {
    clearInterval(timer); timer = null;
    if (campusActive || !grid.hidden) { refreshSummaries(); timer = setInterval(() => { if (!globalThis.document?.hidden) refreshSummaries(); }, SUMMARY_MS); } // 탭이 숨겨져 있으면 건너뛴다
  }
  function toggle(open) {
    grid.hidden = !open; foot.hidden = !reload || !open; bar.setAttribute("aria-expanded", String(open));
    polling();
  }
  bar.addEventListener("click", () => toggle(grid.hidden));

  /** 목록을 통째로 바꾼다. 보던 프로젝트가 목록에 남아 있으면 그대로 두고, 없으면 selectId→저장값→첫 프로젝트 순. 같은 프로젝트를 다시 고르면(직접 입력 뒤 복귀 등) 다시 불러온다. */
  function setProjects(next, { selectId } = {}) {
    list = next.slice();
    build();
    if (!list.length) { current = null; drawBar(); return; }
    const saved = readSaved();
    const want = (selectId && list.some((p) => p.id === selectId) && selectId) || (current && list.some((p) => p.id === current.id) && current.id) || (list.some((p) => p.id === saved) && saved) || list[0].id;
    if (current && current.id === want && !selectId && !current.__stale) { current = list.find((p) => p.id === want); for (const [pid, c] of cards) c.card.classList.toggle("on", pid === want); drawBar(); return; }
    select(want, false);
  }

  /** 다른 곳(직접 입력 등)이 화면을 바꿨을 때 부른다: 같은 카드를 다시 눌러도 전환되게 한다. */
  function markStale() { if (current) current = { ...current, __stale: true }; }

  /**
   * 처음 화면으로 돌아온다(새로고침 없이). 자동으로 찾은 카드(adhoc)는 지운다.
   * projects.json 프로젝트가 남아 있으면 저장된(없으면 첫) 프로젝트로, 하나도 없으면 기본 단일 화면(onHome)으로 간다.
   */
  function home() {
    toggle(false);
    list = list.filter((p) => !p.adhoc);
    if (list.length) { const saved = readSaved(); setProjects(list, { selectId: list.some((p) => p.id === saved) ? saved : list[0].id }); return; }
    current = null; build(); drawBar();
    onHome?.(srcOf({}));
  }

  /**
   * projects.json을 다시 읽어 목록을 바꾼다. 읽기에 실패하면 기존 목록을 그대로 두고 안내만 한다.
   * 자동으로 찾은 카드(adhoc)는 유지한다. 보던 프로젝트가 새 목록에서 사라졌으면 저장된(없으면 첫) 프로젝트로, 하나도 없으면 기본 화면(home)으로 돌아간다.
   */
  let refreshing = false;
  const sig = (l) => JSON.stringify(l.map((p) => [p.id, p.name, p.repo ?? "", p.branch ?? "", p.dir ?? "", !!p.adhoc]));
  async function refresh({ silent = false } = {}) {
    if (!reload || refreshing) return { ok: false };
    refreshing = true; refreshBtn.disabled = true; if (!silent) { note.textContent = "읽는 중…"; note.className = "campus-note"; }
    let fresh = null;
    try { fresh = await reload(); } catch { fresh = null; }
    refreshing = false; refreshBtn.disabled = false;
    if (!Array.isArray(fresh)) {
      note.textContent = "목록을 읽지 못했어요. 기존 목록을 그대로 둬요"; note.className = "campus-note err";
      return { ok: false };
    }
    const ids = new Set(fresh.map((p) => p.id)), keys = new Set(fresh.map(projectKey));
    const kept = list.filter((p) => p.adhoc && !ids.has(p.id) && !keys.has(projectKey(p)));
    const next = [...fresh, ...kept].slice(0, MAX_PROJECTS);
    const gone = !!current && !current.adhoc && !ids.has(current.id);
    const pick = () => { const saved = readSaved(); return ids.has(saved) ? saved : fresh[0]?.id; };
    if (current?.__stale) { if (gone || sig(next) !== sig(list)) relist(next, gone ? pick() : current.id); } // 직접 입력 화면을 보는 중: 카드만 바꾸고 화면은 그대로(카드를 누르면 그때 전환)
    else if (gone && !fresh.length) { list = []; home(); } // 남은 projects.json 프로젝트가 없으니 기본 단일 화면으로
    else if (gone) setProjects(next, { selectId: pick() });
    else if (sig(next) !== sig(list)) { // 달라진 게 없으면 카드를 다시 그리지 않는다(주기 재조회 때 깜빡이지 않게)
      const prev = current;
      setProjects(next);
      if (prev && current?.id === prev.id && srcOf(current).url !== srcOf(prev).url) onSelect(current, srcOf(current)); // 보던 프로젝트의 저장소·폴더가 바뀌었으면 다시 불러온다
    }
    if (!grid.hidden) refreshSummaries();
    note.textContent = silent ? "" : `${fresh.length}개 사무동을 읽었어요`; note.className = "campus-note";
    return { ok: true };
  }
  /** 화면을 바꾸지 않고 카드 목록만 바꾼다. current는 고른 카드의 '바뀐 화면' 표시(__stale)를 유지해 다시 누르면 전환되게 한다. */
  function relist(next, wantId) {
    list = next.slice(); build();
    const p = list.find((x) => x.id === wantId) ?? list[0];
    current = p ? { ...p, __stale: true } : null;
    for (const [pid, c] of cards) c.card.classList.toggle("on", pid === p?.id);
    drawBar();
  }
  refreshBtn.addEventListener("click", () => refresh());

  setProjects(projects);
  return { onSummaries: (fn) => { summaryListeners.add(fn); return () => summaryListeners.delete(fn); },
    onProjects: (fn) => { listListeners.add(fn); fn(list.slice()); return () => listListeners.delete(fn); },
    setCampusActive: (active) => { campusActive = !!active; polling(); }, refreshSummaries,
    dispose: () => { generation++; campusActive = false; grid.hidden = true; clearInterval(timer); summaryListeners.clear(); listListeners.clear(); },
    open: () => toggle(true), refresh, root, select, current: () => current, list: () => list.slice(), setProjects, markStale, home, decorate };
}
