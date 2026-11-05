// DOM이 필요 없는 view-model 함수. 문자열은 가공 없이 그대로 두고, 화면에는 textContent로만 넣는다.
export const MVP_LABEL = { in: "포함", out: "제외", pending: "보류" };
export const FALLBACK_AGENT = "(알 수 없음)";

/** 에이전트 id → 표시 이름. 없으면 id 그대로, id도 없으면 대체 문구. */
export function agentName(agents, id) {
  const a = (agents || []).find((x) => x && x.id === id);
  if (a && typeof a.name === "string" && a.name) return a.name;
  if (id === "board") return "게시판";
  return typeof id === "string" && id ? id : FALLBACK_AGENT;
}

function clampPct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

/** @returns {{mvp: object[], zones: object[]}} 구역마다 ownerName, ownerKnown, tasks[] 를 갖는다. */
export function buildBoardView(status, board) {
  const agents = status?.agents ?? [];
  const taskMap = new Map((status?.tasks ?? []).map((t) => [t.id, t]));
  const mvp = (board?.mvp ?? []).map((m) => ({
    id: m.id, title: m.title, status: m.status, label: MVP_LABEL[m.status] ?? String(m.status),
  }));
  const zones = (board?.zones ?? []).map((z) => ({
    id: z.id,
    name: z.name,
    ownerId: z.ownerAgentId,
    ownerName: agentName(agents, z.ownerAgentId),
    ownerKnown: agents.some((a) => a.id === z.ownerAgentId),
    tasks: (z.taskIds ?? []).map((id) => {
      const t = taskMap.get(id);
      return t
        ? { id, title: t.title, progress: clampPct(t.progress), state: t.state, missing: false }
        : { id, title: "(작업 정보 없음)", progress: 0, state: "todo", missing: true };
    }),
  }));
  return { mvp, zones };
}

import { agentColors } from "../shared/colors.js";
import { teamsOf, hasTeamTabs, pickTeam, TEAM_ID_RE } from "../shared/teams.js";
export { teamsOf, hasTeamTabs, pickTeam };

// ---- 메인 보드의 에이전트 줄 (DESIGN3.md §2) ----
export const AGENT_STATUS_LABEL = { working: "일하는 중", idle: "대기", blocked: "막힘" };
// 캐릭터 옷색과 같다(DESIGN3.md §5). 모르는 에이전트는 회색.
export const AGENT_COLOR = { chief: "#2E3A59", claude: "#3E5A45", gpt: "#9CC3E6" };
export const AGENT_COLOR_FALLBACK = "#8a90a0";

/** @returns {{id, name, status, statusLabel, task, color}[]} 현재 작업이 없으면 task는 빈 문자열. */
export function buildAgentCards(status) {
  const colors = agentColors(status);
  const tasks = new Map((status?.tasks ?? []).map((t) => [t.id, t]));
  return (status?.agents ?? []).filter((a) => a && typeof a === "object").map((a) => {
    const st = String(a.status ?? "");
    const t = a.currentTaskId != null ? tasks.get(a.currentTaskId) : null;
    return {
      id: a.id,
      name: agentName(status.agents, a.id),
      status: st,
      statusLabel: AGENT_STATUS_LABEL[st] ?? (st || "알 수 없음"),
      task: t ? t.title : "",
      color: colors.get(a.id) ?? AGENT_COLOR[a.id] ?? AGENT_COLOR_FALLBACK,
    };
  });
}

/** ISO8601 문자열에서 시계 부분 HH:MM만 뽑는다(시간대 변환 없이 문자열 그대로). */
export function formatHM(at) {
  const m = /T(\d{2}):(\d{2})/.exec(String(at ?? ""));
  return m ? m[1] + ":" + m[2] : "--:--";
}

/** 최신순(id 큰 것 먼저, 같으면 at 큰 것 먼저) 이벤트 행. */
export function buildEventRows(events, agents = [], limit = 30) {
  return [...(events ?? [])]
    .sort((a, b) => (b.id - a.id) || String(b.at).localeCompare(String(a.at)))
    .slice(0, limit)
    .map((e) => {
      const from = agentName(agents, e.from);
      const to = agentName(agents, e.to);
      return { id: e.id, time: formatHM(e.at), from, to, route: from + "→" + to, title: e.title, summary: e.summary, kind: e.kind };
    });
}

