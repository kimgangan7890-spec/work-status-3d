import { describe, it, expect } from "vitest";
import { validateBoard, crossCheck } from "../src/shared/validate.js";
import { buildBoardView } from "../src/panels/model.js";
import { seedStatus } from "../src/shared/seed.js";

const st = () => ({ agents: [{ id: "claude", name: "C" }], tasks: [
  { id: "A", title: "a", ownerAgentId: "claude", zone: "z", progress: 100, state: "done" },
  { id: "B", title: "b", ownerAgentId: "claude", zone: "z", progress: 50, state: "doing" },
  { id: "C", title: "c", ownerAgentId: "claude", zone: "z", progress: 0, state: "todo" } ] });
const bd = () => ({
  prd: [{ id: "P1", title: "문제", status: "approved" }, { id: "P2", title: "요구", status: "review" }, { id: "P3", title: "기준", status: "draft" }, { id: "P4", title: "x", status: "approved" }],
  mvp: [{ id: "M1", title: "기능1", status: "in", taskIds: ["A", "B"] }, { id: "M2", title: "기능2", status: "in" }, { id: "M3", title: "뺄 것", status: "out", taskIds: ["C"] }],
  zones: [{ id: "z", name: "z", ownerAgentId: "claude", taskIds: ["A", "B", "C"] }] });

describe("PRD·MVP 진행도 분리", () => {
  it("세 진행도를 따로 계산한다", () => {
    const p = buildBoardView(st(), bd()).progress;
    expect(p.prd).toEqual({ done: 2, total: 4, pct: 50 });
    expect(p.mvp).toEqual({ pct: 75, items: 1 }); // 포함(in)이고 연결 작업이 있는 M1만: (100+50)/2
    expect(p.tasks).toEqual({ pct: 50, count: 3 }); // (100+50+0)/3
  });
  it("MVP 항목별 진행도: 연결 없으면 null, 없는 작업은 0으로 센다", () => {
    const b = bd(); b.mvp[0].taskIds = ["A", "NOPE"];
    const v = buildBoardView(st(), b);
    expect(v.mvp[0].progress).toBe(50); expect(v.mvp[1].progress).toBeNull();
  });
  it("prd·taskIds가 없는 옛 board.json도 그대로 동작한다", () => {
    const v = buildBoardView(st(), { mvp: [{ id: "M", title: "t", status: "in" }], zones: [] });
    expect(v.prd).toEqual([]); expect(v.progress.prd).toBeNull(); expect(v.progress.mvp).toBeNull();
  });
  it("검증: prd 상태·중복·형식, mvp.taskIds 형식", () => {
    expect(validateBoard(bd())).toEqual([]);
    const a = bd(); a.prd[0].status = "done"; expect(validateBoard(a).join()).toMatch(/prd\[0\].status/);
    const b = bd(); b.prd[1].id = "P1"; expect(validateBoard(b).join()).toMatch(/중복/);
    const c = bd(); c.prd = {}; expect(validateBoard(c).join()).toMatch(/prd는 배열/);
    const d = bd(); d.mvp[0].taskIds = "A"; expect(validateBoard(d).join()).toMatch(/taskIds/);
  });
  it("교차 점검: MVP에 연결된 작업이 없으면 경고", () => {
    const b = bd(); b.mvp[0].taskIds = ["A", "ZZ"];
    expect(crossCheck(st(), b).join()).toMatch(/MVP M1에 연결된 작업 ZZ/);
  });
});
