import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLoadLocal, ADHOC_PROJECT_ID } from "../src/panels/loadlocal.js";
import { createCampus } from "../src/panels/campus.js";

// ---- 아주 작은 가짜 DOM(vitest 환경이 node이고 jsdom은 쓰지 않는다) ----
class N {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.handlers = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.value = ""; this.parent = null; }
  append(...n) { for (const c of n) { c.parent = this; this.children.push(c); } }
  prepend(...n) { for (const c of n) c.parent = this; this.children.unshift(...n); }
  replaceChildren(...n) { this.children = []; this.append(...n); }
  after(n) { const i = this.parent.children.indexOf(this); n.parent = this.parent; this.parent.children.splice(i + 1, 0, n); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  async dispatch(t, e = {}) { for (const fn of this.handlers[t] ?? []) await fn({ target: this, preventDefault() {}, ...e }); }
  click() { return this.dispatch("click"); }
  get classList() { const self = this; return { toggle(c, on) { const s = new Set(self.className.split(" ").filter(Boolean)); (on ?? !s.has(c)) ? s.add(c) : s.delete(c); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; }
  querySelector(sel) { return this.all((n) => sel === "#" + n.id)[0] ?? null; }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(c) { return this.all((n) => n.className.split(" ").includes(c)); }
  get text() { return this.textContent + this.children.map((c) => c.text).join(""); }
}
const store = () => {
  const h = {}, calls = [];
  return { calls, on: (n, fn) => (h[n] ||= []).push(fn), emit: (n, v) => (h[n] ?? []).forEach((fn) => fn(v)), setSource(src) { calls.push(src); this.emit("reset", { url: src.url }); } };
};
const jsonRes = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
const statusOf = (n) => ({ meta: { project: "p", updatedAt: "2026-01-01T09:00:00+09:00", schemaVersion: 1 }, agents: Array.from({ length: n }, (_, i) => ({ id: "a" + i, name: "a" + i, role: "r", status: "idle", currentTaskId: null, note: "" })), tasks: [], events: [] });

let host, st, saved, homeCalls;
beforeEach(() => {
  const doc = { createElement: (t) => new N(t) };
  globalThis.document = doc;
  saved = new Map();
  globalThis.localStorage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, String(v)) };
  globalThis.location = { search: "", hostname: "" };
  host = new N("div"); const hud = new N("div"); hud.id = "hud"; host.append(hud);
  st = store(); homeCalls = [];
  delete globalThis.__projectId; delete globalThis.__campus;
});
afterEach(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.location; delete globalThis.__campus; delete globalThis.__projectId; });

function setup({ publicMode = true, projects = [], fetch, reload } = {}) {
  const campus = createCampus({
    host, projects, base: "", viaServer: !publicMode, reload, fetchFn: async () => jsonRes(statusOf(2)),
    onSelect: (p, src) => { globalThis.__projectId = p.adhoc ? ADHOC_PROJECT_ID : p.id; st.setSource(src); },
    onHome: (src) => { homeCalls.push(src); globalThis.__projectId = undefined; st.setSource(src); },
  });
  globalThis.__campus = campus;
  const ll = createLoadLocal(st, { publicMode, fetch });
  const q = (c) => ll.root.byClass(c)[0];
  return { campus, ll, q, badge: q("ll-badge"), text: () => q("ll-badge-text").textContent, home: q("ll-home"), msg: q("ll-msg"), errs: q("ll-errors"), autoBtn: ll.root.all((n) => n.textContent === "내 저장소 자동 찾기")[0], form: q("ll-gh") };
}
const fakeSearch = (repos) => async (url) => {
  if (String(url).startsWith("https://api.github.com/search/")) return jsonRes({ items: repos.map((r) => ({ full_name: r, default_branch: "main", private: false })) });
  return jsonRes(statusOf(1)); // raw.githubusercontent.com의 status.json
};