// ---- 작업 지시(commands): DATA.md 9장 ----
export const COMMAND_MAX = 300;
export const COMMAND_TO = [
  { id: "chief", label: "총괄" },
  { id: "claude", label: "Claude" },
  { id: "gpt", label: "GPT" },
];
export const COMMAND_KIND = [
  { id: "solo", label: "개인" },
  { id: "team", label: "공동" },
];
export const TEAM_TO = "team";
export const TEAM_LABEL = "모두에게";
export const STATE_LABEL = { pending: "대기", delivered: "전달됨", done: "처리됨" };
export const NOTICE_DELAY = "실시간이 아니라 전달에 몇 분 걸릴 수 있어요";
export const NOTICE_SECRET = "토큰·키는 입력하지 마세요";
export const NOTICE_APPROVAL = "삭제·배포·결제는 사용자 확인 후에만 실행돼요";

const ERROR_TEXT = {
  INVALID_KIND: "개인 지시인지 공동 지시인지 다시 골라 주세요.",
  INVALID_TO: "받는 사람을 다시 골라 주세요. 개인은 총괄, Claude, GPT 중 한 명이고, 공동은 모두에게 가요.",
  EMPTY_TEXT: "내용을 입력해 주세요.",
  TEXT_TOO_LONG: "내용이 " + COMMAND_MAX + "자를 넘었어요. 줄여 주세요.",
  SECRET_LIKE: "키·토큰·이메일처럼 보이는 내용은 보낼 수 없어요. 지우고 다시 보내 주세요.",
  TOO_MANY: "너무 자주 보냈어요. 잠시 후 다시 해 주세요.",
  UNAUTHENTICATED: "로그인이 필요해요. 다시 로그인해 주세요.",
  BAD_PASSWORD: "암호가 맞지 않아요.",
};
export const ERROR_FALLBACK = "처리하지 못했어요. 잠시 후 다시 해 주세요.";
export const ERROR_NETWORK = "서버에 연결하지 못했어요. 잠시 후 다시 해 주세요.";

/** 오류 code → 한국어 안내. retryAfterSec가 있으면 TOO_MANY 문구에 초를 넣는다. */
export function errorMessage(code, retryAfterSec) {
  const base = Object.prototype.hasOwnProperty.call(ERROR_TEXT, code) ? ERROR_TEXT[code] : ERROR_FALLBACK;
  if (code === "TOO_MANY" && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return base.replace("잠시 후", Math.ceil(retryAfterSec) + "초 뒤에");
  }
  return base;
}

/** 상태 칩 라벨. 모르는 값은 그대로 보여 준다. */
export function stateLabel(state) {
  return Object.prototype.hasOwnProperty.call(STATE_LABEL, state) ? STATE_LABEL[state] : String(state ?? "");
}

/** 글자수. 서버 한도(300자)를 넘기지 않도록 UTF-16 길이로 센다. */
export function countChars(text) {
  return String(text ?? "").length;
}

export function remainingChars(text) {
  return COMMAND_MAX - countChars(text);
}

/** 보내기 전 검사. SECRET_LIKE는 서버가 판단한다. @returns {{ok: boolean, code?: string}} */
export function validateCommand(to, text, kind = "solo", status = null) {
  if (!COMMAND_KIND.some((k) => k.id === kind)) return { ok: false, code: "INVALID_KIND" };
  const known = status && hasTeamTabs(status);
  if (kind === "team") {
    const okTeam = to === TEAM_TO || (known && typeof to === "string" && to.startsWith("team:") && teamsOf(status).some((t) => t.id === to.slice(5)));
    if (!okTeam) return { ok: false, code: "INVALID_TO" };
  } else if (!(known ? (status.agents ?? []).some((a) => a.id === to) : COMMAND_TO.some((t) => t.id === to))) return { ok: false, code: "INVALID_TO" };
  if (String(text ?? "").trim() === "") return { ok: false, code: "EMPTY_TEXT" };
  if (countChars(text) > COMMAND_MAX) return { ok: false, code: "TEXT_TOO_LONG" };
  return { ok: true };
}

/** 지시 종류. kind가 없는 옛 기록과 모르는 값은 개인(solo)으로 읽는다. */
export function kindOf(c) {
  return c && c.kind === "team" ? "team" : "solo";
}

export function toLabel(to) {
  if (to === TEAM_TO) return TEAM_LABEL;
  return COMMAND_TO.find((t) => t.id === to)?.label ?? String(to ?? "");
}

/** KST ISO8601 → "MM-DD HH:MM"(문자열 그대로). */
export function formatCommandTime(at) {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at ?? ""));
  return m ? `${m[1]}-${m[2]} ${m[3]}:${m[4]}` : "--";
}

