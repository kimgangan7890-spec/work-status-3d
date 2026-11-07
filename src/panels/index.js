import "./panels.css";
import { buildAgentDetail, buildBoardView, buildEventRows, buildAgentGroups, teamLabelForRoute, buildRoomCards } from "./model.js";
import { createView } from "./view.js";
import { createRooms } from "./rooms.js";
import { createTeamTabs } from "./teams.js";
import { createLoadLocal } from "./loadlocal.js";
import { createDayMode } from "./daymode.js";

// 모든 사용자 데이터는 textContent로만 넣는다(innerHTML 금지).
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function makePanel(cls, title) {
  const root = el("section", "pn " + cls);
  const head = el("div", "pn-head");
  const btn = el("button", "pn-toggle", "접기");
  btn.type = "button";
  btn.setAttribute("aria-expanded", "true");
  const body = el("div", "pn-body");
  head.append(el("span", "", title), btn);
  root.append(head, body);
  btn.addEventListener("click", () => {
    const collapsed = root.classList.toggle("collapsed");
    btn.textContent = collapsed ? "펼치기" : "접기";
    btn.setAttribute("aria-expanded", String(!collapsed));
  });
  return { root, body };
}

// 문서 도착 깜빡임(DESIGN3.md §2): 보드는 매 갱신마다 다시 그려지므로 깜빡이는 작업 id와 만료 시각을 따로 기억한다.
const FLASH_MS = 1200;
const EV_FRESH_MS = 2400; // panels.css의 .ev.fresh 애니메이션 길이와 같게 둔다
const flashUntil = new Map(); // taskId -> 만료 시각(ms)
const lastPct = new Map(); // taskId -> 직전 진행률(막대가 부드럽게 차오르게)

// 에이전트 카드를 누르면 그 에이전트의 작업 화면(지금 하는 일·맡은 작업·최근 문서)이 아래에 열린다. 상태는 모듈 변수에 두어 3초 다시 그리기에도 유지한다.
let openAgentId = null;
let onAgentOpen = null; // mountPanels가 넣는 다시 그리기
function agentCard(c, onCommand) {
  const card = el("div", "ag " + String(c.status).replace(/[^a-z]/g, "") + (openAgentId === c.id ? " open" : ""));
  card.setAttribute("role", "button"); card.tabIndex = 0; card.setAttribute("aria-pressed", String(openAgentId === c.id));
  const toggleOpen = () => { openAgentId = openAgentId === c.id ? null : c.id; onAgentOpen?.(); };
  card.addEventListener("click", (e) => { if (e.target.closest(".ag-cmd")) return; toggleOpen(); });
  card.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === card) { e.preventDefault(); toggleOpen(); } });
  card.style.borderLeftColor = c.color;
  card.append(el("div", "ag-name", c.name), el("div", "ag-status", c.statusLabel), el("div", "ag-task", c.task || "—"));
  if (onCommand) {
    const b = el("button", "ag-cmd", "지시");
    b.type = "button";
    b.setAttribute("aria-label", `${c.name}에게 지시`);
    b.addEventListener("click", () => onCommand(c.id));
    card.append(b);
  }
  return card;
}

