// 팀 묶기(DESIGN4.md §3~§5). DOM 없음. status.teams와 agents[].teamId는 모두 선택이다.
export const DEFAULT_TEAM_ID = "main";
export const DEFAULT_TEAM_NAME = "기본";
export const OTHER_TEAM_NAME = "기타";
export const TEAM_ID_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/**
 * @returns {{id, name, agentIds: string[], count, working, blocked, dot}[]}
 * - teams가 없으면 모든 에이전트가 팀 하나(main)다.
 * - teamId가 없거나 모르는 팀을 가리키면 main(없으면 "기타")으로 모은다.
 * - dot: blocked > working > idle.
 * - 에이전트가 한 명도 없는 팀 중 기본 팀 main만 목록에서 뺀다. 그 밖의 팀은 0명이어도 "빈 방"으로 남긴다(새 팀을 만든 사람이 바로 자기 방을 보게).
 */
export function teamsOf(status) {
  const agents = (Array.isArray(status?.agents) ? status.agents : []).filter((a) => a && typeof a === "object" && typeof a.id === "string");
  const declared = (Array.isArray(status?.teams) ? status.teams : []).filter((t) => t && typeof t === "object" && typeof t.id === "string");
  const list = declared
    .map((t, i) => ({ id: t.id, name: typeof t.name === "string" && t.name ? t.name : t.id, order: Number.isInteger(t.order) ? t.order : i, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((t) => ({ id: t.id, name: t.name, agentIds: [] }));
  const byId = new Map(list.map((t) => [t.id, t]));
  let orphan = null;
  if (!list.length) { orphan = { id: DEFAULT_TEAM_ID, name: DEFAULT_TEAM_NAME, agentIds: [] }; list.push(orphan); byId.set(orphan.id, orphan); }
  for (const a of agents) {
    let t = typeof a.teamId === "string" ? byId.get(a.teamId) : undefined;
    if (!t) t = byId.get(DEFAULT_TEAM_ID);
    if (!t) { orphan = { id: DEFAULT_TEAM_ID, name: OTHER_TEAM_NAME, agentIds: [] }; list.push(orphan); byId.set(orphan.id, orphan); t = orphan; }
    t.agentIds.push(a.id);
  }
  const st = new Map(agents.map((a) => [a.id, a.status]));
  return list.map((t) => {
    const working = t.agentIds.filter((id) => st.get(id) === "working").length;
    const blocked = t.agentIds.filter((id) => st.get(id) === "blocked").length;
    return { ...t, count: t.agentIds.length, working, blocked, dot: blocked ? "blocked" : working ? "working" : "idle" };
  }).filter((t) => t.agentIds.length > 0 || t.id !== DEFAULT_TEAM_ID); // 비어 있는 기본 팀(main)만 뺀다
}

/** 탭을 그릴지: 팀이 2개 이상일 때만(팀 1개·teams 없음은 지금 화면 그대로). */
export function hasTeamTabs(status) {
  return teamsOf(status).length >= 2;
}

export function teamOfAgent(status, agentId) {
  return teamsOf(status).find((t) => t.agentIds.includes(agentId))?.id ?? null;
}

/** 저장된 선택이 지금도 있는 팀이면 그대로, 아니면 첫 팀. */
export function pickTeam(status, wanted) {
  const ts = teamsOf(status);
  return ts.find((t) => t.id === wanted)?.id ?? ts[0]?.id ?? null;
}
