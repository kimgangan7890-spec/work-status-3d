import { it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
const cleanup = []; afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function start(enabled = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3d-api-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const upstream = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let body = [];
    if (pathname === '/login/device/code') body = { device_code: 'server-private-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 };
    if (pathname === '/login/oauth/access_token') body = { access_token: 'fixture-device-access', refresh_token: 'fixture-device-refresh', expires_in: 28800, refresh_token_expires_in: 15811200 };
    if (pathname === '/user') body = { login: 'sample-user' };
    if (pathname === '/repositories/35') body = { id: 35, full_name: 'sample/project', default_branch: 'main', private: true, open_issues_count: 0, size: 1 };
    if (pathname.endsWith('/actions/runs')) body = { workflow_runs: [] };
    if (pathname.endsWith('/actions/workflows')) body = { workflows: [] };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); cleanup.push(() => new Promise(resolve => upstream.close(resolve)));
  const proc = spawn('node', ['server.js'], { env: { ...process.env, PORT: '0', DASH_PASSWORD: 'test-password', GITHUB_AUTH_FILE: path.join(dir, 'auth.enc'), WORK3D_SECRET_KEY: enabled ? crypto.randomBytes(32).toString('base64') : '', GITHUB_APP_CLIENT_ID: 'fixture-client', GITHUB_OAUTH_BASE: `http://127.0.0.1:${upstream.address().port}`, GITHUB_API_BASE: `http://127.0.0.1:${upstream.address().port}` } });
  cleanup.push(() => new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); proc.kill(); }));
  const base = await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(new Error('start timeout')), 5000); proc.stdout.on('data', d => { out += d; const m = /http:\/\/127\.0\.0\.1:\d+/.exec(out); if (m) { clearTimeout(timer); resolve(m[0]); } }); });
  const request = (route, cookie, body, origin = base) => fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const login = async () => (await request('/api/login', null, { password: 'test-password' })).headers.get('set-cookie').split(';')[0];
  return { request, login, dir };
}
it('키가 없어도 서버는 실행되고 연결 기능만 503이며 로그인이 먼저 필요하다', async () => {
  const { request, login } = await start(false);
  expect((await request('/api/github/connection')).status).toBe(401);
  const c = await login(); expect((await request('/api/session', c)).status).toBe(200);
  const r = await request('/api/github/connection', c); expect(r.status).toBe(503); expect(await r.json()).toEqual({ code: 'CONNECTION_DISABLED' });
});
it('실제 HTTP 로그인 두 개의 연결을 분리하고 로그아웃 쿠키를 재사용할 수 없다', async () => {
  const { request, login } = await start(); const a = await login(), b = await login(); expect(a).not.toBe(b);
  expect((await request('/api/github/connect', a, null)).status).toBe(400);
  expect((await request('/api/github/connect', a, { token: 'fixture-token' }, 'https://other.example')).status).toBe(403);
  expect((await request('/api/github/connect', a, { token: 'fixture-token' })).status).toBe(200);
  expect((await (await request('/api/github/connection', a)).json()).connected).toBe(true);
  expect(await (await request('/api/github/connection', b)).json()).toEqual({ connected: false, scopesOk: false });
  await request('/api/logout', a, {}); expect((await request('/api/github/connection', a)).status).toBe(401);
  expect((await request('/api/session', b)).status).toBe(200);
});
it('선택→지표 동기화→해제 HTTP 흐름에서 다른 세션과 재연결에 데이터가 남지 않는다', async () => {
  const { request, login } = await start(); const a = await login(), b = await login();
  await request('/api/github/connect', a, { token: 'fixture-token' }); await request('/api/github/connect', b, { token: 'fixture-other' });
  const selection = await request('/api/github/projects', a, { repoId: 35 }); expect(selection.status).toBe(201);
  expect((await selection.json()).project.projectId).toBe('gh-z');
  expect(await (await request('/api/github/projects', b)).json()).toEqual({ projects: [] });
  const r = await request('/api/github/sync', a, {}); expect(r.status).toBe(200);
  const body = await r.json(); expect(body.metrics[0]).toMatchObject({ commits30d: 0, activityRatio: 0, ci: 'none', sync: { status: 'ok' } });
  expect(body.scopesOk).toBe(true);
  expect(await (await request('/api/github/events', a)).json()).toEqual({ events: [] });
  expect((await request('/api/github/events?since=invalid', a)).status).toBe(400);
  expect(JSON.stringify(body)).not.toMatch(/fixture-token|credentialId|Authorization/);
  expect((await (await request('/api/github/connection', a)).json()).scopesOk).toBe(true);
  await request('/api/github/disconnect', a, {}); expect((await request('/api/github/metrics', a)).status).toBe(409);
  await request('/api/github/connect', a, { token: 'fixture-token' }); expect(await (await request('/api/github/metrics', a)).json()).toEqual({ metrics: [] });
});
it('실제 HTTP Device Flow는 세션별로 격리하며 코드와 토큰을 응답하지 않는다', async () => {
  const { request, login } = await start(); const a = await login(), b = await login();
  const started = await request('/api/github/device/start', a, {}); expect(started.status).toBe(200);
  const code = await started.json(); expect(code.userCode).toBe('ABCD-EFGH'); expect(JSON.stringify(code)).not.toContain('server-private-code');
  expect((await request('/api/github/device/poll', b, {})).status).toBe(409);
  const early = await request('/api/github/device/poll', a, {}); expect(early.status).toBe(202); expect(early.headers.get('retry-after')).toBe('1');
  await new Promise(resolve => setTimeout(resolve, 1050));
  const complete = await request('/api/github/device/poll', a, {}); expect(complete.status).toBe(200); const body = await complete.json();
  expect(body).toMatchObject({ status: 'connected', connection: { method: 'device_flow' } }); expect(JSON.stringify(body)).not.toMatch(/fixture-device|refreshToken|device_code/);
  expect((await (await request('/api/github/connection', b)).json()).connected).toBe(false);
  await request('/api/github/disconnect', a, {}); expect((await (await request('/api/github/connection', a)).json()).connected).toBe(false);
});