// 팀이 2개 미만이면 묶음 하나(머리글 없음)라서 지금 화면과 같다.
const groupOpen = new Map(); // 방문자가 직접 펼치거나 접은 팀(선택 팀 변경 때까지 유지)
// ctx: {grouped, mode, selected, room(카드 데이터), canCommand, enter, soloCmd, teamCmd}. 팀이 2개 미만이면 새 요소 없음.
function renderAgents(box, groups, ctx = {}) {
  box.replaceChildren();
  const floor = ctx.grouped && ctx.mode === "floor";
  const roomMode = ctx.grouped && ctx.mode === "room";
  if (roomMode && ctx.room) {
    const r = ctx.room;
    const card = el("div", "team-card " + r.dot);
    card.dataset.teamId = r.id;
    const head = el("div", "team-card-head");
    head.append(el("i", "tt-dot"), el("span", "team-card-name", r.name), el("span", "team-card-count", `${r.count}명`));
    card.append(head, el("div", "team-card-sum", `일하는 중 ${r.working} / 막힘 ${r.blocked}`));
    if (ctx.canCommand) {
      const b = el("button", "team-cmd", "팀 공동 지시");
      b.type = "button";
      b.addEventListener("click", () => ctx.teamCmd(r.id));
      card.append(b);
    }
    box.append(card);
  }
  for (const g of groups) {
    if (!g.header) { const row = el("div", "ag-row"); for (const c of g.cards) row.append(agentCard(c)); box.append(row); continue; }
    const open = floor ? false : groupOpen.has(g.id) ? groupOpen.get(g.id) : g.open;
    const wrap = el("div", "ag-group " + g.dot + (open ? "" : " shut"));
    wrap.dataset.teamId = g.id;
    const head = el("button", "ag-ghead");
    head.type = "button";
    head.setAttribute("aria-expanded", String(open));
    const dot = el("i", "tt-dot"); head.append(dot, el("span", "", g.header));
    const row = el("div", "ag-row");
    const cmd = roomMode && ctx.canCommand && g.id === ctx.selected ? ctx.soloCmd : null;
    for (const c of g.cards) row.append(agentCard(c, cmd));
    if (floor) { head.addEventListener("click", () => ctx.enter(g.id)); wrap.append(head, row); box.append(wrap); continue; }
    head.addEventListener("click", () => { const now = !wrap.classList.toggle("shut"); groupOpen.set(g.id, now); head.setAttribute("aria-expanded", String(now)); });
    wrap.append(head, row);
    box.append(wrap);
  }
}

// BP(사업계획) 상자: PRD 안의 하위 상자. 보드는 3초마다 새로 그려지므로 접힘 상태는 모듈 변수에 둔다(null이면 기본: 폰은 접힘, 데스크톱은 펼침).
let bpOpen = null;
let redrawBoard = null; // mountPanels가 drawBoard를 넣는다
function renderBp(view) {
  const phone = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  const open = bpOpen ?? !phone;
  const box = el("div", "bp");
  const pg = view.progress.bp;
  const head = el("button", "bp-head");
  head.type = "button"; head.setAttribute("aria-expanded", String(open));
  const miss = pg ? (pg.missingAreas.length ? ` · 빠진 핵심 영역 ${pg.missingAreas.length}` : " · 핵심 영역 모두 확정") : "";
  head.append(el("span", "bp-title", `${open ? "▾" : "▸"} BP · 사업계획`), el("small", "", pg ? `${pg.done}/${pg.total} 확정${miss}` : "정보 없음"));
  head.addEventListener("click", () => { bpOpen = !open; redrawBoard?.(); });
  box.append(head);
  if (open) {
    box.append(el("div", "role-note", "누구에게 팔고 어떻게 벌고 버틸지, 사업 근거를 확정한다. PRD의 '왜'를 사업 쪽에서 받친다."));
    if (!view.bp.length) box.append(el("div", "empty", "BP 정보 없음"));
    for (const x of view.bp) {
      const row = el("div", "bp-row");
      row.append(el("span", "bp-area", x.areaLabel), el("span", "bp-text", (x.order !== null ? `${x.order}. ` : "") + x.title + (x.next ? "  ▶ 다음" : "")), el("span", "chip prd-" + String(x.status).replace(/[^a-z]/g, ""), x.label));
      if (x.note) row.append(el("small", "bp-note", x.note));
      box.append(row);
    }
    if (pg && pg.missingAreas.length) box.append(el("div", "bp-miss", "확정 항목이 없는 핵심 영역: " + pg.missingAreas.join(" · ")));
  }
  return box;
}

