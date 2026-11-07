import { githubError } from '../github-budget.js';

const tokenOK = token => typeof token === 'string' && token.length >= 8 && token.length <= 2048 && /^[\x21-\x7e]+$/.test(token);
export function createDeviceFlow({ clientId = '', base = 'https://github.com', fetchImpl = fetch } = {}) {
  const origin = new URL(base).origin;
  const configured = typeof clientId === 'string' && /^[\w.-]{1,200}$/.test(clientId);
  async function post(path, data, signal) {
    if (!configured) throw githubError('DEVICE_FLOW_UNAVAILABLE', 503);
    const r = await fetchImpl(origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]), headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...data }) });
    const reader = r.body?.getReader(); if (!reader) throw githubError('OAUTH_UPSTREAM');
    const chunks = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 16_384) throw githubError('OAUTH_UPSTREAM'); chunks.push(Buffer.from(value)); } }
    catch (e) { await reader.cancel(); throw e; }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw githubError('OAUTH_UPSTREAM'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (!r.ok && !body.error)) throw githubError('OAUTH_UPSTREAM');
    return body;
  }
  function tokens(body) {
    if (!tokenOK(body.access_token) || (body.refresh_token !== undefined && !tokenOK(body.refresh_token))) throw githubError('OAUTH_UPSTREAM');
    const expiresIn = body.expires_in ?? 8 * 3600, refreshExpiresIn = body.refresh_token_expires_in ?? 6 * 30 * 86400;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 8 * 3600 || !Number.isFinite(refreshExpiresIn) || refreshExpiresIn <= 0 || refreshExpiresIn > 366 * 86400) throw githubError('OAUTH_UPSTREAM');
    return { token: body.access_token, refreshToken: body.refresh_token, expiresIn, refreshExpiresIn };
  }
  const errorOf = error => githubError(({ access_denied: 'DEVICE_DENIED', expired_token: 'DEVICE_EXPIRED', bad_verification_code: 'DEVICE_EXPIRED', incorrect_client_credentials: 'DEVICE_FLOW_UNAVAILABLE', device_flow_disabled: 'DEVICE_FLOW_UNAVAILABLE' })[error] || 'OAUTH_UPSTREAM', ['access_denied'].includes(error) ? 403 : ['expired_token', 'bad_verification_code'].includes(error) ? 410 : 502);
  return {
    async start(signal) {
      const body = await post('/login/device/code', {}, signal); if (body.error) throw errorOf(body.error);
      if (typeof body.device_code !== 'string' || body.device_code.length > 2048 || !body.device_code || typeof body.user_code !== 'string' || !/^[A-Z0-9-]{4,32}$/.test(body.user_code) || body.verification_uri !== 'https://github.com/login/device' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 3600) throw githubError('OAUTH_UPSTREAM');
      const interval = body.interval ?? 5;
      if (!Number.isFinite(interval) || interval < 1 || interval > 60) throw githubError('OAUTH_UPSTREAM');
      return { deviceCode: body.device_code, userCode: body.user_code, verificationUri: body.verification_uri, expiresIn: body.expires_in, interval };
    },
    async poll(deviceCode, signal) {
      const body = await post('/login/oauth/access_token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, signal);
      if (body.error === 'authorization_pending') return { pending: true };
      if (body.error === 'slow_down') return { pending: true, slowDown: true };
      if (body.error) throw errorOf(body.error);
      return tokens(body);
    },
    async refresh(refreshToken, signal) {
      const body = await post('/login/oauth/access_token', { refresh_token: refreshToken, grant_type: 'refresh_token' }, signal);
      if (body.error) throw githubError('AUTH', 401);
      return tokens(body);
    },
  };
}
