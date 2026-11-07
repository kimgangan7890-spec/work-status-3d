import crypto from 'node:crypto';
import { BUDGET_PRIORITY } from '../../contracts/index.js';

export const credentialKey = token => crypto.createHash('sha256').update(token || 'anonymous').digest('hex');
export const githubError = (code, status = 502, retryAfterSec) => Object.assign(new Error(code), { code, status, retryAfterSec });

// 데이터 캐시와 별개인 인증정보별 총예산. 대기 중인 요청만 우선순위로 정렬한다.
export function createGithubBudget({ limit, now = Date.now } = {}) {
  const buckets = new Map();
  async function drain(b) {
    if (b.running) return;
    b.running = true;
    try {
      while (b.queue.length) {
        b.queue.sort((a, z) => BUDGET_PRIORITY.indexOf(a.purpose) - BUDGET_PRIORITY.indexOf(z.purpose));
        const q = b.queue.shift();
        try {
          if (q.signal?.aborted) throw githubError('ABORTED', 409);
          const time = now(); b.times = b.times.filter(t => t > time - 3600_000);
          const cap = Number.isInteger(limit) && limit > 0 ? limit : q.authenticated ? 4000 : 50;
          if (b.until > time) throw githubError('RATE_LIMITED', 429, Math.max(1, Math.ceil((b.until - time) / 1000)));
          if (b.times.length >= cap) throw githubError('BUDGET', 429, Math.max(1, Math.ceil((b.times[0] + 3600_000 - time) / 1000)));
          b.times.push(time);
          const response = await q.execute();
          const retry = response.headers.get('retry-after');
          const seconds = retry === null ? 0 : /^\d+$/.test(retry) ? Number(retry) : Math.max(0, (Date.parse(retry) - time) / 1000);
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          if (response.headers.get('x-ratelimit-remaining') === '0') b.until = Math.max(time + 1000, reset || time + 60_000);
          if (response.status === 429 || (response.status === 403 && (retry !== null || response.headers.get('x-ratelimit-remaining') === '0'))) {
            b.until = Math.max(b.until, time + (seconds || 60) * 1000);
            await response.body?.cancel();
            throw githubError('RATE_LIMITED', 429, Math.ceil((b.until - time) / 1000));
          }
          q.resolve(response);
        } catch (e) { q.reject(e); }
      }
    } finally { b.running = false; }
  }
  return { run({ key, purpose = 'relay', authenticated = false, signal }, execute) {
    if (!BUDGET_PRIORITY.includes(purpose)) return Promise.reject(githubError('INVALID_PURPOSE', 400));
    // 유휴 버킷은 시간창이 지난 뒤 정리한다.
    for (const [k, b] of buckets) if (!b.running && !b.queue.length && b.until <= now() && (!b.times.length || b.times.at(-1) <= now() - 3600_000)) buckets.delete(k);
    let b = buckets.get(key);
    if (!b) { b = { times: [], until: 0, queue: [], running: false }; buckets.set(key, b); }
    return new Promise((resolve, reject) => { b.queue.push({ purpose, authenticated, signal, execute, resolve, reject }); queueMicrotask(() => drain(b)); });
  } };
}
