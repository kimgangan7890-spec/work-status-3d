import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountGhConnect, MAX_REPOS } from "../src/panels/ghconnect.js";
import { GH_API } from "../src/shared/ghcontract.js";
import { FAKE_CONNECTION, FAKE_DISCONNECTED, FAKE_EXPIRED, FAKE_REPOS, FAKE_PROJECTS, FAKE_CONNECTED_UNVERIFIED, FAKE_METRICS } from "./fixtures/gh-metrics.js";

// jsdom 미설치(기존 테스트와 같은 방식): 필요한 만큼만 흉내 낸 DOM
class N {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.handlers = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = [...n]; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  async dispatch(t) { for (const fn of this.handlers[t] ?? []) await fn({ target: this, preventDefault() {} }); }
  async click() { if (this.disabled) return; if (this.tagName === "INPUT" && this.type === "checkbox") this.checked = !this.checked; await this.dispatch("click"); if (this.tagName === "INPUT" && this.type === "checkbox") await this.dispatch("change"); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all((n) => n.className.split(" ").includes(c)); }
  byTag(t) { return this.all((n) => n.tagName === t.toUpperCase()); }
  get text() { return this.textContent + this.children.map((c) => c.text).join(""); }
  dump() { return JSON.stringify([this.textContent, this.value, this.attrs, this.placeholder ?? ""]) + this.children.map((c) => c.dump()).join(""); }
}
const TOKEN = "github_pat_FAKE0123456789abcdef";
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const res = (data, status = 200, headers = {}) => ({ ok: status < 300, status, json: async () => data, headers: { get: (k) => headers[k] ?? null } });

function makeFetch(state) {
  const calls = [];
  state.projects ??= FAKE_PROJECTS.map((p) => ({ ...p }));
  const fn = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body: init.body });
    if (state.override) { const o = state.override(url, method, body); if (o) return o; }
    if (url === GH_API.connection) return res(state.conn);
    if (url === GH_API.disconnect) { state.conn = FAKE_DISCONNECTED; return res({ ok: true }); }
    if (url === GH_API.connect) { state.conn = state.patResult ?? FAKE_CONNECTION; return res(state.conn); }
    if (url === GH_API.repos) return res({ repos: state.repos ?? FAKE_REPOS });
    if (url === GH_API.projects && method === "GET") return res({ projects: state.projects });
    if (url === GH_API.projects && method === "POST") { const r = (state.repos ?? FAKE_REPOS).find((x) => x.repoId === body.repoId); const project = { projectId: "gh-" + body.repoId.toString(36), github: r }; state.projects.push(project); return res({ project }, 201); }
    if (url === GH_API.removeProject) { state.projects = state.projects.filter((p) => p.projectId !== body.projectId); return res({ ok: true }); }
    if (url === "/api/projects") return state.manual ? res({ projects: state.manual }) : res({}, 404);
    if (url === GH_API.metrics) return res({ metrics: FAKE_METRICS });
    if (url === GH_API.sync) return res({ metrics: FAKE_METRICS });
    return res({}, 404);
  };
  fn.calls = calls;
  return fn;
}

let host, store, logSpy, errSpy;
beforeEach(() => {
  globalThis.document = { createElement: (t) => new N(t) };
  store = { n: 0, set() { this.n++; }, get() { return null; } };
  globalThis.localStorage = { setItem: (...a) => { store.n++; store.last = a; }, getItem: () => null };
  globalThis.sessionStorage = { setItem: (...a) => { store.n++; store.last = a; }, getItem: () => null };
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  host = new N("div");
});
afterEach(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks(); });

const mount = async (state) => { const f = makeFetch(state); const p = mountGhConnect(host, { fetch: f }); await flush(); return { p, f, state }; };

