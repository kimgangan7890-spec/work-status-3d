import { describe, it, expect, vi } from "vitest";
import { createCommandsPanel } from "../src/panels/commands.js";

class N { constructor(t) { this.tagName = t; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.classList = { toggle() {}, add() {}, remove() {} }; this.h = {}; this.className = ""; this.textContent = ""; this.value = ""; this.ownerDocument = null; }
  append(...c) { this.children.push(...c); } replaceChildren(...c) { this.children = c; } remove() {} setAttribute(k, v) { this.attrs[k] = v; } addEventListener(t, f) { this.h[t] = f; } focus() { this.focused = true; } }
const doc = { createElement: (t) => { const n = new N(t); n.ownerDocument = doc; return n; }, documentElement: { style: { setProperty() {} } } };
const A = (id, teamId) => ({ id, name: id, status: "idle", teamId });
const status = { teams: [{ id: "x", name: "엑스" }, { id: "y", name: "와이" }], agents: [A("a", "x"), A("b", "y")] };

async function ready(mobile) {
  const root = new N("body"); root.ownerDocument = doc;
  const openSheet = vi.fn();
  const c = createCommandsPanel({
    root, getStatus: () => status, openSheet,
    fetch: async () => ({ status: 200, json: async () => ({ commands: [] }) }),
    matchMedia: () => ({ matches: mobile }), setInterval: () => 1, clearInterval() {},
  });
  await c.start();
  return { c, openSheet };
}
const checked = (c, wrapCls) => c.bar.children[1].children.flatMap((w) => w.children).filter((b) => b.className?.includes?.("on") && b.dataset.to !== undefined).map((b) => b.dataset.to);

describe("commands.preset", () => {
  it("팀 공동 지시(team:<id>)와 개인 지시(agent id)를 맞춘다", async () => {
    const { c } = await ready(false);
    expect(c.preset({ kind: "team", to: "team:y" })).toBe(true);
    expect(c.preset({ kind: "solo", to: "b" })).toBe(true);
    expect(c.preset({ kind: "team", to: "team" })).toBe(true);
  });
  it("잘못된 값은 무시", async () => {
    const { c } = await ready(false);
    for (const p of [null, {}, { kind: "team", to: "team:zzz" }, { kind: "team", to: "a" }, { kind: "solo", to: "nope" }, { kind: "solo", to: "team:x" }, { kind: "x", to: "a" }, { kind: "solo", to: 3 }])
      expect(c.preset(p)).toBe(false);
  });
  it("지시 UI가 준비되지 않았으면 무시", () => {
    const root = new N("body"); root.ownerDocument = doc;
    const c = createCommandsPanel({ root, getStatus: () => status, fetch: async () => ({ status: 401 }), matchMedia: () => ({ matches: false }), setInterval: () => 1, clearInterval() {} });
    expect(c.preset({ kind: "team", to: "team:x" })).toBe(false);
  });
  it("폰이면 시트를 열고, open:false면 열지 않는다", async () => {
    const m = await ready(true);
    m.c.preset({ kind: "solo", to: "a" });
    expect(m.openSheet).toHaveBeenCalledTimes(1);
    m.c.preset({ kind: "team", to: "team" }, { open: false });
    expect(m.openSheet).toHaveBeenCalledTimes(1);
    const d = await ready(false);
    d.c.preset({ kind: "solo", to: "a" });
    expect(d.openSheet).not.toHaveBeenCalled();
  });
});
