import { describe, it, expect } from "vitest";
import { teamsOf, hasTeamTabs, pickTeam, teamOfAgent } from "../src/shared/teams.js";
import { agentColors, FIXED_COLOR, COLOR_FALLBACK } from "../src/shared/colors.js";
import { buildTeamTabs, buildAgentGroups, buildAgentCards, buildCommandTargets, buildCommandRows, targetLabel, validateCommand, teamLabelForRoute, AGENT_COLOR_FALLBACK } from "../src/panels/model.js";

const A = (id, status, teamId, name = id) => ({ id, name, status, currentTaskId: null, teamId });
const plain = { agents: [A("chief", "working"), A("claude", "idle"), A("gpt", "working")], tasks: [], events: [] };
const teamed = {
  teams: [{ id: "review", name: "검수팀", order: 2 }, { id: "code", name: "코딩팀", order: 1 }],
  agents: [A("chief", "working", "code"), A("claude", "idle", "code"), A("gpt", "idle", "code"), A("rev1", "blocked", "review", "검수 1"), A("rev2", "working", "review", "검수 2")],
  tasks: [], events: [],
};

describe("teamsOf", () => {
  it("teams가 없으면 한 팀(main)이고 탭은 없다", () => {
    const t = teamsOf(plain);
    expect(t).toHaveLength(1); expect(t[0].id).toBe("main"); expect(t[0].count).toBe(3);
    expect(hasTeamTabs(plain)).toBe(false);
    expect(buildTeamTabs(plain)).toEqual([]);
  });
  it("order로 정렬하고 인원·일하는 중·막힘을 센다", () => {
    const t = teamsOf(teamed);
    expect(t.map((x) => x.id)).toEqual(["code", "review"]);
    expect(t[0]).toMatchObject({ count: 3, working: 1, blocked: 0, dot: "working" });
    expect(t[1]).toMatchObject({ count: 2, working: 1, blocked: 1, dot: "blocked" });
  });
  it("teamId 없는 에이전트는 main으로, main이 없으면 '기타' 팀으로 모은다", () => {
    const s = { teams: [{ id: "code", name: "코딩팀" }, { id: "main", name: "기본" }], agents: [A("a", "idle", "code"), A("b", "idle", undefined), A("c", "idle", "nope")] };
    expect(teamsOf(s).find((t) => t.id === "main").agentIds).toEqual(["b", "c"]);
    const s2 = { teams: [{ id: "code", name: "코딩팀" }, { id: "x", name: "엑스" }], agents: [A("a", "idle", "code"), A("b", "idle", undefined)] };
    expect(teamsOf(s2).at(-1)).toMatchObject({ id: "main", name: "기타", agentIds: ["b"] });
  });
  it("비어 있는 기본 팀(main)만 뺀다. 그 밖의 팀은 0명이어도 빈 방으로 남는다", () => {
    const s = { teams: [{ id: "main", name: "기본" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], agents: [A("x", "idle", "a"), A("y", "idle", "b")] };
    expect(teamsOf(s).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(teamsOf(s).find((t) => t.id === "c")).toMatchObject({ count: 0, working: 0, blocked: 0, dot: "idle", agentIds: [] });
    expect(buildTeamTabs(s).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(buildCommandTargets(s).map((g) => g.label)).toEqual(["전체", "A", "B", "C"]);
    // 사람이 있는 팀 1개 + 빈 팀 1개는 방이 2개라 층 전체 화면이 생긴다. 빈 main만 있으면 그대로 한 팀.
    expect(hasTeamTabs({ teams: [{ id: "a", name: "A" }, { id: "b", name: "B" }], agents: [A("x", "idle", "a")] })).toBe(true);
    expect(hasTeamTabs({ teams: [{ id: "main", name: "기본" }, { id: "a", name: "A" }], agents: [A("x", "idle", "a")] })).toBe(false);
    expect(teamsOf({ agents: [] })).toEqual([]);
  });
  it("pickTeam: 저장된 값이 없거나 사라졌으면 첫 팀", () => {
    expect(pickTeam(teamed, "review")).toBe("review");
    expect(pickTeam(teamed, "gone")).toBe("code");
    expect(pickTeam(teamed, null)).toBe("code");
    expect(teamOfAgent(teamed, "rev2")).toBe("review");
  });
  it("깨진 입력에도 던지지 않는다", () => {
    expect(() => teamsOf(null)).not.toThrow();
    expect(teamsOf({ agents: [null, 3, {}], teams: [null, 1] })).toEqual([]);
  });
});

describe("색", () => {
  it("고정 3명은 지금 색 그대로, 팀 없으면 나머지는 회색", () => {
    const c = agentColors(plain);
    expect(c.get("claude")).toBe(FIXED_COLOR.claude);
    expect(agentColors({ agents: [A("zzz", "idle")] }).get("zzz")).toBe(COLOR_FALLBACK);
  });
  it("팀이 있으면 새 에이전트는 팀 색, 같은 팀 안에서는 명도만 다르다", () => {
    const c = agentColors(teamed);
    expect(c.get("chief")).toBe(FIXED_COLOR.chief);
    expect(c.get("rev1")).toMatch(/^#[0-9A-F]{6}$/);
    expect(c.get("rev1")).not.toBe(c.get("rev2"));
    expect(c.get("rev1")).not.toBe(COLOR_FALLBACK);
  });
  it("보드 카드 색 = 장면에서 쓰는 색 함수와 같다", () => {
    const cards = buildAgentCards(teamed); const c = agentColors(teamed);
    for (const k of cards) expect(k.color).toBe(c.get(k.id));
    expect(buildAgentCards({ agents: [A("zzz", "idle")], tasks: [] })[0].color).toBe(AGENT_COLOR_FALLBACK);
  });
});

describe("탭·묶음", () => {
  it("탭: 이름·점·선택", () => {
    const tabs = buildTeamTabs(teamed, "review");
    expect(tabs.map((t) => [t.name, t.dot, t.selected])).toEqual([["코딩팀", "working", false], ["검수팀", "blocked", true]]);
  });
  it("보드 묶음: 선택 팀만 펼침, 머리글에 인원·일하는 중·막힘", () => {
    const g = buildAgentGroups(teamed, "review");
    expect(g.map((x) => x.open)).toEqual([false, true]);
    expect(g[1].header).toBe("검수팀 · 2명 · 일하는 중 1 / 막힘 1");
    expect(g[0].cards.map((c) => c.id)).toEqual(["chief", "claude", "gpt"]);
  });
  it("팀이 없으면 머리글 없는 묶음 하나가 펼쳐져 있다", () => {
    const g = buildAgentGroups(plain, null);
    expect(g).toHaveLength(1); expect(g[0].header).toBe(""); expect(g[0].open).toBe(true);
  });
  it("다른 팀과 오간 경우에만 팀 이름을 붙인다", () => {
    expect(teamLabelForRoute(teamed, "rev1", "claude")).toEqual({ from: "검수팀", to: "코딩팀" });
    expect(teamLabelForRoute(teamed, "claude", "gpt")).toBeNull();
    expect(teamLabelForRoute(plain, "claude", "gpt")).toBeNull();
  });
});

describe("지시 대상", () => {
  it("팀 없으면 지금과 같은 목록(전체 + 3명)", () => {
    const t = buildCommandTargets(plain);
    expect(t).toHaveLength(1);
    expect(t[0].options.map((o) => o.to)).toEqual(["team", "chief", "claude", "gpt"]);
  });
  it("팀 있으면 팀별 묶음과 team:<id>", () => {
    const t = buildCommandTargets(teamed);
    expect(t.map((g) => g.label)).toEqual(["전체", "코딩팀", "검수팀"]);
    expect(t[2].options.map((o) => [o.kind, o.to])).toEqual([["team", "team:review"], ["solo", "rev1"], ["solo", "rev2"]]);
  });
  it("검사: team:<없는 팀>·없는 에이전트는 거절, 있는 것은 통과", () => {
    expect(validateCommand("team:review", "안녕", "team", teamed).ok).toBe(true);
    expect(validateCommand("team:nope", "안녕", "team", teamed)).toEqual({ ok: false, code: "INVALID_TO" });
    expect(validateCommand("rev1", "안녕", "solo", teamed).ok).toBe(true);
    expect(validateCommand("ghost", "안녕", "solo", teamed).code).toBe("INVALID_TO");
    // 팀 없는 화면은 지금 규칙 그대로
    expect(validateCommand("team:review", "안녕", "team", plain).code).toBe("INVALID_TO");
    expect(validateCommand("claude", "안녕").ok).toBe(true);
  });
  it("표시 이름", () => {
    expect(targetLabel("team:review", teamed)).toBe("검수팀 전체");
    expect(targetLabel("team", teamed)).toBe("모두에게");
    expect(targetLabel("rev1", teamed)).toBe("검수 1");
  });
});

describe("지시 목록 대상 표시", () => {
  const status = { teams: [{ id: "a", name: "코딩팀" }, { id: "b", name: "검수팀" }], agents: [A("x", "idle", "a"), { ...A("y", "idle", "b"), name: "검수 매니저" }] };
  it("team:<id>는 팀 이름, 에이전트 id는 이름으로 보인다", () => {
    const rows = buildCommandRows([{ id: 3, kind: "team", to: "team:b", text: "t" }, { id: 2, kind: "team", to: "team", text: "t" }, { id: 1, kind: "solo", to: "y", text: "t" }], 50, status);
    expect(rows.map((r) => r.target)).toEqual(["공동 · 검수팀 전체", "공동 · 모두에게", "개인 · 검수 매니저"]);
  });
});
