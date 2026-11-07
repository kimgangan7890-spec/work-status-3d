import { describe, it, expect, vi } from "vitest";
import { buildRoomCards } from "../src/panels/model.js";
import { createView } from "../src/panels/view.js";
import { createRooms } from "../src/panels/rooms.js";

// ---- 아주 작은 가짜 DOM(vitest 환경이 node라서) ----
class Node_ {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.handlers = {}; this.className = ""; this.textContent = ""; this.hidden = false; this.clientWidth = 0; this.clientHeight = 0; this.offsetWidth = 0; this.offsetHeight = 0; }
  append(...n) { this.children.push(...n); }
  prepend(...n) { this.children.unshift(...n); }
  replaceChildren(...n) { this.children = n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.handlers[t] ||= []).push(fn); }
  dispatch(t, e = {}) { for (const fn of this.handlers[t] ?? []) fn({ target: this, ...e }); }
  click() { this.dispatch("click"); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
}
function fakeEnv() {
  const doc = new Node_("document");
  doc.body = new Node_("body");
  doc.createElement = (t) => new Node_(t);
  const win = new Node_("window");
  win.dispatchEvent = (e) => { for (const fn of win.handlers[e.type] ?? []) fn(e); return true; };
  return { doc, win };
}
function fakeStore(state = null) {
  const h = {};
  return { state, on: (n, fn) => (h[n] ||= []).push(fn), emit(n, v) { for (const fn of h[n] ?? []) fn(v); }, set(s) { this.state = s; this.emit("state", { state: s }); } };
}
const A = (id, status, teamId) => ({ id, name: id, status, teamId });
const mk = (n, agentsPer = 1) => ({
  teams: Array.from({ length: n }, (_, i) => ({ id: "t" + i, name: "방" + i })),
  agents: Array.from({ length: n }, (_, i) => Array.from({ length: agentsPer }, (_, j) => A(`a${i}_${j}`, "idle", "t" + i))).flat(),
});

describe("buildRoomCards", () => {
  it("팀 0·1개면 빈 배열(층 전체 화면 없음)", () => {
    expect(buildRoomCards(null)).toEqual([]);
    expect(buildRoomCards({ agents: [] })).toEqual([]);
    expect(buildRoomCards(mk(1))).toEqual([]);
  });
  it("팀 2·3·8개는 teams 순서대로 방이 나온다", () => {
    for (const n of [2, 3, 8]) expect(buildRoomCards(mk(n)).map((c) => c.id)).toEqual(Array.from({ length: n }, (_, i) => "t" + i));
  });
  it("ariaLabel 형식과 요약", () => {
    const s = mk(2); s.agents[0].status = "working";
    const c = buildRoomCards(s);
    expect(c[0].ariaLabel).toBe("방0, 1명, 일하는 중. 누르면 확대");
    expect(c[0].summary).toBe("일 1");
    expect(c[1].summary).toBe("");
    expect(c[1].dot).toBe("idle");
  });
  it("막힘이 일하는 중보다 우선, 요약에 둘 다", () => {
    const s = mk(2, 3); s.agents[0].status = "working"; s.agents[1].status = "blocked";
    const c = buildRoomCards(s)[0];
    expect(c.dot).toBe("blocked"); expect(c.dotLabel).toBe("막힘"); expect(c.summary).toBe("일 1 · 막힘 1");
  });
  it("에이전트 0명인 팀(기본 팀 main 제외)도 빈 방으로 나온다", () => {
    const s = mk(2); s.teams.push({ id: "empty", name: "빈" });
    const cards = buildRoomCards(s);
    expect(cards.map((c) => c.id)).toEqual(["t0", "t1", "empty"]);
    expect(cards.slice(0, 2).every((c) => c.empty === false)).toBe(true);
    expect(cards[2]).toMatchObject({ empty: true, count: 0, summary: "", ariaLabel: "빈, 빈 방. 누르면 확대" });
  });
  it("비어 있는 기본 팀(main)은 방으로 나오지 않는다", () => {
    const s = mk(2); s.teams.unshift({ id: "main", name: "기본" });
    expect(buildRoomCards(s).map((c) => c.id)).toEqual(["t0", "t1"]);
  });
  it("긴 이름·태그 문자열을 가공하지 않고 보존", () => {
    const s = mk(2); s.teams[0].name = "<b>" + "가".repeat(18) + "</b>";
    const c = buildRoomCards(s)[0];
    expect(c.name).toBe(s.teams[0].name);
    expect(c.ariaLabel.startsWith(s.teams[0].name + ", 1명")).toBe(true);
  });
});