describe("loadlocal: 직접 입력 검증", () => {
  it("저장소 형식이 틀리면 오류를 보이고 화면(store)은 바꾸지 않는다", async () => {
    const s = setup();
    const [repo] = s.ll.root.all((n) => n.attrs["aria-label"] === "저장소");
    repo.value = "../x";
    await s.form.dispatch("submit");
    expect(s.msg.textContent).toBe("입력을 확인해 주세요.");
    expect(s.errs.children.length).toBeGreaterThan(0);
    expect(st.calls).toEqual([]);
    expect(s.badge.hidden).toBe(true);
  });
});

describe("loadlocal: 자동 찾기", () => {
  it("누르는 동안 버튼이 비활성이고(busy), 끝나면 다시 켜진다. 겹쳐 눌러도 한 번만 찾는다", async () => {
    let release; const gate = new Promise((r) => (release = r));
    const fetch = vi.fn(async (url) => { if (String(url).startsWith("https://api.github.com/search/")) { await gate; return jsonRes({ items: [] }); } return jsonRes(statusOf(1)); });
    const s = setup({ fetch }); s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = "own";
    const p1 = s.autoBtn.click(); await Promise.resolve();
    expect(s.autoBtn.disabled).toBe(true); expect(s.msg.textContent).toBe("찾는 중…");
    await s.autoBtn.click(); // 두 번째 클릭은 무시
    release(); await p1;
    expect(fetch.mock.calls.filter(([u]) => String(u).startsWith("https://api.github.com/search/")).length).toBe(1);
    expect(s.autoBtn.disabled).toBe(false);
    expect(s.msg.textContent).toContain("work-status-3d"); // 못 찾았다는 안내
  });
  it("사용자 이름이 비면 오류만 보이고 버튼은 다시 켜진다", async () => {
    const s = setup({ fetch: fakeSearch(["own/a"]) });
    await s.autoBtn.click();
    expect(s.msg.textContent).toContain("이름"); expect(s.autoBtn.disabled).toBe(false); expect(s.badge.hidden).toBe(true);
  });
});

describe("loadlocal·campus: 자동 연결 뒤 돌아오기·정리·표시", () => {
  async function found(s, owner = "own") { s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = owner; await s.autoBtn.click(); }

  it("③ '자동 연결' 표시는 선택된 카드에만 붙고 다른 카드로 바꾸면 따라가거나 내려간다", async () => {
    const s = setup({ projects: [{ id: "mine", name: "내것" }], fetch: fakeSearch(["own/alpha", "own/beta"]) });
    await found(s);
    expect(s.campus.list().map((p) => p.name)).toEqual(["내것", "alpha", "beta"]);
    expect(s.badge.hidden).toBe(false); expect(s.text()).toBe("자동 연결: alpha"); expect(s.home.hidden).toBe(false);
    s.campus.select("gh-beta"); expect(s.text()).toBe("자동 연결: beta");
    s.campus.select("mine"); expect(s.badge.hidden).toBe(true); expect(globalThis.__projectId).toBe("mine");
    s.campus.select("gh-alpha"); expect(s.badge.hidden).toBe(false); expect(s.text()).toBe("자동 연결: alpha");
    expect(globalThis.__projectId).toBe(ADHOC_PROJECT_ID);
  });

  it("① 카드가 하나뿐이어도 '처음 화면으로'로 새로고침 없이 기본 화면에 돌아온다", async () => {
    const s = setup({ fetch: fakeSearch(["own/alpha"]) });
    await found(s);
    expect(s.campus.list().length).toBe(1); expect(s.badge.hidden).toBe(false);
    await s.home.click();
    expect(homeCalls.length).toBe(1);
    expect(homeCalls[0]).toMatchObject({ url: "status.json", boardUrl: "board.json" });
    expect(globalThis.__projectId).toBeUndefined();
    expect(s.campus.list()).toEqual([]); expect(s.campus.current()).toBeNull();
    expect(s.badge.hidden).toBe(true);
  });

  it("① projects.json 프로젝트가 있으면 자동 카드만 지우고 그 프로젝트로 돌아온다", async () => {
    const s = setup({ projects: [{ id: "mine", name: "내것" }, { id: "two", name: "둘" }], fetch: fakeSearch(["own/alpha"]) });
    await found(s);
    expect(globalThis.__projectId).toBe(ADHOC_PROJECT_ID);
    await s.home.click();
    expect(s.campus.list().map((p) => p.id)).toEqual(["mine", "two"]);
    expect(s.campus.current().id).toBe("mine"); expect(globalThis.__projectId).toBe("mine");
    expect(homeCalls).toEqual([]); expect(s.badge.hidden).toBe(true);
  });

  it("② 다시 찾으면 이전에 자동으로 찾은 카드는 정리되고 새 결과로 바뀐다", async () => {
    let repos = ["own/alpha", "own/beta"];
    const s = setup({ projects: [{ id: "mine", name: "내것" }], fetch: async (u, o) => fakeSearch(repos)(u, o) });
    await found(s);
    expect(s.campus.list().map((p) => p.name)).toEqual(["내것", "alpha", "beta"]);
    repos = ["own/gamma"];
    await found(s);
    expect(s.campus.list().map((p) => p.name)).toEqual(["내것", "gamma"]);
    expect(s.text()).toBe("자동 연결: gamma");
  });

  it("직접 입력 표시에도 '처음 화면으로'가 있고, 누르면 직접 입력 화면을 벗어난다", async () => {
    const fetch = async (u) => jsonRes(String(u).includes("board") ? { mvp: [], zones: [] } : statusOf(1));
    const s = setup({ fetch });
    const f = (l) => s.ll.root.all((n) => n.attrs["aria-label"] === l)[0];
    f("저장소").value = "own/repo";
    await s.form.dispatch("submit");
    expect(globalThis.__projectId).toBe(ADHOC_PROJECT_ID); expect(s.text()).toContain("GitHub: own/repo"); expect(s.home.hidden).toBe(false);
    await s.home.click();
    expect(homeCalls.length).toBe(1); expect(globalThis.__projectId).toBeUndefined(); expect(s.badge.hidden).toBe(true);
  });
});

