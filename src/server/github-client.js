import { credentialKey, githubError } from './github-budget.js';

export function createGithubClient({ base = 'https://api.github.com', budget, fetchImpl = fetch }) {
  const root = new URL(base);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) throw githubError('INVALID_API_BASE');
  const origin = root.origin;
  function next(link, expectedPath) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(link || '');
    if (!match) return null;
    const url = new URL(match[1], root);
    const paths = Array.isArray(expectedPath) ? expectedPath : [expectedPath];
    if (url.origin !== origin || !paths.includes(url.pathname) || url.username || url.password || url.hash) throw githubError('INVALID_PAGINATION');
    return url.pathname + url.search;
  }
  async function request(ctx, resource, { etag, purpose = 'activity_sync', accept = 'application/vnd.github+json' } = {}) {
    if (!resource.startsWith('/') || resource.startsWith('//')) throw githubError('INVALID_RESOURCE');
    const token = ctx.getToken ? await ctx.getToken() : ctx.token;
    const signal = AbortSignal.any([...(ctx.signal ? [ctx.signal] : []), AbortSignal.timeout(10_000)]);
    return budget.run({ key: credentialKey(token), purpose, authenticated: !!token, signal }, () => fetchImpl(origin + resource, {
      redirect: 'error', signal, headers: { Accept: accept, 'User-Agent': 'work-status-3d', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(etag ? { 'If-None-Match': etag } : {}) },
    }));
  }
  async function json(response) {
    if (!response.ok) { await response.body?.cancel(); throw githubError(response.status === 401 ? 'AUTH' : response.status === 404 ? 'NOT_FOUND' : response.status === 403 ? 'FORBIDDEN' : 'NETWORK', response.status === 401 ? 401 : 502); }
    // 응답 크기는 Content-Length 대신 실제 읽은 바이트로 제한한다.
    const reader = response.body?.getReader(); let size = 0; const chunks = [];
    if (!reader) throw githubError('NETWORK');
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw githubError('NETWORK'); chunks.push(Buffer.from(value)); } }
    catch (e) { await reader.cancel(); throw e; }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw githubError('NETWORK'); }
  }
  return { request, json, next };
}