describe("view 상태", () => {
  const setup = (state) => {
    const env = fakeEnv(); const store = fakeStore(state); const select = vi.fn();
    const events = []; env.win.addEventListener("view:change", (e) => events.push(e.detail ?? e));
    const view = createView(store, { ...env, select });
    return { ...env, store, select, events, view };
  };
  it("팀 2개 이상이면 floor로 시작", () => {
    const t = setup(mk(2));
    expect(t.view.get()).toEqual({ mode: "floor", teamId: null });
    expect(t.doc.body.dataset.view).toBe("floor");
  });
  it("팀 1개면 room, floor 없음, back 무시", () => {
    const t = setup(mk(1));
    expect(t.view.get().mode).toBe("room");
    expect(t.view.back()).toBe(false);
    expect(t.view.get().mode).toBe("room");
  });
  it("enter/back/Esc, 팀 선택 연동, view:change 발행", () => {
    const t = setup(mk(3));
    expect(t.view.enter("t1")).toBe(true);
    expect(t.select).toHaveBeenCalledWith("t1");
    expect(t.view.get()).toEqual({ mode: "room", teamId: "t1" });
    expect(t.doc.body.dataset.view).toBe("room");
    t.doc.dispatch("keydown", { key: "Escape" });
    expect(t.view.get().mode).toBe("floor");
    expect(t.events.map((e) => e.mode)).toEqual(["floor", "room", "floor"]);
    expect(t.win.__view.get().mode).toBe("floor");
    expect(t.view.enter("nope")).toBe(false);
    t.view.enter("t0");
    t.doc.dispatch("keydown", { key: "Escape", target: { tagName: "INPUT" } });
    expect(t.view.get().mode).toBe("room");
  });
  it("상태가 늦게 와도 시작을 정하고, 팀이 줄면 보정", () => {
    const t = setup(null);
    expect(t.view.get().mode).toBe("room");
    t.store.set(mk(3));
    expect(t.view.get().mode).toBe("floor");
    t.view.enter("t2");
    t.store.set({ ...mk(3), teams: mk(3).teams.slice(0, 2), agents: mk(3).agents.slice(0, 2) });
    expect(t.view.get().mode).toBe("floor"); // 보던 팀이 없어짐
    t.store.set(mk(1));
    expect(t.view.get()).toEqual({ mode: "room", teamId: "t0" });
  });
});

describe("view.js 팀 탭 동기화", () => {
  it("방 안에서 team:change가 오면 teamId가 따라가고, 층 전체에서는 무시", () => {
    const env = fakeEnv(); const store = fakeStore(mk(3));
    const view = createView(store, { ...env, select() {} });
    expect(view.get().mode).toBe("floor");
    env.win.dispatchEvent({ type: "team:change", detail: { teamId: "t1" } });
    expect(view.get()).toEqual({ mode: "floor", teamId: null });
    view.enter("t0");
    env.win.dispatchEvent({ type: "team:change", detail: { teamId: "t2" } });
    expect(view.get()).toEqual({ mode: "room", teamId: "t2" });
    env.win.dispatchEvent({ type: "team:change", detail: { teamId: "없는팀" } });
    expect(view.get().teamId).toBe("t2");
  });
});

describe("rooms.js DOM", () => {
  const setup = (state, anchors) => {
    const env = fakeEnv(); const store = fakeStore(state);
    const view = createView(store, { ...env, select() {} });
    const office = { roomAnchors: vi.fn(() => anchors ?? (store.state ? buildRoomCards(store.state).map((c, i) => ({ teamId: c.id, x: 100 + i * 50, y: 80, w: 120 })) : [])) };
    const cardsHost = new Node_("div");
    const rooms = createRooms(store, view, { ...env, office, cardsHost, tagsHost: env.doc.body });
    return { ...env, store, view, office, rooms, cardsHost };
  };
  const tags = (r) => r.layer.children;
  it("이름표 개수 = teams 개수, 순서 같음, 위치·max-width", () => {
    const t = setup(mk(3));
    expect(tags(t.rooms).map((b) => b.dataset.teamId)).toEqual(["t0", "t1", "t2"]);
    expect(tags(t.rooms)[1].style.left).toBe("150px");
    expect(tags(t.rooms)[1].style.maxWidth).toBe("112px");
    expect(t.rooms.cardsBox.children).toHaveLength(3);
    expect(t.rooms.layer.hidden).toBe(false);
  });
  it("팀 1개면 이름표·카드 없음", () => {
    const t = setup(mk(1));
    expect(tags(t.rooms)).toHaveLength(0);
    expect(t.rooms.cardsBox.hidden).toBe(true);
  });
  it("사용자 문자열은 textContent로만: <b> 이름이 자식 요소가 되지 않는다", () => {
    const s = mk(2); s.teams[0].name = "<b>x</b>";
    const t = setup(s);
    const btn = tags(t.rooms)[0];
    const name = btn.children.find((c) => c.className === "rt-name");
    expect(name.textContent).toBe("<b>x</b>");
    expect(name.children).toHaveLength(0);
    expect(btn.children.every((c) => ["I", "SPAN"].includes(c.tagName))).toBe(true);
    expect(btn.getAttribute("aria-label")).toBe("<b>x</b>, 1명, 대기. 누르면 확대");
  });
  it("시그니처가 같으면 DOM을 다시 만들지 않고, 달라지면 만든다", () => {
    const t = setup(mk(2));
    const before = tags(t.rooms)[0];
    t.store.set(mk(2));
    expect(tags(t.rooms)[0]).toBe(before);
    const s = mk(2); s.agents[0].status = "working";
    t.store.set(s);
    expect(tags(t.rooms)[0]).not.toBe(before);
    expect(tags(t.rooms)[0].children.some((c) => c.textContent === "일 1")).toBe(true);
  });
  it("camera moving이면 숨기고 멈추면 anchors를 다시 읽어 보인다", () => {
    const t = setup(mk(2));
    const n = t.office.roomAnchors.mock.calls.length;
    t.doc.dispatch("office:camera", { detail: { moving: true } });
    expect(t.rooms.layer.hidden).toBe(true);
    t.doc.dispatch("office:camera", { detail: { moving: false } });
    expect(t.rooms.layer.hidden).toBe(false);
    expect(t.office.roomAnchors.mock.calls.length).toBeGreaterThan(n);
  });
  it("누르면 view.enter, room 상태에서는 이름표 숨김", () => {
    const t = setup(mk(2));
    tags(t.rooms)[1].click();
    expect(t.view.get()).toEqual({ mode: "room", teamId: "t1" });
    expect(t.rooms.layer.hidden).toBe(true);
    t.view.back();
    expect(t.rooms.layer.hidden).toBe(false);
  });
  it("장면 API(roomAnchors)가 없어도 깨지지 않고 이름표는 숨김", () => {
    const env = fakeEnv(); const store = fakeStore(mk(2));
    const view = createView(store, { ...env, select() {} });
    const rooms = createRooms(store, view, { ...env, tagsHost: env.doc.body });
    expect(rooms.layer.children.every((b) => b.hidden)).toBe(true);
  });
  it("방 사이를 문서가 오가면 두 이름표가 flash", () => {
    const t = setup(mk(3));
    t.store.emit("events", [{ from: "a0_0", to: "a2_0" }]);
    const f = tags(t.rooms).map((b) => b.className.includes("flash"));
    expect(f).toEqual([true, false, true]);
  });
});

