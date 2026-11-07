import { describe, it, expect } from "vitest";
import { buildBoardView, buildEventRows, agentName, formatHM, errorMessage, stateLabel, countChars, remainingChars, validateCommand, buildCommandRows, STATE_LABEL, COMMAND_MAX, checkLocalSize, parseLocalJson, classifyLocalData, pickLocalFiles, localErrorLines, LOCAL_MAX_BYTES, LOCAL_NEED_BOTH, kindOf, toLabel, COMMAND_KIND, buildAgentCards, AGENT_COLOR, AGENT_COLOR_FALLBACK } from "../src/panels/model.js";

const agents = [{ id: "claude", name: "Claude" }, { id: "gpt", name: "GPT" }];
const tasks = [
  { id: "W1", title: "<b>굵게</b> & <script>x()</script>", progress: 60, state: "doing", zone: "z1" },
  { id: "W2", title: "둘", progress: 250, state: "todo", zone: "z1" },
];
const status = { agents, tasks, events: [] };
const board = {
  mvp: [{ id: "M1", title: "<i>일정</i>", status: "in" }, { id: "M2", title: "알림", status: "pending" }, { id: "M3", title: "공유", status: "out" }],
  zones: [
    { id: "z1", name: "<img src=x onerror=alert(1)>", ownerAgentId: "claude", taskIds: ["W1", "W2", "W9"] },
    { id: "z2", name: "빈 구역", ownerAgentId: "chief", taskIds: [] },
  ],
};

describe("buildBoardView", () => {
  it("HTML 문자열을 가공하지 않고 글자 그대로 보존한다", () => {
    const v = buildBoardView(status, board);
    expect(v.zones[0].name).toBe("<img src=x onerror=alert(1)>");
    expect(v.zones[0].tasks[0].title).toBe("<b>굵게</b> & <script>x()</script>");
    expect(v.mvp[0].title).toBe("<i>일정</i>");
  });
  it("MVP 상태 칩 라벨", () => {
    expect(buildBoardView(status, board).mvp.map((m) => m.label)).toEqual(["포함", "보류", "제외"]);
  });
  it("담당자 이름을 status.agents에서 찾는다", () => {
    const v = buildBoardView(status, board);
    expect(v.zones[0].ownerName).toBe("Claude");
    expect(v.zones[0].ownerKnown).toBe(true);
  });
  it("없는 에이전트는 id로 대체하고 unknown 표시", () => {
    const v = buildBoardView(status, board);
    expect(v.zones[1].ownerName).toBe("chief");
    expect(v.zones[1].ownerKnown).toBe(false);
    expect(agentName(agents, undefined)).toBe("(알 수 없음)");
  });
  it("없는 작업은 placeholder, 진행도는 0~100으로 제한", () => {
    const t = buildBoardView(status, board).zones[0].tasks;
    expect(t[1].progress).toBe(100);
    expect(t[2]).toMatchObject({ id: "W9", missing: true, progress: 0 });
  });
  it("status/board가 비어 있어도 죽지 않는다", () => {
    expect(buildBoardView(null, null)).toEqual({ mvp: [], prd: [], bp: null, zones: [], progress: { prd: null, bp: null, mvp: null, tasks: null } });
  });
});

