import crypto from 'node:crypto';
import { githubError } from './github-budget.js';
import { repoRef } from './auth/service.js';
import { MAX_GH_PROJECTS, projectIdFromRepoId } from '../shared/ghcontract.js';
import { createEventBus, createEventJournal } from './events.js';
import { githubEvents, agentEvents } from './work-adapters.js';

const incomplete = () => githubError('NETWORK');
const countValue = x => Number.isSafeInteger(x) && x >= 0;
export function pageCount(body, link, expectedPath, repoId) {
  if (!Array.isArray(body) || body.length > 1) throw incomplete();
  const last = /<([^>]+)>;\s*rel="last"/.exec(link || '');
  if (!last) { if (/rel="next"/.test(link || '')) throw incomplete(); return body.length; }
  const url = new URL(last[1], 'https://api.github.com');
  const page = Number(url.searchParams.get('page'));
  // GitHub의 Link는 /repos/owner/name 대신 /repositories/<id> 정규 주소일 수 있다.
  const canonical = repoId ? `/repositories/${repoId}/${expectedPath.split('/').at(-1)}` : null;
  if (![expectedPath, canonical].includes(url.pathname) || url.searchParams.get('per_page') !== '1' || !Number.isSafeInteger(page) || page < 1 || !body.length) throw incomplete();
  return page;
}
export function ciOf(runs) {
  const states = runs.map(run => {
    if (!run) return 'none';
    if (run.status === 'in_progress') return 'running';
    if (['queued', 'waiting', 'pending', 'requested'].includes(run.status)) return 'pending';
    if (run.status !== 'completed') return 'unknown';
    if (['failure', 'timed_out', 'startup_failure'].includes(run.conclusion)) return 'failing';
    if (['success', 'neutral', 'skipped'].includes(run.conclusion)) return 'passing';
    if (run.conclusion === 'action_required') return 'pending';
    return 'unknown';
  });
  return ['failing', 'running', 'pending', 'unknown', 'passing', 'none'].find(s => states.includes(s)) || 'none';
}
/** @param {import('../../contracts/index.js').ProjectMetrics[]} metrics */
export function withRatios(metrics) {
  const max = Math.max(0, ...metrics.map(m => m.commits30d));
  return metrics.map(m => ({ ...structuredClone(m), activityRatio: max ? Math.log1p(m.commits30d) / Math.log1p(max) : 0 }));
}
const errorKind = e => ({ AUTH: 'auth', FORBIDDEN: 'auth', NOT_FOUND: 'not_found', RATE_LIMITED: 'rate_limited', BUDGET: 'budget' }[e.code] || 'network');