describe("단지 화면 상태", () => {
  it("Esc 한 번에 방→층→단지 한 단계만 이동한다", () => {
    const { doc, win } = fakeEnv(); const s = fakeStore(mk(2)); const view = createView(s, {doc,win,select:()=>{}});
    view.configureCampus(2,true);view.enterCampus();expect(view.get().mode).toBe("campus");
    s.emit("state",{state:s.state});expect(view.get().mode).toBe("campus");
    view.leaveCampus();view.enter("t0");
    let prevented=0;doc.dispatch("keydown",{key:"Escape",preventDefault:()=>prevented++});expect(view.get().mode).toBe("floor");
    doc.dispatch("keydown",{key:"Escape",preventDefault:()=>prevented++});expect(view.get().mode).toBe("campus");expect(prevented).toBe(2);
    view.configureCampus(2,false);expect(view.get().mode).not.toBe("campus");expect(view.enterCampus()).toBe(false);
    view.configureCampus(1,true);expect(view.enterCampus()).toBe(false);
  });
});

describe("단지에서 다른 사무동으로 들어갈 때", () => {
  it("이전 프로젝트의 팀 구성이 아니라 새 상태로 첫 화면(층 전체)을 정한다", () => {
    const { doc, win } = fakeEnv(); const s = fakeStore(mk(1)); const view = createView(s, { doc, win, select: () => {} });
    view.configureCampus(2, true); view.enterCampus();
    view.leaveCampus({ switching: true }); expect(view.get().mode).toBe("room"); // 새 상태 전: 이전(1팀) 기준
    s.set(mk(3)); expect(view.get().mode).toBe("floor"); // 같은 팀 id(t0)가 있어도 방에 머물지 않는다
  });
  it("같은 사무동으로 돌아가면(switching 없음) 다음 상태에도 화면을 바꾸지 않는다", () => {
    const { doc, win } = fakeEnv(); const s = fakeStore(mk(3)); const view = createView(s, { doc, win, select: () => {} });
    view.configureCampus(2, true); view.enterCampus(); view.leaveCampus(); view.enter("t1");
    s.set(mk(3)); expect(view.get()).toEqual({ mode: "room", teamId: "t1" });
  });
});

describe("단지 화면 보강", () => {
  it("팀 1개 상태가 와도 단지 화면을 유지하고, 이미 처리된 Esc는 무시한다", () => {
    const { doc, win } = fakeEnv(); const s = fakeStore(mk(1)); const view = createView(s, { doc, win, select: () => {} });
    view.configureCampus(2, true); view.enterCampus();
    s.set(mk(1)); expect(view.get().mode).toBe("campus");
    view.leaveCampus(); expect(view.get().mode).toBe("room");
    doc.dispatch("keydown", { key: "Escape", defaultPrevented: true, preventDefault: () => {} }); expect(view.get().mode).toBe("room");
    doc.dispatch("keydown", { key: "Escape", preventDefault: () => {} }); expect(view.get().mode).toBe("campus");
  });
});
