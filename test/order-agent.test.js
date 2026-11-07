import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateBoard } from "../src/shared/validate.js";
import { buildBoardView, buildAgentDetail } from "../src/panels/model.js";
import { seedStatus } from "../src/shared/seed.js";

const st = () => ({ agents: [{ id: "claude", name: "C", status: "working", currentTaskId: "A", note: "메모" }, { id: "gpt", name: "G", status: "idle", currentTaskId: null }], tasks: [
  { id: "A", title: "a", ownerAgentId: "claude", zone: "z", progress: 40, state: "doing" }, { id: "B", title: "b", ownerAgentId: "claude", zone: "z", progress: 100, state: "done" }, { id: "C", title: "c", ownerAgentId: "gpt", zone: "z", progress: 0, state: "todo" } ],
  events: [{ id: 1, at: "2026-11-05T10:00:00+09:00", from: "claude", to: "gpt", title: "문서1", summary: "s", taskId: "A", kind: "doc" }, { id: 2, at: "2026-11-05T11:00:00+09:00", from: "gpt", to: "board", title: "무관", summary: "s", taskId: "C", kind: "doc" }] });
const bd = () => ({ zones: [], mvp: [{ id: "M1", title: "하나", status: "in", taskIds: ["A"] }, { id: "M2", title: "둘", status: "in", order: 1, taskIds: ["B"] }, { id: "M3", title: "셋", status: "in", order: 2, taskIds: ["A"] }],
  bp: [{ id: "B1", area: "market", title: "x", status: "approved", order: 1 }, { id: "B2", area: "cost", title: "y", status: "draft" }, { id: "B3", area: "team", title: "z", status: "draft", order: 2 }] });

describe("작업 순서", () => {
  it("order가 있는 항목을 먼저, 없는 항목은 원래 순서로 뒤에", () => {
    expect(buildBoardView(st(), bd()).mvp.map((m) => m.id)).toEqual(["M2", "M3", "M1"]);
    expect(buildBoardView(st(), bd()).bp.map((x) => x.id)).toEqual(["B1", "B3", "B2"]);
  });
  it("'다음'은 순서가 있는 미완료 항목 중 가장 앞", () => {
    const v = buildBoardView(st(), bd());
    expect(v.mvp.find((m) => m.next).id).toBe("M3"); // M2는 연결 작업이 100%라 완료
    expect(v.bp.find((x) => x.next).id).toBe("B3"); // B1은 확정
  });
  it("order가 전혀 없으면 다음 표시도 없고 순서는 그대로", () => {
    const b = bd(); b.mvp.forEach((m) => delete m.order); b.bp.forEach((x) => delete x.order);
    const v = buildBoardView(st(), b); expect(v.mvp.map((m) => m.id)).toEqual(["M1", "M2", "M3"]); expect(v.mvp.some((m) => m.next)).toBe(false); expect(v.bp.some((x) => x.next)).toBe(false);
  });
  it("검증: 1~999 정수만", () => {
    expect(validateBoard(bd())).toEqual([]);
    for (const v of [0, 1000, 1.5, "1", null]) { const b = bd(); b.mvp[0].order = v; expect(validateBoard(b).join(), String(v)).toMatch(/mvp\[0\].order/); const c = bd(); c.bp[0].order = v; expect(validateBoard(c).join(), String(v)).toMatch(/bp\[0\].order/); }
  });
  it("update.js order 명령과 --order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-ord-")); fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify(bd())); fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(seedStatus()));
    const run = (...a) => spawnSync("node", [path.resolve("update.js"), ...a], { env: { ...process.env, STATUS_FILE: path.join(dir, "status.json"), BOARD_FILE: path.join(dir, "board.json") }, encoding: "utf8" });
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8"));
    expect(run("order", "mvp", "M1,M3").status).toBe(0);
    expect(read().mvp.map((m) => m.order)).toEqual([1, undefined, 2]); // 나열하지 않은 M2는 순서 삭제
    expect(run("order", "bp", "B2,B1").status).toBe(0); expect(read().bp.map((x) => x.order)).toEqual([2, 1, undefined]);
    expect(run("order", "mvp", "M1,ZZ").status).not.toBe(0); expect(run("order", "mvp", "M1,M1").status).not.toBe(0); expect(run("order", "prd", "P1").status).not.toBe(0);
    expect(run("mvp", "M2", "in", "--order", "3").status).toBe(0); expect(read().mvp[1].order).toBe(3);
    expect(run("mvp", "M2", "in", "--order", "0").status).not.toBe(0);
  });
});

describe("에이전트 작업 화면", () => {
  it("지금 하는 일·맡은 작업·최근 문서(그 에이전트 관련만)", () => {
    const d = buildAgentDetail(st(), "claude");
    expect(d.current).toMatchObject({ id: "A", progress: 40, stateLabel: "진행 중" }); expect(d.note).toBe("메모");
    expect(d.tasks.map((t) => t.id)).toEqual(["A", "B"]); expect(d.events.map((e) => e.title)).toEqual(["문서1"]);
  });
  it("작업이 없거나 없는 에이전트", () => {
    expect(buildAgentDetail(st(), "gpt").current).toBeNull(); expect(buildAgentDetail(st(), "nobody")).toBeNull(); expect(buildAgentDetail(null, "x")).toBeNull();
  });
  it("글자는 가공 없이 보존", () => {
    const s = st(); s.tasks[0].title = "<b>x</b>"; expect(buildAgentDetail(s, "claude").current.title).toBe("<b>x</b>");
  });
});
