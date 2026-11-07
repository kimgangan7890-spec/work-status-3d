// 서버 모드용 "GitHub 활동 연결" 패널 (DESIGN9 §5, 계약 v1.0.2). 자동 마운트하지 않는다 — mountGhConnect만 export.
// 토큰은 입력란 → 요청 본문으로만 지나간다. 저장·로그·URL·DOM에 남기지 않는다.
import { GH_API } from "../shared/ghcontract.js";

export const MAX_REPOS = 12;
export const CONN_ERROR_TEXT = {
  expired: "토큰이 만료됐어요. 새 토큰으로 다시 연결해 주세요.",
  revoked: "토큰이 취소됐어요. 새 토큰으로 다시 연결해 주세요.",
  rate_limited: "GitHub 호출 한도에 걸렸어요. 잠시 뒤 다시 시도해 주세요.",
  invalid: "토큰을 확인할 수 없어요. 권한(Contents·Metadata 읽기)과 값을 확인해 주세요.",
};
export const DISABLED_TEXT = "서버에 WORK3D_SECRET_KEY가 설정되지 않아 GitHub 연결을 쓸 수 없어요.";
export const SYNC_TEXT = { ok: "최신", syncing: "동기화 중", stale: "오래됨", error: "오류" };
const MANUAL_PROJECTS = "/api/projects"; // 기존(수동) 사무동 목록. GH_API에는 없는 기존 경로
const DEVICE_URI = "https://github.com/login/device"; // 서버가 준 값이 정확히 이 주소일 때만 링크로 만든다
const DEVICE_UNAVAILABLE_TEXT = "서버에 GITHUB_APP_CLIENT_ID가 없어요. 토큰 직접 입력을 쓰세요.";
const DEVICE_END_TEXT = { DEVICE_EXPIRED: "코드가 만료됐어요. 다시 로그인해 주세요.", DEVICE_DENIED: "GitHub에서 로그인을 거절했어요.", NO_DEVICE_FLOW: "진행 중인 로그인이 없어요. 다시 시작해 주세요." };
const NEW_LABEL = "새 사무동(gh-…)";
const NEW_ONLY_NOTE = "새 사무동은 카드가 없어 아래 동기화 상태 목록에서만 지표가 보여요.";
const ROW_ERROR_TEXT = { INVALID_PROJECT: "연결할 수 없는 사무동이에요.", DUPLICATE_PROJECT: "이미 다른 저장소가 연결된 사무동이에요.", DUPLICATE_REPO: "이미 연결된 저장소예요.", PROJECT_LIMIT: `사무동은 최대 ${MAX_REPOS}개까지 연결돼요.` };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // 사용자 문자열은 textContent로만
  return n;
}

