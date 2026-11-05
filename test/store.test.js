import { describe, it, expect } from "vitest";
import { createStore } from "../src/scene/store.js";
import { seedStatus, seedBoard } from "../src/shared/seed.js";

const ev = (id) => ({ id, at: "2026-11-05T14:00:00+09:00", from: "gpt", to: "claude", title: "t", summary: "s", taskId: "T6", kind: "doc" });
const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => { if (body instanceof Error) throw body; return structuredClone(body); } });

function make() {
  let next; const store = createStore({ fetchFn: (...a) => next(...a) });
  const events = [], errors = [];
  store.on("events", (e) => events.push(...e)); store.on("error", (m) => errors.push(m));
  return { store, events, errors, set: (f) => (next = f) };
}

describe("store", () => {
  it("첫 로드의 기존 이벤트는 재생하지 않고 새 id만 알린다", async () => {
    const t = make(); const s = seedStatus(); s.events = [ev(1), ev(2)];
    t.set(reply(s)); await t.store.poll();
    expect(t.events).toEqual([]);
    s.events = [ev(1), ev(2), ev(3)]; t.set(reply(s)); await t.store.poll();
    expect(t.events.map((e) => e.id)).toEqual([3]);
    await t.store.poll(); expect(t.events.length).toBe(1);
  });
  it("깨진 파일·검증 실패·서버 오류에서는 직전 상태를 유지한다", async () => {
    const t = make(); const s = seedStatus(); t.set(reply(s)); await t.store.poll();
    const before = t.store.state;
    t.set(reply(new SyntaxError("bad json"))); await t.store.poll();
    const bad = seedStatus(); bad.tasks[0].progress = 999; t.set(reply(bad)); await t.store.poll();
    t.set(reply({}, false)); await t.store.poll();
    expect(t.errors.length).toBe(3);
    expect(t.store.state).toBe(before);
  });
  it("board.json이 깨지면 직전 board를 유지한다", async () => {
    const t = make(); t.set(reply(seedBoard())); await t.store.pollBoard();
    const before = t.store.board; expect(before.mvp.length).toBeGreaterThan(0);
    const bad = seedBoard(); bad.mvp[0].status = "x"; t.set(reply(bad)); await t.store.pollBoard();
    t.set(reply(new SyntaxError("bad"))); await t.store.pollBoard();
    expect(t.errors.length).toBe(2); expect(t.store.board).toBe(before);
  });

  describe("loadLocal", () => {
    it("검증을 통과한 두 객체를 반영하고 폴링을 멈춘다. 이벤트는 재생하지 않는다", async () => {
      const t = make(); t.set(reply(seedStatus())); await t.store.poll();
      const s = seedStatus(); s.meta.project = "내 데이터"; s.events = [ev(1), ev(2)]; const b = seedBoard();
      const states = [], boards = []; t.store.on("state", (x) => states.push(x)); t.store.on("board", (x) => boards.push(x));
      const r = t.store.loadLocal(s, b);
      expect(r.ok).toBe(true);
      expect(t.store.state.meta.project).toBe("내 데이터"); expect(t.store.isLocal).toBe(true);
      expect(states.length).toBe(1); expect(boards.length).toBe(1); expect(t.events).toEqual([]);
      t.set(reply(seedStatus())); await t.store.poll(); await t.store.pollBoard();
      expect(t.store.state.meta.project).toBe("내 데이터");
    });
    it("하나라도 검증에 실패하면 아무것도 바꾸지 않고 이유를 돌려준다", async () => {
      const t = make(); t.set(reply(seedStatus())); await t.store.poll(); const before = t.store.state;
      const bad = seedStatus(); bad.tasks[0].progress = 999;
      let r = t.store.loadLocal(bad, seedBoard());
      expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/^status\.json:/);
      const badBoard = seedBoard(); badBoard.mvp[0].status = "x";
      r = t.store.loadLocal(seedStatus(), badBoard);
      expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/^board\.json:/);
      r = t.store.loadLocal(null, undefined); expect(r.ok).toBe(false);
      expect(t.store.state).toBe(before); expect(t.store.isLocal).toBe(false);
      t.set(reply(seedStatus())); await t.store.poll(); expect(t.store.state).not.toBe(before); // 폴링은 계속 동작
    });
    it("응답을 기다리는 중에 loadLocal이 불리면 그 응답은 버린다", async () => {
      let release; const gate = new Promise((r) => (release = r));
      const s = seedStatus(); s.meta.project = "서버";
      const store = createStore({ fetchFn: async () => { await gate; return { ok: true, status: 200, json: async () => structuredClone(s) }; } });
      const pending = store.poll();
      const mine = seedStatus(); mine.meta.project = "내 것";
      expect(store.loadLocal(mine, seedBoard()).ok).toBe(true);
      release(); await pending;
      expect(store.state.meta.project).toBe("내 것");
    });
    it("넘긴 객체를 나중에 고쳐도 화면 상태는 변하지 않는다", () => {
      const store = createStore({ fetchFn: async () => ({ ok: false, status: 500 }) });
      const s = seedStatus(); store.loadLocal(s, seedBoard()); s.meta.project = "바뀜";
      expect(store.state.meta.project).not.toBe("바뀜");
    });
  });
});