function renderAgentDetail(box, d) {
  box.replaceChildren();
  if (!d) return;
  const root = el("div", "agd " + String(d.status).replace(/[^a-z]/g, ""));
  root.style.borderLeftColor = d.color;
  const head = el("div", "agd-head");
  const close = el("button", "agd-close", "닫기"); close.type = "button";
  close.addEventListener("click", () => { openAgentId = null; onAgentOpen?.(); });
  head.append(el("span", "agd-name", `${d.name} 작업 화면`), el("small", "", d.statusLabel), close);
  root.append(head);
  if (d.note) root.append(el("div", "agd-note", d.note));
  const cur = el("div", "agd-cur");
  if (d.current) {
    cur.append(el("div", "agd-cur-title", `지금: ${d.current.title}`), el("small", "", `${d.current.stateLabel} · ${d.current.progress}%`));
    const bar = el("div", "bar"); const fill = el("i"); fill.style.width = `${d.current.progress}%`; bar.append(fill); cur.append(bar);
  } else cur.append(el("div", "agd-cur-title", "지금 맡은 작업 없음"));
  root.append(cur);
  if (d.tasks.length) {
    root.append(el("h4", "", "맡은 작업"));
    for (const t of d.tasks) {
      const r = el("div", "agd-task " + String(t.state).replace(/[^a-z]/g, ""));
      r.append(el("span", "agd-tid", t.id), el("span", "agd-ttl", t.title), el("span", "agd-tpct", `${t.progress}%`));
      const bar = el("div", "bar"); const fill = el("i"); fill.style.width = `${t.progress}%`; bar.append(fill); r.append(bar);
      root.append(r);
    }
  }
  if (d.events.length) {
    root.append(el("h4", "", "최근 오간 문서"));
    for (const ev of d.events) root.append(el("div", "agd-ev", `${ev.time} ${ev.route} · ${ev.title}`));
  }
  box.append(root);
}

function renderBoard(body, view, now = Date.now()) {
  body.replaceChildren();
  // 진행도 3종: 서로 다른 것을 재므로 이름·기준을 붙여 따로 보여 준다.
  const pg = view.progress;
  const prog = el("div", "pg3");
  const row = (name, what, p, text, extra = "") => {
    const r = el("div", "pg-row" + (p ? "" : " na") + (extra ? " " + extra : ""));
    r.append(el("span", "pg-name", name), el("span", "pg-pct", p ? text : "—"), el("small", "pg-what", what));
    const bar = el("div", "bar"); const fill = el("i"); fill.style.width = `${p ? p.pct : 0}%`; bar.append(fill); r.append(bar);
    return r;
  };
  prog.append(
    row("PRD 확정", "무엇을·왜 만들지 요구사항을 확정한 비율", pg.prd, pg.prd ? `${pg.prd.done}/${pg.prd.total} · ${pg.prd.pct}%` : ""),
    ...(pg.bp ? [row("└ BP 확정", "사업 근거(시장·고객·수익·비용·일정 등)를 확정한 비율 — PRD 확정과 별도", pg.bp, `${pg.bp.done}/${pg.bp.total} · ${pg.bp.pct}%`, "sub")] : []),
    row("MVP 구현", "이번 출시에 포함한 범위의 구현 진행(연결된 작업 평균)", pg.mvp, pg.mvp ? `${pg.mvp.pct}%` : ""),
    row("전체 작업", "모든 작업의 진행률 평균", pg.tasks, pg.tasks ? `${pg.tasks.pct}%` : ""),
  );
  body.append(prog);
  body.append(el("h3", "", "PRD · 요구사항"), el("div", "role-note", "무엇을·왜 만들지 정한 문서의 항목. 확정되면 범위(MVP)를 정하는 근거가 된다."));
  if (!view.prd.length) body.append(el("div", "empty", "PRD 정보 없음"));
  const prdList = el("ul", "pn-mvp");
  for (const p of view.prd) {
    const li = el("li", "chip prd-" + String(p.status).replace(/[^a-z]/g, ""));
    li.append(document.createTextNode(p.title), el("small", "", p.label));
    prdList.append(li);
  }
  body.append(prdList);
  if (view.bp) body.append(renderBp(view));
  body.append(el("h3", "", "MVP · 출시 범위"), el("div", "role-note", "이번 첫 출시에 넣을 것과 뺄 것. 진행도는 연결된 작업으로 잰다."));
  if (!view.mvp.length) body.append(el("div", "empty", "MVP 정보 없음"));
  const chips = el("ul", "pn-mvp");
  for (const m of view.mvp) {
    const li = el("li", "chip " + String(m.status).replace(/[^a-z]/g, ""));
    li.append(document.createTextNode((m.order !== null ? `${m.order}. ` : "") + m.title), ...(m.next ? [el("small", "next", "다음")] : []), el("small", "", m.progress === null || m.status !== "in" ? m.label : `${m.label} · ${m.progress}%`));
    chips.append(li);
  }
  body.append(chips, el("h3", "", "구역별 담당"));
  if (!view.zones.length) body.append(el("div", "empty", "구역 정보 없음"));
  const grow = [];
  for (const z of view.zones) {
    const box = el("div", "zone");
    const head = el("div", "zone-head");
    head.append(el("span", "zone-name", z.name), el("span", z.ownerKnown ? "zone-owner" : "zone-owner unknown", " · " + z.ownerName));
    box.append(head);
    for (const t of z.tasks) {
      const state = String(t.state).replace(/[^a-z]/g, "");
      const flashing = (flashUntil.get(t.id) ?? 0) > now;
      const row = el("div", "task " + state + (t.missing ? " missing" : "") + (flashing ? " flash" : ""));
      row.dataset.taskId = t.id;
      const bar = el("div", "bar");
      const fill = document.createElement("i");
      const prev = lastPct.get(t.id);
      fill.style.width = (prev === undefined ? t.progress : prev) + "%";
      if (prev !== undefined && prev !== t.progress) grow.push([fill, t.progress]);
      lastPct.set(t.id, t.progress);
      bar.append(fill);
      row.append(el("span", "task-id", t.id), el("span", "task-title", t.title), el("span", "task-pct", t.progress + "%"), bar);
      box.append(row);
    }
    body.append(box);
  }
  if (grow.length) requestAnimationFrame(() => requestAnimationFrame(() => { for (const [f, v] of grow) f.style.width = v + "%"; }));
}

