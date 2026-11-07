import { it, expect, afterEach } from 'vitest';
import { createDeviceFlow } from '../src/server/auth/device-flow.js';
import { createAuthService } from '../src/server/auth/service.js';
import { createGithubClient } from '../src/server/github-client.js';
import { createGithubBudget } from '../src/server/github-budget.js';
const closes = []; afterEach(() => { for (const close of closes.splice(0)) close(); });
const json = value => new Response(JSON.stringify(value));
function setup(options = {}) {
  let time = Date.now(); const records = new Map(), calls = [], replies = [];
  const store = { enabled: true, clear() { records.clear(); }, set(k, v) { records.set(k, v); }, remove(k) { records.delete(k); } };
  const client = createGithubClient({ budget: createGithubBudget(), fetchImpl: async () => json({ login: 'sample' }) });
  const flow = createDeviceFlow({ clientId: 'fixture-client', fetchImpl: async (url, opts) => {
    const body = Object.fromEntries(opts.body); calls.push({ url, body, signal: opts.signal });
    if (url.endsWith('/device/code')) return json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    const result = replies.shift() ?? { error: 'authorization_pending' };
    return typeof result === 'function' ? result() : json(result);
  } });
  const auth = createAuthService({ store, client, deviceFlow: flow, now: () => time, ...options }); closes.push(() => auth.close());
  return { auth, records, calls, replies, a: `${time + 12 * 3600_000}.a`, b: `${time + 12 * 3600_000}.b`, advance(ms) { time += ms; } };
}
const tokens = n => ({ access_token: `fixture-access-${n}`, refresh_token: `fixture-refresh-${n}`, expires_in: 28800, refresh_token_expires_in: 15811200 });
it('Device Flow의 비공개 코드와 토큰은 응답하지 않고 폴링 간격과 slow_down을 따른다', async () => {
  const s = setup(); const result = await s.auth.startDevice(s.a);
  expect(result).toEqual({ userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 });
  expect(await s.auth.pollDevice(s.a)).toEqual({ status: 'pending', retryAfterSec: 5 }); expect(s.calls).toHaveLength(1);
  s.advance(5000); s.replies.push({ error: 'slow_down' }); expect((await s.auth.pollDevice(s.a)).retryAfterSec).toBe(10);
  s.advance(10000); s.replies.push(tokens(1)); const info = await s.auth.pollDevice(s.a);
  expect(info).toMatchObject({ status: 'connected', connection: { connected: true, method: 'device_flow' } });
  expect(JSON.stringify(info)).not.toMatch(/fixture-access|fixture-refresh|private-device/);
  expect(s.calls.at(-1).body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
});
it('다른 세션은 흐름을 조회하지 못하고 거절되어도 기존 PAT 연결은 보존한다', async () => {
  const s = setup(); await s.auth.connect(s.a, 'fixture-original'); const ctx = s.auth.context(s.a);
  await s.auth.startDevice(s.a); await expect(s.auth.pollDevice(s.b)).rejects.toMatchObject({ code: 'NO_DEVICE_FLOW' });
  s.advance(5000); s.replies.push({ error: 'access_denied' }); await expect(s.auth.pollDevice(s.a)).rejects.toMatchObject({ code: 'DEVICE_DENIED' });
  expect(s.auth.context(s.a)).toBe(ctx);
});
it('8시간 만료 전 갱신을 하나로 합치고 자격 ID와 세션의 선택 상태를 유지한다', async () => {
  const s = setup(); await s.auth.startDevice(s.a); s.advance(5000); s.replies.push(tokens(1)); await s.auth.pollDevice(s.a);
  const id = s.auth.context(s.a).credentialId; s.advance(28800_000 - 30_000); s.replies.push(tokens(2));
  const [a, b] = await Promise.all([s.auth.provider(s.a).getToken(), s.auth.provider(s.a).getToken()]);
  expect(a).toBe('fixture-access-2'); expect(b).toBe(a); expect(s.calls.filter(c => c.body.grant_type === 'refresh_token')).toHaveLength(1);
  expect(s.auth.context(s.a).credentialId).toBe(id); expect(s.records.values().next().value.refreshToken).toBe('fixture-refresh-2');
  expect(JSON.stringify(s.calls)).not.toContain('client_secret');
});
it('갱신 실패는 해당 세션을 expired로 바꾸고 토큰과 폴링 정리 신호를 보낸다', async () => {
  const s = setup(); await s.auth.connect(s.b, 'fixture-other'); await s.auth.startDevice(s.a); s.advance(5000); s.replies.push(tokens(1)); await s.auth.pollDevice(s.a);
  const removed = []; s.auth.onDisconnect(id => removed.push(id)); const ctx = s.auth.context(s.a);
  s.advance(28800_000); s.replies.push({ error: 'bad_refresh_token' }); await expect(s.auth.ready(s.a)).rejects.toMatchObject({ code: 'AUTH' });
  expect(s.auth.info(s.a)).toEqual({ connected: false, scopesOk: false, error: 'expired' }); expect(ctx.signal.aborted).toBe(true); expect(removed).toEqual([ctx.credentialId]);
  expect(s.auth.info(s.b).connected).toBe(true); expect(s.records.size).toBe(1);
});
it('갱신 중 해제해도 늦은 토큰이 다시 저장되지 않는다', async () => {
  const s = setup(); await s.auth.startDevice(s.a); s.advance(5000); s.replies.push(tokens(1)); await s.auth.pollDevice(s.a); s.advance(28800_000);
  let release; s.replies.push(() => new Promise(resolve => { release = () => resolve(json(tokens(2))); }));
  const job = s.auth.ready(s.a); await new Promise(resolve => setImmediate(resolve)); s.auth.disconnect(s.a); release();
  await expect(job).rejects.toMatchObject({ code: 'AUTH' }); expect(s.records.size).toBe(0); expect(s.auth.info(s.a).connected).toBe(false);
});
it('새 PAT 연결과 만료가 기존 Device Flow를 취소한다', async () => {
  const s = setup(); await s.auth.startDevice(s.a); await s.auth.connect(s.a, 'fixture-new-pat');
  await expect(s.auth.pollDevice(s.a)).rejects.toMatchObject({ code: 'NO_DEVICE_FLOW' });
  await s.auth.startDevice(s.a); s.advance(901_000); await expect(s.auth.pollDevice(s.a)).rejects.toMatchObject({ code: 'DEVICE_EXPIRED' });
  expect(s.auth.info(s.a).method).toBe('pat');
});
it('client ID 미설정과 악성 확인 URL은 외부 인증 시작을 허용하지 않는다', async () => {
  const missing = createDeviceFlow({ fetchImpl: () => { throw new Error('must not fetch'); } }); await expect(missing.start()).rejects.toMatchObject({ code: 'DEVICE_FLOW_UNAVAILABLE' });
  const bad = createDeviceFlow({ clientId: 'fixture', fetchImpl: async () => json({ device_code: 'code', user_code: 'ABCD-EFGH', verification_uri: 'https://other.example', expires_in: 900 }) });
  await expect(bad.start()).rejects.toMatchObject({ code: 'OAUTH_UPSTREAM' });
});

it('비정상 토큰 수명과 숫자 확인 코드를 계약 값으로 받지 않는다', async () => {
  const lifetime = createDeviceFlow({ clientId: 'fixture', fetchImpl: async () => json({ ...tokens(1), expires_in: 999999999 }) });
  await expect(lifetime.refresh('fixture-refresh')).rejects.toMatchObject({ code: 'OAUTH_UPSTREAM' });
  const code = createDeviceFlow({ clientId: 'fixture', fetchImpl: async () => json({ device_code: 'private', user_code: 1234, verification_uri: 'https://github.com/login/device', expires_in: 900 }) });
  await expect(code.start()).rejects.toMatchObject({ code: 'OAUTH_UPSTREAM' });
});