describe("처음 화면으로: 입력 폼 정리", () => {
  it("폼을 다시 열어 오류가 난 상태에서 '처음 화면으로'를 누르면 폼이 닫히고 오류·안내가 지워진다(입력값은 유지)", async () => {
    const s = setup({ fetch: fakeSearch(["own/alpha"]) });
    s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = "own";
    await s.autoBtn.click();
    expect(s.badge.hidden).toBe(false); expect(s.form.hidden).toBe(true);
    const ghBtn = s.ll.root.all((n) => n.textContent === "GitHub에서 불러오기")[0];
    await ghBtn.click(); expect(s.form.hidden).toBe(false);
    const manual = s.ll.root.byClass("ll-manual")[0]; manual.open = true;
    const f = (l) => s.ll.root.all((n) => n.attrs["aria-label"] === l)[0];
    f("저장소").value = "잘못된 입력";
    await s.form.dispatch("submit");
    expect(s.msg.textContent).not.toBe(""); expect(s.errs.children.length).toBeGreaterThan(0);
    await s.home.click();
    expect(s.form.hidden).toBe(true); expect(manual.open).toBe(false);
    expect(s.msg.textContent).toBe(""); expect(s.errs.children.length).toBe(0);
    expect(f("저장소").value).toBe("잘못된 입력");
  });
});