describe("buildEventRows", () => {
  const ev = (id, at, extra = {}) => ({ id, at, from: "gpt", to: "claude", title: "t" + id, summary: "s" + id, kind: "doc", ...extra });
  it("최신순으로 정렬한다", () => {
    const rows = buildEventRows([ev(1, "2026-11-05T14:10:00+09:00"), ev(3, "2026-11-05T14:30:00+09:00"), ev(2, "2026-11-05T14:20:00+09:00")], agents);
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("HH:MM, from→to, 제목, 요약", () => {
    const [r] = buildEventRows([ev(1, "2026-11-05T14:05:09+09:00", { to: "board" })], agents);
    expect(r).toMatchObject({ time: "14:05", route: "GPT→게시판", title: "t1", summary: "s1" });
  });
  it("HTML 제목/요약은 글자 그대로", () => {
    const [r] = buildEventRows([ev(1, "2026-11-05T14:05:09+09:00", { title: "<b>x</b>", summary: "<script>1</script>" })], agents);
    expect(r.title).toBe("<b>x</b>");
    expect(r.summary).toBe("<script>1</script>");
  });
  it("없는 에이전트는 id 그대로, 입력 배열을 바꾸지 않는다", () => {
    const input = [ev(1, "2026-11-05T14:00:00+09:00", { from: "ghost" }), ev(2, "2026-11-05T14:01:00+09:00")];
    const rows = buildEventRows(input, agents);
    expect(rows[1].from).toBe("ghost");
    expect(input[0].id).toBe(1);
  });
  it("limit과 잘못된 시각", () => {
    expect(buildEventRows([ev(1, "x"), ev(2, "y")], agents, 1)).toHaveLength(1);
    expect(formatHM("garbage")).toBe("--:--");
    expect(buildEventRows(undefined)).toEqual([]);
  });
});

describe("작업 지시 순수 함수", () => {
  it("오류 code별 한국어 안내와 알 수 없는 code 대체", () => {
    for (const c of ["INVALID_TO", "EMPTY_TEXT", "TEXT_TOO_LONG", "SECRET_LIKE", "TOO_MANY", "UNAUTHENTICATED"]) {
      expect(errorMessage(c)).toMatch(/[가-힣]/);
    }
    expect(errorMessage("NOPE")).toBe(errorMessage(undefined));
    expect(errorMessage("TOO_MANY", 60)).toContain("60초");
  });
  it("상태 칩 라벨: pending/delivered/done", () => {
    expect(STATE_LABEL).toEqual({ pending: "대기", delivered: "전달됨", done: "처리됨" });
    expect(stateLabel("done")).toBe("처리됨");
    expect(stateLabel("read")).toBe("read");
  });
  it("글자수 계산", () => {
    expect(COMMAND_MAX).toBe(300);
    expect(countChars("가나다")).toBe(3);
    expect(remainingChars("a".repeat(299))).toBe(1);
    expect(remainingChars("a".repeat(301))).toBe(-1);
  });
  it("입력 검증", () => {
    expect(validateCommand("x", "hi")).toEqual({ ok: false, code: "INVALID_TO" });
    expect(validateCommand("gpt", "   ")).toEqual({ ok: false, code: "EMPTY_TEXT" });
    expect(validateCommand("gpt", "a".repeat(301))).toEqual({ ok: false, code: "TEXT_TOO_LONG" });
    expect(validateCommand("claude", "a".repeat(300))).toEqual({ ok: true });
  });
  it("지시 목록 행: 최신순, 시각 필드, 원문 보존", () => {
    const rows = buildCommandRows([
      { id: 1, at: "2026-11-05T14:03:00+09:00", to: "claude", text: "<b>x</b>", state: "done", needsApproval: false, deliveredAt: "2026-11-05T14:06:00+09:00", doneAt: "2026-11-05T14:30:00+09:00" },
      { id: 2, at: "2026-11-05T15:00:00+09:00", to: "gpt", text: "배포", state: "pending", needsApproval: true, deliveredAt: null, doneAt: null, note: "메모" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ to: "GPT", stateLabel: "대기", needsApproval: true, deliveredTime: "", note: "메모" });
    expect(rows[1]).toMatchObject({ text: "<b>x</b>", stateLabel: "처리됨", deliveredTime: "11-05 14:06", doneTime: "11-05 14:30" });
  });
});

describe("개인·공동 지시", () => {
  it("validateCommand: 종류와 받는 사람 조합", () => {
    expect(validateCommand("gpt", "hi", "solo")).toEqual({ ok: true });
    expect(validateCommand("gpt", "hi")).toEqual({ ok: true }); // kind 생략은 개인
    expect(validateCommand("team", "hi", "team")).toEqual({ ok: true });
    expect(validateCommand("team", "hi", "solo")).toEqual({ ok: false, code: "INVALID_TO" });
    expect(validateCommand("gpt", "hi", "team")).toEqual({ ok: false, code: "INVALID_TO" });
    expect(validateCommand("gpt", "hi", "group")).toEqual({ ok: false, code: "INVALID_KIND" });
    expect(validateCommand("team", "   ", "team")).toEqual({ ok: false, code: "EMPTY_TEXT" });
    expect(validateCommand("team", "a".repeat(301), "team")).toEqual({ ok: false, code: "TEXT_TOO_LONG" });
  });
  it("kindOf: kind가 없거나 모르는 값은 개인", () => {
    expect(kindOf({ kind: "team" })).toBe("team");
    expect(kindOf({ kind: "solo" })).toBe("solo");
    expect(kindOf({})).toBe("solo");
    expect(kindOf({ kind: "group" })).toBe("solo");
    expect(kindOf(null)).toBe("solo");
  });
  it("오류 문구와 라벨", () => {
    expect(errorMessage("INVALID_KIND")).toContain("공동");
    expect(errorMessage("INVALID_TO")).toContain("받는 사람");
    expect(toLabel("team")).toBe("모두에게");
    expect(COMMAND_KIND.map((k) => k.label)).toEqual(["개인", "공동"]);
  });
  it("목록 행: 개인·공동 표시와 옛 기록", () => {
    const rows = buildCommandRows([
      { id: 1, at: "2026-11-05T14:03:00+09:00", to: "claude", text: "옛 기록", state: "done" },
      { id: 2, at: "2026-11-05T15:00:00+09:00", kind: "team", to: "team", text: "<b>다같이</b>", state: "pending" },
      { id: 3, at: "2026-11-05T15:01:00+09:00", kind: "solo", to: "gpt", text: "혼자", state: "pending" },
    ]);
    expect(rows.map((r) => r.target)).toEqual(["개인 · GPT", "공동 · 모두에게", "개인 · Claude"]);
    expect(rows[1]).toMatchObject({ kind: "team", kindLabel: "공동", text: "<b>다같이</b>" });
    expect(rows[2]).toMatchObject({ kind: "solo", kindLabel: "개인" });
  });
});

describe("내 데이터 불러오기(순수 함수)", () => {
  const f = (name, obj, size) => ({ name, size: size ?? 100, text: typeof obj === "string" ? obj : JSON.stringify(obj) });
  it("내용으로 status/board를 구분한다", () => {
    expect(classifyLocalData({ agents: [] })).toBe("status");
    expect(classifyLocalData({ mvp: [] })).toBe("board");
    expect(classifyLocalData({ agents: [], mvp: [] })).toBeNull();
    expect(classifyLocalData({ agents: {} })).toBeNull();
    expect(classifyLocalData([])).toBeNull();
    expect(classifyLocalData(null)).toBeNull();
  });
  it("크기 검사: 5MB 초과는 거부", () => {
    expect(checkLocalSize("a.json", LOCAL_MAX_BYTES)).toEqual({ ok: true });
    expect(checkLocalSize("a.json", LOCAL_MAX_BYTES + 1).ok).toBe(false);
  });
  it("JSON 아님은 이유를 돌려주고 BOM은 무시한다", () => {
    expect(parseLocalJson("a.json", "{x").ok).toBe(false);
    expect(parseLocalJson("a.json", "﻿" + '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("파일 순서와 이름에 상관없이 짝을 맞춘다", () => {
    const r = pickLocalFiles([f("x.json", { mvp: [] }), f("y.json", { agents: [] })]);
    expect(r).toEqual({ ok: true, status: { agents: [] }, board: { mvp: [] } });
  });
  it("하나만 고르면 안내 문구", () => {
    expect(pickLocalFiles([f("a.json", { agents: [] })])).toEqual({ ok: false, reasons: [LOCAL_NEED_BOTH] });
    expect(pickLocalFiles([]).ok).toBe(false);
  });
  it("같은 종류 둘, 구분 불가, 큰 파일, JSON 아님, 3개 이상 거부", () => {
    expect(pickLocalFiles([f("a", { agents: [] }), f("b", { agents: [] })]).ok).toBe(false);
    expect(pickLocalFiles([f("a", { foo: 1 }), f("b", { mvp: [] })]).reasons[0]).toContain("알 수 없어요");
    expect(pickLocalFiles([f("a", { agents: [] }, LOCAL_MAX_BYTES + 1), f("b", { mvp: [] })]).reasons[0]).toContain("5MB");
    expect(pickLocalFiles([f("a", "not json"), f("b", { mvp: [] })]).reasons[0]).toContain("JSON");
    expect(pickLocalFiles([f("a", {}), f("b", {}), f("c", {})]).ok).toBe(false);
  });
  it("오류는 최대 8줄", () => {
    const many = Array.from({ length: 20 }, (_, i) => "e" + i);
    const lines = localErrorLines(many);
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe("...외 13건");
    expect(localErrorLines(["a", "b"])).toEqual(["a", "b"]);
    expect(localErrorLines(undefined)).toEqual([]);
  });
});

describe("buildAgentCards (메인 보드 에이전트 줄)", () => {
  const st = {
    agents: [
      { id: "chief", name: "총괄", status: "working", currentTaskId: "W1" },
      { id: "claude", name: "Claude", status: "idle", currentTaskId: null },
      { id: "gpt", name: "<b>GPT</b>", status: "blocked", currentTaskId: "W9" },
      { id: "x", name: "새 에이전트", status: "sleeping" },
    ],
    tasks: [{ id: "W1", title: "<i>작업</i>", progress: 10, state: "doing" }],
  };
  it("상태 글자를 한국어로 바꾼다", () => {
    expect(buildAgentCards(st).map((c) => c.statusLabel)).toEqual(["일하는 중", "대기", "막힘", "sleeping"]);
  });
  it("현재 작업 제목을 가공 없이 넣고, 없거나 모르는 작업은 빈 문자열", () => {
    const c = buildAgentCards(st);
    expect(c[0].task).toBe("<i>작업</i>");
    expect(c[1].task).toBe("");
    expect(c[2].task).toBe("");
    expect(c[2].name).toBe("<b>GPT</b>");
  });
  it("옷색: 총괄 네이비·Claude 녹색·GPT 하늘색, 모르는 에이전트는 회색", () => {
    const c = buildAgentCards(st);
    expect(c[0].color).toBe(AGENT_COLOR.chief);
    expect(c[1].color).toBe("#3E5A45");
    expect(c[2].color).toBe("#9CC3E6");
    expect(c[3].color).toBe(AGENT_COLOR_FALLBACK);
  });
  it("비어 있거나 깨진 입력에도 죽지 않는다", () => {
    expect(buildAgentCards(null)).toEqual([]);
    expect(buildAgentCards({ agents: [null, 3], tasks: null })).toEqual([]);
  });
});

describe("프로토타입 이름 id/값", () => {
  const BAD = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];
  it("에이전트 id가 위험한 이름이어도 옷색은 문자열(회색)이다", () => {
    const st = { agents: BAD.map((id) => ({ id, name: id, role: "r", status: id, currentTaskId: null, note: "" })), tasks: [] };
    for (const c of buildAgentCards(st)) {
      expect(c.color).toBe(AGENT_COLOR_FALLBACK);
      expect(typeof c.statusLabel).toBe("string");
      expect(c.statusLabel).not.toMatch(/function|\[object/);
    }
  });
  it("보드 상태·영역 값이 위험한 이름이어도 라벨은 문자열이다", () => {
    const v = buildBoardView({ agents: [], tasks: [] }, { mvp: [{ id: "m", title: "t", status: "constructor", taskIds: [] }], prd: [{ id: "p", title: "t", status: "toString" }], bp: [{ id: "b", area: "__proto__", title: "t", status: "valueOf" }] });
    expect(v.mvp[0].label).toBe("constructor");
    expect(v.prd[0].label).toBe("toString");
    expect(v.bp[0].areaLabel).toBe("__proto__");
    expect(v.bp[0].label).toBe("valueOf");
  });
});
