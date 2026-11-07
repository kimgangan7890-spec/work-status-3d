import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readDayMode, writeDayMode, nextDayMode, createDayMode, MODE_LABEL } from "../src/panels/daymode.js";

class N { constructor(t) { this.tagName = t; this.attrs = {}; this.handlers = {}; this.textContent = ""; this.className = ""; }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(t, f) { (this.handlers[t] ||= []).push(f); } click() { for (const f of this.handlers.click ?? []) f(); } }
let store, events;
beforeEach(() => {
  store = {}; events = [];
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  globalThis.document = { createElement: (t) => new N(t) };
  vi.stubGlobal("window", { dispatchEvent: (e) => events.push(e.detail) });
  vi.stubGlobal("CustomEvent", class { constructor(t, o) { this.type = t; this.detail = o?.detail; } });
});
afterEach(() => { delete globalThis.localStorage; delete globalThis.document; vi.unstubAllGlobals(); });

describe("하늘 시간 전환", () => {
  it("순서는 자동 → 낮 → 밤 → 자동", () => { expect(["auto", "day", "night", "auto"].map((m, i, a) => nextDayMode(a[i - 1] ?? "night"))).toEqual(["auto", "day", "night", "auto"]); });
  it("저장값이 없거나 이상하면 자동", () => { expect(readDayMode()).toBe("auto"); store["office.daymode"] = "zzz"; expect(readDayMode()).toBe("auto"); });
  it("저장소가 막혀도(예외) 동작한다", () => {
    globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(readDayMode()).toBe("auto"); expect(() => writeDayMode("night")).not.toThrow();
    const dm = createDayMode(); dm.root.click(); expect(dm.mode).toBe("day"); expect(events).toEqual(["day"]);
  });
  it("버튼: 누를 때마다 모드를 바꾸고 저장하고 알린다", () => {
    const dm = createDayMode();
    expect(dm.root.textContent).toBe("하늘: 자동");
    dm.root.click(); dm.root.click();
    expect(dm.root.textContent).toBe("하늘: 밤"); expect(store["office.daymode"]).toBe("night"); expect(events).toEqual(["day", "night"]);
    dm.root.click(); expect(events.at(-1)).toBe("auto");
  });
  it("저장된 모드로 시작한다", () => { store["office.daymode"] = "day"; expect(createDayMode().root.textContent).toBe(`하늘: ${MODE_LABEL.day}`); });
});
