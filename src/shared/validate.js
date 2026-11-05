// status.json / board.json 검증 규칙 (DATA.md 2·3장). 화면과 update.js가 같은 코드를 쓴다.
export const AGENT_IDS = ["chief", "claude", "gpt"]; // 처음부터 있던 세 명(색이 고정이다). 새 에이전트는 AGENT_ID_RE만 맞으면 된다.
export const AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/;
export const TEAM_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/;
export const RESERVED_IDS = ["board", "team", "all"]; // 이벤트 끝점·지시 대상으로 이미 쓰는 말
export const MAX_TEAMS = 8, MAX_PER_TEAM = 8, MAX_AGENTS = 24;
export const DEFAULT_TEAM = "main";
export const MAX_TEAM_NAME = 20;
export const isTeamId = (v) => typeof v === "string" && TEAM_ID_RE.test(v) && !RESERVED_IDS.includes(v);
export const isAgentId = (v) => typeof v === "string" && AGENT_ID_RE.test(v) && !RESERVED_IDS.includes(v);
const AGENT_STATUS = ["working", "idle", "blocked"];
const TASK_STATE = ["todo", "doing", "done", "blocked"];
const EVENT_KIND = ["doc", "ask", "reply", "report"];
const MVP_STATUS = ["in", "out", "pending"];
const KST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+09:00|Z)$/;
export const MAX_EVENTS = 30;
const MAX_TEXT = 80;
const STATUS_KEYS = ["meta", "agents", "tasks", "events"];
const OPTIONAL_STATUS_KEYS = ["teams"];

const isStr = (v) => typeof v === "string";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const tooLong = (v) => [...v].length > MAX_TEXT;

/** @returns {string[]} 오류 목록. 비어 있으면 통과 */
export function validateStatus(s) {
  const e = [];
  if (!isObj(s)) return ["최상위가 객체가 아니다"];
  for (const k of STATUS_KEYS) if (!(k in s)) e.push(`최상위 키 없음: ${k}`);
  for (const k of Object.keys(s)) if (!STATUS_KEYS.includes(k) && !OPTIONAL_STATUS_KEYS.includes(k)) e.push(`허용되지 않은 최상위 키: ${k}`);
  if (e.length) return e;
  const len = (label, v) => { if (!isStr(v)) e.push(`${label}: 문자열이 아니다`); else if (tooLong(v)) e.push(`${label}: ${MAX_TEXT}자 초과`); };

  if (!isObj(s.meta) || !isStr(s.meta.project) || !KST_ISO.test(s.meta.updatedAt ?? "") || !Number.isInteger(s.meta.schemaVersion)) e.push("meta 형식 오류");

  const teamIds = new Set();
  if ("teams" in s) {
    if (!Array.isArray(s.teams)) e.push("teams가 배열이 아니다");
    else {
      if (s.teams.length > MAX_TEAMS) e.push(`팀은 최대 ${MAX_TEAMS}개`);
      s.teams.forEach((t, i) => {
        const p = `teams[${i}]`;
        if (!isObj(t)) return e.push(`${p}: 객체가 아니다`);
        for (const k of Object.keys(t)) if (!["id", "name", "order"].includes(k)) e.push(`${p}: 허용되지 않은 키 ${k}`);
        if (!isTeamId(t.id)) e.push(`${p}.id 형식 오류(영문 소문자로 시작, 소문자·숫자·_·- 24자 이하, board·team·all 불가)`); else if (teamIds.has(t.id)) e.push(`${p}.id 중복`); else teamIds.add(t.id);
        if (!isStr(t.name) || !t.name.trim() || [...t.name].length > MAX_TEAM_NAME) e.push(`${p}.name은 1~${MAX_TEAM_NAME}자 문자열`);
        if ("order" in t && !Number.isInteger(t.order)) e.push(`${p}.order는 정수`);
      });
    }
  }

  const agentIds = new Set();
  if (!Array.isArray(s.agents)) e.push("agents가 배열이 아니다");
  else s.agents.forEach((a, i) => {
    const p = `agents[${i}]`;
    if (!isObj(a)) return e.push(`${p}: 객체가 아니다`);
    if (!isAgentId(a.id)) e.push(`${p}.id 허용값 아님(영문 소문자로 시작, 소문자·숫자·_·- 24자 이하, board·team·all 불가)`); else if (agentIds.has(a.id)) e.push(`${p}.id 중복`); else agentIds.add(a.id);
    if ("teamId" in a) {
      if (!isStr(a.teamId)) e.push(`${p}.teamId 형식 오류`);
      else if (!("teams" in s)) e.push(`${p}.teamId가 있으면 최상위 teams도 있어야 한다`);
      else if (!teamIds.has(a.teamId)) e.push(`${p}.teamId 없는 팀: ${a.teamId}`);
    }
    if (!isStr(a.name) || !isStr(a.role)) e.push(`${p}: name/role 필요`);
    if (!AGENT_STATUS.includes(a.status)) e.push(`${p}.status 허용값 아님`);
    if (a.currentTaskId !== null && !isStr(a.currentTaskId)) e.push(`${p}.currentTaskId 형식 오류`);
    len(`${p}.note`, a.note);
    if ("model" in a && !isStr(a.model)) e.push(`${p}.model 형식 오류`);
  });

  if (Array.isArray(s.agents)) {
    if (s.agents.length > MAX_AGENTS) e.push(`에이전트는 최대 ${MAX_AGENTS}명`);
    const per = new Map();
    for (const a of s.agents) if (isObj(a)) { const t = isStr(a.teamId) ? a.teamId : DEFAULT_TEAM; per.set(t, (per.get(t) ?? 0) + 1); }
    for (const [t, n] of per) if (n > MAX_PER_TEAM) e.push(`팀 ${t}의 에이전트는 최대 ${MAX_PER_TEAM}명(지금 ${n}명)`);
  }

  const taskIds = new Set();
  if (!Array.isArray(s.tasks)) e.push("tasks가 배열이 아니다");
  else s.tasks.forEach((t, i) => {
    const p = `tasks[${i}]`;
    if (!isObj(t)) return e.push(`${p}: 객체가 아니다`);
    if (!isStr(t.id) || !t.id) e.push(`${p}.id 필요`); else if (taskIds.has(t.id)) e.push(`${p}.id 중복`); else taskIds.add(t.id);
    len(`${p}.title`, t.title);
    if (!agentIds.has(t.ownerAgentId)) e.push(`${p}.ownerAgentId 없음: ${t.ownerAgentId}`);
    if (!isStr(t.zone) || !t.zone) e.push(`${p}.zone 필요`);
    if (!Number.isInteger(t.progress) || t.progress < 0 || t.progress > 100) e.push(`${p}.progress는 0~100 정수`);
    if (!TASK_STATE.includes(t.state)) e.push(`${p}.state 허용값 아님`);
    if (t.state === "done" && t.progress !== 100) e.push(`${p}: done이면 progress 100`);
    if (!KST_ISO.test(t.updatedAt ?? "")) e.push(`${p}.updatedAt 형식 오류`);
  });
  if (Array.isArray(s.agents)) s.agents.forEach((a, i) => { if (a?.currentTaskId != null && !taskIds.has(a.currentTaskId)) e.push(`agents[${i}].currentTaskId 없음`); });

  if (!Array.isArray(s.events)) e.push("events가 배열이 아니다");
  else {
    if (s.events.length > MAX_EVENTS) e.push(`events는 최대 ${MAX_EVENTS}개`);
    const endpoints = new Set([...agentIds, "board"]);
    let last = -Infinity;
    s.events.forEach((ev, i) => {
      const p = `events[${i}]`;
      if (!isObj(ev)) return e.push(`${p}: 객체가 아니다`);
      if (!Number.isInteger(ev.id)) e.push(`${p}.id 정수 필요`); else { if (ev.id <= last) e.push(`${p}.id 단조 증가 위반`); last = ev.id; }
      if (!KST_ISO.test(ev.at ?? "")) e.push(`${p}.at 형식 오류`);
      if (!endpoints.has(ev.from) || !endpoints.has(ev.to)) e.push(`${p}.from/to 없음`);
      len(`${p}.title`, ev.title); len(`${p}.summary`, ev.summary);
      if (ev.taskId !== null && !taskIds.has(ev.taskId)) e.push(`${p}.taskId 없음`);
      if (!EVENT_KIND.includes(ev.kind)) e.push(`${p}.kind 허용값 아님`);
    });
  }
  return e;
}