/** @returns {{root:HTMLElement, refresh:()=>Promise<void>, ready:Promise<void>}} */
export function mountGhConnect(container, opts = {}) {
  const fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const root = el("section", "ghc");
  root.setAttribute("aria-label", "GitHub 활동 연결");
  const msg = el("div", "ghc-msg"); msg.setAttribute("role", "status");
  const body = el("div", "ghc-body");
  root.append(el("h3", "ghc-title", "GitHub 활동 연결"), msg, body);
  container.append(root);

  const call = async (url, method = "GET", payload) => {
    const init = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (payload !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(payload); }
    const res = await fetchFn(url, init);
    let data = null;
    try { data = await res.json(); } catch { /* 본문 없음 */ }
    const ra = Number(res.headers?.get?.("Retry-After"));
    return { ok: res.ok, status: res.status, data, retryAfter: Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : null };
  };
  const changed = () => { try { opts.onChange?.(); } catch { /* 알림 실패는 무시 */ } };
  const say = (t) => { msg.textContent = t || ""; };
  const failText = (r, fallback) => (r.status === 429 ? `${r.retryAfter ?? 60}초 뒤 다시 시도해 주세요.` : fallback);

  // Device Flow 진행 상태. device code는 받지도 보내지도 않는다(서버 보관). 타이머는 stopFlow()로만 정리한다.
  let flow = null; // { gen, poll, tick }
  let flowGen = 0;
  function stopFlow() { flowGen++; if (flow) { clearTimeout(flow.poll); clearInterval(flow.tick); flow = null; } }

  function renderDisabled() { stopFlow(); body.replaceChildren(el("p", "ghc-note", DISABLED_TEXT)); }

  function startDeviceUi(area, restart) {
    const go = el("button", "ghc-btn ghc-btn-main", "GitHub로 로그인(권장)"); go.type = "button";
    go.addEventListener("click", async () => {
      go.disabled = true; say("");
      try {
        const r = await call(GH_API.deviceStart, "POST", {});
        if (r.ok && typeof r.data?.userCode === "string") return showCode(area, r.data, restart);
        if (r.status === 503 && r.data?.code === "CONNECTION_DISABLED") return renderDisabled();
        if (r.status === 503 && r.data?.code === "DEVICE_FLOW_UNAVAILABLE") return restart({ note: DEVICE_UNAVAILABLE_TEXT, openPat: true });
        say(failText(r, "로그인을 시작하지 못했어요."));
      } catch { say("서버에 연결할 수 없어요."); }
      go.disabled = false;
    });
    area.replaceChildren(go);
  }

  function showCode(area, d, restart) {
    stopFlow();
    const gen = flowGen, f = (flow = { gen, poll: null, tick: null });
    let interval = Number.isFinite(d.interval) && d.interval > 0 ? d.interval : 5;
    const expiresAt = Date.now() + (Number.isFinite(d.expiresIn) ? d.expiresIn : 900) * 1000;
    const code = el("div", "ghc-code", d.userCode); // textContent
    const copy = el("button", "ghc-btn", "복사"); copy.type = "button";
    copy.addEventListener("click", () => { try { const p = globalThis.navigator?.clipboard?.writeText(d.userCode); p?.catch?.(() => {}); } catch { /* 복사 실패는 무시 */ } });
    let where;
    if (d.verificationUri === DEVICE_URI) {
      where = document.createElement("a"); where.className = "ghc-link"; where.href = DEVICE_URI; where.target = "_blank"; where.rel = "noopener noreferrer"; where.textContent = DEVICE_URI;
    } else where = el("span", "ghc-link", typeof d.verificationUri === "string" ? d.verificationUri : "");
    const left = el("div", "ghc-note ghc-left");
    const cancel = el("button", "ghc-btn", "취소"); cancel.type = "button";
    cancel.addEventListener("click", () => { stopFlow(); say("로그인을 취소했어요."); restart({}); });
    const paintLeft = () => {
      const sec = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      left.textContent = `남은 시간 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      return sec;
    };
    paintLeft();
    area.replaceChildren(el("p", "ghc-note", "아래 주소에서 이 코드를 입력하고 승인해 주세요."), code, copy, where, left, cancel);
    f.tick = setInterval(() => { if (gen === flowGen && paintLeft() <= 0) { stopFlow(); say(DEVICE_END_TEXT.DEVICE_EXPIRED); restart({}); } }, 1000);
    const schedule = () => { f.poll = setTimeout(pollOnce, interval * 1000); };
    async function pollOnce() { // 탭이 숨겨져도 계속한다(사용자가 GitHub 탭에 가 있다)
      if (gen !== flowGen) return;
      let r;
      try { r = await call(GH_API.devicePoll, "POST", {}); }
      catch { if (gen !== flowGen) return; say("서버에 연결할 수 없어요. 다시 시도해요."); return schedule(); }
      if (gen !== flowGen) return;
      const status = r.data?.status;
      if (r.status === 200 && status === "connected") {
        stopFlow();
        let info = r.data.connection;
        try { const c = await call(GH_API.connection); if (c.ok && c.data?.connected) info = c.data; } catch { /* 응답의 connection 사용 */ }
        await show(info ?? { connected: false }); changed(); return;
      }
      if (r.status === 202 || (r.ok && status === "pending")) {
        const ra = Number(r.data?.retryAfterSec); if (Number.isFinite(ra) && ra > 0) interval = ra; // slow_down이면 서버가 늘린 값
        return schedule();
      }
      const c = r.data?.code;
      if (r.status === 429) { const ra = r.retryAfter ?? Number(r.data?.retryAfterSec); if (Number.isFinite(ra) && ra > 0) interval = Math.max(interval, ra); say(`${interval}초 뒤 다시 확인해요.`); return schedule(); }
      stopFlow();
      if (r.status === 503 && c === "DEVICE_FLOW_UNAVAILABLE") return restart({ note: DEVICE_UNAVAILABLE_TEXT, openPat: true });
      if (r.status === 503 && c === "CONNECTION_DISABLED") return renderDisabled();
      say(DEVICE_END_TEXT[c] ?? "로그인을 확인하지 못했어요. 다시 시도해 주세요.");
      restart({});
    }
    schedule();
  }

  function renderForm(error, { note, openPat } = {}) {
    stopFlow();
    const wrap = el("div", "ghc-login-box");
    if (error) wrap.append(el("p", "ghc-err", CONN_ERROR_TEXT[error] ?? CONN_ERROR_TEXT.invalid));
    if (note) wrap.append(el("p", "ghc-err", note));
    const deviceArea = el("div", "ghc-device");
    startDeviceUi(deviceArea, (o) => renderForm(null, o));
    const pat = el("details", "ghc-pat"); pat.open = Boolean(openPat);
    pat.append(el("summary", "ghc-sum", "토큰 직접 입력"));
    const form = el("form", "ghc-form");
    form.append(el("p", "ghc-note", "fine-grained 토큰을 권장해요. 필요한 읽기 권한은 Contents와 Metadata뿐이에요. 토큰은 서버에만 암호화해 보관하고 이 화면에는 저장되지 않아요."));
    const input = el("input", "ghc-input");
    input.type = "password"; input.autocomplete = "off"; input.spellcheck = false;
    input.setAttribute("aria-label", "GitHub 토큰");
    input.placeholder = "GitHub 토큰";
    const btn = el("button", "ghc-btn", error ? "다시 연결" : "연결"); btn.type = "submit";
    form.append(input, btn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = { token: input.value };
      input.value = ""; // 전송 직전에 비운다
      if (!payload.token) { say("토큰을 입력해 주세요."); return; }
      btn.disabled = true; say("연결 중…");
      try {
        const r = await call(GH_API.connect, "POST", payload);
        payload.token = ""; // 참조 제거
        if (r.ok && r.data) { await show(r.data); changed(); }
        else if (r.status === 503 && r.data?.code === "CONNECTION_DISABLED") renderDisabled();
        else { say(failText(r, "")); if (r.status !== 429) { renderForm("invalid"); } }
      } catch { payload.token = ""; say("서버에 연결할 수 없어요."); }
      btn.disabled = false;
    });
    pat.append(form);
    wrap.append(deviceArea, pat);
    body.replaceChildren(wrap);
  }

  async function renderConnected(info) {
    const head = el("div", "ghc-head");
    stopFlow();
    head.append(el("span", "ghc-login", `연결됨: ${info.login ?? ""}`));
    if (info.method === "device_flow") head.append(el("span", "ghc-method", "GitHub 로그인"));
    const off = el("button", "ghc-btn", "연결 해제"); off.type = "button";
    off.addEventListener("click", async () => {
      off.disabled = true;
      try {
        const r = await call(GH_API.disconnect, "POST");
        if (!r.ok) { say(failText(r, "연결을 해제하지 못했어요.")); off.disabled = false; return; }
        await refresh(); say("연결을 해제했어요."); changed();
      } catch { say("서버에 연결할 수 없어요."); off.disabled = false; }
    });
    head.append(off);
    const perm = el("div", "ghc-note ghc-perm");
    const repoBox = el("div", "ghc-repos");
    const syncBox = el("div", "ghc-sync");
    body.replaceChildren(head, perm, repoBox, syncBox);
    const state = { info, projects: [], metrics: [] }; // projects: ProjectRef[]
    const paintPerm = () => {
      // scopesOk=false는 오류가 아니다(연결·선택 직후 정상). 지표가 모두 ok가 되면 true가 된다.
      if (state.info.scopesOk) perm.textContent = "저장소 읽기 권한을 확인했어요.";
      else perm.textContent = state.projects.length ? "권한 확인 중이에요." : "저장소를 고르면 권한을 확인해요.";
    };
    const paintSync = () => renderSync(syncBox, state);
    state.paintPerm = paintPerm; state.paintSync = paintSync;
    const [repos, projects, metrics, manual] = await Promise.all([call(GH_API.repos), call(GH_API.projects), call(GH_API.metrics), call(MANUAL_PROJECTS)]);
    state.manual = manual.ok && Array.isArray(manual.data?.projects) ? manual.data.projects : [];
    state.projects = projects.ok ? projects.data?.projects ?? [] : [];
    state.metrics = metrics.ok ? metrics.data?.metrics ?? [] : [];
    paintPerm(); paintSync();
    renderRepos(repoBox, state, repos);
  }

  function renderRepos(box, state, r) {
    if (!r.ok) { box.replaceChildren(el("p", "ghc-err", failText(r, "저장소 목록을 불러오지 못했어요."))); return; }
    const repos = r.data?.repos ?? [];
    const linked = () => new Map(state.projects.filter((p) => p.github).map((p) => [p.github.repoId, p.projectId]));
    const rows = [];
    const ul = el("ul", "ghc-list");
    const count = el("div", "ghc-count");
    const save = el("button", "ghc-btn", "저장"); save.type = "button";
    const refreshCount = () => {
      const n = rows.filter((c) => c.input.checked).length;
      count.textContent = `${n}/${MAX_REPOS}개 선택`;
      for (const c of rows) c.input.disabled = !c.input.checked && n >= MAX_REPOS; // 13번째 막기
    };
    const initial = linked();
    const targetName = (pid) => state.manual.find((m) => m.id === pid)?.name ?? (pid.startsWith("gh-") ? NEW_LABEL : pid);
    for (const repo of repos) {
      const li = el("li", "ghc-item");
      const label = el("label", "ghc-label");
      const input = document.createElement("input");
      input.type = "checkbox"; input.checked = initial.has(repo.repoId); input.value = String(repo.repoId);
      input.addEventListener("change", () => {
        if (input.checked && rows.filter((c) => c.input.checked).length > MAX_REPOS) input.checked = false;
        refreshCount();
      });
      label.append(input, el("span", "ghc-name", repo.fullName));
      if (repo.isPrivate) label.append(el("span", "ghc-priv", "비공개"));
      const note = el("div", "ghc-rownote");
      const pid = initial.get(repo.repoId);
      let select = null;
      if (pid) li.append(label, el("div", "ghc-target", `연결된 사무동: ${targetName(pid)}`));
      else {
        select = document.createElement("select"); select.className = "ghc-select";
        select.setAttribute("aria-label", `${repo.fullName} 연결할 사무동`);
        const used = new Set(state.projects.map((p) => p.projectId));
        const opt = (v, t) => { const o = document.createElement("option"); o.value = v; o.textContent = t; select.append(o); };
        opt("", NEW_LABEL);
        for (const m of state.manual) if (!used.has(m.id)) opt(m.id, m.name);
        // 수동 프로젝트의 repo가 같은 저장소면 기본으로 고른다(대소문자 무시). /api/projects가 repo를 주지 않으면 "새 사무동".
        const same = state.manual.find((m) => !used.has(m.id) && typeof m.repo === "string" && m.repo.toLowerCase() === String(repo.fullName).toLowerCase());
        select.value = same ? same.id : "";
        li.append(label, select);
      }
      li.append(note); ul.append(li); rows.push({ input, repo, note, select });
    }
    if (!repos.length) ul.append(el("li", "ghc-empty", "접근 가능한 저장소가 없어요."));
    save.addEventListener("click", async () => {
      save.disabled = true; say("");
      const cur = linked();
      let failed = false;
      try {
        for (const row of rows) {
          row.note.textContent = "";
          const id = row.repo.repoId, want = row.input.checked, have = cur.has(id);
          if (want && !have) { // 새로 체크 → 하나씩 추가
            const target = row.select?.value;
            const a = await call(GH_API.projects, "POST", target ? { repoId: id, projectId: target } : { repoId: id });
            if (a.ok && a.data?.project) { state.projects.push(a.data.project); if (!target) row.note.textContent = NEW_ONLY_NOTE; }
            else { failed = true; row.input.checked = false; row.note.textContent = ROW_ERROR_TEXT[a.data?.code] ?? failText(a, "추가하지 못했어요."); }
          } else if (!want && have) { // 체크 해제 → 제거
            const d = await call(GH_API.removeProject, "POST", { projectId: cur.get(id) });
            if (d.ok) state.projects = state.projects.filter((p) => p.projectId !== cur.get(id));
            else { failed = true; row.input.checked = true; row.note.textContent = failText(d, "제거하지 못했어요."); }
          }
        }
        refreshCount();
        const s = await call(GH_API.sync, "POST");
        if (s.ok) state.metrics = s.data?.metrics ?? state.metrics;
        else if (s.status === 429) say(failText(s, ""));
        else if (!failed) say("저장했지만 바로 조회하지 못했어요.");
        if (!failed && s.ok) say("저장했어요.");
        const c = await call(GH_API.connection);
        if (c.ok && c.data) state.info = c.data;
        state.paintPerm(); state.paintSync();
        changed();
      } catch { say("서버에 연결할 수 없어요."); }
      save.disabled = false;
    });
    box.replaceChildren(ul, count, save);
    refreshCount();
  }

  function renderSync(box, state) {
    const names = new Map(state.projects.map((p) => [p.projectId, p.github?.fullName]));
    const ul = el("ul", "ghc-synclist");
    for (const m of state.metrics) {
      const st = m.sync?.status;
      const li = el("li", `ghc-syncitem ghc-sync-${st ?? "unknown"}`);
      const when = m.sync?.lastSuccessfulSyncAt ? ` · 마지막 성공 ${m.sync.lastSuccessfulSyncAt}` : "";
      li.textContent = `${names.get(m.projectId) ?? m.projectId}: ${SYNC_TEXT[st] ?? "알 수 없음"}${when}`;
      ul.append(li);
    }
    box.replaceChildren(ul);
  }

  async function show(info) {
    say("");
    if (info?.connected) return renderConnected(info);
    return renderForm(info?.error);
  }

  async function refresh() {
    try {
      const r = await call(GH_API.connection);
      if (r.status === 503 && r.data?.code === "CONNECTION_DISABLED") { say(""); return renderDisabled(); }
      if (!r.ok || !r.data) { say(failText(r, "연결 상태를 불러오지 못했어요.")); return; }
      await show(r.data);
    } catch { say("서버에 연결할 수 없어요."); }
  }
  const ready = refresh();
  return { root, refresh, ready };
}
