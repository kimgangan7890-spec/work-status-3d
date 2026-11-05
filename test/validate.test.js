import { describe, it, expect } from "vitest";
import { validateStatus, validateBoard, crossCheck } from "../src/shared/validate.js";
import { seedStatus, seedBoard } from "../src/shared/seed.js";

const ev = (id) => ({ id, at: "2026-11-05T14:00:00+09:00", from: "gpt", to: "claude", title: "t", summary: "s", taskId: "T6", kind: "doc" });

describe("validateStatus", () => {
  it("시드는 통과한다", () => expect(validateStatus(seedStatus())).toEqual([]));
  it("progress 범위 밖은 거부", () => { const s = seedStatus(); s.tasks[0].progress = 101; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("done인데 100이 아니면 거부", () => { const s = seedStatus(); s.tasks[0].state = "done"; s.tasks[0].progress = 50; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("없는 담당자는 거부", () => { const s = seedStatus(); s.tasks[0].ownerAgentId = "nobody"; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("이벤트 id가 증가하지 않으면 거부", () => { const s = seedStatus(); s.events = [ev(2), ev(2)]; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("이벤트 31개는 거부", () => { const s = seedStatus(); s.events = Array.from({ length: 31 }, (_, i) => ev(i + 1)); expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("필수 키가 없으면 거부", () => { const s = seedStatus(); delete s.agents; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("board·desks 같은 다른 최상위 키는 거부", () => {
    const a = seedStatus(); a.board = {}; expect(validateStatus(a).length).toBeGreaterThan(0);
    const b = seedStatus(); b.desks = []; expect(validateStatus(b).length).toBeGreaterThan(0);
  });
  it("에이전트 상태는 working·idle·blocked만", () => { const s = seedStatus(); s.agents[0].status = "waiting"; expect(validateStatus(s).length).toBeGreaterThan(0); });
  it("80자 초과 note는 거부", () => { const s = seedStatus(); s.agents[0].note = "가".repeat(81); expect(validateStatus(s).length).toBeGreaterThan(0); });
});

describe("validateBoard / crossCheck", () => {
  it("시드 board는 통과하고 교차 확인 경고도 없다", () => { expect(validateBoard(seedBoard())).toEqual([]); expect(crossCheck(seedStatus(), seedBoard())).toEqual([]); });
  it("허용되지 않은 status·owner·중복 id는 거부", () => {
    const a = seedBoard(); a.mvp[0].status = "maybe"; expect(validateBoard(a).length).toBeGreaterThan(0);
    const b = seedBoard(); b.zones[0].ownerAgentId = "User"; expect(validateBoard(b).length).toBeGreaterThan(0);
    const c = seedBoard(); c.zones[1].id = c.zones[0].id; expect(validateBoard(c).length).toBeGreaterThan(0);
    expect(validateBoard({ mvp: [] }).length).toBeGreaterThan(0);
  });
  it("zone 불일치는 거부가 아니라 경고", () => { const s = seedStatus(); s.tasks[0].zone = "z-plan"; expect(validateStatus(s)).toEqual([]); expect(crossCheck(s, seedBoard()).length).toBeGreaterThan(0); });
});
