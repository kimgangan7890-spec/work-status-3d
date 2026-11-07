import { describe, it, expect } from "vitest";
import { projectIdFromRepoId, GH_API, CI_STATES, SYNC_STATES } from "../src/shared/ghcontract.js";
import { CI_STATES as SERVER_CI } from "../contracts/index.js";
import { TEAM_ID_RE } from "../src/shared/validate.js";
import { FAKE_METRICS } from "./fixtures/gh-metrics.js";

describe("GitHub 동기화 화면 계약 v1.1.0", () => {
  it("projectId 규칙이 기존 id 규칙을 지킨다", () => {
    for (const n of [1, 1001, 123456789, 2 ** 40]) expect(TEAM_ID_RE.test(projectIdFromRepoId(n))).toBe(true);
    expect(projectIdFromRepoId(1001)).toBe("gh-rt");
  });
  it("CI 상태 목록이 공통 계약과 같다", () => { expect([...CI_STATES]).toEqual([...SERVER_CI]); });
  it("모든 경로가 /api/github/ 아래", () => { for (const p of Object.values(GH_API)) expect(p.startsWith("/api/github/")).toBe(true); });
  it("가짜 데이터가 계약 모양을 따른다", () => {
    for (const m of FAKE_METRICS) {
      expect(TEAM_ID_RE.test(m.projectId)).toBe(true);
      expect(m.activityRatio).toBeGreaterThanOrEqual(0); expect(m.activityRatio).toBeLessThanOrEqual(1);
      expect(CI_STATES).toContain(m.ci); expect(SYNC_STATES).toContain(m.sync.status);
    }
  });
});