describe("검수 보강: 저장값·내 파일 표시·429", () => {
  async function found(s, owner = "own") { s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = owner; await s.autoBtn.click(); }

  it("'처음 화면으로'는 자동 연결 직전에 보던 projects.json 프로젝트로 돌아온다(자동 카드 id는 저장하지 않는다)", async () => {
    const s = setup({ projects: [{ id: "mine", name: "내것" }, { id: "two", name: "둘" }], fetch: fakeSearch(["own/alpha"]) });
    s.campus.select("two");
    await found(s);
    expect(s.campus.current().adhoc).toBe(true);
    expect(saved.get("office.project")).toBe("two");
    await s.home.click();
    expect(s.campus.current().id).toBe("two"); expect(globalThis.__projectId).toBe("two");
  });

  it("내 파일을 본 뒤 다른 사무동으로 바꾸면 '내 데이터' 표시를 내린다", async () => {
    const s = setup({ projects: [{ id: "mine", name: "내것" }, { id: "two", name: "둘" }] });
    st.loadLocal = () => ({ ok: true, warnings: [] });
    const input = s.ll.root.all((n) => n.type === "file")[0];
    const file = (name, v) => { const text = JSON.stringify(v); return { name, size: text.length, text: async () => text }; };
    input.files = [file("status.json", statusOf(1)), file("board.json", { mvp: [], zones: [] })];
    await input.dispatch("change");
    expect(s.badge.hidden).toBe(false); expect(s.text()).toContain("내 데이터"); expect(s.home.hidden).toBe(true);
    s.campus.select("two");
    expect(s.badge.hidden).toBe(true);
  });

  it("서버 모드 자동 찾기가 429면 권한 문제가 아니라 너무 잦다고 알린다", async () => {
    const fetch = async () => ({ ok: false, status: 429, headers: { get: (k) => (k === "Retry-After" ? "30" : null) }, json: async () => ({ code: "TOO_MANY", retryAfterSec: 30 }) });
    const s = setup({ publicMode: false, fetch });
    await s.autoBtn.click();
    expect(s.msg.textContent).toBe("너무 자주 불러왔어요. 30초 뒤에 다시 해 주세요");
  });
});

