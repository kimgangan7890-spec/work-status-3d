import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateBoard } from "../src/shared/validate.js";
import { buildBoardView } from "../src/panels/model.js";
import { seedStatus } from "../src/shared/seed.js";

const bd = () => ({ mvp: [], zones: [], prd: [{ id: "P1", title: "p", status: "approved" }], bp: [
  { id: "B1", area: "market", title: "시장", status: "approved" }, { id: "B2", area: "customer", title: "고객", status: "review", note: "메모" },
  { id: "B3", area: "revenue", title: "수익", status: "approved" }, { id: "B4", area: "risk", title: "위험", status: "draft" }] });

describe("BP(사업계획)", () => {
  it("PRD 확정과 따로 센다", () => {
    const p = buildBoardView(seedStatus(), bd()).progress;
    expect(p.prd).toEqual({ done: 1, total: 1, pct: 100 });
    expect(p.bp).toMatchObject({ done: 2, total: 4, pct: 50 });
  });
  it("핵심 영역 중 확정이 없는 영역을 글로 낸다", () => {
    expect(buildBoardView(seedStatus(), bd()).progress.bp.missingAreas).toEqual(["고객", "비용", "일정"]);
  });
  it("bp 키가 없으면 null, 비어 있으면 상자는 있고 진행도는 없다", () => {
    const a = bd(); delete a.bp; const v = buildBoardView(seedStatus(), a); expect(v.bp).toBeNull(); expect(v.progress.bp).toBeNull();
    const b = bd(); b.bp = []; const w = buildBoardView(seedStatus(), b); expect(w.bp).toEqual([]); expect(w.progress.bp).toBeNull();
  });
  it("글자는 가공 없이 보존하고 영역 라벨을 붙인다", () => {
    const b = bd(); b.bp[0].title = "<b>x</b>"; const v = buildBoardView(seedStatus(), b);
    expect(v.bp[0].title).toBe("<b>x</b>"); expect(v.bp[0].areaLabel).toBe("시장"); expect(v.bp[1].note).toBe("메모");
  });
  it("검증", () => {
    expect(validateBoard(bd())).toEqual([]);
    const f = (mut, re) => { const b = bd(); mut(b); expect(validateBoard(b).join(), re).toMatch(re); };
    f((b) => (b.bp = {}), /bp는 배열/);
    f((b) => (b.bp[0].area = "zzz"), /area/);
    f((b) => (b.bp[0].status = "validated"), /status/);
    f((b) => (b.bp[1].id = "B1"), /중복/);
    f((b) => (b.bp[0].note = 5), /note/);
    f((b) => (b.bp = Array.from({ length: 31 }, (_, i) => ({ id: `B${i}`, area: "etc", title: "t", status: "draft" }))), /최대/);
  });
  it("update.js bp 명령: 새 항목은 title·area 필요, 다른 키 보존, note 삭제", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-bp-")); fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ mvp: [], zones: [], prd: [] })); fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(seedStatus()));
    const run = (...a) => spawnSync("node", [path.resolve("update.js"), ...a], { env: { ...process.env, DATA_DIR: dir, BOARD_FILE: path.join(dir, "board.json"), STATUS_FILE: path.join(dir, "status.json") }, encoding: "utf8" });
    const read = () => JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8"));
    expect(run("bp", "B1", "draft").status).not.toBe(0);
    expect(run("bp", "B1", "draft", "--area", "market", "--title", "시장 조사", "--note", "메모").status).toBe(0);
    expect(read().bp[0]).toMatchObject({ id: "B1", area: "market", status: "draft", note: "메모" });
    expect(run("bp", "B1", "approved", "--note", "none").status).toBe(0);
    expect(read().bp[0].note).toBeUndefined(); expect(read().prd).toEqual([]);
    expect(run("bp", "B1", "done").status).not.toBe(0);
  });
});
