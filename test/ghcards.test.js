import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { build } from "vite";
import { resolveFloors, cardText, startGhCards, worstCi } from "../src/panels/ghcards.js";
import { GH_API } from "../src/shared/ghcontract.js";
import { FAKE_METRICS, FAKE_CONNECTION, FAKE_DISCONNECTED } from "./fixtures/gh-metrics.js";

const [busy, failing, running, stale, error] = FAKE_METRICS;

describe("층수 결합 규칙", () => {
  it("연결 없음 → 기존 값", () => { expect(resolveFloors({ existing: 15, metrics: null })).toBe(15); });
  it("ok·syncing → GitHub 층수", () => {
    expect(resolveFloors({ existing: 15, metrics: busy })).toBe(22);
    expect(resolveFloors({ existing: 15, metrics: running })).toBeGreaterThanOrEqual(12);
  });
  it("stale·error → 마지막 성공 층수 유지", () => {
    expect(resolveFloors({ existing: 15, metrics: stale, last: 19 })).toBe(19);
    expect(resolveFloors({ metrics: error, last: 19 })).toBe(19);
  });
  it("마지막 성공이 없으면 서버 스냅샷(성공 시각 있음)만 쓰고, 없으면 null", () => {
    expect(resolveFloors({ metrics: stale })).toBe(toFloors(stale));
    expect(resolveFloors({ metrics: error })).toBeNull();
  });
});
const toFloors = (m) => Math.round(12 + 10 * m.activityRatio);

describe("cardText", () => {
  it("층수·PR·이슈·CI", () => {
    const c = cardText(busy);
    expect(c.text).toBe("GitHub 22층 · PR 4 · 이슈 7 · CI 통과");
    expect(c.cls).toBe("");
  });
  it("CI 실패는 경고색 클래스", () => { expect(cardText(failing)).toMatchObject({ cls: "alert" }); expect(cardText(failing).text).toContain("CI 실패"); });
  it("stale·error는 흐림 + 짧은 문구", () => {
    expect(cardText(stale)).toMatchObject({ cls: "dim" }); expect(cardText(stale).text).toContain("오래됨");
    expect(cardText(error).cls).toBe("dim"); expect(cardText(error).text).toContain("오류"); expect(cardText(error).text).toContain("층수 –");
  });
});

const res = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("startGhCards", () => {
  let calls, deco, campus, conn, metrics, win, fetchFn;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = []; deco = []; conn = FAKE_CONNECTION; metrics = FAKE_METRICS;
    campus = { decorate: (id, x) => deco.push([id, x]) };
    win = new EventTarget();
    fetchFn = async (url) => { calls.push(url); if (url === GH_API.connection) return res(conn, conn ? 200 : 401); if (url === GH_API.metrics) return res({ metrics }); return res({}, 404); };
  });
  afterEach(() => vi.useRealTimers());

  it("연결이 있으면 지표를 읽어 카드에 붙인다", async () => {
    const g = startGhCards({ campus, fetch: fetchFn, intervalMs: 1000, win }); await flush();
    expect(deco.map((d) => d[0])).toEqual(FAKE_METRICS.map((m) => m.projectId));
    expect(deco[0][1].text).toContain("22층");
    g.stop();
  });
  it("세션 없음(401)·미연결이면 metrics를 호출하지 않는다", async () => {
    conn = null;
    const g = startGhCards({ campus, fetch: fetchFn, intervalMs: 1000, win }); await flush();
    expect(calls).toEqual([GH_API.connection]);
    conn = FAKE_DISCONNECTED; vi.advanceTimersByTime(1000); await flush();
    expect(calls).not.toContain(GH_API.metrics);
    g.stop();
  });
  it("폴링 중 같은 데이터면 다시 그리지 않고, 바뀌면 그 카드만 갱신", async () => {
    const g = startGhCards({ campus, fetch: fetchFn, intervalMs: 1000, win }); await flush();
    const n = deco.length;
    vi.advanceTimersByTime(1000); await flush(); vi.advanceTimersByTime(1000); await flush();
    expect(calls.filter((u) => u === GH_API.metrics).length).toBe(3);
    expect(deco.length).toBe(n);
    metrics = FAKE_METRICS.map((m, i) => (i === 0 ? { ...m, openPRs: 9 } : m));
    vi.advanceTimersByTime(1000); await flush();
    expect(deco.length).toBe(n + 1); expect(deco.at(-1)[0]).toBe("gh-rt"); expect(deco.at(-1)[1].text).toContain("PR 9");
    g.stop();
  });
  it("ok 뒤 error가 오면 마지막 성공 층수를 유지하고 흐림", async () => {
    const g = startGhCards({ campus, fetch: fetchFn, intervalMs: 1000, win }); await flush();
    metrics = [{ ...FAKE_METRICS[0], activityRatio: 0, sync: { mode: "polling", status: "error", error: "network" } }];
    vi.advanceTimersByTime(1000); await flush();
    const last = deco.filter((d) => d[0] === "gh-rt" && d[1]).at(-1)[1];
    expect(last.text).toContain("22층"); expect(last.cls).toBe("dim");
    g.stop();
  });
  it("연결 해제 알림(gh:changed) 뒤 미연결이면 카드 표시를 지운다", async () => {
    const g = startGhCards({ campus, fetch: fetchFn, intervalMs: 1000, win }); await flush();
    conn = FAKE_DISCONNECTED; deco.length = 0;
    win.dispatchEvent(new Event("gh:changed")); await flush();
    expect(deco.length).toBe(FAKE_METRICS.length); expect(deco.every((d) => d[1] === null)).toBe(true);
    g.stop();
  });
});

