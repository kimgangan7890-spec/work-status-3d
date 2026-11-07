import { adhocSourcesOf, MAX_PROJECTS } from "../shared/projects.js";
import { discoverPublic, reposToProjects, mergeProjects, projectKey, ownerFromLocation, TOPIC } from "../shared/discover.js";
import { validateStatus, validateBoard } from "../shared/validate.js";
import { ADHOC_PROJECT_ID, pickLocalFiles, localErrorLines, checkLocalSize, LOCAL_BADGE, LOCAL_NEED_BOTH } from "./model.js";

export { ADHOC_PROJECT_ID };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * '내 데이터 불러오기' UI. 파일은 File.text()로 브라우저 안에서만 읽고 어디에도 보내거나 저장하지 않는다.
 * @returns {{root: HTMLElement}}
 */
export function createLoadLocal(store, opts = {}) {
  const viaServer = opts.publicMode === false; // 서버 모드면 서버가 대신 읽는다(비공개 저장소 가능). 공개판은 브라우저가 GitHub에서 직접(공개 저장소만).
  const fetchFn = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const root = el("div", "ll");
  const btn = el("button", "ll-btn", "내 데이터 불러오기");
  btn.type = "button";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.multiple = true;
  input.hidden = true;
  const msg = el("div", "ll-msg");
  msg.setAttribute("role", "status");
  const list = el("ul", "ll-errors");
  const badge = el("div", "ll-badge");
  badge.hidden = true;
  const badgeText = el("span", "ll-badge-text");
  // 직접 입력·자동 연결로 연 화면에서 처음 화면(기본 단일 화면 또는 projects.json 프로젝트)으로 돌아오는 버튼. 새로고침이 필요 없다.
  const homeBtn = el("button", "ll-btn ll-home", "처음 화면으로"); homeBtn.type = "button"; homeBtn.hidden = true;
  badge.append(badgeText, homeBtn);
  let badgeKind = null; // "auto" | "gh" | "local" | null: 누가 띄운 표시인지(다른 화면으로 바뀔 때 내려도 되는 것만 내린다)
  const showBadge = (text, kind) => { badgeText.textContent = text; badgeKind = kind; homeBtn.hidden = kind === "local"; badge.hidden = false; };
  const hideBadge = () => { badge.hidden = true; badgeKind = null; badgeText.textContent = ""; };
  const warn = document.createElement("details");
  warn.className = "ll-warn";
  warn.hidden = true;
  const ghBtn = el("button", "ll-btn", "GitHub에서 불러오기");
  ghBtn.type = "button";
  const gh = el("form", "ll-gh"); gh.hidden = true;
  const field = (label, ph) => { const i = document.createElement("input"); i.type = "text"; i.placeholder = ph; i.autocomplete = "off"; i.spellcheck = false; i.setAttribute("aria-label", label); return i; };
  const fRepo = field("저장소", "소유자/저장소"), fDir = field("폴더(선택)", "폴더 (예: status, 비우면 맨 위)"), fBranch = field("브랜치(선택)", "브랜치 (기본 main)");
  const ghGo = el("button", "ll-btn", "불러오기"); ghGo.type = "submit";
  // 자동 찾기: 저장소에 토픽(work-status-3d)만 붙여 두면 손으로 적지 않아도 사무동으로 연결된다.
  const autoBtn = el("button", "ll-btn", "내 저장소 자동 찾기"); autoBtn.type = "button";
  const fOwner = field("GitHub 사용자", "GitHub 사용자 또는 조직 이름");
  try { fOwner.value = localStorage.getItem("office.gh.owner") || ownerFromLocation(globalThis.location ?? {}) || ""; } catch { fOwner.value = ownerFromLocation(globalThis.location ?? {}); }
  const autoRow = el("div", "ll-auto");
  autoRow.append(...(viaServer ? [] : [fOwner]), autoBtn, el("small", "ll-gh-note", `저장소의 Topics에 "${TOPIC}"를 붙여 두면 찾아서 사무동으로 연결해요${viaServer ? "(서버 토큰 계정의 저장소)" : "(공개 저장소)"}.`));
  const manual = document.createElement("details"); manual.className = "ll-manual";
  manual.append(el("summary", "", "직접 입력"), fRepo, fDir, fBranch, ghGo);
  gh.append(autoRow, manual, el("small", "ll-gh-note", viaServer ? "비공개 저장소는 서버에 설정한 읽기 전용 토큰으로 읽어요. 토큰은 여기에 입력하지 않아요." : "공개 저장소만 읽을 수 있어요. 비공개 저장소는 서버 모드가 필요해요."));
  root.append(btn, ghBtn, gh, input, msg, list, badge, warn);
  try { const s = JSON.parse(localStorage.getItem("office.gh") || "null"); if (s) { fRepo.value = s.repo ?? ""; fDir.value = s.dir ?? ""; fBranch.value = s.branch ?? ""; } } catch { /* 저장이 막혀도 계속 */ }
  let ghUrl = null; // 지금 보고 있는 직접 입력 저장소의 주소. 다른 프로젝트로 바뀌면 GitHub 표시를 내린다.
  // 진행 중인 자동 찾기·직접 입력(한 번에 하나). 처음 화면으로·다른 사무동 선택·내 파일 불러오기처럼 화면이 다른 곳으로 바뀌면
  // 요청을 취소(AbortController)하고 세대 번호를 올려, 늦게 온 응답이 바뀐 화면을 다시 덮지 못하게 한다.
  let opSeq = 0, pending = null, applying = false; // pending: { id, ctl, kind: "auto"|"gh" }
  const MSG_BUSY = { auto: "찾는 중…", gh: "불러오는 중…" };
  function idle() { autoBtn.disabled = false; ghGo.disabled = false; }
  function beginOp(kind) {
    cancelOp();
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    pending = { id: ++opSeq, ctl, kind };
    autoBtn.disabled = true; ghGo.disabled = true; clear(); msg.textContent = MSG_BUSY[kind];
    const signal = ctl?.signal;
    const id = pending.id;
    return { id, live: () => pendingId() === id, fetch: (u, o = {}) => fetchFn(u, signal ? { ...o, signal } : o) };
  }
  const pendingId = () => pending?.id ?? -1;
  /** 진행 중 요청을 버린다. 버튼·"찾는 중…" 안내도 원래대로 돌린다. */
  function cancelOp() {
    if (!pending) return;
    const { ctl, kind } = pending; pending = null;
    try { ctl?.abort(); } catch { /* 무시 */ }
    if (msg.textContent === MSG_BUSY[kind]) msg.textContent = "";
    idle();
  }
  function endOp(id) { if (pendingId() !== id) return; const { kind } = pending; pending = null; if (msg.textContent === MSG_BUSY[kind]) msg.textContent = ""; idle(); }
  /** 결과를 화면에 적용하는 동안 생기는 reset은 내가 낸 것이라 취소하지 않는다. */
  const apply = (fn) => { applying = true; try { fn(); } finally { applying = false; } };
  // 화면(프로젝트)이 바뀔 때마다: 직접 입력 저장소를 벗어났으면 그 표시를 내리고, 자동으로 찾은 카드를 보고 있을 때만 "자동 연결" 표시를 단다.
  store.on?.("reset", ({ url } = {}) => {
    if (pending && !applying) cancelOp(); // 다른 곳에서 화면을 바꿨으면 진행 중 요청은 버린다
    if (ghUrl && url === ghUrl) return; // setSource는 내 파일 보기도 끝내므로 "내 파일" 표시도 여기서 내린다
    ghUrl = null;
    const cur = globalThis.__campus?.current?.();
    if (cur?.adhoc) showBadge(`자동 연결: ${cur.name}`, "auto"); else hideBadge();
  });
  homeBtn.addEventListener("click", () => {
    cancelOp(); // 진행 중인 자동 찾기·직접 입력의 응답이 돌아온 화면을 다시 바꾸지 않게
    ghUrl = null; clear(); hideBadge(); warn.hidden = true;
    gh.hidden = true; manual.open = false; // 열려 있던 GitHub 입력 폼도 닫는다(입력값은 그대로 둔다)
    globalThis.__campus?.home?.();
  });
  ghBtn.addEventListener("click", () => { gh.hidden = !gh.hidden; });
  autoBtn.addEventListener("click", async () => {
    if (pending) return; // 찾는 중·불러오는 중에는 무시(버튼도 꺼져 있다)
    const op = beginOp("auto");
    const fail = (...a) => { if (op.live()) failMsg(...a); };
    try {
      let found;
      if (viaServer) {
        let res; try { res = await op.fetch("/api/gh/discover", { cache: "no-store", credentials: "same-origin" }); } catch { res = null; }
        if (!op.live()) return;
        if (!res) { fail([], "서버에 연결하지 못했어요"); return; }
        if (res.status === 401) { fail([], "로그인이 필요해요"); return; }
        if (res.status === 400) { fail([], "서버에 GITHUB_TOKEN이 설정되지 않았어요"); return; }
        if (res.status === 429) { fail([], tooMany(res)); return; }
        if (!res.ok) { fail([], "GitHub에서 저장소 목록을 읽지 못했어요. 서버 토큰 권한을 확인해 주세요"); return; }
        let body; try { body = await res.json(); } catch { fail([], "서버 응답을 읽지 못했어요"); return; }
        if (!op.live()) return;
        found = { ok: true, projects: reposToProjects(Array.isArray(body.projects) ? body.projects : [], { viaServer: true }) };
      } else {
        found = await discoverPublic(fOwner.value.trim(), op.fetch);
        if (!op.live()) return;
        if (!found.ok) { fail([], found.error); return; }
        try { localStorage.setItem("office.gh.owner", fOwner.value.trim()); } catch { /* 저장이 막혀도 계속 */ }
      }
      const campus = globalThis.__campus;
      if (!found.projects.length) { fail([], `토픽 "${TOPIC}"가 붙고 status.json이 있는 저장소를 찾지 못했어요. 저장소 About의 Topics에 추가해 주세요`); return; }
      if (!campus) { fail([], "사무동 목록을 열 수 없어요"); return; }
      // 합치면서 id가 바뀌거나(충돌) 이미 있던 항목으로 합쳐질 수 있으니, 고를 카드는 저장소 키로 찾는다.
      // 이전에 자동으로 찾은 카드는 지우고 이번 결과로 바꾼다(저장소에서 토픽을 뗀 카드가 새로고침 전까지 남지 않게).
      const merged = mergeProjects((campus.list?.() ?? []).filter((p) => !p.adhoc), found.projects);
      const keys = new Set(found.projects.map(projectKey)), hit = merged.filter((p) => keys.has(projectKey(p)));
      if (!hit.length) { fail([], `사무동은 최대 ${MAX_PROJECTS}개까지예요. 찾은 저장소를 더할 자리가 없어요`); return; }
      apply(() => campus.setProjects(merged, { selectId: hit[0].id }));
      // 표시는 지금 선택된 카드 하나만. 다른 카드로 바꾸면 reset 핸들러가 그 카드에 맞게 고친다.
      clear(); ghUrl = null; showBadge(`자동 연결: ${campus.current?.()?.name ?? hit[0].name}`, "auto"); warn.hidden = true; gh.hidden = true;
    } finally { endOp(op.id); }
  });
  const tooMany = (res) => { const sec = Number(res.headers?.get?.("Retry-After")); return `너무 자주 불러왔어요. ${sec > 0 ? sec + "초 뒤에" : "잠시 후"} 다시 해 주세요`; };
  async function getJson(url, fetchOp = fetchFn) {
    let res;
    try { res = await fetchOp(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" }); } catch { return { err: "GitHub에 연결하지 못했어요" }; }
    if (res.status === 401) return { err: "로그인이 필요해요(서버 모드)" };
    if (res.status === 404) return { err: viaServer ? "서버에서 이 기능을 쓸 수 없어요" : "파일을 찾지 못했어요. 저장소·폴더·브랜치를 확인하고, 비공개 저장소는 서버 모드가 필요해요" };
    if (res.status === 400) return { err: "저장소·폴더·브랜치 형식이 맞지 않아요" };
    if (res.status === 422) return { err: "파일 형식이 맞지 않아요(DATA.md 형식이 아님)" };
    if (res.status === 429) return { err: tooMany(res) };
    if (res.status === 502) return { err: "GitHub에서 읽지 못했어요. 저장소 이름과 서버 토큰 권한을 확인해 주세요" };
    if (!res.ok) return { err: `불러오지 못했어요(HTTP ${res.status})` };
    try { return { data: await res.json() }; } catch { return { err: "JSON 형식이 아니에요" }; }
  }
  gh.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pending) return; // 불러오는 중 다시 제출(Enter 연타 등)은 무시
    const a = adhocSourcesOf({ repo: fRepo.value, branch: fBranch.value, dir: fDir.value }, { viaServer });
    if (!a.ok) { fail(a.errors.map((x) => x.replace(/^projects\[\d+\]: /, "")), "입력을 확인해 주세요."); return; }
    const op = beginOp("gh");
    try {
      const [s, b] = await Promise.all([getJson(a.sources.url, op.fetch), getJson(a.sources.boardUrl, op.fetch)]);
      if (!op.live()) return; // 그 사이 처음 화면으로·다른 화면으로 바뀌었으면 결과를 버린다
      const errs = [];
      if (s.err) errs.push(`status.json: ${s.err}`); else errs.push(...validateStatus(s.data).map((x) => `status.json: ${x}`));
      if (b.err) errs.push(`board.json: ${b.err}`); else errs.push(...validateBoard(b.data).map((x) => `board.json: ${x}`));
      if (errs.length) { fail(errs, "불러오지 못했어요. 화면은 바뀌지 않았어요."); return; }
      try { localStorage.setItem("office.gh", JSON.stringify({ repo: fRepo.value.trim(), dir: fDir.value.trim(), branch: fBranch.value.trim() })); } catch { /* 저장이 막혀도 계속 */ }
      // 직접 입력한 저장소는 프로젝트 목록과 별개. 비워 두면 지시가 기본 프로젝트로 잘못 기록되므로,
      // 어떤 projects.json id와도 맞지 않는 값을 넣어 서버가 지시를 거절하게 한다(지시 목록도 비어 보인다).
      globalThis.__projectId = ADHOC_PROJECT_ID; globalThis.__campus?.markStale?.(); // 카드를 다시 눌러도 전환되게
      ghUrl = a.sources.url;
      apply(() => store.setSource(a.sources)); // 이후 주기적으로 다시 읽는다
      clear();
      showBadge(`GitHub: ${a.project.repo}${a.project.dir ? "/" + a.project.dir : ""}`, "gh");
      warn.hidden = true; gh.hidden = true;
    } finally { endOp(op.id); }
  });

  const clear = () => { msg.textContent = ""; list.replaceChildren(); };
  const failMsg = (lines, head) => {
    clear();
    if (head) msg.textContent = head;
    for (const l of localErrorLines(lines)) list.append(el("li", "", l));
  };
  const fail = failMsg;

  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const picked = Array.from(input.files || []);
    input.value = ""; // 같은 파일을 다시 고를 수 있게
    if (!picked.length) return;
    if (picked.length === 1) { fail([], LOCAL_NEED_BOTH); return; }
    if (picked.length > 2) { fail([], "파일은 두 개까지만 고를 수 있어요. " + LOCAL_NEED_BOTH); return; }
    const files = [];
    for (const f of picked) {
      const sz = checkLocalSize(f.name, f.size);
      let text = "";
      if (sz.ok) {
        try { text = await f.text(); } catch { fail([`${f.name}: 파일을 읽지 못했어요`]); return; }
      }
      files.push({ name: f.name, size: f.size, text });
    }
    const res = pickLocalFiles(files);
    if (!res.ok) { fail(res.reasons); return; }
    const out = store.loadLocal(res.status, res.board);
    if (!out || !out.ok) { fail(out?.errors ?? ["불러오지 못했어요"], "데이터를 바꾸지 않았어요. 아래를 고쳐서 다시 골라 주세요."); return; }
    cancelOp(); // 내 파일로 바꿨으니 진행 중인 GitHub 요청의 결과는 버린다
    clear();
    showBadge(LOCAL_BADGE, "local");
    warn.replaceChildren();
    const w = Array.isArray(out.warnings) ? out.warnings : [];
    warn.hidden = w.length === 0;
    if (w.length) {
      warn.append(el("summary", "", `확인할 점 ${w.length}건`));
      const ul = el("ul");
      for (const t of w) ul.append(el("li", "", String(t)));
      warn.append(ul);
    }
  });

  return { root };
}
