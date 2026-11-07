import crypto from 'node:crypto';
import { githubError } from '../github-budget.js';

const sessionKey = sid => crypto.createHash('sha256').update(sid).digest('hex');
/** @returns {import('../../../contracts/index.js').RepoRef} */
export function repoRef(repo) {
  if (!Number.isSafeInteger(repo?.id) || repo.id <= 0 || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name) || typeof repo.default_branch !== 'string' || !repo.default_branch || typeof repo.private !== 'boolean') throw githubError('INVALID_REPO', 400);
  return { repoId: repo.id, fullName: repo.full_name, defaultBranch: repo.default_branch, isPrivate: repo.private };
}
export function createAuthService({ store, client, now = Date.now, sweepMs = 60_000, deviceFlow }) {
  const entries = new Map(), pending = new Map(), listeners = new Set(), errors = new Map(), flows = new Map();
  let storageError = false;
  // 대시보드 서명키가 재시작마다 바뀌므로 이전 세션의 인증정보도 폐기한다.
  if (store.enabled) { try { store.clear(); } catch { storageError = true; } }
  const enabled = () => { if (!store.enabled) throw githubError('CONNECTION_DISABLED', 503); if (storageError) throw githubError('CONNECTION_STORAGE_ERROR', 503); };
  function cancelFlow(sid) { flows.get(sid)?.controller.abort(); flows.delete(sid); }
  function expire(sid, error) {
    cancelFlow(sid);
    pending.get(sid)?.abort(); pending.delete(sid);
    const ctx = entries.get(sid);
    if (ctx) {
      ctx.controller.abort(); entries.delete(sid);
      try { store.remove(sessionKey(sid)); } catch { storageError = true; }
      for (const listener of listeners) listener(ctx.credentialId);
    }
    if (error) errors.set(sid, error); else errors.delete(sid);
  }
  function context(sid) {
    enabled(); const ctx = entries.get(sid);
    if (!ctx) throw githubError('NOT_CONNECTED', 409);
    if (ctx.expiresAt <= now()) { expire(sid, 'expired'); throw githubError('AUTH', 401); }
    return ctx;
  }
  function persist(sid, ctx) {
    const { token, method, login, credentialId, expiresAt, accessExpiresAt, refreshToken, refreshExpiresAt } = ctx;
    store.set(sessionKey(sid), { token, method, login, credentialId, expiresAt, accessExpiresAt, refreshToken, refreshExpiresAt });
  }
  async function userOf(token, signal) {
    const user = await client.json(await client.request({ token, signal }, '/user', { purpose: 'relay' }));
    if (typeof user.login !== 'string' || !/^[\w-]{1,100}$/.test(user.login)) throw githubError('AUTH', 401);
    return user.login;
  }
  async function ready(sid) {
    const ctx = context(sid);
    if (ctx.method !== 'device_flow' || ctx.accessExpiresAt > now() + 30_000) return ctx;
    if (!ctx.refreshJob) ctx.refreshJob = (async () => {
      try {
        if (!ctx.refreshToken || ctx.refreshExpiresAt <= now()) throw githubError('AUTH', 401);
        const value = await deviceFlow.refresh(ctx.refreshToken, ctx.signal);
        const login = await userOf(value.token, ctx.signal);
        if (ctx.signal.aborted || entries.get(sid) !== ctx) throw githubError('ABORTED', 409);
        if (login !== ctx.login) throw githubError('AUTH', 401);
        const update = { ...ctx, token: value.token, refreshToken: value.refreshToken, accessExpiresAt: now() + value.expiresIn * 1000, refreshExpiresAt: now() + value.refreshExpiresIn * 1000 };
        persist(sid, update); Object.assign(ctx, update); ctx.scopesOk = false;
        return ctx;
      } catch {
        if (entries.get(sid) === ctx) expire(sid, 'expired');
        throw githubError('AUTH', 401);
      } finally { ctx.refreshJob = null; }
    })();
    return ctx.refreshJob;
  }
  function install(sid, value, login, controller) {
    const expiresAt = Number(sid.split('.')[0]);
    if (controller.signal.aborted || expiresAt <= now()) throw githubError('ABORTED', 409);
    const ctx = { ...value, login, expiresAt, credentialId: crypto.randomUUID(), scopesOk: false, controller, signal: controller.signal, getToken: async () => (await ready(sid)).token };
    persist(sid, ctx);
    const old = entries.get(sid); if (old) { old.controller.abort(); for (const listener of listeners) listener(old.credentialId); }
    entries.set(sid, ctx); errors.delete(sid);
  }
  const timer = setInterval(() => {
    for (const [sid, ctx] of entries) if (ctx.expiresAt <= now()) expire(sid, 'expired');
    for (const [sid, flow] of flows) if (flow.expiresAt <= now()) cancelFlow(sid);
    for (const [sid, ctx] of entries) if (ctx.method === 'device_flow' && ctx.accessExpiresAt <= now() + 30_000) ready(sid).catch(() => {});
    for (const sid of errors.keys()) if (Number(sid.split('.')[0]) <= now()) errors.delete(sid);
  }, sweepMs); timer.unref();
  return {
    context, ready,
    /** @returns {import('../../../contracts/index.js').AuthService} */
    provider(sid) { return { getToken: async () => (await ready(sid)).token }; },
    /** @returns {import('../../../contracts/index.js').ConnectionInfo} */
    info(sid) {
      enabled(); let ctx = entries.get(sid);
      if (ctx && ctx.expiresAt <= now()) { expire(sid, 'expired'); ctx = null; }
      return ctx ? { connected: true, method: ctx.method, login: ctx.login, scopesOk: ctx.scopesOk } : { connected: false, scopesOk: false, ...(errors.has(sid) ? { error: errors.get(sid) } : {}) };
    },
    async connection(sid) { if (entries.has(sid)) { try { await ready(sid); } catch { /* info에 만료 반영 */ } } return this.info(sid); },
    async connect(sid, token) {
      enabled();
      if (typeof token !== 'string' || token.length < 8 || token.length > 1024 || /\s|[^\x21-\x7e]/.test(token)) throw githubError('INVALID_TOKEN', 400);
      const expiresAt = Number(sid.split('.')[0]);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw githubError('AUTH', 401);
      cancelFlow(sid); pending.get(sid)?.abort(); const controller = new AbortController(); pending.set(sid, controller);
      try {
        const login = await userOf(token, controller.signal);
        if (pending.get(sid) !== controller) throw githubError('ABORTED', 409);
        install(sid, { token, method: 'pat' }, login, controller);
        return this.info(sid);
      } finally { if (pending.get(sid) === controller) pending.delete(sid); }
    },
    async startDevice(sid) {
      enabled(); if (!deviceFlow) throw githubError('DEVICE_FLOW_UNAVAILABLE', 503);
      if (Number(sid.split('.')[0]) <= now()) throw githubError('AUTH', 401);
      cancelFlow(sid); pending.get(sid)?.abort();
      const controller = new AbortController(); pending.set(sid, controller);
      try {
        const value = await deviceFlow.start(controller.signal);
        if (controller.signal.aborted || pending.get(sid) !== controller || Number(sid.split('.')[0]) <= now()) throw githubError('ABORTED', 409);
        flows.set(sid, { ...value, controller, expiresAt: now() + value.expiresIn * 1000, nextPollAt: now() + value.interval * 1000 });
        return { userCode: value.userCode, verificationUri: value.verificationUri, expiresIn: value.expiresIn, interval: value.interval };
      } finally { if (pending.get(sid) === controller) pending.delete(sid); }
    },
    async pollDevice(sid) {
      enabled(); const flow = flows.get(sid);
      if (!flow) throw githubError('NO_DEVICE_FLOW', 409);
      if (flow.expiresAt <= now() || Number(sid.split('.')[0]) <= now()) { cancelFlow(sid); throw githubError('DEVICE_EXPIRED', 410); }
      if (flow.job) return flow.job;
      const pendingResult = () => ({ status: 'pending', retryAfterSec: Math.max(1, Math.ceil((flow.nextPollAt - now()) / 1000)) });
      if (now() < flow.nextPollAt) return pendingResult();
      flow.job = (async () => {
        try {
          flow.nextPollAt = now() + flow.interval * 1000;
          const value = await deviceFlow.poll(flow.deviceCode, flow.controller.signal);
          if (flows.get(sid) !== flow || flow.controller.signal.aborted) throw githubError('ABORTED', 409);
          if (flow.expiresAt <= now()) throw githubError('DEVICE_EXPIRED', 410);
          if (value.pending) { if (value.slowDown) flow.interval += 5; flow.nextPollAt = now() + flow.interval * 1000; return pendingResult(); }
          const login = await userOf(value.token, flow.controller.signal);
          if (flows.get(sid) !== flow || flow.expiresAt <= now()) throw githubError('ABORTED', 409);
          install(sid, { token: value.token, method: 'device_flow', refreshToken: value.refreshToken, accessExpiresAt: now() + value.expiresIn * 1000, refreshExpiresAt: now() + value.refreshExpiresIn * 1000 }, login, flow.controller);
          flows.delete(sid); return { status: 'connected', connection: this.info(sid) };
        } catch (e) { cancelFlow(sid); throw e; }
        finally { flow.job = null; }
      })();
      return flow.job;
    },
    disconnect(sid) { enabled(); expire(sid); },
    revoke(sid) { expire(sid, 'revoked'); },
    onDisconnect(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async repos(sid) {
      const ctx = await ready(sid), repos = [], seen = new Set();
      let resource = '/user/repos?per_page=100&affiliation=owner,collaborator,organization_member';
      try {
        for (let page = 0; resource && page < 10; page++) {
          if (seen.has(resource)) throw githubError('INVALID_PAGINATION'); seen.add(resource);
          const r = await client.request(ctx, resource, { purpose: 'relay' });
          const list = await client.json(r); if (!Array.isArray(list)) throw githubError('NETWORK');
          for (const repo of list) repos.push(repoRef(repo));
          resource = client.next(r.headers.get('link'), '/user/repos');
        }
        if (resource) throw githubError('REPO_LIST_LIMIT', 409);
        if (ctx.signal.aborted) throw githubError('ABORTED', 409);
        return [...new Map(repos.map(r => [r.repoId, r])).values()];
      } catch (e) { if (e.code === 'AUTH') expire(sid, 'revoked'); throw e; }
    },
    close() { clearInterval(timer); for (const sid of flows.keys()) cancelFlow(sid); for (const sid of entries.keys()) expire(sid); for (const controller of pending.values()) controller.abort(); pending.clear(); },
  };
}