describe("공개 번들", () => {
  const bundle = async (mode) => {
    const out = await build({ mode, logLevel: "silent", build: { write: false, minify: true }, define: { __PUBLIC__: JSON.stringify(mode === "public") } });
    return (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).map((c) => c.code ?? "").join("\n");
  };
  it("공개판에는 ghconnect·ghcards·/api/github가 없고, 서버판에는 있다", async () => {
    const pub = await bundle("public");
    for (const s of ["/api/github", "WORK3D_SECRET_KEY", "gh:changed", "GitHub 활동 연결"]) expect(pub, s).not.toContain(s);
    const srv = await bundle("production");
    expect(srv).toContain("/api/github"); expect(srv).toContain("gh:changed");
  }, 60000);
});

describe("worstCi (상태실 랙 색)", () => {
  const m = (ci) => ({ ci });
  it("지표 없음 → null(상태실 없음)", () => { expect(worstCi([])).toBeNull(); expect(worstCi(undefined)).toBeNull(); });
  it("failing > running·pending > passing > none", () => {
    expect(worstCi([m("passing"), m("failing"), m("running")])).toBe("failing");
    expect(worstCi([m("passing"), m("pending")])).toBe("running");
    expect(worstCi([m("passing"), m("none")])).toBe("passing");
    expect(worstCi([m("none"), m("unknown")])).toBe("none");
  });
  it("가짜 지표 5종은 failing", () => { expect(worstCi(FAKE_METRICS)).toBe("failing"); });
});

describe("startGhCards → onCi", () => {
  it("지표가 오면 최악값, 연결 해제하면 null", async () => {
    vi.useFakeTimers();
    const calls = []; let conn = FAKE_CONNECTION;
    const res = (d) => ({ ok: true, status: 200, json: async () => d });
    const f = async (u) => (u === GH_API.connection ? res(conn) : res({ metrics: FAKE_METRICS }));
    const win = new EventTarget(), flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    const g = startGhCards({ campus: { decorate() {} }, onCi: (v) => calls.push(v), fetch: f, intervalMs: 1e9, win }); await flush();
    expect(calls.at(-1)).toBe("failing");
    conn = { connected: false }; win.dispatchEvent(new Event("gh:changed")); await flush();
    expect(calls.at(-1)).toBeNull();
    g.stop(); vi.useRealTimers();
  });
});
