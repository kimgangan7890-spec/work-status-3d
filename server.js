#!/usr/bin/env node
// 작업현황 서버: 빌드된 화면(dist), 데이터 파일, 로그인, 작업 지시 API. 의존성 없음.
// 127.0.0.1에서만 연다. 외부 노출(터널)은 이 코드의 몫이 아니다.
// 암호는 환경변수 DASH_PASSWORD에서만 읽고 어디에도 기록하지 않는다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TOPIC, DIR_CANDIDATES } from "./src/shared/discover.js";
import { validateProjects, filePathOf } from "./src/shared/projects.js";
import { validateStatus, validateBoard } from "./src/shared/validate.js";
import { looksSecret } from "./src/shared/secret.js";
import { checkTarget, targetsOf, TO_VALUES, MAX_COMMAND_CHARS, addCommand, recent } from "./src/shared/inbox.js";

import { createEncryptedStore, parseSecretKey } from './src/server/auth/encrypted-store.js';
import { createDeviceFlow } from './src/server/auth/device-flow.js';
import { createAuthService } from './src/server/auth/service.js';
import { createGithubBudget } from './src/server/github-budget.js';
import { createGithubClient } from './src/server/github-client.js';
import { createAgentSource } from './src/server/agent-source.js';
import { createActivityService } from './src/server/activity.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 5180);
const DIST = process.env.DIST_DIR || path.join(ROOT, "dist");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "public");
// 지시 대상(에이전트·팀 id)은 그때그때 status.json에서 읽는다. 못 읽으면 처음 세 명(chief·claude·gpt)만 받는다.
function currentTargets() {
  try { return targetsOf(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "status.json"), "utf8"))) ?? { agentIds: TO_VALUES, teamIds: ["main"] }; } catch { return { agentIds: TO_VALUES, teamIds: ["main"] }; }
}
const INBOX_FILE = process.env.INBOX_FILE || path.join(ROOT, "data", "inbox.json");
// 프로젝트 목록(DATA_DIR/projects.json). 없으면 단일 프로젝트(기존 동작). 비공개 저장소는 GITHUB_TOKEN(읽기 전용 토큰)으로만 읽는다.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_API = process.env.GITHUB_API_BASE || "https://api.github.com";
// 토큰이 없으면 GitHub API 한도가 시간당 60회라서 캐시를 길게 잡는다(토큰이 있으면 시간당 5000회). 직전 성공본은 STALE_MS까지만 대신 내보낸다.
const GH_TTL_MS = Number(process.env.GITHUB_CACHE_MS || (GITHUB_TOKEN ? 10_000 : 120_000)), GH_MAX_BYTES = 1_000_000, GH_STALE_MS = 10 * 60_000;
const GH_ADHOC_MAX = 32; // 화면에서 직접 입력한 저장소(/api/gh)의 캐시 항목 수 한도
const ghInflight = new Map(); // 같은 파일을 동시에 요청하면 GitHub 호출 하나로 합친다
const ghCache = new Map(); // "<id>/<file>" -> {at, body}
function loadProjects() {
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "projects.json"), "utf8"));
    return validateProjects(obj).length ? [] : obj.projects;
  } catch { return []; }
}
// 이 프로젝트의 파일 하나를 읽는다. 토큰은 서버 안에서만 쓰고 응답·로그 어디에도 싣지 않는다. 실패하면 직전 성공본(있으면)을 돌려준다.
async function projectFile(project, file) {
  if (!project.repo) return fs.promises.readFile(path.join(DATA_DIR, file));
  const key = `${project.id}|${project.repo}|${project.branch || "main"}|${project.dir || ""}|${file}`, hit = ghCache.get(key);
  if (hit && Date.now() - hit.at < GH_TTL_MS) return hit.body;
  if (ghInflight.has(key)) return ghInflight.get(key);
  const job = ghFetch(project, file, key, hit).finally(() => ghInflight.delete(key));
  ghInflight.set(key, job);
  return job;
}
// GitHub API 요청 하나. 토큰이 있을 때만 Authorization을 붙인다(중계·자동 찾기가 같은 머리글을 쓴다).
function ghGet(pathAndQuery, accept = "application/vnd.github+json", purpose = "relay") {
  return githubClient.request({ token: GITHUB_TOKEN }, pathAndQuery, { accept, purpose });
}
async function ghFetch(project, file, key, hit) {
  try {
    const r = await ghGet(`/repos/${project.repo}/contents/${filePathOf(project, file).split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(project.branch || "main")}`, "application/vnd.github.raw+json");
    if (!r.ok) throw Object.assign(new Error("upstream"), { upstream: r.status });
    if (Number(r.headers.get("content-length") || 0) > GH_MAX_BYTES) throw Object.assign(new Error("too large"), { upstream: 413 });
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > GH_MAX_BYTES) throw Object.assign(new Error("too large"), { upstream: 413 });
    ghCache.set(key, { at: Date.now(), body });
    return body;
  } catch (e) {
    if (hit && Date.now() - hit.at < GH_STALE_MS) return hit.body; // 오래된 성공본은 내보내지 않는다(조용히 멈춘 화면 방지)
    throw e;
  }
}
// 자동 찾기: 토큰 계정이 볼 수 있는 저장소 중 토픽(work-status-3d)이 붙은 것을 찾고, 형식이 맞는 status.json이 있는 폴더를 알아낸다.
// 결과는 5분 캐시, 실패도 1분 캐시하고 동시 요청은 하나로 합친다(한 번에 GitHub 호출이 최대 1+12×4회라 연타로 한도를 쓰지 않게).
let discoverCache = null, discoverJob = null;
async function discoverRepos() {
  if (discoverCache && Date.now() - discoverCache.at < (discoverCache.error ? 60_000 : 300_000)) {
    if (discoverCache.error) throw discoverCache.error;
    return discoverCache.items;
  }
  if (discoverJob) return discoverJob;
  discoverJob = discoverOnce().then(
    (items) => { discoverCache = { at: Date.now(), items }; return items; },
    (error) => { discoverCache = { at: Date.now(), error }; throw error; },
  ).finally(() => { discoverJob = null; });
  return discoverJob;
}
async function discoverOnce() {
  const r = await ghGet("/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member", "application/vnd.github+json", "discovery");
  if (!r.ok) throw Object.assign(new Error("upstream"), { upstream: r.status });
  const list = await r.json();
  const repos = (Array.isArray(list) ? list : []).filter((x) => Array.isArray(x?.topics) && x.topics.includes(TOPIC) && typeof x.full_name === "string").slice(0, 12);
  const items = [];
  for (const x of repos) {
    const branch = typeof x.default_branch === "string" ? x.default_branch : "main";
    for (const dir of DIR_CANDIDATES) {
      const p = { id: "adhoc", name: "x", repo: x.full_name, branch, ...(dir ? { dir } : {}) };
      if (validateProjects({ projects: [p] }).length) break; // GitHub가 준 이름·브랜치도 projects.json 규칙으로 검사한 뒤에만 주소에 넣는다
      try {
        const f = await ghGet(`/repos/${x.full_name}/contents/${filePathOf(p, "status.json")}?ref=${encodeURIComponent(branch)}`, "application/vnd.github.raw+json", "discovery");
        if (!f.ok) continue;
        const text = await f.text();
        if (text.length <= GH_MAX_BYTES && !validateStatus(JSON.parse(text)).length) { items.push({ repo: x.full_name, branch, dir: dir || undefined, private: Boolean(x.private) }); break; }
      } catch (e) { if (e.status === 429) throw e; /* 다음 폴더 */ }
    }
  }
  return items;
}
const PASSWORD = process.env.DASH_PASSWORD;
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_TTL_MS = 12 * 3600 * 1000;
const MAX_BODY = 4096;
const LOGIN_FAIL_LIMIT = 5, LOGIN_WINDOW_MS = 60_000;
// /api/gh/* 호출 제한(세션별 고정 창). 캐시 적중도 한 번으로 센다. 0 이하로 두면 끈다.
// 숫자가 아닌 값(오타 등)은 제한이 조용히 꺼지지 않게 기본값으로 둔다. 창 길이는 양수만 받는다.
const envNum = (v, d, ok) => { const n = Number(v); return v !== undefined && String(v).trim() !== "" && Number.isFinite(n) && ok(n) ? n : d; };
const GH_RATE_LIMIT = envNum(process.env.GH_RATE_LIMIT, 60, () => true), GH_RATE_WINDOW_MS = envNum(process.env.GH_RATE_WINDOW_MS, 60_000, (n) => n > 0);
// 실제 GitHub 호출 예산. 캐시 적중과 동시 요청 합치기는 추가로 세지 않는다.
const GH_UPSTREAM_LIMIT = envNum(process.env.GITHUB_UPSTREAM_LIMIT, undefined, (n) => Number.isInteger(n) && n > 0);
const githubBudget = createGithubBudget({ limit: GH_UPSTREAM_LIMIT });
const githubClient = createGithubClient({ base: GITHUB_API, budget: githubBudget });
let authKey = null;
try { authKey = parseSecretKey(process.env.WORK3D_SECRET_KEY); } catch { /* 연결 기능만 비활성화 */ }
const githubAuth = createAuthService({ store: createEncryptedStore({ file: process.env.GITHUB_AUTH_FILE || path.join(ROOT, 'data', 'github-auth.enc'), key: authKey }), client: githubClient, deviceFlow: createDeviceFlow({ clientId: process.env.GITHUB_APP_CLIENT_ID, base: process.env.GITHUB_OAUTH_BASE || 'https://github.com' }) });
const githubActivity = createActivityService({ auth: githubAuth, client: githubClient, manualProjects: loadProjects, loadAgentStatus: createAgentSource({ dataDir: DATA_DIR, projects: loadProjects }) });
const CMD_LIMIT = envNum(process.env.CMD_RATE_LIMIT, 10, (n) => n > 0), CMD_WINDOW_MS = 60_000;
// 로그인할 때마다 새 세션이 생기므로 세션별 한도만으로는 우회된다. 모든 세션을 합친 한도(세션 한도의 이 배수)를 함께 둔다.
const ALL_SESSIONS_FACTOR = 5;

