import { it, expect } from 'vitest';
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { createEventBus, createEventJournal } from '../src/server/events.js';
import { githubEvents, agentEvents, makeEvent } from '../src/server/work-adapters.js';
import { createAgentSource } from '../src/server/agent-source.js';
const t0 = '2026-11-07T10:00:00.000Z', t1 = '2026-11-07T10:01:00.000Z';
const sha = n => n.repeat(40);
const issue = (n, extra = {}) => ({ number: n, state: 'open', created_at: t1, updated_at: t1, ...extra });
const snapshot = extra => ({ projectId: 'sample', commits: [{ sha: sha('a') }], issues: [], pulls: [], ci: 'passing', observedAt: t0, ...extra });
it('처음은 기준선으로 삼고 커밋·CI·이슈·PR 변화를 구분하며 PR을 이슈에서 제외한다', () => {
  const first = githubEvents(snapshot()); expect(first.events).toEqual([]);
  const second = githubEvents(snapshot({ previous: first.state, observedAt: t1, commits: [{ sha: sha('b') }], ci: 'failing', issues: [issue(1), issue(2, { pull_request: {} })], pulls: [issue(2, { state: 'closed', merged_at: t1, closed_at: t1 })] }));
  expect(second.events.map(e => e.kind)).toEqual(['commit', 'issue_opened', 'pr_opened', 'pr_merged', 'ci_changed']);
  expect(second.events.filter(e => e.kind === 'issue_opened').map(e => e.meta.number)).toEqual([1]);
  const unchanged = githubEvents(snapshot({ previous: second.state, observedAt: t1, commits: [{ sha: sha('b') }], ci: 'failing', issues: [issue(1)], pulls: [issue(2, { state: 'closed', merged_at: t1, closed_at: t1 })] })); expect(unchanged.events).toEqual([]);
});
it('이슈 닫힘·다시 열림을 감지하고 댓글 수정은 열림 이벤트로 오인하지 않는다', () => {
  const first = githubEvents(snapshot({ issues: [issue(1, { created_at: t0 })] }));
  const comment = githubEvents(snapshot({ previous: first.state, observedAt: t1, issues: [issue(1, { created_at: t0 })] })); expect(comment.events).toEqual([]);
  const closed = githubEvents(snapshot({ previous: first.state, observedAt: t1, issues: [issue(1, { state: 'closed', closed_at: t1, created_at: t0 })] })); expect(closed.events[0].kind).toBe('issue_closed');
  const reopened = githubEvents(snapshot({ previous: closed.state, observedAt: t1, issues: [issue(1, { created_at: t0 })] })); expect(reopened.events[0].kind).toBe('issue_opened');
});
it('Bus는 복사해 전달하며 Journal은 eventId 중복 제거·200개 보관·since 필터를 맡는다', () => {
  const bus = createEventBus(), journal = createEventJournal(bus); let seen;
  bus.subscribe(event => { event.meta.changed = true; seen = event; });
  const event = makeEvent('github', 'sample', 'commit', '1', t0); bus.publish(event); bus.publish(event);
  expect(seen.meta.changed).toBe(true); expect(journal.list()).toHaveLength(1); expect(journal.list()[0].meta.changed).toBeUndefined();
  for (let i = 0; i < 205; i++) bus.publish(makeEvent('github', 'sample', 'commit', String(i + 2), t1));
  expect(journal.list()).toHaveLength(200); expect(journal.list(t1)).toHaveLength(200); expect(journal.list('2026-11-07T10:02:00Z')).toEqual([]);
  expect(() => journal.list('invalid')).toThrow('BAD_SINCE'); journal.removeProject('sample'); expect(journal.list()).toEqual([]); journal.close();
});
it('에이전트는 status.json의 상태 변화만 변환하고 메모·지시·작업 본문을 내보내지 않는다', async () => {
  const status = JSON.parse(await fs.readFile(new URL('../public-sample/status.json', import.meta.url), 'utf8'));
  const first = agentEvents({ projectId: 'sample', status, observedAt: t0 }); expect(first.events).toEqual([]);
  status.agents[0].status = 'blocked'; status.agents[0].note = 'private-note-not-an-event';
  const next = agentEvents({ projectId: 'sample', status, previous: first.state, observedAt: t1 }); expect(next.events).toHaveLength(1); expect(next.events[0].kind).toBe('agent_needs_approval');
  expect(JSON.stringify(next.events)).not.toContain('private-note'); expect(agentEvents({ projectId: 'sample', status: {}, previous: first.state, observedAt: t1 }).events).toEqual([]);
});
it('로컬 어댑터는 status.json만 읽고 지시함 내용과 무관하며 원격은 호출자의 전용 읽기를 쓴다', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'w3d-agent-'));
  try {
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ marker: 'status' })); await fs.writeFile(path.join(dir, 'inbox.json'), 'not-json-and-must-not-be-read');
    const load = createAgentSource({ dataDir: dir, projects: () => [{ id: 'local' }, { id: 'remote', repo: 'sample/project', branch: 'data', dir: 'dashboard' }] });
    expect(await load({ projectId: 'local' })).toEqual({ marker: 'status' });
    let resource; expect(await load({ projectId: 'remote' }, async url => { resource = url; return { marker: 'remote' }; })).toEqual({ marker: 'remote' });
    expect(resource).toBe('/repos/sample/project/contents/dashboard/status.json?ref=data'); expect(await load({ projectId: 'unknown' })).toBeNull();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
