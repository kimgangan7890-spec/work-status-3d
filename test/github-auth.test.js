import { it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEncryptedStore } from '../src/server/auth/encrypted-store.js';
import { createAuthService } from '../src/server/auth/service.js';
import { createGithubBudget, credentialKey } from '../src/server/github-budget.js';
import { createGithubClient } from '../src/server/github-client.js';

const cleanups = []; afterEach(() => { for (const close of cleanups.splice(0)) close(); });
function setup(fetchImpl, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-session-'));
  const file = path.join(dir, 'auth.enc'), key = crypto.randomBytes(32);
  const store = createEncryptedStore({ file, key });
  const client = createGithubClient({ budget: createGithubBudget(), fetchImpl });
  const service = createAuthService({ store, client, ...options });
  cleanups.push(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, file, store };
}
const sid = n => `${Date.now() + 3600_000}.${n}`;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
it('세션마다 다른 인증정보와 저장소 목록을 사용하고 연결 정보에 토큰을 내보내지 않는다', async () => {
  const { service, file } = setup(async (url, opts) => url.endsWith('/user') ? json({ login: opts.headers.Authorization.endsWith('one') ? 'user-one' : 'user-two' }) : json([{ id: opts.headers.Authorization.endsWith('one') ? 1 : 2, full_name: 'sample/repo', default_branch: 'main', private: true }]));
  const a = sid('a'), b = sid('b');
  await service.connect(a, 'fixture-token-one'); await service.connect(b, 'fixture-token-two');
  expect(service.context(a).credentialId).not.toBe(service.context(b).credentialId);
  expect(service.info(a)).toEqual({ connected: true, method: 'pat', login: 'user-one', scopesOk: false });
  expect((await service.repos(a))[0].repoId).toBe(1); expect((await service.repos(b))[0].repoId).toBe(2);
  expect(fs.readFileSync(file, 'utf8')).not.toContain('fixture-token');
  service.disconnect(a); expect(service.info(a).connected).toBe(false); expect(service.info(b).connected).toBe(true);
});
it('검증 실패 시 기존 연결을 보존하고 연결 해제는 진행 중 요청을 취소한다', async () => {
  const { service } = setup(async (_url, opts) => opts.headers.Authorization.endsWith('bad') ? json({}, 401) : json({ login: 'sample' }));
  const s = sid('a'); await service.connect(s, 'fixture-token-good'); const ctx = service.context(s);
  await expect(service.connect(s, 'fixture-token-bad')).rejects.toMatchObject({ code: 'AUTH' });
  expect(service.context(s)).toBe(ctx); const removed = []; service.onDisconnect(id => removed.push(id));
  service.disconnect(s); expect(ctx.signal.aborted).toBe(true); expect(removed).toEqual([ctx.credentialId]);
});
it('연결 검증 중 해제해도 늦은 응답이 인증정보를 복구하지 못한다', async () => {
  let release; const { service } = setup(() => new Promise(resolve => { release = () => resolve(json({ login: 'sample' })); }));
  const s = sid('a'), job = service.connect(s, 'fixture-token-one');
  await new Promise(resolve => setImmediate(resolve)); service.disconnect(s); release();
  await expect(job).rejects.toMatchObject({ code: 'ABORTED' }); expect(service.info(s).connected).toBe(false);
});
it('만료된 세션의 암호문 레코드와 요청 신호를 지운다', async () => {
  let now = Date.now(); const { service, store } = setup(async () => json({ login: 'sample' }), { now: () => now });
  const s = sid('a'); await service.connect(s, 'fixture-token-one'); const ctx = service.context(s);
  now += 7200_000; expect(service.info(s)).toEqual({ connected: false, scopesOk: false, error: 'expired' });
  expect(ctx.signal.aborted).toBe(true); expect(store.get(crypto.createHash('sha256').update(s).digest('hex'))).toBeNull();
});
it('페이지 이동으로 다른 호스트에 인증정보를 보내지 않는다', async () => {
  let calls = 0;
  const { service } = setup(async url => { calls++; return url.endsWith('/user') ? json({ login: 'sample' }) : json([], 200, { link: '<https://other.example/user/repos?page=2>; rel="next"' }); });
  const s = sid('a'); await service.connect(s, 'fixture-token-one'); await expect(service.repos(s)).rejects.toMatchObject({ code: 'INVALID_PAGINATION' }); expect(calls).toBe(2);
});
it('인증정보별 총예산과 GitHub 재시도 시각을 지키고 대기 요청 우선순위를 적용한다', async () => {
  let now = 1000; const budget = createGithubBudget({ limit: 2, now: () => now }), order = [];
  const opts = purpose => ({ key: credentialKey('fixture'), purpose, authenticated: true });
  const run = purpose => budget.run(opts(purpose), async () => { order.push(purpose); return json({}); });
  const jobs = await Promise.allSettled([run('discovery'), run('relay'), run('activity_sync')]);
  expect(order).toEqual(['relay', 'activity_sync']); expect(jobs[0].reason.code).toBe('BUDGET');
  now += 3600_001;
  await expect(budget.run(opts('relay'), async () => json({}, 429, { 'retry-after': '90' }))).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 90 });
  await expect(run('relay')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