// 지표와 이벤트는 같은 성공 스냅샷에서 확정한다. 캐시·동시 요청·선택 목록은 인증 ID별로 소유한다.
export function createActivityService({ auth, client, manualProjects = () => [], now = Date.now, intervalMs = 60_000, loadAgentStatus = async () => null }) {
  const connections = new Map();
  function bucket(sid) {
    const ctx = auth.context(sid);
    let b = connections.get(ctx.credentialId);
    if (!b) { const bus = createEventBus(); b = { sid, ctx, projects: new Map(), bus, journal: createEventJournal(bus) }; connections.set(ctx.credentialId, b); }
    return b;
  }
  const unsubscribe = auth.onDisconnect(id => {
    const b = connections.get(id);
    if (b) { for (const entry of b.projects.values()) { entry.controller.abort(); entry.cache.clear(); entry.missing = null; } b.projects.clear(); b.journal.close(); connections.delete(id); }
  });
  async function resource(ctx, entry, slot, url, { emptyCommits = false, accept } = {}) {
    const hit = entry.cache.get(slot);
    const r = await client.request(ctx, url, { etag: hit?.url === url ? hit.etag : undefined, ...(accept ? { accept } : {}) });
    if (r.status === 304) {
      if (!hit || hit.url !== url) throw incomplete();
      return hit;
    }
    // GitHub는 커밋 없는 저장소에 409를 돌려준다. 저장소 정보로 빈 저장소임을 확인한 경우만 0으로 처리한다.
    let body;
    if (emptyCommits && r.status === 409) { await r.body?.cancel(); body = []; }
    else body = await client.json(r);
    const etag = r.headers.get('etag'), link = r.headers.get('link');
    const value = { url, etag, link, body, revision: crypto.createHash('sha256').update(JSON.stringify([etag, body, link])).digest('hex') };
    if (ctx.signal.aborted) throw githubError('ABORTED', 409);
    entry.cache.set(slot, value); return value;
  }
  async function workflows(ctx, entry, prefix) {
    let url = `${prefix}/actions/workflows?per_page=100`, page = 0;
    const all = [], revisions = [], seen = new Set();
    while (url) {
      if (++page > 20 || seen.has(url)) throw incomplete(); seen.add(url);
      const value = await resource(ctx, entry, `workflows:${page}`, url);
      if (!Array.isArray(value.body?.workflows)) throw incomplete();
      all.push(...value.body.workflows); revisions.push(value.revision);
      url = client.next(value.link, [`${prefix}/actions/workflows`, `/repositories/${entry.project.github.repoId}/actions/workflows`]);
    }
    for (const slot of entry.cache.keys()) if (slot.startsWith('workflows:') && Number(slot.split(':')[1]) > page) entry.cache.delete(slot);
    if (all.some(w => !Number.isSafeInteger(w.id) || typeof w.state !== 'string')) throw incomplete();
    return { active: [...new Set(all.filter(w => w.state === 'active').map(w => w.id))], revision: revisions.join(':') };
  }
  async function eventRows(ctx, entry, kind, url, firstOnly = false) {
    const rows = [], seen = new Set(); let page = 0;
    const cutoff = entry.githubState ? Date.parse(entry.githubState.at) - 1000 : null;
    const path = new URL(url, 'https://api.github.com').pathname;
    const canonical = `/repositories/${entry.project.github.repoId}/${kind === 'issues' ? 'issues' : 'pulls'}`;
    while (url) {
      if (++page > 20 || seen.has(url)) throw incomplete(); seen.add(url);
      const value = await resource(ctx, entry, `events:${kind}:${page}`, url);
      if (!Array.isArray(value.body)) throw incomplete(); rows.push(...value.body);
      // PR 목록에는 since가 없어 최신 수정순으로 보다가 이전 성공 시각을 지나면 멈춘다.
      if (firstOnly || (kind === 'pulls' && cutoff !== null && value.body.some(x => Number.isFinite(Date.parse(x.updated_at)) && Date.parse(x.updated_at) < cutoff))) break;
      url = client.next(value.link, [path, canonical]);
    }
    for (const slot of entry.cache.keys()) if (slot.startsWith(`events:${kind}:`) && Number(slot.split(':').at(-1)) > page) entry.cache.delete(slot);
    return rows;
  }
  async function snapshot(b, entry) {
    const ctx = { ...b.ctx, signal: AbortSignal.any([b.ctx.signal, entry.controller.signal]) };
    const info = await resource(ctx, entry, 'repo', `/repositories/${entry.project.github.repoId}`);
    const ref = repoRef(info.body);
    if (ref.repoId !== entry.project.github.repoId || !countValue(info.body.open_issues_count)) throw incomplete();
    const prefix = `/repos/${ref.fullName.split('/').map(encodeURIComponent).join('/')}`;
    const branch = encodeURIComponent(ref.defaultBranch);
    const since = new Date(now() - 30 * 86400_000).toISOString();
    // since가 바뀌면 URL도 달라지므로 이전 기간의 ETag를 붙이지 않는다.
    const commits = await resource(ctx, entry, 'commits', `${prefix}/commits?sha=${branch}&since=${encodeURIComponent(since)}&per_page=1`, { emptyCommits: info.body.size === 0 });
    const prs = await resource(ctx, entry, 'pulls', `${prefix}/pulls?state=open&per_page=1`);
    const recent = await resource(ctx, entry, 'runs', `${prefix}/actions/runs?branch=${branch}&per_page=20`);
    if (!Array.isArray(recent.body?.workflow_runs)) throw incomplete();
    const workflow = await workflows(ctx, entry, prefix);
    const revision = `${ref.defaultBranch}:${workflow.revision}:${recent.revision}`;
    const selected = new Map();
    for (const run of recent.body.workflow_runs) {
      if (!workflow.active.includes(run.workflow_id)) continue;
      const prev = selected.get(run.workflow_id);
      if (!prev || String(run.created_at) > String(prev.created_at) || (run.created_at === prev.created_at && run.id > prev.id)) selected.set(run.workflow_id, run);
    }
    const missing = new Map();
    for (const id of workflow.active) {
      if (selected.has(id)) continue;
      if (entry.missing?.revision === revision && entry.missing.runs.has(id)) missing.set(id, entry.missing.runs.get(id));
      else {
        const value = await resource(ctx, entry, `missing:${id}`, `${prefix}/actions/workflows/${id}/runs?branch=${branch}&per_page=1`);
        if (!Array.isArray(value.body?.workflow_runs) || value.body.workflow_runs.length > 1) throw incomplete();
        const run = value.body.workflow_runs[0] || null;
        if (run && run.workflow_id !== id) throw incomplete(); missing.set(id, run);
      }
    }
    const openPRs = pageCount(prs.body, prs.link, `${prefix}/pulls`, ref.repoId);
    if (info.body.open_issues_count < openPRs) throw incomplete(); // 조회 시점 차이로 모순된 집계를 성공으로 표시하지 않는다
    const metrics = { projectId: entry.project.projectId, commits30d: pageCount(commits.body, commits.link, `${prefix}/commits`, ref.repoId), activityRatio: 0, openPRs, openIssues: info.body.open_issues_count - openPRs,
      ci: ciOf(workflow.active.map(id => selected.get(id) || missing.get(id))), ciBranch: ref.defaultBranch,
      sync: { mode: 'polling', status: 'ok', lastSuccessfulSyncAt: new Date(now()).toISOString() } };
    const cursor = new Date((entry.githubState ? Date.parse(entry.githubState.at) : now()) - 1000).toISOString();
    const issues = await eventRows(ctx, entry, 'issues', `${prefix}/issues?state=all&sort=updated&direction=asc&since=${encodeURIComponent(cursor)}&per_page=100`);
    const pulls = await eventRows(ctx, entry, 'pulls', `${prefix}/pulls?state=all&sort=updated&direction=desc&per_page=100`, !entry.githubState);
    const status = await loadAgentStatus(entry.project, async url => (await resource(ctx, entry, 'agentStatus', url, { accept: 'application/vnd.github.raw+json' })).body);
    const observedAt = new Date(now()).toISOString();
    const gh = githubEvents({ projectId: entry.project.projectId, previous: entry.githubState, commits: commits.body, issues, pulls, ci: metrics.ci, observedAt });
    const agent = agentEvents({ projectId: entry.project.projectId, previous: entry.agentState, status, observedAt });
    if (ctx.signal.aborted) throw githubError('ABORTED', 409);
    entry.missing = { revision, runs: missing };
    for (const slot of entry.cache.keys()) if (slot.startsWith('missing:') && !workflow.active.includes(Number(slot.split(':')[1]))) entry.cache.delete(slot);
    metrics.sync.lastSuccessfulSyncAt = observedAt;
    entry.project.github = ref; entry.metrics = metrics; entry.githubState = gh.state; entry.agentState = agent.state;
    for (const event of [...gh.events, ...agent.events]) entry.bus.publish(event);
  }
  function refreshEntry(b, entry) {
    if (entry.job) return entry.job;
    entry.metrics.sync = { ...entry.metrics.sync, status: 'syncing' };
    entry.job = snapshot(b, entry).catch(e => {
      if (entry.controller.signal.aborted || b.ctx.signal.aborted) return;
      entry.metrics.sync = { ...entry.metrics.sync, status: entry.metrics.sync.lastSuccessfulSyncAt || ['BUDGET', 'RATE_LIMITED'].includes(e.code) ? 'stale' : 'error', error: errorKind(e) };
      b.ctx.scopesOk = false;
      if (e.code === 'AUTH') auth.revoke(b.sid);
    }).finally(() => { entry.job = null; });
    return entry.job;
  }
  async function refreshBucket(b) {
    await Promise.all([...b.projects.values()].map(entry => refreshEntry(b, entry)));
    if (b.ctx.signal.aborted) throw githubError('ABORTED', 409);
    b.ctx.scopesOk = b.projects.size > 0 && [...b.projects.values()].every(e => e.metrics.sync.status === 'ok');
    return withRatios([...b.projects.values()].map(e => e.metrics));
  }
  const timer = setInterval(() => {
    for (const b of connections.values()) {
      try { auth.context(b.sid); refreshBucket(b).catch(() => {}); } catch { /* 만료 정리는 auth가 알린다 */ }
    }
  }, intervalMs); timer.unref();
  return {
    events(sid, since) { return bucket(sid).journal.list(since); },
    projects(sid) { return [...bucket(sid).projects.values()].map(e => structuredClone(e.project)); },
    metrics(sid) { return withRatios([...bucket(sid).projects.values()].map(e => e.metrics)); },
    async select(sid, { repoId, projectId } = {}) {
      const b = bucket(sid);
      if (!Number.isSafeInteger(repoId) || repoId <= 0) throw githubError('INVALID_REPO', 400);
      if ([...b.projects.values()].some(e => e.project.github.repoId === repoId)) throw githubError('DUPLICATE_REPO', 409);
      if (b.projects.size >= MAX_GH_PROJECTS) throw githubError('PROJECT_LIMIT', 409);
      const manual = manualProjects();
      if (projectId !== undefined && (!/^[a-z][a-z0-9_-]{0,23}$/.test(projectId) || !manual.some(p => p.id === projectId))) throw githubError('INVALID_PROJECT', 400);
      const id = projectId || projectIdFromRepoId(repoId);
      if (b.projects.has(id) || (!projectId && manual.some(p => p.id === id))) throw githubError('DUPLICATE_PROJECT', 409);
      const ref = repoRef(await client.json(await client.request(b.ctx, `/repositories/${repoId}`, { purpose: 'relay' })));
      if (ref.repoId !== repoId) throw githubError('INVALID_REPO', 400);
      if (b.ctx.signal.aborted) throw githubError('ABORTED', 409);
      // 동시에 들어온 선택 요청도 조회가 끝난 뒤 다시 검사한다.
      if (b.projects.has(id) || [...b.projects.values()].some(e => e.project.github.repoId === repoId)) throw githubError('DUPLICATE_REPO', 409);
      if (b.projects.size >= MAX_GH_PROJECTS) throw githubError('PROJECT_LIMIT', 409);
      const entry = { bus: b.bus, project: { projectId: id, github: ref }, controller: new AbortController(), cache: new Map(), metrics: { projectId: id, commits30d: 0, activityRatio: 0, openPRs: 0, openIssues: 0, ci: 'unknown', sync: { mode: 'polling', status: 'syncing' } } };
      b.projects.set(id, entry); b.ctx.scopesOk = false;
      return structuredClone(entry.project);
    },
    remove(sid, projectId) { const b = bucket(sid), entry = b.projects.get(projectId); if (!entry) throw githubError('NOT_FOUND', 404); entry.controller.abort(); entry.cache.clear(); entry.missing = null; b.projects.delete(projectId); b.journal.removeProject(projectId); b.ctx.scopesOk = false; },
    sync(sid) { return refreshBucket(bucket(sid)); },
    close() { clearInterval(timer); unsubscribe(); for (const b of connections.values()) { for (const e of b.projects.values()) e.controller.abort(); b.journal.close(); } connections.clear(); },
  };
}
