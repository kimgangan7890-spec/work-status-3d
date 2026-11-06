// 로그인 폼 + 작업 지시. 이 파일만 fetch를 쓴다(같은 출처 상대경로만). DATA.md 9장.
import {
  COMMAND_MAX, COMMAND_TO, COMMAND_KIND, TEAM_TO, TEAM_LABEL, NOTICE_DELAY, NOTICE_SECRET, NOTICE_APPROVAL,
  ERROR_NETWORK, errorMessage, validateCommand, remainingChars, buildCommandRows, hasTeamTabs, teamsOf, TEAM_PREFIX,
} from "./model.js";

const POLL_MS = 5000;

/**
 * 주입: {fetch, root, setInterval, clearInterval, matchMedia, listSlot}
 *  - root: 데스크톱 하단 바를 붙일 요소
 *  - listSlot: 데스크톱에서 '내 지시' 구역을 둘 요소(게시판 안). setListSlot으로도 지정 가능
 * 반환: {bar, list, sheetBody, start, onVisibility, setListSlot, destroy}
 *  - 모바일(600px 이하)에서는 bar와 list가 sheetBody 안으로 옮겨 간다.
 */
export function createCommandsPanel(deps = {}) {
  // 로그인 직후 데이터 파일(401이었던)을 다시 받도록 화면을 새로 불러온다. 테스트에서는 주입한다.
  const onLoggedIn = deps.onLoggedIn ?? (() => globalThis.location?.reload());
  const doFetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
  const root = deps.root ?? document.body;
  const setTimer = deps.setInterval ?? ((...a) => globalThis.setInterval(...a));
  const clearTimer = deps.clearInterval ?? ((...a) => globalThis.clearInterval(...a));
  const mq = deps.matchMedia ?? (typeof window !== "undefined" && window.matchMedia ? (q) => window.matchMedia(q) : null);
  const doc = root.ownerDocument ?? document;
  let listSlot = deps.listSlot ?? null;

  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // ---- 요소 ----
  const bar = el("div", "cmd-bar"); bar.hidden = true;
  const list = el("div", "cmd-list"); list.hidden = true;
  const sheetBody = el("div", "cmd-sheet-body");

  // 로그인 폼
  const loginForm = el("form", "cmd-login"); loginForm.hidden = true;
  const pw = el("input", "cmd-input"); pw.type = "password"; pw.autocomplete = "current-password"; pw.placeholder = "암호";
  pw.setAttribute("aria-label", "암호");
  const loginBtn = el("button", "cmd-btn", "로그인"); loginBtn.type = "submit";
  const loginMsg = el("div", "cmd-msg"); loginMsg.setAttribute("role", "status");
  loginForm.append(pw, loginBtn, loginMsg);

  // 지시 폼
  const form = el("form", "cmd-form"); form.hidden = true;
  const toWrap = el("div", "cmd-to"); toWrap.setAttribute("role", "radiogroup"); toWrap.setAttribute("aria-label", "받는 사람");
  let to = "chief"; // 개인 지시의 받는 사람. 공동으로 바꿔도 기억해 둔다.
  let kind = "solo";
  const kindWrap = el("div", "cmd-kind"); kindWrap.setAttribute("role", "radiogroup"); kindWrap.setAttribute("aria-label", "지시 종류");
  const kindBtns = COMMAND_KIND.map((k) => {
    const b = el("button", "cmd-kind-btn", k.label); b.type = "button"; b.dataset.kind = k.id;
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => { kind = k.id; syncTo(); });
    kindWrap.append(b);
    return b;
  });
  const teamNote = el("span", "cmd-team-note", TEAM_LABEL); teamNote.hidden = true;
  // 받는 사람 버튼: 팀이 2개 이상이면 현재 에이전트 전체(개인)와 "전체"+팀별 "팀 전체"(공동), 아니면 지금과 같다.
  const teamWrap = el("div", "cmd-to"); teamWrap.setAttribute("role", "radiogroup"); teamWrap.setAttribute("aria-label", "받는 팀"); teamWrap.hidden = true;
  let teamTo = TEAM_TO;
  let toBtns = [], teamBtns = [];
  function targetsFor(status) {
    if (!status || !hasTeamTabs(status)) return { solo: COMMAND_TO.map((t) => ({ to: t.id, label: t.label })), team: [] };
    const names = new Map((status.agents ?? []).map((a) => [a.id, a.name]));
    const ts = teamsOf(status);
    return {
      solo: ts.flatMap((t) => t.agentIds.map((id) => ({ to: id, label: names.get(id) || id, title: t.name }))),
      team: [{ to: TEAM_TO, label: TEAM_LABEL }, ...ts.map((t) => ({ to: TEAM_PREFIX + t.id, label: t.name + " 전체" }))],
    };
  }
  function makeBtns(wrap, list, getCur, setCur) {
    wrap.replaceChildren();
    return list.map((t) => {
      const b = el("button", "cmd-to-btn", t.label); b.type = "button"; b.dataset.to = t.to;
      if (t.title) b.title = t.title;
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => { setCur(t.to); syncTo(); });
      wrap.append(b);
      return b;
    });
  }
  function rebuildTargets() {
    const t = targetsFor(deps.getStatus?.());
    if (!t.solo.some((x) => x.to === to)) to = t.solo[0]?.to ?? "chief";
    if (t.team.length && !t.team.some((x) => x.to === teamTo)) teamTo = TEAM_TO;
    toBtns = makeBtns(toWrap, t.solo, () => to, (v) => { to = v; });
    teamBtns = makeBtns(teamWrap, t.team, () => teamTo, (v) => { teamTo = v; });
    syncTo();
  }
  function syncTo() {
    for (const b of kindBtns) {
      const on = b.dataset.kind === kind;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    toWrap.hidden = kind === "team";
    teamWrap.hidden = kind !== "team" || teamBtns.length === 0;
    teamNote.hidden = kind !== "team" || teamBtns.length > 0;
    for (const b of toBtns) {
      const on = b.dataset.to === to;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    for (const b of teamBtns) {
      const on = b.dataset.to === teamTo;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
  }
  rebuildTargets();
  const input = el("input", "cmd-input"); input.type = "text";
  input.placeholder = "지시 내용"; input.setAttribute("aria-label", "지시 내용"); input.autocomplete = "off";
  const counter = el("span", "cmd-count");
  const sendBtn = el("button", "cmd-btn", "전송"); sendBtn.type = "submit";
  const notice = el("div", "cmd-notice", NOTICE_SECRET + " · " + NOTICE_DELAY);
  const msg = el("div", "cmd-msg"); msg.setAttribute("role", "status");
  form.append(kindWrap, toWrap, teamWrap, teamNote, input, counter, sendBtn, notice, msg);

  bar.append(loginForm, form);

  function updateCounter() {
    const r = remainingChars(input.value);
    counter.textContent = String(r);
    counter.classList.toggle("over", r < 0);
    counter.setAttribute("aria-label", "남은 글자 수 " + r + " / " + COMMAND_MAX);
  }
  input.addEventListener("input", updateCounter);
  updateCounter();

  // ---- 상태 ----
  let mode = "unknown"; // unknown | hidden | login | ready
  let timer = null;
  let loading = false;
  let destroyed = false;
  const visListeners = [];

  function stopPoll() { if (timer !== null) { clearTimer(timer); timer = null; } }
  function setMode(m) {
    if (destroyed || mode === m) return;
    mode = m;
    const shown = m === "login" || m === "ready";
    bar.hidden = !shown;
    loginForm.hidden = m !== "login";
    form.hidden = m !== "ready";
    list.hidden = m !== "ready";
    if (m !== "ready") stopPoll();
    for (const f of visListeners) f(shown);
  }

  async function readJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  async function checkSession() {
    let res;
    try { res = await doFetch("/api/session", { credentials: "same-origin" }); }
    catch { setMode("hidden"); return; } // 네트워크 오류 → 정적 모드
    if (res.status === 200) { setMode("ready"); loadList(); startPoll(); }
    else if (res.status === 401) setMode("login");
    else setMode("hidden"); // 404 등
  }

  function startPoll() {
    if (timer !== null || mode !== "ready") return;
    timer = setTimer(() => { if (mode === "ready") loadList(); }, POLL_MS);
  }

  function renderList(commands) {
    list.replaceChildren();
    list.append(el("h3", "", "내 지시"));
    const rows = buildCommandRows(commands, 50, deps.getStatus?.());
    if (!rows.length) list.append(el("div", "empty", "아직 보낸 지시가 없어요"));
    for (const r of rows) {
      const card = el("div", "cmd-card " + r.state);
      const head = el("div", "cmd-card-head");
      head.append(el("span", "cmd-card-to", r.target), el("span", "cmd-card-time", r.time), el("span", "cmd-chip " + r.state, r.stateLabel));
      if (r.needsApproval) head.append(el("span", "cmd-chip approval", "승인 필요"));
      card.append(head, el("div", "cmd-card-text", r.text));
      const times = [r.deliveredTime && "전달 " + r.deliveredTime, r.doneTime && "처리 " + r.doneTime].filter(Boolean).join(" · ");
      if (times) card.append(el("div", "cmd-card-time2", times));
      if (r.needsApproval) card.append(el("div", "cmd-card-warn", NOTICE_APPROVAL));
      if (r.note) card.append(el("div", "cmd-card-note", r.note));
      list.append(card);
    }
  }

  async function loadList() {
    if (mode !== "ready" || loading) return; // 로그인 전에는 요청하지 않는다
    loading = true;
    try {
      const res = await doFetch("/api/commands" + (globalThis.__projectId ? `?project=${encodeURIComponent(globalThis.__projectId)}` : ""), { credentials: "same-origin" });
      if (res.status === 401) { setMode("login"); return; }
      if (res.status !== 200) return;
      const data = await readJson(res);
      if (mode === "ready" && data && Array.isArray(data.commands)) renderList(data.commands);
    } catch { /* 직전 목록 유지 */ }
    finally { loading = false; }
  }

  // ---- 이벤트 ----
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loginBtn.disabled) return;
    loginBtn.disabled = true;
    loginMsg.textContent = "";
    let res;
    try {
      // 암호는 변수에 담지 않고 본문으로만 보낸 뒤 바로 입력창을 비운다.
      const p = doFetch("/api/login", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw.value }),
      });
      pw.value = "";
      res = await p;
    } catch {
      pw.value = "";
      loginMsg.textContent = ERROR_NETWORK;
      loginBtn.disabled = false;
      return;
    }
    loginBtn.disabled = false;
    if (res.status === 200) { await checkSession(); onLoggedIn(); return; }
    const data = await readJson(res);
    loginMsg.textContent = errorMessage(data?.code, data?.retryAfterSec);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sendBtn.disabled) return;
    const target = kind === "team" ? (teamBtns.length ? teamTo : TEAM_TO) : to;
    const v = validateCommand(target, input.value, kind, deps.getStatus?.());
    if (!v.ok) { msg.textContent = errorMessage(v.code); return; }
    sendBtn.disabled = true;
    msg.textContent = "";
    try {
      const res = await doFetch("/api/command", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, to: target, text: input.value, ...(globalThis.__projectId ? { project: globalThis.__projectId } : {}) }),
      });
      if (res.status === 201) {
        input.value = ""; updateCounter();
        msg.textContent = "보냈어요."; // 지연 안내는 위쪽 안내줄에 이미 있다
        loadList();
      } else {
        const data = await readJson(res);
        const code = res.status === 401 ? "UNAUTHENTICATED" : data?.code;
        msg.textContent = errorMessage(code, data?.retryAfterSec);
        if (res.status === 401) { loginMsg.textContent = msg.textContent; setMode("login"); }
      }
    } catch { msg.textContent = ERROR_NETWORK; }
    sendBtn.disabled = false;
  });

  // ---- 배치: 데스크톱은 바(하단 가운데)+게시판 구역, 모바일은 시트 안에 함께 ----
  const mobileQuery = mq ? mq("(max-width: 600px)") : null;
  function place() {
    if (mobileQuery && mobileQuery.matches) sheetBody.append(bar, list);
    else {
      root.append(bar);
      if (listSlot) listSlot.append(list); else list.remove();
    }
  }
  const onMq = () => place();
  if (mobileQuery) {
    if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", onMq);
    else mobileQuery.addListener?.(onMq);
  }
  place();

  // 지시 바 높이를 CSS 변수로 알려 줘서(받는 사람 버튼이 여러 줄이 돼도) 이벤트 로그가 바와 겹치지 않게 한다.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => document.documentElement.style.setProperty("--cmd-h", bar.offsetHeight + "px")).observe(bar);
  }
  /**
   * 입력창을 미리 맞춘다(DESIGN5-panels.md §5). 값만 바꾸고 보내는 규칙은 그대로다.
   * kind=team: to는 "team" 또는 알려진 팀의 "team:<id>". kind=solo: to는 알려진 에이전트 id. 잘못된 값·지시 UI가 안 보일 때는 false.
   * opts.open === false 면 시트를 열거나 입력창에 초점을 두지 않는다. 폰이면 시트를 연다(deps.openSheet).
   */
  function preset(p, opts = {}) {
    if (mode !== "ready" || !p || typeof p !== "object") return false;
    const t = targetsFor(deps.getStatus?.());
    if (p.kind === "team") {
      if (typeof p.to !== "string") return false;
      if (p.to !== TEAM_TO && !t.team.some((x) => x.to === p.to)) return false;
      kind = "team"; teamTo = p.to;
    } else if (p.kind === "solo") {
      if (typeof p.to !== "string" || !t.solo.some((x) => x.to === p.to)) return false;
      kind = "solo"; to = p.to;
    } else return false;
    syncTo();
    if (opts.open !== false) {
      if (mobileQuery && mobileQuery.matches) deps.openSheet?.();
      input.focus?.();
    }
    return true;
  }
  return {
    preset,
    bar, list, sheetBody,
    get mode() { return mode; },
    /** 보이기/숨기기가 바뀔 때 fn(shown) 호출(탭 표시 제어용). */
    onVisibility(fn) { visListeners.push(fn); },
    setListSlot(slot) { listSlot = slot; place(); },
    refreshTargets: rebuildTargets,
    start: checkSession,
    destroy() {
      destroyed = true; stopPoll();
      if (mobileQuery) {
        if (mobileQuery.removeEventListener) mobileQuery.removeEventListener("change", onMq);
        else mobileQuery.removeListener?.(onMq);
      }
      bar.remove(); list.remove();
    },
  };
}
