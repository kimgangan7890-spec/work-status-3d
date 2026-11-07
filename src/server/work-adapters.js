import crypto from 'node:crypto';
import { validateStatus } from '../shared/validate.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function makeEvent(source, projectId, kind, identity, observedAt, meta = {}, agent) {
  return { eventId: digest([source, projectId, kind, identity]), source, projectId, kind, observedAt, ...(agent ? { agent } : {}), meta };
}

// 첫 스냅샷은 기준선이다. 원문 제목·본문·메시지·계정 토큰은 이벤트에 복사하지 않는다.
export function githubEvents({ projectId, previous, commits, issues, pulls, ci, observedAt }) {
  const events = [], states = new Map(previous?.states || []);
  const cutoff = previous ? Date.parse(previous.at) : Infinity;
  const emit = (kind, identity, meta) => events.push(makeEvent('github', projectId, kind, identity, observedAt, meta));
  const head = typeof commits?.[0]?.sha === 'string' && /^[a-f0-9]{40}$/i.test(commits[0].sha) ? commits[0].sha : null;
  if (previous && head && head !== previous.head) emit('commit', head, { sha: head });
  for (const [type, items] of [['issue', issues], ['pr', pulls]]) {
    for (const item of items) {
      if (type === 'issue' && Object.hasOwn(item, 'pull_request')) continue;
      if (!Number.isSafeInteger(item?.number) || !['open', 'closed'].includes(item.state)) continue;
      const key = `${type}:${item.number}`, oldRecord = states.get(key), old = oldRecord?.state;
      const merged = type === 'pr' && validTime(item.merged_at);
      const nextState = merged ? 'merged' : item.state;
      if (previous) {
        if ((old === undefined && validTime(item.created_at) && Date.parse(item.created_at) >= cutoff) || (old === 'closed' && item.state === 'open')) emit(`${type}_opened`, [item.number, item.created_at, old === 'closed' ? item.updated_at : 'created'], { number: item.number });
        const closedAt = merged ? item.merged_at : item.closed_at;
        if (item.state === 'closed' && (merged ? oldRecord?.mergedAt : oldRecord?.closedAt) !== closedAt && validTime(closedAt) && Date.parse(closedAt) >= cutoff) emit(merged ? 'pr_merged' : `${type}_closed`, [item.number, closedAt], { number: item.number });
      }
      states.delete(key); states.set(key, { state: nextState, closedAt: item.closed_at, mergedAt: item.merged_at });
    }
  }
  if (previous && previous.ci !== ci) emit('ci_changed', [observedAt, ci], { ci });
  while (states.size > 2000) states.delete(states.keys().next().value);
  return { events, state: { at: observedAt, head, ci, states } };
}

export function agentEvents({ projectId, previous, status, observedAt }) {
  if (!status || validateStatus(status).length) return { events: [], state: previous };
  const state = new Map(), events = [];
  const kinds = { working: 'agent_working', idle: 'agent_idle', blocked: 'agent_needs_approval' };
  for (const agent of status.agents) {
    state.set(agent.id, agent.status);
    if (previous && previous.get(agent.id) !== agent.status) {
      const model = ['grok', 'gpt', 'claude', 'sonnet'].includes(agent.id) ? agent.id : undefined;
      events.push(makeEvent('agent', projectId, kinds[agent.status], [agent.id, agent.status, observedAt], observedAt, { agentId: agent.id, ...(agent.status === 'blocked' ? { reason: 'blocked' } : {}) }, model));
    }
  }
  return { events, state };
}