describe("ghconnect", () => {
  it("미연결 → PAT 제출 → 연결됨, 입력란은 비워지고 토큰은 어디에도 남지 않는다", async () => {
    const { p, f } = await mount({ conn: FAKE_DISCONNECTED });
    const input = p.root.byTag("input")[0];
    expect(input.type).toBe("password");
    expect(p.root.text).toContain("Contents");
    input.value = TOKEN;
    await p.root.byTag("form")[0].dispatch("submit");
    await flush();
    const post = f.calls.find((c) => c.url === GH_API.connect);
    expect(post.method).toBe("POST");
    expect(JSON.parse(post.body)).toEqual({ token: TOKEN });
    expect(f.calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect(p.root.text).toContain("octo-demo");
    expect(p.root.dump()).not.toContain(TOKEN);
    expect(input.value).toBe(""); // 연결 후 폼은 사라졌지만, 참조 중인 입력란도 비어 있다
    expect(store.n).toBe(0);
    expect(logSpy).not.toHaveBeenCalled(); expect(errSpy).not.toHaveBeenCalled();
  });

  it("빈 토큰은 전송하지 않는다", async () => {
    const { p, f } = await mount({ conn: FAKE_DISCONNECTED });
    await p.root.byTag("form")[0].dispatch("submit");
    expect(f.calls.some((c) => c.url === GH_API.connect)).toBe(false);
  });

  it("PAT 거부(invalid)는 안내와 다시 연결 버튼을 보인다", async () => {
    const { p } = await mount({ conn: FAKE_DISCONNECTED, patResult: { connected: false, scopesOk: false, error: "invalid" } });
    p.root.byTag("input")[0].value = TOKEN;
    await p.root.byTag("form")[0].dispatch("submit"); await flush();
    expect(p.root.text).toContain("토큰을 확인할 수 없어요");
    expect(p.root.dump()).not.toContain(TOKEN);
  });

  it("만료 상태는 한국어 안내와 다시 연결", async () => {
    const { p } = await mount({ conn: FAKE_EXPIRED });
    expect(p.root.text).toContain("만료");
    expect(p.root.byTag("button").map((b) => b.textContent)).toContain("다시 연결");
  });

  it("연결 해제 버튼은 DELETE 후 미연결 화면", async () => {
    const { p, f } = await mount({ conn: FAKE_CONNECTION });
    const off = p.root.byTag("button").find((b) => b.textContent === "연결 해제");
    await off.click(); await flush();
    expect(f.calls.some((c) => c.method === "POST" && c.url === GH_API.disconnect)).toBe(true);
    expect(p.root.byTag("input")[0].type).toBe("password");
  });

  it("저장소 목록(비공개 표시, 기존 연결 체크)과 동기화 상태 표시", async () => {
    const { p } = await mount({ conn: FAKE_CONNECTION });
    const t = p.root.text;
    expect(t).toContain("octo-demo/alpha"); expect(t).toContain("비공개");
    const boxes = p.root.byTag("input");
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);
    expect(t).toContain("1/12");
    expect(t).toContain("최신"); expect(t).toContain("동기화 중"); expect(t).toContain("오래됨"); expect(t).toContain("오류");
    expect(t).toContain("2026-11-07T10:00:00Z");
  });

  it("저장은 추가·제거 차이만 호출하고 이어서 sync", async () => {
    const { p, f } = await mount({ conn: FAKE_CONNECTION });
    const boxes = p.root.byTag("input");
    await boxes[1].click(); // beta 추가
    await boxes[0].click(); // alpha 제거
    f.calls.length = 0;
    await p.root.byTag("button").find((b) => b.textContent === "저장").click(); await flush();
    const writes = f.calls.filter((c) => c.method === "POST").map((c) => [c.url, c.body && JSON.parse(c.body)]);
    expect(writes).toEqual([[GH_API.removeProject, { projectId: "gh-rt" }], [GH_API.projects, { repoId: 1002 }], [GH_API.sync, undefined]]);
    expect(p.root.text).toContain("저장했어요");
  });

  it("바꾼 게 없으면 추가·제거 호출이 없다", async () => {
    const { p, f } = await mount({ conn: FAKE_CONNECTION });
    f.calls.length = 0;
    await p.root.byTag("button").find((b) => b.textContent === "저장").click(); await flush();
    expect(f.calls.filter((c) => c.url === GH_API.projects || c.url === GH_API.removeProject)).toEqual([]);
  });

  it("503 CONNECTION_DISABLED: 안내만 보이고 입력란 없음", async () => {
    const { p } = await mount({ conn: null, override: (u) => (u === GH_API.connection ? res({ code: "CONNECTION_DISABLED" }, 503) : null) });
    expect(p.root.text).toContain("WORK3D_SECRET_KEY");
    expect(p.root.byTag("input")).toHaveLength(0);
  });

  it("scopesOk=false(연결됨)는 오류 문구가 아니라 중립 문구", async () => {
    const { p } = await mount({ conn: FAKE_CONNECTED_UNVERIFIED, projects: [] });
    expect(p.root.text).toContain("저장소를 고르면 권한을 확인해요");
    expect(p.root.text).not.toContain("부족");
    expect(p.root.byClass("ghc-err")).toHaveLength(0);
    const q = await mount({ conn: FAKE_CONNECTED_UNVERIFIED });
    expect(q.p.root.text).toContain("권한 확인 중");
  });

  it("409 DUPLICATE_REPO·PROJECT_LIMIT는 해당 줄에 안내", async () => {
    const { p } = await mount({ conn: FAKE_CONNECTION, override: (u, m, b) => (u === GH_API.projects && m === "POST" ? res({ code: b.repoId === 1002 ? "DUPLICATE_REPO" : "PROJECT_LIMIT" }, 409) : null) });
    const boxes = p.root.byTag("input");
    await boxes[1].click(); await boxes[2].click();
    await p.root.byTag("button").find((b) => b.textContent === "저장").click(); await flush();
    const notes = p.root.byClass("ghc-rownote").map((n) => n.textContent);
    expect(notes[1]).toContain("이미 연결");
    expect(notes[2]).toContain("최대 12개");
    expect(boxes[1].checked).toBe(false);
  });

  it("429는 Retry-After 초를 안내", async () => {
    const { p } = await mount({ conn: FAKE_CONNECTION, override: (u, m) => (u === GH_API.projects && m === "POST" ? res({ code: "RATE_LIMITED" }, 429, { "Retry-After": "17" }) : null) });
    await p.root.byTag("input")[1].click();
    await p.root.byTag("button").find((b) => b.textContent === "저장").click(); await flush();
    expect(p.root.text).toContain("17초 뒤 다시 시도");
  });

  it("12개 제한: 13번째는 막힌다", async () => {
    const repos = Array.from({ length: 14 }, (_, i) => ({ repoId: 2000 + i, fullName: `octo-demo/r${i}`, isPrivate: false }));
    const { p, f } = await mount({ conn: FAKE_CONNECTION, repos, projects: [] });
    const boxes = p.root.byTag("input");
    for (let i = 0; i < MAX_REPOS; i++) await boxes[i].click();
    expect(boxes.filter((b) => b.checked).length).toBe(12);
    expect(boxes[12].disabled).toBe(true);
    await boxes[12].click();
    expect(boxes[12].checked).toBe(false);
    expect(p.root.text).toContain("12/12");
    await p.root.byTag("button").find((b) => b.textContent === "저장").click(); await flush();
    expect(f.calls.filter((c) => c.url === GH_API.projects && c.method === "POST")).toHaveLength(12);
    await boxes[0].click(); // 하나 풀면 다시 열린다
    expect(boxes[12].disabled).toBe(false);
  });

  it("사용자 문자열은 textContent로만(마크업 해석 없음)", async () => {
    const repos = [{ repoId: 5, fullName: "<img src=x onerror=alert(1)>", isPrivate: false }];
    const { p } = await mount({ conn: FAKE_CONNECTION, repos });
    expect(p.root.text).toContain("<img src=x onerror=alert(1)>");
    expect(p.root.byTag("img")).toHaveLength(0);
  });

  it("네트워크 실패는 안내 문구", async () => {
    const f = async () => { throw new Error("x"); };
    const p = mountGhConnect(host, { fetch: f }); await flush();
    expect(p.root.text).toContain("서버에 연결할 수 없어요");
  });

  const saveBtn = (p) => p.root.byTag("button").find((b) => b.textContent === "저장");
  const selects = (p) => p.root.byTag("select");

  it("사무동 선택: 기본값은 repo가 같은 수동 프로젝트(대소문자 무시), 불일치면 새 사무동", async () => {
    const manual = [{ id: "web", name: "웹", repo: "Octo-Demo/BETA" }, { id: "app", name: "앱", repo: "octo-demo/other" }];
    const { p } = await mount({ conn: FAKE_CONNECTION, manual });
    const sel = selects(p); // alpha는 이미 연결 → select 없음, beta·gamma만
    expect(sel).toHaveLength(2);
    expect(sel[0].value).toBe("web");
    expect(sel[1].value).toBe("");
    expect(sel[0].children.map((o) => o.textContent)).toEqual(["새 사무동(gh-…)", "웹", "앱"]);
  });

  it("이미 연결된 줄은 대상 표시만", async () => {
    const { p } = await mount({ conn: FAKE_CONNECTION, manual: [{ id: "web", name: "웹" }] });
    expect(p.root.text).toContain("연결된 사무동: 새 사무동(gh-…)");
  });

  it("수동 프로젝트를 고르면 POST에 projectId 포함", async () => {
    const manual = [{ id: "web", name: "웹", repo: "octo-demo/beta" }];
    const { p, f } = await mount({ conn: FAKE_CONNECTION, manual });
    await p.root.byTag("input")[1].click();
    f.calls.length = 0;
    await saveBtn(p).click(); await flush();
    const post = f.calls.find((c) => c.url === GH_API.projects && c.method === "POST");
    expect(JSON.parse(post.body)).toEqual({ repoId: 1002, projectId: "web" });
  });

  it("새 사무동으로 연결하면 projectId 없이 POST하고 안내 한 줄", async () => {
    const { p, f } = await mount({ conn: FAKE_CONNECTION, manual: [{ id: "web", name: "웹" }] });
    await p.root.byTag("input")[1].click();
    f.calls.length = 0;
    await saveBtn(p).click(); await flush();
    expect(JSON.parse(f.calls.find((c) => c.url === GH_API.projects && c.method === "POST").body)).toEqual({ repoId: 1002 });
    expect(p.root.text).toContain("동기화 상태 목록에서만");
  });

  it("서버가 projectId를 거부하면 해당 줄 안내", async () => {
    const manual = [{ id: "web", name: "웹", repo: "octo-demo/beta" }, { id: "app", name: "앱", repo: "octo-demo/gamma" }];
    const { p } = await mount({ conn: FAKE_CONNECTION, manual, override: (u, m, b) => (u === GH_API.projects && m === "POST" ? res({ code: b.projectId === "web" ? "INVALID_PROJECT" : "DUPLICATE_PROJECT" }, b.projectId === "web" ? 400 : 409) : null) });
    await p.root.byTag("input")[1].click(); await p.root.byTag("input")[2].click();
    await saveBtn(p).click(); await flush();
    const notes = p.root.byClass("ghc-rownote").map((n) => n.textContent);
    expect(notes[1]).toContain("연결할 수 없는 사무동");
    expect(notes[2]).toContain("이미 다른 저장소");
  });
});