if (!PASSWORD) { console.error("DASH_PASSWORD 환경변수가 없어 시작하지 않는다."); process.exit(1); }
const passDigest = crypto.createHash("sha256").update(PASSWORD).digest();

const nowKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, "+09:00");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".woff2": "font/woff2" };
const PROTECTED_DATA = new Set(["/status.json", "/board.json"]);

// ---- 세션: 로그인마다 난수를 넣어 같은 시각의 세션도 분리한다.
const revokedSessions = new Map();
const sign = value => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
function makeCookie(secure) {
  const id = `${Date.now() + SESSION_TTL_MS}.${crypto.randomBytes(16).toString('hex')}`;
  return `sid=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
function sessionOf(req) {
  for (const [sid, exp] of revokedSessions) if (exp <= Date.now()) revokedSessions.delete(sid);
  const m = /(?:^|;\s*)sid=(\d+\.[a-f0-9]{32})\.([A-Za-z0-9_-]+)(?:;|$)/.exec(req.headers.cookie || '');
  if (!m || Number(m[1].split('.')[0]) <= Date.now() || revokedSessions.has(m[1])) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}

// ---- 속도 제한 (메모리)
const loginFails = [];
const cmdTimes = new Map(); const cmdAll = [];
const ghRate = new Map(); let ghRateSweep = 0; // 키 -> {start, count}
/** /api/gh/* 호출을 센다. 한도를 넘으면 다시 시도할 수 있을 때까지 남은 초를, 아니면 0을 돌려준다. 키는 세션 우선, 없으면 접속 IP. */
function ghRateCheck(req, sid, now = Date.now()) {
  if (!(GH_RATE_LIMIT > 0)) return 0;
  if (now - ghRateSweep >= GH_RATE_WINDOW_MS) { // 지난 창의 키는 버려 메모리가 늘지 않게 한다
    ghRateSweep = now;
    for (const [k, v] of ghRate) if (now - v.start >= GH_RATE_WINDOW_MS) ghRate.delete(k);
  }
  const hit = (key, limit) => {
    let e = ghRate.get(key);
    if (!e || now - e.start >= GH_RATE_WINDOW_MS) { e = { start: now, count: 0 }; ghRate.set(key, e); }
    return e.count >= limit ? Math.max(1, Math.ceil((e.start + GH_RATE_WINDOW_MS - now) / 1000)) : 0;
  };
  const key = sid ? "s:" + sid : "ip:" + (req.socket?.remoteAddress ?? "");
  const wait = Math.max(hit(key, GH_RATE_LIMIT), hit("all", GH_RATE_LIMIT * ALL_SESSIONS_FACTOR));
  if (wait) return wait;
  ghRate.get(key).count++; ghRate.get("all").count++;
  return 0;
}
function recentOf(list, windowMs) { const t = Date.now() - windowMs; while (list.length && list[0] < t) list.shift(); return list; }

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...(isJson ? { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } : {}), ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) return reject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject({ status: 413, code: "PAYLOAD_TOO_LARGE" }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject({ status: 400, code: "BAD_JSON" }); } });
    req.on("error", () => reject({ status: 400, code: "BAD_REQUEST" }));
  });
}

async function readGithubBody(req) {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw { status: 400, code: 'BAD_JSON' };
  return body;
}

// POST는 같은 출처에서 온 것만 받는다. Origin이 없거나 Host와 다르면 거절.
function sameOrigin(req) {
  const origin = req.headers.origin, host = req.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { code: "NOT_FOUND" });
    send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": cache });
  });
}

function safeJoin(base, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes("\0")) return null;
  const full = path.join(base, path.normalize(p));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const secure = req.headers["x-forwarded-proto"] === "https";
  try {
    if (pathname.startsWith("/api/")) {
      if (req.method === "POST" && !sameOrigin(req)) return send(res, 403, { code: "BAD_ORIGIN" });
      if (pathname === "/api/login" && req.method === "POST") {
        const fails = recentOf(loginFails, LOGIN_WINDOW_MS);
        if (fails.length >= LOGIN_FAIL_LIMIT) { const wait = Math.max(1, Math.ceil((fails[0] + LOGIN_WINDOW_MS - Date.now()) / 1000)); return send(res, 429, { code: "TOO_MANY", retryAfterSec: wait }, { "Retry-After": String(wait) }); }
        const body = await readJson(req);
        const given = crypto.createHash("sha256").update(String(body.password ?? "")).digest();
        if (!crypto.timingSafeEqual(given, passDigest)) { loginFails.push(Date.now()); return send(res, 401, { code: "BAD_PASSWORD" }); }
        return send(res, 200, { ok: true }, { "Set-Cookie": makeCookie(secure) });
      }
      if (pathname === "/api/logout" && req.method === "POST") {
        const sid = sessionOf(req);
        if (sid) { revokedSessions.set(sid, Number(sid.split('.')[0])); try { githubAuth.disconnect(sid); } catch { /* 비활성화된 연결 */ } }
        return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      }
      const sid = sessionOf(req);
      if (pathname === "/api/session" && req.method === "GET") return sid ? send(res, 200, { ok: true }) : send(res, 401, { code: "UNAUTHENTICATED" });
      if (pathname.startsWith('/api/github/')) {
        if (!sid) return send(res, 401, { code: 'UNAUTHENTICATED' });
        const wait = ghRateCheck(req, sid);
        if (wait) return send(res, 429, { code: 'TOO_MANY', retryAfterSec: wait }, { 'Retry-After': String(wait) });
        try {
          if (pathname === '/api/github/connection' && req.method === 'GET') return send(res, 200, await githubAuth.connection(sid));
          if (pathname === '/api/github/device/start' && req.method === 'POST') { await readGithubBody(req); return send(res, 200, await githubAuth.startDevice(sid)); }
          if (pathname === '/api/github/device/poll' && req.method === 'POST') {
            await readGithubBody(req); const result = await githubAuth.pollDevice(sid);
            return send(res, result.status === 'pending' ? 202 : 200, result, result.retryAfterSec ? { 'Retry-After': String(result.retryAfterSec) } : {});
          }
          if (pathname === '/api/github/connect' && req.method === 'POST') return send(res, 200, await githubAuth.connect(sid, (await readGithubBody(req)).token));
          if (pathname === '/api/github/disconnect' && req.method === 'POST') { githubAuth.disconnect(sid); return send(res, 200, { ok: true }); }
          if (pathname === '/api/github/repos' && req.method === 'GET') return send(res, 200, { repos: await githubAuth.repos(sid) });
          if (pathname === '/api/github/projects' && req.method === 'GET') return send(res, 200, { projects: githubActivity.projects(sid) });
          if (pathname === '/api/github/projects' && req.method === 'POST') return send(res, 201, { project: await githubActivity.select(sid, await readGithubBody(req)) });
          if (pathname === '/api/github/projects/remove' && req.method === 'POST') { githubActivity.remove(sid, (await readGithubBody(req)).projectId); return send(res, 200, { ok: true }); }
          if (pathname === '/api/github/events' && req.method === 'GET') return send(res, 200, { events: githubActivity.events(sid, url.searchParams.get('since')) });
          if (pathname === '/api/github/metrics' && req.method === 'GET') return send(res, 200, { metrics: githubActivity.metrics(sid) });
          if (pathname === '/api/github/sync' && req.method === 'POST') return send(res, 200, { metrics: await githubActivity.sync(sid), scopesOk: githubAuth.info(sid).scopesOk });
          return send(res, 404, { code: 'NOT_FOUND' });
        } catch (e) {
          const allowed = ['DEVICE_FLOW_UNAVAILABLE', 'DEVICE_DENIED', 'DEVICE_EXPIRED', 'NO_DEVICE_FLOW', 'BAD_SINCE', 'OAUTH_UPSTREAM', 'CONNECTION_DISABLED', 'CONNECTION_STORAGE_ERROR', 'NOT_CONNECTED', 'INVALID_TOKEN', 'AUTH', 'RATE_LIMITED', 'BUDGET', 'ABORTED', 'REPO_LIST_LIMIT', 'INVALID_REPO', 'INVALID_PROJECT', 'DUPLICATE_REPO', 'DUPLICATE_PROJECT', 'PROJECT_LIMIT', 'NOT_FOUND', 'BAD_JSON', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE'];
          return send(res, e.status || 502, { code: allowed.includes(e.code) ? e.code : 'UPSTREAM' }, e.retryAfterSec ? { 'Retry-After': String(e.retryAfterSec) } : {});
        }
      }
      if (pathname === "/api/command" && req.method === "POST") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const body = await readJson(req);
        const kind = body.kind === undefined ? "solo" : body.kind; // 생략하면 개인 지시
        let project;
        if (body.project !== undefined) { // 여러 프로젝트: 지시를 그 프로젝트의 대상으로 검사하고 기록한다
          project = loadProjects().find((p) => p.id === body.project);
          if (!project) return send(res, 400, { code: "INVALID_PROJECT" });
        }
        let targets;
        if (project) { try { targets = targetsOf(JSON.parse((await projectFile(project, "status.json")).toString("utf8"))) ?? undefined; } catch { return send(res, 502, { code: "UPSTREAM" }); } }
        targets ??= currentTargets();
        const bad = checkTarget(kind, body.to, targets);
        if (bad) return send(res, 400, { code: bad });
        const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
        if (!text) return send(res, 400, { code: "EMPTY_TEXT" });
        if ([...text].length > MAX_COMMAND_CHARS) return send(res, 400, { code: "TEXT_TOO_LONG" });
        if (looksSecret(text)) return send(res, 400, { code: "SECRET_LIKE" });
        for (const [k, list] of cmdTimes) if (k !== sid && !recentOf(list, CMD_WINDOW_MS).length) cmdTimes.delete(k); // 지난 세션의 빈 기록은 버린다
        const times = recentOf(cmdTimes.get(sid) ?? cmdTimes.set(sid, []).get(sid), CMD_WINDOW_MS);
        const allTimes = recentOf(cmdAll, CMD_WINDOW_MS);
        const hot = times.length >= CMD_LIMIT ? times : allTimes.length >= CMD_LIMIT * ALL_SESSIONS_FACTOR ? allTimes : null;
        if (hot) { const wait = Math.max(1, Math.ceil((hot[0] + CMD_WINDOW_MS - Date.now()) / 1000)); return send(res, 429, { code: "TOO_MANY", retryAfterSec: wait }, { "Retry-After": String(wait) }); }
        times.push(Date.now()); allTimes.push(Date.now());
        return send(res, 201, { command: addCommand(INBOX_FILE, { kind, to: body.to, text, at: nowKst(), targets, project: project?.id }) });
      }
      if (pathname === "/api/commands" && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const only = url.searchParams.get("project"); // 지정하면 그 프로젝트의 지시만(없으면 전체)
        return send(res, 200, { commands: recent(INBOX_FILE, only ? 200 : 50).filter((c) => !only || c.project === only).slice(0, 50) });
      }
      if (pathname === "/api/projects" && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        return send(res, 200, { projects: loadProjects().map((p) => ({ id: p.id, name: p.name, remote: Boolean(p.repo) })) });
      }
      if (pathname.startsWith("/api/gh/") && req.method === "GET" && sid) { // GitHub 중계(discover·status·board) 공통 호출 제한. 응답에는 토큰·원인을 싣지 않는다.
        const wait = ghRateCheck(req, sid);
        if (wait) return send(res, 429, { code: "TOO_MANY", retryAfterSec: wait }, { "Retry-After": String(wait) });
      }
      if (pathname === "/api/gh/discover" && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        if (!GITHUB_TOKEN) return send(res, 400, { code: "NO_TOKEN" });
        try { return send(res, 200, { topic: TOPIC, projects: await discoverRepos() }); }
        catch (e) { if (e.status === 429) return send(res, 429, { code: "TOO_MANY", retryAfterSec: e.retryAfterSec }, { "Retry-After": String(e.retryAfterSec) }); return send(res, 502, { code: "UPSTREAM", status: e.upstream ?? 0 }); }
      }
      const gm = /^\/api\/gh\/(status|board)\.json$/.exec(pathname);
      if (gm && req.method === "GET") { // 화면에서 직접 입력한 저장소(로그인한 사용자만). 형식은 projects.json과 같은 규칙으로 검사한다.
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const p = { id: "adhoc", name: "x", repo: url.searchParams.get("repo") ?? "", ...(url.searchParams.get("branch") ? { branch: url.searchParams.get("branch") } : {}), ...(url.searchParams.get("dir") ? { dir: url.searchParams.get("dir") } : {}) };
        if (validateProjects({ projects: [p] }).length) return send(res, 400, { code: "INVALID_REPO" });
        // 입력이 바뀔 때마다 캐시 키가 새로 생기니 직접 입력분은 최근 GH_ADHOC_MAX개만 남긴다(메모리 한도).
        const adhocKeys = [...ghCache.keys()].filter((k) => k.startsWith("adhoc|"));
        for (const k of adhocKeys.slice(0, Math.max(0, adhocKeys.length - GH_ADHOC_MAX))) ghCache.delete(k);
        let body;
        try { body = await projectFile(p, `${gm[1]}.json`); }
        catch (e) { if (e.status === 429) return send(res, 429, { code: "TOO_MANY", retryAfterSec: e.retryAfterSec }, { "Retry-After": String(e.retryAfterSec) }); return send(res, 502, { code: "UPSTREAM", status: e.upstream ?? 0 }); }
        // 토큰이 읽을 수 있는 아무 저장소의 같은 이름 파일이 그대로 나가지 않게, 형식을 통과한 것만 내보낸다.
        let obj; try { obj = JSON.parse(body.toString("utf8")); } catch { obj = undefined; }
        if (obj === undefined || (gm[1] === "status" ? validateStatus(obj) : validateBoard(obj)).length) return send(res, 422, { code: "INVALID_DATA" });
        return send(res, 200, body, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      }
      const pm = /^\/api\/p\/([a-z][a-z0-9_-]{0,23})\/(status|board)\.json$/.exec(pathname);
      if (pm && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const project = loadProjects().find((p) => p.id === pm[1]);
        if (!project) return send(res, 404, { code: "NO_PROJECT" });
        try { return send(res, 200, await projectFile(project, `${pm[2]}.json`), { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }); }
        catch (e) { if (e.status === 429) return send(res, 429, { code: "TOO_MANY", retryAfterSec: e.retryAfterSec }, { "Retry-After": String(e.retryAfterSec) }); return send(res, 502, { code: "UPSTREAM", status: e.upstream ?? 0 }); } // 원인(토큰·주소)은 응답에 싣지 않는다
      }
      return send(res, 404, { code: "NOT_FOUND" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { code: "METHOD_NOT_ALLOWED" });
    if (PROTECTED_DATA.has(pathname)) { // 데이터 파일은 로그인 후에만, 항상 DATA_DIR의 최신본
      if (!sessionOf(req)) return send(res, 401, { code: "UNAUTHENTICATED" });
      return serveFile(res, path.join(DATA_DIR, pathname), "no-store");
    }
    if (pathname === "/favicon.ico") { res.writeHead(204, { ...SECURITY_HEADERS, "Cache-Control": "public, max-age=86400" }); return res.end(); } // 아이콘 없음: 404 대신 빈 응답
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = safeJoin(DIST, rel);
    if (!file || /(^|\/)(\.|status\.json$|board\.json$|projects\.json$)/.test(rel.replace(/^\//, ""))) return send(res, 404, { code: "NOT_FOUND" });
    return serveFile(res, file, rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  } catch (e) {
    if (e && e.status) return send(res, e.status, { code: e.code });
    console.error("서버 오류:", e?.message);
    return send(res, 500, { code: "INTERNAL" });
  }
});

server.listen(PORT, HOST, () => console.log(`작업현황 서버: http://${HOST}:${server.address().port} (이 컴퓨터에서만 열림)`));