/** 목록 행 view-model. 최신순(id 큰 것 먼저), 최대 50개. 텍스트는 가공하지 않는다. */
export function buildCommandRows(commands, limit = 50, status = null) {
  return [...(Array.isArray(commands) ? commands : [])]
    .filter((c) => c && typeof c === "object")
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      to: targetLabel(c.to, status),
      kind: kindOf(c),
      kindLabel: kindOf(c) === "team" ? "공동" : "개인",
      target: (kindOf(c) === "team" ? "공동 · " : "개인 · ") + targetLabel(c.to, status),
      time: formatCommandTime(c.at),
      deliveredTime: c.deliveredAt ? formatCommandTime(c.deliveredAt) : "",
      doneTime: c.doneAt ? formatCommandTime(c.doneAt) : "",
      text: String(c.text ?? ""),
      state: String(c.state ?? "").replace(/[^a-z]/g, ""),
      stateLabel: stateLabel(c.state),
      needsApproval: c.needsApproval === true,
      note: typeof c.note === "string" ? c.note : "",
    }));
}

// ---- 내 데이터 불러오기: 파일 내용 분류·검사(DOM 없음) ----
export const LOCAL_MAX_BYTES = 5 * 1024 * 1024;
export const LOCAL_MAX_ERRORS = 8;
export const LOCAL_NEED_BOTH = "두 파일(status.json, board.json)을 함께 골라 주세요";
export const LOCAL_BADGE = "내 데이터를 보고 있어요(이 브라우저 안에서만 사용, 새로고침하면 샘플로 돌아가요)";

/** 파일 크기 검사. @returns {{ok: boolean, reason?: string}} */
export function checkLocalSize(name, size) {
  if (!Number.isFinite(size) || size < 0) return { ok: false, reason: `${name}: 파일 크기를 알 수 없어요` };
  if (size > LOCAL_MAX_BYTES) return { ok: false, reason: `${name}: 5MB를 넘어서 불러올 수 없어요` };
  return { ok: true };
}

/** 텍스트 → JSON. @returns {{ok: true, value: any} | {ok: false, reason: string}} */
export function parseLocalJson(name, text) {
  try {
    return { ok: true, value: JSON.parse(String(text ?? "").replace(/^﻿/, "")) };
  } catch {
    return { ok: false, reason: `${name}: JSON 형식이 아니에요` };
  }
}

/** 최상위 agents 배열이면 "status", mvp 배열이면 "board", 둘 다이거나 아무것도 아니면 null. */
export function classifyLocalData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = Array.isArray(value.agents);
  const b = Array.isArray(value.mvp);
  if (s === b) return null;
  return s ? "status" : "board";
}

/**
 * 읽은 파일들 [{name, size, text}] → status/board 짝.
 * @returns {{ok: true, status: object, board: object} | {ok: false, reasons: string[]}}
 */
export function pickLocalFiles(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return { ok: false, reasons: [LOCAL_NEED_BOTH] };
  if (list.length > 2) return { ok: false, reasons: ["파일은 두 개까지만 고를 수 있어요. " + LOCAL_NEED_BOTH] };
  const reasons = [];
  const found = {};
  for (const f of list) {
    const name = String(f?.name ?? "(이름 없음)");
    const sz = checkLocalSize(name, f?.size);
    if (!sz.ok) { reasons.push(sz.reason); continue; }
    const p = parseLocalJson(name, f.text);
    if (!p.ok) { reasons.push(p.reason); continue; }
    const kind = classifyLocalData(p.value);
    if (!kind) { reasons.push(`${name}: status(agents 목록)인지 board(mvp 목록)인지 알 수 없어요`); continue; }
    if (found[kind]) { reasons.push(`${name}: ${kind} 형식 파일이 두 개예요`); continue; }
    found[kind] = p.value;
  }
  if (reasons.length) return { ok: false, reasons };
  if (!found.status || !found.board) return { ok: false, reasons: [LOCAL_NEED_BOTH] };
  return { ok: true, status: found.status, board: found.board };
}

/** 검증 오류 목록 → 화면에 보일 줄(최대 8줄, 넘치면 마지막 줄에 나머지 개수). */
export function localErrorLines(errors, max = LOCAL_MAX_ERRORS) {
  const list = (Array.isArray(errors) ? errors : []).map((e) => String(e));
  if (list.length <= max) return list;
  return [...list.slice(0, max - 1), `...외 ${list.length - max + 1}건`];
}

// ---- 팀 탭·보드 팀 묶음·지시 대상 (DESIGN4.md) ----
const DOT_LABEL = { blocked: "막힘", working: "일하는 중", idle: "대기" };