describe("ghconnect Device Flow", () => {
  const START = { userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 };
  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
  const startBtn = (p) => p.root.byTag("button").find((b) => b.textContent === "GitHub로 로그인(권장)");
  const btn = (p, t) => p.root.byTag("button").find((b) => b.textContent === t);
  // polls: 순서대로 devicePoll 응답을 준다(소진되면 pending)
  const setup = async ({ start = res(START, 200), polls = [], conn = FAKE_DISCONNECTED } = {}) => {
    vi.useFakeTimers();
    const state = { conn, polls: [...polls], pollTimes: [] };
    state.override = (u, m) => {
      if (u === GH_API.deviceStart) return start;
      if (u === GH_API.devicePoll) { state.pollTimes.push(Date.now()); const n = state.polls.shift() ?? res({ status: "pending", retryAfterSec: 5 }, 202); if (n.ok && n.status === 200) state.conn = FAKE_CONNECTION_DEVICE; return n; }
      return null;
    };
    const f = makeFetch(state); const p = mountGhConnect(host, { fetch: f }); await settle();
    return { p, f, state };
  };
  const FAKE_CONNECTION_DEVICE = { ...FAKE_CONNECTION, method: "device_flow" };
  afterEach(() => vi.useRealTimers());

  it("미연결 화면: 로그인 버튼이 PAT 입력보다 위, PAT는 접힌 details", async () => {
    const { p } = await setup();
    const kids = p.root.all(() => true);
    const iBtn = kids.indexOf(startBtn(p)), iInput = kids.indexOf(p.root.byTag("input")[0]);
    expect(iBtn).toBeGreaterThan(-1); expect(iBtn).toBeLessThan(iInput);
    const d = p.root.byTag("details")[0];
    expect(d.open).toBe(false); expect(d.text).toContain("토큰 직접 입력");
  });

  it("시작 → 코드·링크·남은 시간 → pending → connected(GitHub 로그인 표시, onChange)", async () => {
    const onChange = vi.fn();
    vi.useFakeTimers();
    const state = { conn: FAKE_DISCONNECTED, n: 0 };
    state.override = (u) => {
      if (u === GH_API.deviceStart) return res(START);
      if (u === GH_API.devicePoll) { if (++state.n < 2) return res({ status: "pending", retryAfterSec: 5 }, 202); state.conn = { ...FAKE_CONNECTION, method: "device_flow" }; return res({ status: "connected", connection: state.conn }); }
      return null;
    };
    const f = makeFetch(state); const p = mountGhConnect(host, { fetch: f, onChange }); await settle();
    await startBtn(p).click(); await settle();
    expect(p.root.text).toContain("ABCD-EFGH"); expect(p.root.text).toContain("남은 시간 15:00");
    const a = p.root.byTag("a")[0];
    expect(a.href).toBe("https://github.com/login/device"); expect(a.target).toBe("_blank"); expect(a.rel).toBe("noopener noreferrer");
    expect(f.calls.find((c) => c.url === GH_API.deviceStart).body).toBe("{}");
    await settle(5000); expect(p.root.text).toContain("ABCD-EFGH"); // pending
    await settle(5000);
    expect(p.root.text).toContain("연결됨: octo-demo"); expect(p.root.text).toContain("GitHub 로그인");
    expect(p.root.text).not.toContain("ABCD-EFGH");
    expect(onChange).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.calls.filter((c) => c.url === GH_API.devicePoll).every((c) => c.body === "{}")).toBe(true);
  });

  it("retryAfterSec가 늘면(slow_down) 다음 폴링 간격이 늘어난다", async () => {
    const { p, state } = await setup({ polls: [res({ status: "pending", retryAfterSec: 10 }, 202)] });
    await startBtn(p).click(); await settle();
    await settle(5000); expect(state.pollTimes).toHaveLength(1);
    await settle(9000); expect(state.pollTimes).toHaveLength(1);
    await settle(1000); expect(state.pollTimes).toHaveLength(2);
    expect(state.pollTimes[1] - state.pollTimes[0]).toBe(10000);
  });

  it.each([
    [res({ code: "DEVICE_EXPIRED" }, 410), "만료"],
    [res({ code: "DEVICE_DENIED" }, 403), "거절"],
  ])("종료 응답 %#은 안내 후 시작 화면으로, 타이머 정리", async (poll, text) => {
    const { p } = await setup({ polls: [poll] });
    await startBtn(p).click(); await settle(); await settle(5000);
    expect(p.root.text).toContain(text); expect(p.root.text).not.toContain("ABCD-EFGH");
    expect(startBtn(p)).toBeTruthy(); expect(vi.getTimerCount()).toBe(0);
  });

  it("DEVICE_FLOW_UNAVAILABLE(시작·폴링 모두): 안내하고 PAT 영역을 펼친다", async () => {
    const a = await setup({ start: res({ code: "DEVICE_FLOW_UNAVAILABLE" }, 503) });
    await startBtn(a.p).click(); await settle();
    expect(a.p.root.text).toContain("GITHUB_APP_CLIENT_ID"); expect(a.p.root.byTag("details")[0].open).toBe(true);
    vi.useRealTimers(); host = new N("div");
    const b = await setup({ polls: [res({ code: "DEVICE_FLOW_UNAVAILABLE" }, 503)] });
    await startBtn(b.p).click(); await settle(); await settle(5000);
    expect(b.p.root.text).toContain("GITHUB_APP_CLIENT_ID"); expect(b.p.root.byTag("details")[0].open).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("429는 안내하고 간격을 늘려 계속한다", async () => {
    const { p, state } = await setup({ polls: [res({ code: "RATE_LIMITED" }, 429, { "Retry-After": "20" })] });
    await startBtn(p).click(); await settle(); await settle(5000);
    expect(p.root.text).toContain("20초 뒤"); expect(p.root.text).toContain("ABCD-EFGH");
    await settle(19000); expect(state.pollTimes).toHaveLength(1);
    await settle(1000); expect(state.pollTimes).toHaveLength(2);
    btn(p, "취소") && await btn(p, "취소").click();
  });

  it("취소하면 폴링이 멈추고 타이머가 남지 않는다", async () => {
    const { p, state } = await setup();
    await startBtn(p).click(); await settle(); await settle(5000);
    expect(state.pollTimes).toHaveLength(1);
    await btn(p, "취소").click(); await settle();
    expect(vi.getTimerCount()).toBe(0);
    await settle(60000); expect(state.pollTimes).toHaveLength(1);
    expect(p.root.text).toContain("취소했어요"); expect(startBtn(p)).toBeTruthy();
  });

  it("만료 시간이 지나면 스스로 끝낸다", async () => {
    const { p } = await setup({ start: res({ ...START, expiresIn: 3, interval: 60 }) });
    await startBtn(p).click(); await settle(); await settle(3500);
    expect(p.root.text).toContain("만료"); expect(vi.getTimerCount()).toBe(0);
  });

  it("verificationUri가 정확히 github.com/login/device가 아니면 링크 없이 텍스트만", async () => {
    for (const uri of ["https://github.com/login/device/evil", "https://evil.example/login/device", "javascript:alert(1)"]) {
      host = new N("div");
      const { p } = await setup({ start: res({ ...START, verificationUri: uri }) });
      await startBtn(p).click(); await settle();
      expect(p.root.byTag("a")).toHaveLength(0); expect(p.root.text).toContain(uri);
      await btn(p, "취소").click(); vi.useRealTimers();
    }
  });

  it("userCode는 textContent로만(마크업 해석 없음)", async () => {
    const { p } = await setup({ start: res({ ...START, userCode: "<img src=x onerror=1>" }) });
    await startBtn(p).click(); await settle();
    expect(p.root.byTag("img")).toHaveLength(0); expect(p.root.text).toContain("<img src=x onerror=1>");
    await btn(p, "취소").click();
  });

  it("복사 버튼은 clipboard 실패를 무시한다", async () => {
    const { p } = await setup();
    await startBtn(p).click(); await settle();
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    await expect(btn(p, "복사").click()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    await btn(p, "취소").click();
  });

  it("method=device_flow가 아니면(PAT) GitHub 로그인 표시 없음", async () => {
    const p = (await mount({ conn: FAKE_CONNECTION })).p;
    expect(p.root.text).not.toContain("GitHub 로그인");
  });
});