function renderLog(body, rows, freshIds) {
  body.replaceChildren();
  if (!rows.length) { body.append(el("div", "empty", "이벤트 없음")); return; }
  for (const r of rows) {
    const item = el("div", freshIds.has(r.id) ? "ev fresh" : "ev");
    const main = el("div");
    main.append(el("span", "ev-route", (r.teamRoute || r.route) + " "), el("span", "ev-title", r.title));
    item.append(el("span", "ev-time", r.time), main, el("div", "ev-sum", r.summary));
    body.append(item);
  }
}

/** store: createStore() 결과. rootElement: 게시판을 넣을 요소(이벤트 로그는 화면 하단 좌측에 고정). */
export function mountPanels(store, rootElement, options = {}) {
  const host = rootElement || document.body;
  const board = makePanel("pn-board", "메인 보드");
  const log = makePanel("pn-log", "이벤트 로그");
  // renderBoard가 비우는 영역과 '내 지시' 자리를 나눈다.
  const agentsBox = el("div", "ag-box");
  const boardMain = el("div", "board-main");
  const cmdSlot = el("div", "cmd-slot");
  const agentDetailBox = el("div", "agd-box");
  board.body.append(agentsBox, agentDetailBox, createLoadLocal(store, { publicMode: options.publicMode }).root, createDayMode().root, cmdSlot, boardMain);
  host.append(board.root, log.root);
  const view = createView(store, { select: (id) => teamTabs.select(id) });
  const teamTabs = createTeamTabs(store, document.body, { view });
  teamTabs.onChange(() => { groupOpen.clear(); drawBoard(); });
  view.onChange(() => { groupOpen.clear(); drawBoard(); if (view.get().mode === "floor") commandsApi?.preset({ kind: "team", to: "team" }, { open: false }); });
  // 팀 중심 화면 단축: 지시 UI가 보일 때(로그인 후)만 버튼을 그린다.
  let commandsApi = null, canCommand = false, ghMounted = false;
  createRooms(store, view, { office: options.office, cardsHost: board.body });

  // 모바일(600px 이하) 탭 바 + 시트. 데스크톱에서는 CSS로 숨긴다.
  const cmdSheet = el("section", "pn pn-cmd");
  cmdSheet.append(el("div", "pn-head", "지시"));
  const tabs = el("nav", "tabbar");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "패널 탭");
  const publicMode = options.publicMode === true;
  const sheets = { log: log.root }; // 보드는 항상 보이므로 시트가 아니다(DESIGN3.md §1)
  if (!publicMode) sheets.cmd = cmdSheet;
  const tabBtns = {};
  let active = null;
  const setActive = (name) => {
    active = name;
    for (const k of Object.keys(sheets)) {
      sheets[k].classList.toggle("sheet-open", k === name);
      tabBtns[k].setAttribute("aria-selected", String(k === name));
      tabBtns[k].classList.toggle("on", k === name);
    }
  };
  const tabDefs = [["log", "로그"]];
  if (!publicMode) tabDefs.push(["cmd", "지시"]);
  for (const [k, label] of tabDefs) {
    const b = el("button", "tab", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => setActive(active === k ? null : k)); // 기본은 모두 닫힘
    tabBtns[k] = b;
    tabs.append(b);
  }
  host.append(tabs);
  setActive(null);

  // 작업 지시: 공개판에서는 commands.js를 불러오지도, UI를 만들지도 않는다.
  // 그 외에는 /api/session이 200/401일 때만 보인다(정적 모드는 숨김).
  // __PUBLIC__은 vite define 상수(공개 빌드에서 true)라서 번들러가 이 블록과 commands.js를 통째로 지운다.
  const buildPublic = typeof __PUBLIC__ !== "undefined" && __PUBLIC__;
  if (!publicMode && !buildPublic) {
    host.append(cmdSheet);
    tabBtns.cmd.hidden = true;
    import("./commands.js").then(({ createCommandsPanel }) => {
      const { publicMode: _p, ...rest } = options;
      const commands = createCommandsPanel({ root: document.body, listSlot: cmdSlot, getStatus: () => store.state, openSheet: () => setActive("cmd"), ...rest });
      commandsApi = commands;
      store.on("state", () => commands.refreshTargets());
      cmdSheet.append(commands.sheetBody);
      commands.onVisibility((shown) => {
        tabBtns.cmd.hidden = !shown;
        const ready = commands.mode === "ready";
        if (ready !== canCommand) { canCommand = ready; drawBoard(); }
        document.body.classList.toggle("has-cmd", shown);
        if (commands.mode === "ready" && !ghMounted) { // 로그인된 서버 모드에서만 GitHub 연결 패널을 붙인다(공개판은 이 블록째 빠진다)
          ghMounted = true;
          import("./ghconnect.js").then(({ mountGhConnect }) => {
            const wrap = el("details", "ghc-wrap");
            wrap.append(el("summary", "ghc-sum", "GitHub 활동 연결"));
            cmdSlot.after(wrap);
            mountGhConnect(wrap, { onChange: () => window.dispatchEvent(new Event("gh:changed")) });
          }).catch(() => { /* 연결 패널 없이 계속 */ });
        }
        if (!shown && active === "cmd") setActive(null);
      });
      commands.start();
    }).catch(() => { /* 지시 UI 없이 계속 */ });
  }

  const evFreshUntil = new Map(); // 이벤트 id → 강조가 끝나는 시각
  let logSig = null;
  let seen = null; // 이미 그린 이벤트 id (첫 렌더는 강조하지 않는다)

  // 보드는 status가 3초마다 와도 그리는 데 쓰는 값이 그대로면 다시 만들지 않는다(누르던 버튼이 사라지지 않고 DOM을 덜 만든다).
  // 상태·보드는 내용이 같으면 store가 같은 객체를 준다. 펼침·접기·팀·화면 전환은 force로 늘 다시 그린다.
  let drawnKey = null;
  const isPhone = () => typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches; // BP 기본 펼침이 폭에 따라 다르다
  const drawBoard = (force = true) => {
    const key = [store.state, store.board, teamTabs.selected(), view.get().mode, canCommand, isPhone()];
    if (!force && drawnKey && key.every((v, i) => v === drawnKey[i])) return;
    drawnKey = key;
    if (store.state) {
      const sel = teamTabs.selected();
      const rooms = buildRoomCards(store.state);
      renderAgents(agentsBox, buildAgentGroups(store.state, sel), {
        grouped: rooms.length >= 2, mode: view.get().mode, selected: sel, room: rooms.find((r) => r.id === sel),
        canCommand, enter: (id) => view.enter(id),
        soloCmd: (id) => commandsApi?.preset({ kind: "solo", to: id }),
        teamCmd: (id) => commandsApi?.preset({ kind: "team", to: "team:" + id }),
      });
      if (openAgentId && !buildAgentDetail(store.state, openAgentId)) openAgentId = null; // 사라진 에이전트
      renderAgentDetail(agentDetailBox, openAgentId ? buildAgentDetail(store.state, openAgentId) : null);
    } else { agentsBox.replaceChildren(); agentDetailBox.replaceChildren(); }
    if (store.state && store.board) renderBoard(boardMain, buildBoardView(store.state, store.board));
    else boardMain.replaceChildren(el("div", "empty", "불러오는 중…"));
  };

  // office.js가 문서가 화이트보드에 도착할 때 보낸다. taskId가 없거나 모르는 값이면 아무것도 하지 않는다.
  window.addEventListener("office:arrive", (e) => {
    const id = e?.detail?.taskId;
    if (typeof id !== "string" || !id) return;
    flashUntil.set(id, Date.now() + FLASH_MS);
    for (const row of boardMain.querySelectorAll(".task")) if (row.dataset.taskId === id) row.classList.add("flash");
    setTimeout(() => { for (const row of boardMain.querySelectorAll(".task")) if (row.dataset.taskId === id) row.classList.remove("flash"); }, FLASH_MS);
  });
  // 테스트 훅: 작업 막대가 채워진 비율(0~1). 없는 작업은 undefined.
  window.__board = {
    progress(id) {
      for (const row of boardMain.querySelectorAll(".task")) {
        if (row.dataset.taskId === id) { const w = parseFloat(row.querySelector(".bar > i")?.style.width); return Number.isFinite(w) ? w / 100 : undefined; }
      }
      return undefined;
    },
  };
  const drawLog = () => {
    const s = store.state;
    if (!s) { logSig = null; log.body.replaceChildren(el("div", "empty", "불러오는 중…")); return; }
    const rows = buildEventRows(s.events, s.agents);
    for (const r of rows) { const e = s.events.find((x) => x.id === r.id); const tl = e && teamLabelForRoute(s, e.from, e.to); if (tl) r.teamRoute = `${tl.from} ${r.from}→${tl.to} ${r.to}`; }
    const now = Date.now();
    if (seen) for (const r of rows) if (!seen.has(r.id)) evFreshUntil.set(r.id, now + EV_FRESH_MS);
    seen = new Set(rows.map((r) => r.id));
    const fresh = new Set(rows.filter((r) => (evFreshUntil.get(r.id) ?? 0) > now).map((r) => r.id));
    // 같은 내용이면 다시 그리지 않는다(다시 그리면 강조 애니메이션이 처음부터 재시작된다).
    const sig = rows.map((r) => `${r.id}${fresh.has(r.id) ? "*" : ""}`).join(",") + "|" + rows.map((r) => `${r.from}>${r.to}:${r.teamRoute ?? ""}`).join(",");
    if (sig === logSig) return;
    logSig = sig;
    renderLog(log.body, rows, fresh);
    if (fresh.size) setTimeout(drawLog, EV_FRESH_MS + 50);
  };

  redrawBoard = drawBoard; onAgentOpen = drawBoard;
  drawBoard(); drawLog();
  store.on("state", () => { drawBoard(false); drawLog(); });
  store.on("board", () => drawBoard(false));
  store.on("events", drawLog);
}
