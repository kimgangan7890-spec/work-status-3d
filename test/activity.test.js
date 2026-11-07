import { it, expect, afterEach } from 'vitest';
import { createActivityService, pageCount, ciOf, withRatios } from '../src/server/activity.js';
import { createGithubClient } from '../src/server/github-client.js';
import { createGithubBudget, githubError } from '../src/server/github-budget.js';

const closes = []; afterEach(() => { for (const close of closes.splice(0)) close(); });
function setup(options = {}) {
  const contexts = new Map(), listeners = new Set(), calls = []; let time = 1794052800000, version = 1, fail = null;
  const auth = {
    context(sid) { const ctx = contexts.get(sid); if (!ctx) throw githubError('NOT_CONNECTED', 409); return ctx; },
    onDisconnect(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    revoke(sid) { const ctx = contexts.get(sid); ctx?.controller.abort(); contexts.delete(sid); for (const fn of listeners) fn(ctx.credentialId); },
  };
  function connect(sid) { const controller = new AbortController(); contexts.set(sid, { credentialId: `credential-${sid}`, token: `fixture-${sid}`, signal: controller.signal, controller, scopesOk: false }); }
  connect('a'); connect('b');
  const repo = { id: 35, full_name: 'sample/project', default_branch: 'main', private: true, open_issues_count: 9, size: 1 };
  const fetchImpl = async (url, opts) => {
    const u = new URL(url); calls.push({ url: u.pathname + u.search, headers: opts.headers });
    if (fail) throw fail;
    const etag = `"${u.pathname}-${version}"`;
    if (options.respond) { const custom = await options.respond(u, opts, etag); if (custom) return custom; }
    if (opts.headers['If-None-Match'] === etag) return new Response(null, { status: 304 });
    let body, link;
    if (u.pathname.endsWith('/issues')) body = [];
    else if (u.pathname === '/repositories/35') body = repo;
    else if (u.pathname.endsWith('/commits')) { body = [{ sha: 'sample' }]; link = '<https://api.github.com/repos/sample/project/commits?per_page=1&page=42>; rel="last"'; }
    else if (u.pathname.endsWith('/pulls')) { body = [{ number: 1 }]; link = '<https://api.github.com/repos/sample/project/pulls?per_page=1&page=3>; rel="last"'; }
    else if (u.pathname.endsWith('/actions/workflows')) body = { workflows: [{ id: 1, state: 'active' }, { id: 2, state: 'active' }, { id: 3, state: 'disabled_manually' }] };
    else if (u.pathname.endsWith('/workflows/2/runs')) body = { workflow_runs: [{ id: 9, workflow_id: 2, status: 'completed', conclusion: 'failure' }] };
    else if (u.pathname.endsWith('/actions/runs')) body = { workflow_runs: [{ id: 10, workflow_id: 1, status: 'completed', conclusion: 'success', created_at: '2026-11-01T00:00:00Z' }] };
    else throw new Error('Unexpected fixture path');
    return new Response(JSON.stringify(body), { headers: { etag, ...(link ? { link } : {}) } });
  };
  const client = createGithubClient({ budget: createGithubBudget({ limit: options.limit }), fetchImpl });
  const service = createActivityService({ auth, client, now: () => time, intervalMs: options.intervalMs || 60_000, manualProjects: options.manualProjects, loadAgentStatus: options.loadAgentStatus });
  closes.push(() => service.close());
  return { service, auth, contexts, calls, repo, now: () => time, advance() { time += 60_000; }, change() { version++; }, fail(e) { fail = e; } };
}
it('Link 마지막 페이지로 정확히 세고 PR을 이슈에서 제외하며 누락 워크플로 실패를 반영한다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 });
  const [m] = await s.service.sync('a');
  expect(m).toMatchObject({ projectId: 'gh-z', commits30d: 42, openPRs: 3, openIssues: 6, ci: 'failing', activityRatio: 1, sync: { status: 'ok' } });
  expect(s.calls.some(c => c.url.includes('/workflows/2/runs'))).toBe(true); expect(s.calls.some(c => c.url.includes('/workflows/3/runs'))).toBe(false);
  expect(s.contexts.get('a').scopesOk).toBe(true);
});
it('304는 본문·Link 집계를 유지하고 누락 조회 캐시는 목록 ETag 변경 때만 다시 확인한다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 }); await s.service.sync('a');
  const before = s.calls.length; const [m] = await s.service.sync('a');
  expect(m.openPRs).toBe(3); expect(m.ci).toBe('failing'); expect(s.calls.length - before).toBe(7);
  s.change(); await s.service.sync('a'); expect(s.calls.filter(c => c.url.includes('/workflows/2/runs'))).toHaveLength(2);
});
it('30일 창이 이동하면 이전 URL의 ETag를 재사용하지 않는다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 }); await s.service.sync('a'); s.advance(); await s.service.sync('a');
  const commits = s.calls.filter(c => c.url.includes('/commits?')); expect(commits).toHaveLength(2);
  expect(commits[0].url).not.toBe(commits[1].url); expect(commits[1].headers['If-None-Match']).toBeUndefined();
});
it('예산이 모자라면 불완전한 스냅샷 대신 stale로 표시한다', async () => {
  const s = setup({ limit: 4 }); await s.service.select('a', { repoId: 35 }); const [m] = await s.service.sync('a');
  expect(m).toMatchObject({ commits30d: 0, sync: { status: 'stale', error: 'budget' } }); expect(m.sync.lastSuccessfulSyncAt).toBeUndefined();
});
it('성공 뒤 네트워크 실패 시 마지막 집계와 성공 시각을 보존한다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 }); const [previous] = await s.service.sync('a'); s.advance(); s.fail(new Error('network'));
  const [m] = await s.service.sync('a'); expect(m.commits30d).toBe(previous.commits30d); expect(m.sync).toEqual({ ...previous.sync, status: 'stale', error: 'network' });
});
it('같은 저장소도 인증 ID가 다르면 캐시와 동시 요청을 합치지 않는다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 }); expect(s.service.projects('b')).toEqual([]);
  await s.service.select('b', { repoId: 35 }); await Promise.all([s.service.sync('a'), s.service.sync('b')]);
  const commits = s.calls.filter(c => c.url.includes('/commits?')); expect(commits).toHaveLength(2);
  expect(new Set(commits.map(c => c.headers.Authorization)).size).toBe(2);
  s.auth.revoke('a'); expect(() => s.service.metrics('a')).toThrow('NOT_CONNECTED'); expect(s.service.metrics('b')[0].sync.status).toBe('ok');
});
it('같은 인증 ID의 동시 동기화는 리소스 요청 하나로 합친다', async () => {
  const s = setup(); await s.service.select('a', { repoId: 35 }); await Promise.all([s.service.sync('a'), s.service.sync('a')]); expect(s.calls.filter(c => c.url.includes('/commits?'))).toHaveLength(1);
});
it('연결 해제하면 주기 조회가 멈추고 재연결에 선택·지표가 남지 않는다', async () => {
  const s = setup({ intervalMs: 15 }); await s.service.select('a', { repoId: 35 }); await s.service.sync('a');
  s.auth.revoke('a'); const count = s.calls.length; await new Promise(resolve => setTimeout(resolve, 50)); expect(s.calls.length).toBe(count);
  const controller = new AbortController(); s.contexts.set('a', { credentialId: 'new-a', token: 'fixture-new', signal: controller.signal, controller }); expect(s.service.metrics('a')).toEqual([]); expect(s.service.projects('a')).toEqual([]);
});
it('기존 수동 ID를 유지하고 중복 저장소와 자동 ID 충돌을 거절한다', async () => {
  const s = setup({ manualProjects: () => [{ id: 'manual' }, { id: 'gh-z' }] });
  await expect(s.service.select('a', { repoId: 35 })).rejects.toMatchObject({ code: 'DUPLICATE_PROJECT' });
  expect((await s.service.select('a', { repoId: 35, projectId: 'manual' })).projectId).toBe('manual');
  await expect(s.service.select('a', { repoId: 35, projectId: 'manual' })).rejects.toMatchObject({ code: 'DUPLICATE_REPO' });
});
it('커밋이 모두 0일 때 ratio는 0이고 로그 비율을 사용한다', () => {
  expect(withRatios([{ commits30d: 0 }, { commits30d: 0 }]).map(x => x.activityRatio)).toEqual([0, 0]);
  expect(withRatios([{ commits30d: 9 }, { commits30d: 99 }]).map(x => x.activityRatio)).toEqual([0.5, 1]);
});
it('집계 페이지 누락을 1개로 오인하지 않고 빈 본문과 1개 본문을 구분한다', () => {
  expect(pageCount([], null, '/x')).toBe(0); expect(pageCount([{}], null, '/x')).toBe(1);
  expect(() => pageCount([{}], '<https://api.github.com/x?page=2>; rel="next"', '/x')).toThrow('NETWORK');
});
it('실제 GitHub 형식인 숫자 저장소 ID의 Link를 집계하되 다른 저장소의 Link는 거절한다', () => {
  const link = '<https://api.github.com/repositories/1296269/pulls?state=open&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1296269/pulls?state=open&per_page=1&page=1374>; rel="last"';
  expect(pageCount([{}], link, '/repos/octocat/Hello-World/pulls', 1296269)).toBe(1374);
  expect(() => pageCount([{}], link, '/repos/octocat/Hello-World/pulls', 35)).toThrow('NETWORK');
});
it('CI 대표값은 실패를 우선하며 취소·알 수 없는 상태를 성공으로 만들지 않는다', () => {
  expect(ciOf([])).toBe('none'); expect(ciOf([{ status: 'completed', conclusion: 'cancelled' }])).toBe('unknown');
  expect(ciOf([{ status: 'in_progress' }, { status: 'completed', conclusion: 'failure' }])).toBe('failing');
});
it('누락 워크플로 확인의 예산 부족은 마지막 CI와 성공 시각을 유지하며 stale로 표시한다', async () => {
  let denied = false;
  const s = setup({ respond: async u => { if (denied && u.pathname.endsWith('/workflows/2/runs')) throw githubError('BUDGET', 429); } });
  await s.service.select('a', { repoId: 35 }); const [previous] = await s.service.sync('a');
  denied = true; s.change(); s.advance(); const [m] = await s.service.sync('a');
  expect(m.ci).toBe('failing'); expect(m.sync).toEqual({ ...previous.sync, status: 'stale', error: 'budget' });
});
it('워크플로 목록의 다음 페이지도 확인하며 비활성 워크플로는 제외한다', async () => {
  const s = setup({ respond: async (u, _opts, etag) => {
    if (!u.pathname.endsWith('/actions/workflows')) return;
    const page2 = u.searchParams.get('page') === '2';
    return new Response(JSON.stringify({ workflows: page2 ? [{ id: 2, state: 'active' }, { id: 3, state: 'disabled_manually' }] : [{ id: 1, state: 'active' }] }), { headers: { etag: etag + u.search, ...(page2 ? {} : { link: '<https://api.github.com/repos/sample/project/actions/workflows?per_page=100&page=2>; rel="next"' }) } });
  } });
  await s.service.select('a', { repoId: 35 }); expect((await s.service.sync('a'))[0].ci).toBe('failing');
  expect(s.calls.some(c => c.url.includes('page=2'))).toBe(true);
});
it('성공 스냅샷의 GitHub 이벤트만 발행하고 세션 간 이력과 해제 후 이력을 분리한다', async () => {
  let changed = false;
  const s = setup({ respond: async u => {
    if (u.pathname.endsWith('/commits')) return new Response(JSON.stringify([{ sha: (changed ? 'b' : 'a').repeat(40) }]));
    if (u.pathname.endsWith('/issues')) return new Response(JSON.stringify(changed ? [{ number: 55, state: 'open', created_at: new Date(s.now()).toISOString(), updated_at: new Date(s.now()).toISOString() }, { number: 56, state: 'open', pull_request: {}, created_at: new Date(s.now()).toISOString() }] : []));
  } });
  await s.service.select('a', { repoId: 35 }); await s.service.select('b', { repoId: 35 }); await s.service.sync('a'); await s.service.sync('b');
  expect(s.service.events('a')).toEqual([]); changed = true; s.advance(); await s.service.sync('a');
  expect(s.service.events('a').map(e => e.kind)).toEqual(['commit', 'issue_opened']); expect(s.service.events('b')).toEqual([]);
  await s.service.sync('a'); expect(s.service.events('a')).toHaveLength(2);
  expect(() => s.service.events('a', 'invalid')).toThrow('BAD_SINCE'); s.service.remove('a', 'gh-z'); expect(s.service.events('a')).toEqual([]);
  s.auth.revoke('a'); expect(() => s.service.events('a')).toThrow('NOT_CONNECTED');
});
it('이벤트 추가 조회의 예산 부족은 커서를 전진시키지 않아 복구 후 변경을 한 번 발행한다', async () => {
  let changed = false, blocked = false;
  const s = setup({ respond: async u => {
    if (u.pathname.endsWith('/commits')) return new Response(JSON.stringify([{ sha: (changed ? 'b' : 'a').repeat(40) }]));
    if (u.pathname.endsWith('/issues') && blocked) throw githubError('BUDGET', 429);
  } });
  await s.service.select('a', { repoId: 35 }); await s.service.sync('a'); changed = true; blocked = true; s.advance();
  expect((await s.service.sync('a'))[0].sync).toMatchObject({ status: 'stale', error: 'budget' }); expect(s.service.events('a')).toEqual([]);
  blocked = false; expect((await s.service.sync('a'))[0].sync.status).toBe('ok'); expect(s.service.events('a').map(e => e.kind)).toEqual(['commit']);
});
it('issues의 숫자 ID 페이지를 끝까지 읽고 PR 혼입을 제외하며 마지막 성공 시각으로 조회한다', async () => {
  let changed = false;
  const s = setup({ respond: async u => {
    if (!u.pathname.endsWith('/issues')) return;
    if (!changed) return new Response('[]');
    const created = new Date(s.now()).toISOString(), page2 = u.searchParams.get('page') === '2';
    const body = page2 ? [{ number: 2, state: 'open', created_at: created }] : [{ number: 1, state: 'open', created_at: created }, { number: 3, state: 'open', created_at: created, pull_request: {} }];
    return new Response(JSON.stringify(body), { headers: page2 ? {} : { link: '<https://api.github.com/repositories/35/issues?state=all&page=2&per_page=100>; rel="next"' } });
  } });
  await s.service.select('a', { repoId: 35 }); const [first] = await s.service.sync('a'); changed = true; s.advance(); await s.service.sync('a');
  expect(s.service.events('a').filter(e => e.kind === 'issue_opened').map(e => e.meta.number)).toEqual([1, 2]);
  const initialPage = s.calls.filter(c => c.url.includes('/issues?') && !c.url.includes('page=2')).at(-1);
  expect(Date.parse(new URL(initialPage.url, 'https://api.github.com').searchParams.get('since'))).toBe(Date.parse(first.sync.lastSuccessfulSyncAt) - 1000);
});