/** 탭 목록. 팀이 2개 미만이면 빈 배열(탭을 그리지 않는다). */
export function buildTeamTabs(status, selectedId) {
  if (!hasTeamTabs(status)) return [];
  const sel = pickTeam(status, selectedId);
  return teamsOf(status).map((t) => ({ id: t.id, name: t.name, count: t.count, dot: t.dot, dotLabel: DOT_LABEL[t.dot], selected: t.id === sel }));
}

/** 보드의 에이전트 묶음. 팀 2개 미만이면 머리글 없는 묶음 하나(지금 화면). 머리글: "이름 · N명 · 일하는 중 a / 막힘 b". */
export function buildAgentGroups(status, selectedId) {
  const cards = new Map(buildAgentCards(status).map((c) => [c.id, c]));
  const grouped = hasTeamTabs(status);
  const sel = pickTeam(status, selectedId);
  return teamsOf(status).map((t) => ({
    id: t.id,
    name: t.name,
    header: grouped ? `${t.name} · ${t.count}명 · 일하는 중 ${t.working} / 막힘 ${t.blocked}` : "",
    dot: t.dot,
    open: !grouped || t.id === sel,
    cards: t.agentIds.map((id) => cards.get(id)).filter(Boolean),
  }));
}

/** 이벤트 줄에서 다른 팀과 오간 경우 이름 앞에 팀 이름을 붙인다. 팀이 2개 미만이면 그대로. */
export function teamLabelForRoute(status, fromId, toId) {
  if (!hasTeamTabs(status)) return null;
  const ts = teamsOf(status);
  const f = ts.find((t) => t.agentIds.includes(fromId)), t = ts.find((x) => x.agentIds.includes(toId));
  if (!f || !t || f.id === t.id) return null;
  return { from: f.name, to: t.name };
}

export const TEAM_PREFIX = "team:";

/** 지시 대상 묶음. 맨 위 "전체"(공동 team), 팀 2개 이상이면 팀별 "[팀] 전체"(공동 team:<id>)와 그 팀 에이전트(개인). */
export function buildCommandTargets(status) {
  const grouped = hasTeamTabs(status);
  const out = [{ label: "전체", options: [{ kind: "team", to: "team", label: TEAM_LABEL }] }];
  if (!grouped) { out[0].options.push(...COMMAND_TO.map((t) => ({ kind: "solo", to: t.id, label: t.label }))); return out; }
  const names = new Map((status.agents ?? []).map((a) => [a.id, a.name]));
  for (const t of teamsOf(status)) {
    out.push({ label: t.name, options: [
      ...(TEAM_ID_RE.test(t.id) ? [{ kind: "team", to: TEAM_PREFIX + t.id, label: `${t.name} 전체` }] : []),
      ...t.agentIds.map((id) => ({ kind: "solo", to: id, label: names.get(id) || id })),
    ] });
  }
  return out;
}

/** 지시 대상 표시 이름. team:<id>는 팀 이름(모르면 id)으로. */
export function targetLabel(to, status) {
  if (typeof to === "string" && to.startsWith(TEAM_PREFIX)) {
    const id = to.slice(TEAM_PREFIX.length);
    return (teamsOf(status).find((t) => t.id === id)?.name ?? id) + " 전체";
  }
  if (to === TEAM_TO) return TEAM_LABEL;
  return (status?.agents ?? []).find((a) => a.id === to)?.name ?? toLabel(to);
}

// ---- 방 이름표·요약 카드 (DESIGN5-panels.md §3~§4) ----
/** 방 카드 목록. 팀이 2개 미만이면 빈 배열(층 전체 화면 없음). 이름표와 폰 요약 카드가 같은 데이터를 쓴다. */
export function buildRoomCards(status) {
  if (!hasTeamTabs(status)) return [];
  return teamsOf(status).map((t) => {
    const dotLabel = DOT_LABEL[t.dot];
    const parts = [];
    if (t.working > 0) parts.push(`일 ${t.working}`);
    if (t.blocked > 0) parts.push(`막힘 ${t.blocked}`);
    return {
      id: t.id, name: t.name, count: t.count, working: t.working, blocked: t.blocked,
      dot: t.dot, dotLabel, empty: t.count === 0,
      ariaLabel: t.count === 0 ? `${t.name}, 빈 방. 누르면 확대` : `${t.name}, ${t.count}명, ${dotLabel}. 누르면 확대`,
      summary: parts.join(" · "),
    };
  });
}
