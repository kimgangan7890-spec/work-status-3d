import "./panels.css";
import { buildBoardView, buildEventRows, buildAgentGroups, teamLabelForRoute, buildRoomCards } from "./model.js";
import { createView } from "./view.js";
import { createRooms } from "./rooms.js";
import { createTeamTabs } from "./teams.js";
import { createLoadLocal } from "./loadlocal.js";

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

function agentCard(c, onCommand) {
  const card = el("div", "ag " + String(c.status).replace(/[^a-z]/g, ""));
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

function renderBoard(body, view, now = Date.now()) {
  body.replaceChildren();
  body.append(el("h3", "", "MVP"));
  if (!view.mvp.length) body.append(el("div", "empty", "MVP 정보 없음"));
  const chips = el("ul", "pn-mvp");
  for (const m of view.mvp) {
    const li = el("li", "chip " + String(m.status).replace(/[^a-z]/g, ""));
    li.append(document.createTextNode(m.title), el("small", "", m.label));
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
  const boardMain = el("div");
  const cmdSlot = el("div", "cmd-slot");
  board.body.append(agentsBox, createLoadLocal(store).root, cmdSlot, boardMain);
  host.append(board.root, log.root);
  const view = createView(store, { select: (id) => teamTabs.select(id) });
  const teamTabs = createTeamTabs(store, document.body, { view });
  teamTabs.onChange(() => { groupOpen.clear(); drawBoard(); });
  view.onChange(() => { groupOpen.clear(); drawBoard(); if (view.get().mode === "floor") commandsApi?.preset({ kind: "team", to: "team" }, { open: false }); });
  // 팀 중심 화면 단축: 지시 UI가 보일 때(로그인 후)만 버튼을 그린다.
  let commandsApi = null, canCommand = false;
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
        if (!shown && active === "cmd") setActive(null);
      });
      commands.start();
    }).catch(() => { /* 지시 UI 없이 계속 */ });
  }

  const evFreshUntil = new Map(); // 이벤트 id → 강조가 끝나는 시각
  let logSig = null;
  let seen = null; // 이미 그린 이벤트 id (첫 렌더는 강조하지 않는다)

  const drawBoard = () => {
    if (store.state) {
      const sel = teamTabs.selected();
      const rooms = buildRoomCards(store.state);
      renderAgents(agentsBox, buildAgentGroups(store.state, sel), {
        grouped: rooms.length >= 2, mode: view.get().mode, selected: sel, room: rooms.find((r) => r.id === sel),
        canCommand, enter: (id) => view.enter(id),
        soloCmd: (id) => commandsApi?.preset({ kind: "solo", to: id }),
        teamCmd: (id) => commandsApi?.preset({ kind: "team", to: "team:" + id }),
      });
    } else agentsBox.replaceChildren();
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

  drawBoard(); drawLog();
  store.on("state", () => { drawBoard(); drawLog(); });
  store.on("board", drawBoard);
  store.on("events", drawLog);
}
