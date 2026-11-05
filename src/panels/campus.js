import { sourcesOf, summarize } from "../shared/projects.js";
import { validateStatus } from "../shared/validate.js";

// 단지 화면: 프로젝트(사무동) 카드 목록. 카드를 누르면 그 프로젝트로 전환한다. 사용자 데이터는 textContent로만 넣는다.
const KEY = "office.project";
const SUMMARY_MS = 30000;
function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }
function writeSaved(v) { try { localStorage.setItem(KEY, v); } catch { /* 저장이 막혀도 계속 */ } }
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

/**
 * @param {{host:HTMLElement, projects:Array, base:string, viaServer:boolean, onSelect:(project, sources)=>void, fetchFn?:Function}} o
 * 프로젝트가 2개 미만이면 아무것도 그리지 않는다(기존 화면 그대로).
 */
export function createCampus({ host, projects, base, viaServer, onSelect, fetchFn = (...a) => fetch(...a) }) {
  const root = el("section", "campus");
  root.hidden = projects.length < 2;
  const bar = el("button", "campus-bar"); bar.type = "button"; bar.setAttribute("aria-expanded", "false");
  const grid = el("div", "campus-grid"); grid.hidden = true;
  root.append(bar, grid);
  const hud = host.querySelector("#hud"); // 제목줄 바로 아래에 둔다
  hud ? hud.after(root) : host.prepend(root);

  const cards = new Map(); // id -> {card, sum}
  let current = null, timer = null;
  const srcOf = (p) => sourcesOf(p, { base, viaServer });

  function drawBar() { bar.textContent = `${current?.name ?? "프로젝트"} ▾  (${projects.length}개 사무동)`; }
  for (const p of projects) {
    const card = el("button", "campus-card"); card.type = "button";
    const sum = el("div", "campus-sum", "…");
    card.append(el("div", "campus-name", p.name), sum);
    card.addEventListener("click", () => select(p.id, true));
    grid.append(card); cards.set(p.id, { card, sum });
  }

  function select(id, close) {
    const p = projects.find((x) => x.id === id) ?? projects[0];
    if (!p) return;
    const changed = current?.id !== p.id;
    current = p; writeSaved(p.id); drawBar();
    for (const [pid, c] of cards) c.card.classList.toggle("on", pid === p.id);
    if (close) toggle(false);
    if (changed) onSelect(p, srcOf(p));
  }

  async function refreshSummaries() {
    await Promise.all(projects.map(async (p) => {
      const c = cards.get(p.id);
      try {
        const res = await fetchFn(`${srcOf(p).url}${srcOf(p).url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const st = await res.json();
        if (validateStatus(st).length) throw new Error("검증");
        const s = summarize(st);
        c.sum.textContent = `${s.agents}명 · 일하는 중 ${s.working} · 막힘 ${s.blocked}`;
        c.sum.className = "campus-sum" + (s.blocked ? " warn" : "");
      } catch { c.sum.textContent = "읽지 못함"; c.sum.className = "campus-sum err"; }
    }));
  }
  function toggle(open) {
    grid.hidden = !open; bar.setAttribute("aria-expanded", String(open));
    clearInterval(timer);
    if (open) { refreshSummaries(); timer = setInterval(refreshSummaries, SUMMARY_MS); }
  }
  bar.addEventListener("click", () => toggle(grid.hidden));

  const saved = readSaved();
  select(projects.some((p) => p.id === saved) ? saved : projects[0].id, false);
  return { root, select, current: () => current };
}