describe("진행 중 '처음 화면으로' 레이스(늦은 응답이 돌아온 화면을 덮지 않는다)", () => {
  // 응답을 붙잡아 두는 fetch. hold=true인 동안 온 요청은 release()까지 기다린다. rejectOnAbort면 취소 신호에 실제 fetch처럼 실패한다.
  function gated(base, { rejectOnAbort = false } = {}) {
    const waiting = [], signals = [];
    const f = vi.fn((u, o = {}) => {
      if (!f.hold) return base(u, o);
      signals.push(o.signal);
      return new Promise((res, rej) => {
        waiting.push(() => res(base(u, o)));
        if (rejectOnAbort) o.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    });
    f.hold = false; f.signals = signals;
    f.release = async () => { f.hold = false; while (waiting.length) waiting.shift()(); for (let i = 0; i < 50; i++) await Promise.resolve(); };
    return f;
  }
  const owner = (s, v = "own") => { s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = v; };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  it("자동 찾기 중 '처음 화면으로' → 응답이 와도 처음 화면(projects.json 프로젝트)이 유지되고 버튼·안내가 정리된다", async () => {
    let repos = ["own/alpha"];
    const fetch = gated((u, o) => fakeSearch(repos)(u, o));
    const s = setup({ projects: [{ id: "mine", name: "내것" }, { id: "two", name: "둘" }], fetch });
    owner(s); await s.autoBtn.click();
    expect(s.campus.current().adhoc).toBe(true); expect(s.home.hidden).toBe(false);
    repos = ["own/beta"]; fetch.hold = true;
    const p = s.autoBtn.click(); await flush();
    expect(s.autoBtn.disabled).toBe(true); expect(s.msg.textContent).toBe("찾는 중…");
    await s.home.click();
    expect(s.campus.current().id).toBe("mine"); expect(s.autoBtn.disabled).toBe(false); expect(s.msg.textContent).toBe("");
    expect(fetch.signals.every((x) => x?.aborted)).toBe(true); // 진행 중 요청은 취소된다
    await fetch.release(); await p;
    expect(s.campus.list().map((x) => x.id)).toEqual(["mine", "two"]);
    expect(s.campus.current().id).toBe("mine"); expect(globalThis.__projectId).toBe("mine");
    expect(s.badge.hidden).toBe(true); expect(s.autoBtn.disabled).toBe(false); expect(s.msg.textContent).toBe("");
  });

  it("자동 찾기 중 '처음 화면으로'(기본 단일 화면) → 취소로 실패한 요청의 오류도 보이지 않는다", async () => {
    let repos = ["own/alpha"];
    const fetch = gated((u, o) => fakeSearch(repos)(u, o), { rejectOnAbort: true });
    const s = setup({ fetch });
    owner(s); await s.autoBtn.click();
    expect(s.campus.list().length).toBe(1);
    repos = ["own/beta"]; fetch.hold = true;
    const p = s.autoBtn.click(); await flush();
    await s.home.click(); await p; await fetch.release();
    expect(s.campus.list()).toEqual([]); expect(s.campus.current()).toBeNull();
    expect(globalThis.__projectId).toBeUndefined(); expect(homeCalls.length).toBe(1);
    expect(s.msg.textContent).toBe(""); expect(s.errs.children.length).toBe(0); expect(s.badge.hidden).toBe(true);
  });

  it("직접 입력 중 '처음 화면으로' → 응답이 와도 직접 입력 저장소로 다시 바뀌지 않는다", async () => {
    const fetch = gated(async (u) => jsonRes(String(u).includes("board") ? { mvp: [], zones: [] } : statusOf(1)));
    const s = setup({ fetch });
    const f = (l) => s.ll.root.all((n) => n.attrs["aria-label"] === l)[0];
    f("저장소").value = "own/repo"; await s.form.dispatch("submit");
    expect(globalThis.__projectId).toBe(ADHOC_PROJECT_ID);
    f("저장소").value = "own/other"; fetch.hold = true;
    const ghGo = s.ll.root.all((n) => n.textContent === "불러오기" && n.type === "submit")[0];
    const p = s.form.dispatch("submit"); await flush();
    expect(ghGo.disabled).toBe(true); expect(s.msg.textContent).toBe("불러오는 중…");
    await s.home.click();
    const callsAfterHome = st.calls.length;
    await fetch.release(); await p;
    expect(st.calls.length).toBe(callsAfterHome); // 늦은 응답으로 setSource가 다시 불리지 않는다
    expect(st.calls.at(-1)).toMatchObject({ url: "status.json" });
    expect(globalThis.__projectId).toBeUndefined(); expect(s.badge.hidden).toBe(true);
    expect(ghGo.disabled).toBe(false); expect(s.msg.textContent).toBe("");
    expect(saved.get("office.gh")).toContain("own/repo"); // 버린 요청의 입력값은 저장하지 않는다
  });

  it("찾는 중 다른 사무동 카드를 골라도 늦은 결과가 화면을 덮지 않는다", async () => {
    const fetch = gated(fakeSearch(["own/alpha"]));
    const s = setup({ projects: [{ id: "mine", name: "내것" }, { id: "two", name: "둘" }], fetch });
    owner(s); fetch.hold = true;
    const p = s.autoBtn.click(); await flush();
    s.campus.select("two");
    await fetch.release(); await p;
    expect(s.campus.current().id).toBe("two"); expect(s.campus.list().some((x) => x.adhoc)).toBe(false);
    expect(s.autoBtn.disabled).toBe(false);
  });

  it("취소한 뒤 다시 찾으면 정상으로 연결된다", async () => {
    let repos = ["own/alpha"];
    const fetch = gated((u, o) => fakeSearch(repos)(u, o));
    const s = setup({ projects: [{ id: "mine", name: "내것" }], fetch });
    owner(s); await s.autoBtn.click();
    fetch.hold = true; const p = s.autoBtn.click(); await flush();
    await s.home.click(); await fetch.release(); await p;
    fetch.hold = false; repos = ["own/gamma"];
    await s.autoBtn.click();
    expect(s.campus.current().name).toBe("gamma"); expect(s.text()).toBe("자동 연결: gamma");
  });
});

describe("프로젝트 목록 다시 읽기(refresh)", () => {
  const P = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
  const cardNames = (s) => s.campus.root.byClass("campus-name").map((n) => n.textContent);

  it("reload가 없으면 새로고침 동작이 숨겨져 있다", () => {
    const s = setup({ projects: P("a", "b") });
    expect(s.campus.root.byClass("campus-foot")[0].hidden).toBe(true);
    return expect(s.campus.refresh()).resolves.toEqual({ ok: false });
  });
  it("버튼으로 새 목록을 반영한다(보던 프로젝트는 유지, 전환 호출 없음)", async () => {
    let cur = P("a", "b");
    const s = setup({ projects: cur, reload: async () => cur });
    s.campus.select("b"); st.calls.length = 0;
    cur = P("a", "b", "c");
    await s.campus.root.byClass("campus-refresh")[0].click();
    expect(cardNames(s)).toEqual(["A", "B", "C"]);
    expect(s.campus.current().id).toBe("b"); expect(st.calls.length).toBe(0);
    expect(s.campus.root.byClass("campus-note")[0].textContent).toContain("3개");
  });
  it("읽기에 실패(null·예외)하면 기존 목록을 유지하고 오류 안내를 낸다", async () => {
    for (const bad of [async () => null, async () => { throw new Error("x"); }]) {
      const s = setup({ projects: P("a", "b"), reload: bad });
      st.calls.length = 0;
      expect(await s.campus.refresh()).toEqual({ ok: false });
      expect(cardNames(s)).toEqual(["A", "B"]); expect(st.calls.length).toBe(0);
      const note = s.campus.root.byClass("campus-note")[0];
      expect(note.textContent).toContain("읽지 못했어요"); expect(note.className).toContain("err");
    }
  });
  it("보던 프로젝트가 사라지면 남은 프로젝트로 전환한다", async () => {
    let cur = P("a", "b", "c");
    const s = setup({ projects: cur, reload: async () => cur });
    s.campus.select("c"); st.calls.length = 0;
    cur = P("a", "b");
    await s.campus.refresh();
    expect(s.campus.current().id).toBe("a"); expect(st.calls.length).toBe(1);
  });
  it("목록이 비면 기본 화면으로 돌아간다(onHome)", async () => {
    let cur = P("a", "b");
    const s = setup({ projects: cur, reload: async () => cur });
    cur = [];
    await s.campus.refresh();
    expect(homeCalls.length).toBe(1); expect(s.campus.current()).toBeNull(); expect(s.campus.list()).toEqual([]);
  });
  it("자동으로 찾은 카드는 새로고침 뒤에도 남는다", async () => {
    const s = setup({ projects: P("a", "b"), reload: async () => P("a", "b"), fetch: fakeSearch(["own/alpha"]) });
    s.ll.root.all((n) => n.attrs["aria-label"] === "GitHub 사용자")[0].value = "own";
    await s.autoBtn.click();
    expect(s.campus.current().adhoc).toBe(true);
    st.calls.length = 0;
    await s.campus.refresh();
    expect(s.campus.current().adhoc).toBe(true); expect(s.campus.list().length).toBe(3); expect(st.calls.length).toBe(0);
  });
  it("변화가 없으면 카드를 다시 그리지 않는다", async () => {
    const s = setup({ projects: P("a", "b"), reload: async () => P("a", "b") });
    const before = s.campus.root.byClass("campus-card")[0];
    await s.campus.refresh({ silent: true });
    expect(s.campus.root.byClass("campus-card")[0]).toBe(before);
  });
  it("프로젝트가 없다가 생기면 첫 프로젝트를 연다", async () => {
    let cur = [];
    const s = setup({ projects: [], reload: async () => cur });
    cur = P("a", "b"); st.calls.length = 0;
    await s.campus.refresh();
    expect(s.campus.current().id).toBe("a"); expect(st.calls.length).toBe(1);
  });
  it("직접 입력으로 다른 저장소를 보는 중이면 주기 재조회로 목록이 바뀌어도 화면을 되돌리지 않는다", async () => {
    let cur = P("a", "b");
    const s = setup({ projects: cur, reload: async () => cur, fetch: async (u) => jsonRes(String(u).includes("board") ? { mvp: [], zones: [] } : statusOf(1)) });
    const f = (l) => s.ll.root.all((n) => n.attrs["aria-label"] === l)[0];
    f("저장소").value = "own/repo"; await s.form.dispatch("submit");
    expect(s.text()).toContain("GitHub: own/repo"); st.calls.length = 0;
    cur = P("a", "b", "c"); await s.campus.refresh({ silent: true });
    expect(st.calls.length).toBe(0); expect(s.text()).toContain("GitHub: own/repo"); expect(cardNames(s)).toEqual(["A", "B", "C"]);
    cur = P("b", "c"); await s.campus.refresh({ silent: true }); // 보던 카드(a)가 사라져도 직접 입력 화면은 그대로
    expect(st.calls.length).toBe(0); expect(globalThis.__projectId).toBe(ADHOC_PROJECT_ID);
    await s.campus.root.byClass("campus-card")[0].click(); // 카드를 누르면 그때 전환한다
    expect(st.calls.length).toBe(1);
  });
  it("보던 프로젝트의 저장소 주소가 바뀌면 다시 불러온다", async () => {
    let cur = [{ id: "a", name: "A", repo: "own/x" }, { id: "b", name: "B" }];
    const s = setup({ projects: cur, reload: async () => cur });
    st.calls.length = 0;
    cur = [{ id: "a", name: "A", repo: "own/y" }, { id: "b", name: "B" }];
    await s.campus.refresh({ silent: true });
    expect(st.calls.length).toBe(1); expect(st.calls[0].url).toContain("own/y");
  });
  it("읽는 중에 다시 부르면(버튼·주기 재조회 겹침) 한 번만 읽고 버튼은 꺼져 있다", async () => {
    let release, n = 0; const gate = new Promise((r) => (release = r));
    const s = setup({ projects: P("a", "b"), reload: async () => { n++; await gate; return P("a", "b", "c"); } });
    const btn = s.campus.root.byClass("campus-refresh")[0];
    const p1 = s.campus.refresh();
    expect(btn.disabled).toBe(true);
    expect(await s.campus.refresh({ silent: true })).toEqual({ ok: false });
    release(); expect(await p1).toEqual({ ok: true });
    expect(n).toBe(1); expect(btn.disabled).toBe(false); expect(cardNames(s)).toEqual(["A", "B", "C"]);
  });
});

describe("단지 요약 공급", () => {
  it("열림·단지 모드가 한 폴링을 공유하며 중지하면 더 읽지 않는다", async () => {
    vi.useFakeTimers();
    const c=setup({projects:[{id:"a",name:"A"},{id:"b",name:"B"}]}).campus;
    const updates=[];c.onSummaries(v=>updates.push(v));
    c.setCampusActive(true);await c.refreshSummaries();expect(updates).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30000);expect(updates).toHaveLength(4);
    c.setCampusActive(false);await vi.advanceTimersByTimeAsync(30000);expect(updates).toHaveLength(4);
    c.dispose();vi.useRealTimers();
  });
  it("새 목록에 이전 요청의 실패·성공 요약이 섞이지 않는다", async()=>{
    let release;const gate=new Promise(r=>release=r),seen=[];
    const c=createCampus({host,projects:[{id:"a",name:"A"}],base:"",viaServer:false,onSelect:()=>{},fetchFn:async()=>{await gate;return jsonRes(statusOf(1));}});
    c.onSummaries(v=>seen.push(v));const pending=c.refreshSummaries();c.setProjects([{id:"b",name:"B"}]);release();await pending;expect(seen).toEqual([]);c.dispose();
  });
});

it("단지 요약 실패는 프로젝트 id와 함께 전달하고 재시도할 수 있다", async()=>{
  let fail=true;const updates=[];
  const c=createCampus({host,projects:[{id:"a",name:"A"}],base:"",viaServer:false,onSelect:()=>{},fetchFn:async()=>{if(fail)throw Error("network");return jsonRes(statusOf(1));}});
  c.onSummaries(v=>updates.push(v));await c.refreshSummaries();expect(updates[0]).toEqual({id:"a",error:true});
  fail=false;await c.refreshSummaries();expect(updates[1].summary.agents).toBe(1);c.dispose();
});

it("탭이 숨겨진 동안 단지 요약 주기 읽기를 건너뛴다", async () => {
  vi.useFakeTimers();
  const c = setup({ projects: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }).campus;
  const updates = []; c.onSummaries((v) => updates.push(v));
  c.setCampusActive(true); await c.refreshSummaries(); expect(updates).toHaveLength(2);
  const desc = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  try { await vi.advanceTimersByTimeAsync(30000); expect(updates).toHaveLength(2); }
  finally { if (desc) Object.defineProperty(document, "hidden", desc); else delete document.hidden; }
  await vi.advanceTimersByTimeAsync(30000); expect(updates).toHaveLength(4);
  c.dispose(); vi.useRealTimers();
});
