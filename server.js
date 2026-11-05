#!/usr/bin/env node
// 작업현황 서버: 빌드된 화면(dist), 데이터 파일, 로그인, 작업 지시 API. 의존성 없음.
// 127.0.0.1에서만 연다. 외부 노출(터널)은 이 코드의 몫이 아니다.
// 암호는 환경변수 DASH_PASSWORD에서만 읽고 어디에도 기록하지 않는다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateProjects, filePathOf } from "./src/shared/projects.js";
import { looksSecret } from "./src/shared/secret.js";
import { checkTarget, targetsOf, TO_VALUES, MAX_COMMAND_CHARS, addCommand, recent } from "./src/shared/inbox.js";

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
async function ghFetch(project, file, key, hit) {
  try {
    const u = `${GITHUB_API}/repos/${project.repo}/contents/${filePathOf(project, file).split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(project.branch || "main")}`;
    const r = await fetch(u, { headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "work-status-3d", "X-GitHub-Api-Version": "2022-11-28", ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(10_000) });
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
const PASSWORD = process.env.DASH_PASSWORD;
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_TTL_MS = 12 * 3600 * 1000;
const MAX_BODY = 4096;
const LOGIN_FAIL_LIMIT = 5, LOGIN_WINDOW_MS = 60_000;
const CMD_LIMIT = Number(process.env.CMD_RATE_LIMIT || 10), CMD_WINDOW_MS = 60_000;

if (!PASSWORD) { console.error("DASH_PASSWORD 환경변수가 없어 시작하지 않는다."); process.exit(1); }
const passDigest = crypto.createHash("sha256").update(PASSWORD).digest();

const nowKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, "+09:00");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".woff2": "font/woff2" };
const PROTECTED_DATA = new Set(["/status.json", "/board.json"]);

// ---- 세션: "<만료ms>.<HMAC>" 서명 쿠키
const sign = (exp) => crypto.createHmac("sha256", SESSION_SECRET).update(String(exp)).digest("base64url");
function makeCookie(secure) {
  const exp = Date.now() + SESSION_TTL_MS;
  return `sid=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? "; Secure" : ""}`;
}
function sessionOf(req) {
  const m = /(?:^|;\s*)sid=(\d+)\.([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const exp = Number(m[1]);
  const a = Buffer.from(m[2]), b = Buffer.from(sign(exp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || exp < Date.now()) return null;
  return m[1] + "." + m[2].slice(0, 8); // 속도 제한용 세션 키
}

// ---- 속도 제한 (메모리)
const loginFails = [];
const cmdTimes = new Map();
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
        if (fails.length >= LOGIN_FAIL_LIMIT) return send(res, 429, { code: "TOO_MANY", retryAfterSec: Math.max(1, Math.ceil((fails[0] + LOGIN_WINDOW_MS - Date.now()) / 1000)) });
        const body = await readJson(req);
        const given = crypto.createHash("sha256").update(String(body.password ?? "")).digest();
        if (!crypto.timingSafeEqual(given, passDigest)) { loginFails.push(Date.now()); return send(res, 401, { code: "BAD_PASSWORD" }); }
        return send(res, 200, { ok: true }, { "Set-Cookie": makeCookie(secure) });
      }
      if (pathname === "/api/logout" && req.method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      const sid = sessionOf(req);
      if (pathname === "/api/session" && req.method === "GET") return sid ? send(res, 200, { ok: true }) : send(res, 401, { code: "UNAUTHENTICATED" });
      if (pathname === "/api/command" && req.method === "POST") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const body = await readJson(req);
        const kind = body.kind === undefined ? "solo" : body.kind; // 생략하면 개인 지시
        const targets = currentTargets();
        const bad = checkTarget(kind, body.to, targets);
        if (bad) return send(res, 400, { code: bad });
        const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
        if (!text) return send(res, 400, { code: "EMPTY_TEXT" });
        if ([...text].length > MAX_COMMAND_CHARS) return send(res, 400, { code: "TEXT_TOO_LONG" });
        if (looksSecret(text)) return send(res, 400, { code: "SECRET_LIKE" });
        const times = recentOf(cmdTimes.get(sid) ?? cmdTimes.set(sid, []).get(sid), CMD_WINDOW_MS);
        if (times.length >= CMD_LIMIT) return send(res, 429, { code: "TOO_MANY" });
        times.push(Date.now());
        return send(res, 201, { command: addCommand(INBOX_FILE, { kind, to: body.to, text, at: nowKst(), targets }) });
      }
      if (pathname === "/api/commands" && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        return send(res, 200, { commands: recent(INBOX_FILE, 50) });
      }
      if (pathname === "/api/projects" && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        return send(res, 200, { projects: loadProjects().map((p) => ({ id: p.id, name: p.name, remote: Boolean(p.repo) })) });
      }
      const pm = /^\/api\/p\/([a-z][a-z0-9_-]{0,23})\/(status|board)\.json$/.exec(pathname);
      if (pm && req.method === "GET") {
        if (!sid) return send(res, 401, { code: "UNAUTHENTICATED" });
        const project = loadProjects().find((p) => p.id === pm[1]);
        if (!project) return send(res, 404, { code: "NO_PROJECT" });
        try { return send(res, 200, await projectFile(project, `${pm[2]}.json`), { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }); }
        catch (e) { return send(res, 502, { code: "UPSTREAM", status: e.upstream ?? 0 }); } // 원인(토큰·주소)은 응답에 싣지 않는다
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