/** board.json 검증 (DATA.md 3장). */
export function validateBoard(b) {
  const e = [];
  if (!isObj(b)) return ["board 최상위가 객체가 아니다"];
  if (!Array.isArray(b.mvp)) e.push("mvp는 배열이어야 한다");
  if (!Array.isArray(b.zones)) e.push("zones는 배열이어야 한다");
  if (e.length) return e;
  const mvpIds = new Set(), zoneIds = new Set();
  b.mvp.forEach((m, i) => {
    if (!isObj(m) || !isStr(m.id) || !m.id) return e.push(`mvp[${i}] 형식 오류`);
    if (mvpIds.has(m.id)) e.push(`mvp[${i}].id 중복`); mvpIds.add(m.id);
    if (!isStr(m.title) || tooLong(m.title)) e.push(`mvp[${i}].title 오류`);
    if (!MVP_STATUS.includes(m.status)) e.push(`mvp[${i}].status 허용값 아님`);
  });
  b.zones.forEach((z, i) => {
    if (!isObj(z) || !isStr(z.id) || !z.id || !isStr(z.name)) return e.push(`zones[${i}] 형식 오류`);
    if (zoneIds.has(z.id)) e.push(`zones[${i}].id 중복`); zoneIds.add(z.id);
    if (!isAgentId(z.ownerAgentId)) e.push(`zones[${i}].ownerAgentId 허용값 아님`);
    if ("teamId" in z && !isTeamId(z.teamId)) e.push(`zones[${i}].teamId 형식 오류`);
    if (!Array.isArray(z.taskIds) || z.taskIds.some((t) => !isStr(t))) e.push(`zones[${i}].taskIds 형식 오류`);
  });
  return e;
}

/** 거부하지 않고 경고만 한다: zones.taskIds와 tasks.zone이 서로 맞는지. */
export function crossCheck(status, board) {
  const w = [];
  const zoneOf = new Map();
  for (const z of board.zones) for (const id of z.taskIds) zoneOf.set(id, z.id);
  const zoneIds = new Set(board.zones.map((z) => z.id));
  const taskIds = new Set(status.tasks.map((t) => t.id));
  for (const t of status.tasks) {
    if (!zoneIds.has(t.zone)) w.push(`작업 ${t.id}: board.json에 없는 구역 ${t.zone}`);
    else if (zoneOf.get(t.id) !== t.zone) w.push(`작업 ${t.id}: zone(${t.zone})과 board.json 구역 목록(${zoneOf.get(t.id) ?? "없음"})이 다르다`);
  }
  for (const id of zoneOf.keys()) if (!taskIds.has(id)) w.push(`board.json 구역에 있는 ${id}가 status.json 작업에 없다`);
  return w;
}
