import { describe, it, expect } from "vitest";
import { toBuildingLook } from "../src/scene/ghlook.js";
import { FAKE_METRICS } from "./fixtures/gh-metrics.js";

const base = { projectId: "gh-x", commits30d: 0, activityRatio: 0, openPRs: 0, openIssues: 0, ci: "none", sync: { mode: "polling", status: "ok" } };
const look = (o) => toBuildingLook({ ...base, ...o });

describe("toBuildingLook floors", () => {
  it("ratio 0 → 12, 1 → 22, 0.5 → 17", () => {
    expect(look({ activityRatio: 0 }).floors).toBe(12);
    expect(look({ activityRatio: 1 }).floors).toBe(22);
    expect(look({ activityRatio: 0.5 }).floors).toBe(17);
  });
  it("정수로 반올림", () => {
    expect(Number.isInteger(look({ activityRatio: 0.123 }).floors)).toBe(true);
    expect(look({ activityRatio: 0.04 }).floors).toBe(12);
    expect(look({ activityRatio: 0.06 }).floors).toBe(13);
  });
  it("범위 밖·NaN은 0..1로 자른다", () => {
    expect(look({ activityRatio: -3 }).floors).toBe(12);
    expect(look({ activityRatio: 7 }).floors).toBe(22);
    expect(look({ activityRatio: NaN }).floors).toBe(12);
    expect(look({ activityRatio: undefined }).floors).toBe(12);
    expect(look({ activityRatio: Infinity }).floors).toBe(12);
  });
});

describe("toBuildingLook roof", () => {
  it.each([["failing", "alert"], ["running", "busy"], ["pending", "busy"], ["passing", "normal"], ["unknown", "normal"], ["none", "normal"]])("%s → %s", (ci, roof) => {
    expect(look({ ci }).roof).toBe(roof);
  });
});

describe("toBuildingLook dim", () => {
  it.each([["ok", false], ["syncing", false], ["stale", true], ["error", true]])("%s → %s", (status, dim) => {
    expect(look({ sync: { mode: "polling", status } }).dim).toBe(dim);
  });
  it("sync 없음은 dim 아님", () => { expect(look({ sync: undefined }).dim).toBe(false); });
});

describe("toBuildingLook litRatio", () => {
  it("0이면 0", () => { expect(look({}).litRatio).toBe(0); });
  it("단조 증가이고 1 미만(상한)", () => {
    let prev = 0;
    for (const n of [1, 2, 8, 50, 1000, 1e9]) {
      const v = look({ openPRs: n, openIssues: n }).litRatio;
      expect(v).toBeGreaterThan(prev); expect(v).toBeLessThanOrEqual(1); prev = v;
    }
    expect(look({ openPRs: 1e12 }).litRatio).toBeLessThanOrEqual(1);
  });
  it("PR+이슈 합이 8이면 0.5", () => { expect(look({ openPRs: 3, openIssues: 5 }).litRatio).toBe(0.5); });
  it("음수·NaN은 0", () => {
    expect(look({ openPRs: -5, openIssues: -1 }).litRatio).toBe(0);
    expect(look({ openPRs: NaN, openIssues: NaN }).litRatio).toBe(0);
    expect(look({ openPRs: NaN, openIssues: 8 }).litRatio).toBe(0.5);
  });
});

describe("가짜 지표 5종", () => {
  it("대표 사례", () => {
    const [busy, fail, run, stale, err] = FAKE_METRICS.map(toBuildingLook);
    expect(busy).toMatchObject({ floors: 22, roof: "normal", dim: false });
    expect(fail.roof).toBe("alert");
    expect(run.roof).toBe("busy");
    expect(stale).toMatchObject({ dim: true, roof: "normal" });
    expect(err).toMatchObject({ floors: 12, dim: true, litRatio: 0 });
  });
});
