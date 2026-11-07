import { describe, it, expect } from "vitest";
import { createCampusScene } from "../src/scene/campus3d.js";
import { towerLayout, lookProps, desaturate, LIT_MIN, DIM_DESAT } from "../src/scene/campus-layout.js";
import { startGhCards } from "../src/panels/ghcards.js";
import { GH_API } from "../src/shared/ghcontract.js";
import { FAKE_CONNECTION, FAKE_METRICS } from "./fixtures/gh-metrics.js";

describe("lookProps (지표 → 3D 속성)", () => {
  it("look 없음 → null(지금 외관 그대로)", () => { expect(lookProps(null)).toBeNull(); expect(lookProps(undefined)).toBeNull(); });
  it("lit은 0.25 + 0.75 × litRatio (0→0.25, 1→1, 범위 밖·NaN은 자름)", () => {
    expect(lookProps({ litRatio: 0 }).lit).toBe(0.25);
    expect(lookProps({ litRatio: 1 }).lit).toBe(1);
    expect(lookProps({ litRatio: 0.4 }).lit).toBeCloseTo(0.55);
    expect(lookProps({ litRatio: 7 }).lit).toBe(1);
    expect(lookProps({ litRatio: -1 }).lit).toBe(0.25);
    expect(lookProps({ litRatio: NaN }).lit).toBe(0.25);
    expect(lookProps({}).lit).toBe(LIT_MIN);
  });
  it("옥탑 색: alert·busy는 서로 다른 색, normal은 null(악센트 유지)", () => {
    const a = lookProps({ roof: "alert" }).roofColor, b = lookProps({ roof: "busy" }).roofColor;
    expect(a).not.toBe(b); expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(lookProps({ roof: "normal" }).roofColor).toBeNull();
  });
  it("dim이면 탈채도 비율, 아니면 0(창 불빛은 dim과 무관)", () => {
    expect(lookProps({ dim: true, litRatio: 0.5 })).toMatchObject({ desat: DIM_DESAT, lit: 0.625 });
    expect(lookProps({ dim: false }).desat).toBe(0);
  });
  it("desaturate: 휘도 보존, 채도만 낮춤", () => {
    const luma = h => 0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255);
    const sat = h => { const c = [(h >> 16) & 255, (h >> 8) & 255, h & 255]; return Math.max(...c) - Math.min(...c); };
    for (const c of [0xd9534f, 0x4f8fd6, 0x6b8191, 0xd9d6cf]) {
      const d = desaturate(c, DIM_DESAT);
      expect(Math.abs(luma(d) - luma(c))).toBeLessThanOrEqual(2);
      expect(sat(d)).toBeLessThan(sat(c) * 0.5);
    }
    expect(desaturate(0xd9534f, 0)).toBe(0xd9534f);
    expect(desaturate(0x808080, 0.65)).toBe(0x808080);
  });
});

describe("towerLayout 층수", () => {
  it("look 없으면 기존 규칙 그대로", () => {
    expect(towerLayout({ agents: 6, tasks: 6, teams: 1 })).toEqual(towerLayout({ agents: 6, tasks: 6, teams: 1 }, null));
    expect(towerLayout({ agents: 0, tasks: 0, teams: 1 })[0].floors).toBe(12);
  });
  it("look.floors가 최고 동 층수(12~22), 동 사이 차이 규칙 유지", () => {
    const t = towerLayout({ teams: 3 }, { floors: 22 });
    expect(t.map((x) => x.floors)).toEqual([22, 19, 16]);
    expect(t[0].height / t[2].height).toBeGreaterThanOrEqual(1.3);
    expect(towerLayout({ teams: 1 }, { floors: 12 })[0].floors).toBe(12);
  });
  it("2동은 19층 상한, 범위 밖은 12~22로", () => {
    expect(towerLayout({ teams: 2 }, { floors: 22 })[0].floors).toBe(19);
    expect(towerLayout({ teams: 1 }, { floors: 99 })[0].floors).toBe(22);
    expect(towerLayout({ teams: 1 }, { floors: 3 })[0].floors).toBe(12);
    expect(towerLayout({ teams: 1 }, { floors: null })[0].floors).toBe(12);
  });
});

describe("campus3d setLook", () => {
  const projects = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `동${i}` }));
  const mk = () => { const c = createCampusScene(); c.setProjects(projects); c.update({ id: "p0", summary: { agents: 3, tasks: 3, teams: 2, progress: 50 } }); return c; };
  it("지표를 주면 그 건물만 층수가 바뀌고 다른 건물은 그대로", () => {
    const c = mk(), before = c.composition();
    expect(c.setLook("p0", { floors: 19, litRatio: 0.5, roof: "alert", dim: false })).toBe(true);
    const after = c.composition();
    expect(after[0].towers[0].floors).toBe(19);
    expect(after.slice(1)).toEqual(before.slice(1));
  });
  it("같은 내용이면 갱신하지 않는다", () => {
    const c = mk(), look = { floors: 15, litRatio: 0.2, roof: "busy", dim: false };
    expect(c.setLook("p1", look)).toBe(true);
    expect(c.setLook("p1", { ...look })).toBe(false);
    expect(c.setLook("p1", { ...look, dim: true })).toBe(true);
  });
  it("null로 지우면 원래 외관으로, 없는 id는 무시", () => {
    const c = mk(), base = JSON.stringify(c.composition());
    c.setLook("p0", { floors: 22, litRatio: 1, roof: "alert", dim: true });
    expect(JSON.stringify(c.composition())).not.toBe(base);
    expect(c.setLook("p0", null)).toBe(true);
    expect(JSON.stringify(c.composition())).toBe(base);
    expect(c.setLook("nope", { floors: 15 })).toBe(false);
  });
  it("목록을 다시 받아도(setProjects) 지표가 유지된다", () => {
    const c = mk(); c.setLook("p2", { floors: 21, litRatio: 0.5, roof: "normal", dim: false });
    c.setProjects(projects.map((p) => ({ ...p, name: p.name + "!" })));
    expect(c.composition()[2].towers[0].floors).toBe(21);
  });
  it("요약이 갱신돼도 지표 층수를 유지", () => {
    const c = mk(); c.setLook("p0", { floors: 17, litRatio: 0, roof: "normal", dim: false });
    c.update({ id: "p0", summary: { agents: 30, tasks: 30, teams: 2 } });
    expect(c.composition()[0].towers[0].floors).toBe(17);
  });
});

describe("ghcards → onLook", () => {
  it("바뀐 프로젝트만 호출하고, 해제하면 null", async () => {
    const calls = []; let conn = FAKE_CONNECTION, metrics = FAKE_METRICS;
    const res = (d) => ({ ok: true, status: 200, json: async () => d });
    const f = async (u) => (u === GH_API.connection ? res(conn) : res({ metrics }));
    const win = new EventTarget(), flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    const g = startGhCards({ campus: { decorate() {} }, onLook: (id, l) => calls.push([id, l]), fetch: f, intervalMs: 1e9, win }); await flush();
    expect(calls).toHaveLength(FAKE_METRICS.length);
    expect(calls[0][1]).toMatchObject({ floors: 22, roof: "normal", dim: false });
    expect(calls[1][1].roof).toBe("alert"); expect(calls[3][1].dim).toBe(true);
    calls.length = 0; await g.refresh(); await flush();
    expect(calls).toHaveLength(0);
    conn = { connected: false }; win.dispatchEvent(new Event("gh:changed")); await flush();
    expect(calls.every((c) => c[1] === null)).toBe(true); expect(calls).toHaveLength(FAKE_METRICS.length);
    g.stop();
  });
});
