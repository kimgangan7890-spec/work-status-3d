import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateProjects, sourcesOf, summarize, adhocSourcesOf } from "../src/shared/projects.js";
import { createStore } from "../src/scene/store.js";
import { seedStatus, seedBoard } from "../src/shared/seed.js";

const P = (o = {}) => ({ projects: [{ id: "web", name: "웹", repo: "own/repo", ...o }] });

describe("projects 검증", () => {
  it("올바른 목록은 통과한다", () => {
    expect(validateProjects(P())).toEqual([]);
    expect(validateProjects(P({ branch: "main", dir: "status/live", private: true }))).toEqual([]);
    expect(validateProjects({ projects: [{ id: "local", name: "이 컴퓨터" }] })).toEqual([]);
  });
  it("잘못된 입력을 거절한다", () => {
    for (const bad of [null, {}, { projects: [] }, P({ repo: "a b/c" }), P({ repo: "../x" }), P({ dir: "../etc" }), P({ dir: "/abs" }), P({ branch: "a..b" }), P({ private: "yes" }), P({ extra: 1 }), { projects: [{ id: "A", name: "x" }] }, { projects: [{ id: "a", name: "" }] }, { projects: [{ id: "a", name: "x", dir: "d" }] }]) {
      expect(validateProjects(bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(validateProjects({ projects: [{ id: "a", name: "x" }, { id: "a", name: "y" }] })[0]).toMatch(/중복/);
    expect(validateProjects({ projects: Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, name: "x" })) })[0]).toMatch(/최대/);
  });
});

describe("sourcesOf", () => {
  it("repo가 없으면 같은 곳의 파일", () => expect(sourcesOf({ id: "a" }, { base: "./" }).url).toBe("./status.json"));
  it("공개 저장소는 raw 주소(토큰 없음)", () => {
    const s = sourcesOf({ id: "web", repo: "own/repo", branch: "dev", dir: "status" });
    expect(s.url).toBe("https://raw.githubusercontent.com/own/repo/dev/status/status.json");
    expect(s.boardUrl).toBe("https://raw.githubusercontent.com/own/repo/dev/status/board.json");
  });
  it("비공개·서버 모드는 서버 중계 주소", () => {
    expect(sourcesOf({ id: "web", repo: "own/repo", private: true }).url).toBe("/api/p/web/status.json");
    expect(sourcesOf({ id: "web", repo: "own/repo" }, { viaServer: true }).boardUrl).toBe("/api/p/web/board.json");
  });
  it("요약", () => {
    const s = seedStatus(); expect(summarize(s)).toMatchObject({ agents: s.agents.length, project: s.meta.project });
  });
});

describe("store.setSource", () => {
  it("프로젝트를 바꾸면 상태를 비우고 이전 주소의 늦은 응답을 버린다", async () => {
    const a = seedStatus(); a.meta.project = "A"; const b = seedStatus(); b.meta.project = "B";
    let release; const slowA = new Promise((r) => (release = r));
    const fetchFn = async (u) => {
      if (u.startsWith("a")) { await slowA; return { ok: true, status: 200, json: async () => structuredClone(a) }; }
      return { ok: true, status: 200, json: async () => structuredClone(u.startsWith("b-board") ? seedBoard() : b) };
    };
    const store = createStore({ url: "a", boardUrl: "a-board", fetchFn, intervalMs: 1e9, boardIntervalMs: 1e9 });
    const seen = []; store.on("state", ({ state }) => seen.push(state.meta.project));
    const resets = []; store.on("reset", (r) => resets.push(r.url));
    const pending = store.poll();
    store.setSource({ url: "b", boardUrl: "b-board" });
    expect(store.state).toBeNull();
    release(); await pending; await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(["B"]);
    expect(store.state.meta.project).toBe("B");
    expect(resets).toEqual(["b"]);
    store.stop();
  });
});

// ---- 서버 중계: 가짜 GitHub API
let proc, fake, dir;
afterEach(() => { proc?.kill(); fake?.close(); });
async function startServer({ token = "tok-SECRET-123", projects, env: extraEnv = {} }) {
  const hits = [];
  fake = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization, accept: req.headers.accept });
    if (req.url.includes("/repos/own/priv/")) {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(404); return res.end("{}"); }
      res.writeHead(200); return res.end(JSON.stringify(req.url.includes("board.json") ? seedBoard() : seedStatus()));
    }
    if (req.url.includes("/repos/own/junk/")) { res.writeHead(200); return res.end(JSON.stringify({ secret: "not-a-status-file" })); }
    res.writeHead(404); res.end("{}");
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-prj-"));
  fs.mkdirSync(path.join(dir, "dist")); fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "dist/index.html"), "ok");
  fs.writeFileSync(path.join(dir, "dist/projects.json"), "{}");
  fs.writeFileSync(path.join(dir, "data/status.json"), JSON.stringify(seedStatus()));
  fs.writeFileSync(path.join(dir, "data/board.json"), JSON.stringify(seedBoard()));
  fs.writeFileSync(path.join(dir, "data/projects.json"), JSON.stringify(projects));
  const env = { ...process.env, PORT: "0", DASH_PASSWORD: "pw-x-1234", GITHUB_TOKEN: token, GITHUB_API_BASE: `http://127.0.0.1:${fake.address().port}`, GITHUB_CACHE_MS: "0", DIST_DIR: path.join(dir, "dist"), DATA_DIR: path.join(dir, "data"), INBOX_FILE: path.join(dir, "inbox.json"), ...extraEnv };
  proc = spawn("node", [path.resolve("server.js")], { env });
  let out = ""; proc.stdout.on("data", (d) => (out += d)); proc.stderr.on("data", (d) => (out += d));
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("timeout")), 5000); proc.stdout.on("data", () => { if (/127\.0\.0\.1:\d+/.test(out)) { clearTimeout(t); resolve(); } }); });
  const base = `http://127.0.0.1:${/127\.0\.0\.1:(\d+)/.exec(out)[1]}`;
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password: "pw-x-1234" }) });
  return { base, cookie: r.headers.get("set-cookie").split(";")[0], hits, token };
}

describe("서버 프로젝트 중계", () => {
  const projects = { projects: [{ id: "priv", name: "비공개", repo: "own/priv", dir: "st", private: true }, { id: "here", name: "여기" }, { id: "gone", name: "없음", repo: "own/none" }] };
  it("로그인 없이는 목록·중계 모두 401", async () => {
    const s = await startServer({ projects });
    expect((await fetch(s.base + "/api/projects")).status).toBe(401);
    expect((await fetch(s.base + "/api/p/priv/status.json")).status).toBe(401);
  });
  it("실제 GitHub 호출 예산을 등록 프로젝트와 직접 입력이 공유한다", async () => {
    const s = await startServer({ projects, env: { GITHUB_UPSTREAM_LIMIT: "1" } });
    const get = (p) => fetch(s.base + p, { headers: { Cookie: s.cookie } });
    expect((await get("/api/gh/status.json?repo=own/priv")).status).toBe(200);
    const r = await get("/api/p/priv/board.json");
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body.code).toBe("TOO_MANY"); expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(r.headers.get("retry-after")).toBe(String(body.retryAfterSec));
    expect(JSON.stringify(body)).not.toContain(s.token); expect(s.hits).toHaveLength(1);
  });
  it("목록에는 저장소 주소·토큰이 없다", async () => {
    const s = await startServer({ projects });
    const body = await (await fetch(s.base + "/api/projects", { headers: { Cookie: s.cookie } })).text();
    expect(JSON.parse(body).projects.map((p) => p.id)).toEqual(["priv", "here", "gone"]);
    expect(body).not.toContain("own/priv"); expect(body).not.toContain(s.token);
  });
  it("비공개 저장소는 토큰으로 읽고, 응답에 토큰이 없다", async () => {
    const s = await startServer({ projects });
    const r = await fetch(s.base + "/api/p/priv/status.json", { headers: { Cookie: s.cookie } });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text).meta.project).toBeTruthy();
    expect(text).not.toContain(s.token);
    expect(s.hits[0].url).toContain("/repos/own/priv/contents/st/status.json?ref=main");
    expect(s.hits[0].auth).toBe(`Bearer ${s.token}`);
  });
  it("저장소 쪽 오류는 502이고 원인을 싣지 않는다 / repo 없는 프로젝트는 로컬 파일 / 모르는 id는 404", async () => {
    const s = await startServer({ projects });
    const bad = await fetch(s.base + "/api/p/gone/status.json", { headers: { Cookie: s.cookie } });
    expect(bad.status).toBe(502); expect(await bad.text()).not.toContain(s.token);
    expect((await fetch(s.base + "/api/p/here/board.json", { headers: { Cookie: s.cookie } })).status).toBe(200);
    expect((await fetch(s.base + "/api/p/nope/status.json", { headers: { Cookie: s.cookie } })).status).toBe(404);
  });
  it("지시는 프로젝트별로 검사·기록되고 목록도 프로젝트별로 거른다", async () => {
    const s = await startServer({ projects });
    const send = (body) => fetch(s.base + "/api/command", { method: "POST", headers: { "Content-Type": "application/json", Origin: s.base, Cookie: s.cookie }, body: JSON.stringify(body) });
    const ok = await send({ kind: "solo", to: "claude", text: "확인 부탁", project: "priv" });
    expect(ok.status).toBe(201); expect((await ok.json()).command.project).toBe("priv");
    expect((await send({ kind: "solo", to: "nobody", text: "x", project: "priv" })).status).toBe(400); // 그 프로젝트에 없는 에이전트
    expect((await send({ kind: "solo", to: "claude", text: "x", project: "nope" })).status).toBe(400);
    expect((await send({ kind: "solo", to: "claude", text: "x", project: "gone" })).status).toBe(502); // 저장소를 못 읽으면 대상 검사도 못 함
    const list = (q) => fetch(s.base + "/api/commands" + q, { headers: { Cookie: s.cookie } }).then((r) => r.json());
    expect((await list("?project=priv")).commands.length).toBe(1);
    expect((await list("?project=here")).commands.length).toBe(0);
    expect((await list("")).commands.length).toBe(1);
  });
  it("화면을 연 뒤 projects.json에서 지워진 프로젝트로 지시하면 INVALID_PROJECT이고, 화면 문구는 '목록에 없다'(직접 불러온 저장소 문구가 아님)", async () => {
    const s = await startServer({ projects });
    const send = (body) => fetch(s.base + "/api/command", { method: "POST", headers: { "Content-Type": "application/json", Origin: s.base, Cookie: s.cookie }, body: JSON.stringify(body) });
    expect((await send({ kind: "solo", to: "claude", text: "전", project: "here" })).status).toBe(201);
    fs.writeFileSync(path.join(dir, "data/projects.json"), JSON.stringify({ projects: projects.projects.filter((p) => p.id !== "here") }));
    const r = await send({ kind: "solo", to: "claude", text: "후", project: "here" });
    expect(r.status).toBe(400);
    const { code } = await r.json(); expect(code).toBe("INVALID_PROJECT");
    const { errorMessage, PROJECT_GONE, ADHOC_NO_COMMAND } = await import("../src/panels/model.js");
    expect(errorMessage(code)).toBe(PROJECT_GONE); expect(errorMessage(code)).not.toBe(ADHOC_NO_COMMAND);
  });
  it("projects.json 파일 자체는 정적으로 노출하지 않는다", async () => {
    const s = await startServer({ projects });
    expect((await fetch(s.base + "/projects.json", { headers: { Cookie: s.cookie } })).status).toBe(404);
  });
});

import { checkSample } from "../scripts/check-public.js";
describe("check-public: 공개판 projects.json", () => {
  const mk = (projects) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-pub-")); fs.copyFileSync("public-sample/status.json", d + "/status.json"); fs.copyFileSync("public-sample/board.json", d + "/board.json"); if (projects) fs.writeFileSync(d + "/projects.json", JSON.stringify(projects)); return d; };
  it("정상 목록·없음은 통과", () => { expect(checkSample(mk())).toEqual([]); expect(checkSample(mk({ projects: [{ id: "a", name: "예시", repo: "my-org/status" }] }))).toEqual([]); });
  it("private·형식 오류·금지어는 거절", () => {
    expect(checkSample(mk({ projects: [{ id: "a", name: "예시", repo: "my-org/status", private: true }] })).join()).toMatch(/private/);
    expect(checkSample(mk({ projects: [{ id: "a", name: "x", repo: "../x" }] })).join()).toMatch(/repo/);
    expect(checkSample(mk({ projects: [{ id: "a", name: "gpt팀", repo: "my-org/status" }] })).join()).toMatch(/금지어/);
  });
});

describe("adhocSourcesOf (화면에서 직접 입력)", () => {
  it("공개판은 raw 주소, 서버 모드는 /api/gh", () => {
    const a = adhocSourcesOf({ repo: " own/repo ", dir: "/status/", branch: "dev" });
    expect(a.ok).toBe(true); expect(a.sources.url).toBe("https://raw.githubusercontent.com/own/repo/dev/status/status.json");
    const b = adhocSourcesOf({ repo: "own/repo" }, { viaServer: true });
    expect(b.sources.url).toBe("/api/gh/status.json?repo=own%2Frepo"); expect(b.sources.boardUrl).toContain("/api/gh/board.json");
  });
  it("잘못된 입력은 거절", () => {
    for (const bad of [{}, { repo: "" }, { repo: "a b/c" }, { repo: "../x" }, { repo: "own/repo", dir: "../etc" }, { repo: "own/repo", branch: "a..b" }]) {
      expect(adhocSourcesOf(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("서버 /api/gh 호출 횟수 제한", () => {
  const projects = { projects: [{ id: "here", name: "여기" }] };
  const url = "/api/gh/status.json?repo=own/priv";
  it("한도를 넘으면 429 + Retry-After(캐시 적중도 센다), 토큰은 나오지 않고, 다른 API는 영향 없다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "3", GH_RATE_WINDOW_MS: "60000", GITHUB_CACHE_MS: "60000" } });
    const h = { headers: { Cookie: s.cookie } };
    for (let i = 0; i < 3; i++) expect((await fetch(s.base + url, h)).status).toBe(200);
    expect(s.hits.length).toBe(1); // 2·3번째는 캐시 적중이었지만 횟수에는 센다
    const r = await fetch(s.base + url, h), text = await r.text();
    expect(r.status).toBe(429);
    const ra = Number(r.headers.get("retry-after")); expect(ra).toBeGreaterThanOrEqual(1); expect(ra).toBeLessThanOrEqual(60);
    expect(JSON.parse(text)).toMatchObject({ code: "TOO_MANY", retryAfterSec: ra });
    expect(text + JSON.stringify([...r.headers])).not.toContain(s.token);
    expect(s.hits.length).toBe(1); // 제한된 요청은 GitHub를 부르지 않는다
    expect((await fetch(s.base + "/api/gh/discover", h)).status).toBe(429); // discover도 같은 한도
    expect((await fetch(s.base + "/api/gh/board.json?repo=own/priv", h)).status).toBe(429);
    expect((await fetch(s.base + "/api/projects", h)).status).toBe(200); // /api/gh/* 밖은 제한 없음
    expect((await fetch(s.base + url)).status).toBe(401); // 로그인 전은 401
  });
  it("세션마다 따로 센다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "1", GH_RATE_WINDOW_MS: "60000" } });
    const h = { headers: { Cookie: s.cookie } };
    expect((await fetch(s.base + url, h)).status).toBe(200);
    expect((await fetch(s.base + url, h)).status).toBe(429);
    await new Promise((r) => setTimeout(r, 15)); // 세션 키는 발급 시각(ms)에서 나오니 겹치지 않게
    const lr = await fetch(s.base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: s.base }, body: JSON.stringify({ password: "pw-x-1234" }) });
    const other = lr.headers.get("set-cookie").split(";")[0];
    expect(other).not.toBe(s.cookie);
    expect((await fetch(s.base + url, { headers: { Cookie: other } })).status).toBe(200);
  });
  it("창이 지나면 다시 된다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "2", GH_RATE_WINDOW_MS: "700" } });
    const h = { headers: { Cookie: s.cookie } };
    await fetch(s.base + url, h); await fetch(s.base + url, h);
    expect((await fetch(s.base + url, h)).status).toBe(429);
    await new Promise((r) => setTimeout(r, 800));
    expect((await fetch(s.base + url, h)).status).toBe(200);
  });
  it("창 길이가 음수·숫자 아님이면 기본 창(60초)을 써서 제한이 꺼지지 않는다", async () => {
    for (const bad of ["-5", "abc"]) {
      const s = await startServer({ projects, env: { GH_RATE_LIMIT: "1", GH_RATE_WINDOW_MS: bad } });
      const h = { headers: { Cookie: s.cookie } };
      expect((await fetch(s.base + url, h)).status).toBe(200);
      expect((await fetch(s.base + url, h)).status).toBe(429);
      proc.kill(); fake.close();
    }
  });
  it("GH_RATE_LIMIT가 숫자가 아니면 기본 한도(60)를 쓴다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "abc" } });
    const h = { headers: { Cookie: s.cookie } };
    for (let i = 0; i < 60; i++) expect((await fetch(s.base + url, h)).status).toBe(200);
    expect((await fetch(s.base + url, h)).status).toBe(429);
  });
  it("GH_RATE_LIMIT=0이면 끈다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "0" } });
    for (let i = 0; i < 5; i++) expect((await fetch(s.base + url, { headers: { Cookie: s.cookie } })).status).toBe(200);
  });
});

describe("서버 /api/gh (직접 입력한 저장소)", () => {
  it("로그인 필요, 형식 검사, 토큰으로 읽기", async () => {
    const s = await startServer({ projects: { projects: [{ id: "here", name: "여기" }] } });
    expect((await fetch(s.base + "/api/gh/status.json?repo=own/priv")).status).toBe(401);
    const h = { headers: { Cookie: s.cookie } };
    expect((await fetch(s.base + "/api/gh/status.json?repo=../x", h)).status).toBe(400);
    expect((await fetch(s.base + "/api/gh/status.json", h)).status).toBe(400);
    expect((await fetch(s.base + "/api/gh/status.json?repo=own/priv&dir=..%2Fx", h)).status).toBe(400);
    const r = await fetch(s.base + "/api/gh/status.json?repo=own/priv&dir=st&branch=dev", h);
    expect(r.status).toBe(200); expect(await r.text()).not.toContain(s.token);
    expect(s.hits.at(-1).url).toContain("/repos/own/priv/contents/st/status.json?ref=dev");
    expect((await fetch(s.base + "/api/gh/status.json?repo=own/none", h)).status).toBe(502);
  });
  it("중복 파라미터로 검사를 피할 수 없고, 형식이 틀린 파일은 내보내지 않는다", async () => {
    const s = await startServer({ projects: { projects: [{ id: "here", name: "여기" }] } });
    const h = { headers: { Cookie: s.cookie } };
    expect((await fetch(s.base + "/api/gh/status.json?repo=../x&repo=own/priv", h)).status).toBe(400);
    const r = await fetch(s.base + "/api/gh/board.json?repo=own/priv&dir=st&dir=..", h);
    expect(r.status).toBe(200); // 첫 값(st)으로 검사하고 같은 값으로 읽는다
    expect(s.hits.at(-1).url).toContain("/repos/own/priv/contents/st/board.json?ref=main");
    const j = await fetch(s.base + "/api/gh/status.json?repo=own/junk", h);
    expect(j.status).toBe(422); expect(await j.text()).not.toContain("not-a-status-file");
  });
  it("직접 입력 화면의 프로젝트 id는 어떤 projects.json id와도 겹치지 않는다(지시가 다른 프로젝트로 가지 않게)", async () => {
    const { ADHOC_PROJECT_ID } = await import("../src/panels/loadlocal.js");
    expect(validateProjects({ projects: [{ id: ADHOC_PROJECT_ID, name: "x" }] }).join()).toMatch(/id 형식/);
  });
});

describe("서버 /api/gh/discover", () => {
  it("로그인 필요, 토픽이 붙은 저장소만 찾고 토큰을 싣지 않는다", async () => {
    const hits = [];
    const fakeApi = http.createServer((req, res) => {
      hits.push(req.url);
      if (req.url.startsWith("/user/repos")) { res.writeHead(200); return res.end(JSON.stringify([{ full_name: "own/priv", private: true, default_branch: "main", topics: ["work-status-3d"] }, { full_name: "own/other", default_branch: "main", topics: ["x"] }])); }
      if (req.url.includes("/repos/own/priv/contents/status.json")) { res.writeHead(200); return res.end("{}"); } // 형식이 틀린 맨 위 파일은 고르지 않는다
      if (req.url.includes("/repos/own/priv/contents/status/status.json")) { res.writeHead(200); return res.end(JSON.stringify(seedStatus())); }
      res.writeHead(404); res.end("{}");
    });
    await new Promise((r) => fakeApi.listen(0, "127.0.0.1", r));
    try {
      const s = await startServer({ projects: { projects: [{ id: "here", name: "여기" }] } });
      // 이 테스트는 startServer가 만든 가짜 API 대신 별도 가짜 API를 쓰므로 서버를 다시 띄운다.
      proc.kill();
      const env = { ...process.env, PORT: "0", DASH_PASSWORD: "pw-x-1234", GITHUB_TOKEN: "tok-SECRET-123", GITHUB_API_BASE: `http://127.0.0.1:${fakeApi.address().port}`, DIST_DIR: path.join(dir, "dist"), DATA_DIR: path.join(dir, "data"), INBOX_FILE: path.join(dir, "inbox.json") };
      proc = spawn("node", [path.resolve("server.js")], { env });
      let out = ""; proc.stdout.on("data", (d) => (out += d));
      await new Promise((resolve) => { const t = setInterval(() => { if (/127\.0\.0\.1:\d+/.test(out)) { clearInterval(t); resolve(); } }, 20); });
      const base = `http://127.0.0.1:${/127\.0\.0\.1:(\d+)/.exec(out)[1]}`;
      expect((await fetch(base + "/api/gh/discover")).status).toBe(401);
      const lr = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password: "pw-x-1234" }) });
      const cookie = lr.headers.get("set-cookie").split(";")[0];
      const r = await fetch(base + "/api/gh/discover", { headers: { Cookie: cookie } });
      const text = await r.text();
      expect(r.status).toBe(200); expect(JSON.parse(text).projects).toEqual([{ repo: "own/priv", branch: "main", dir: "status", private: true }]);
      expect(text).not.toContain("tok-SECRET");
      // 동시·반복 요청은 캐시와 합치기로 GitHub 목록 호출을 다시 하지 않는다
      const before = hits.filter((u) => u.startsWith("/user/repos")).length;
      const again = await Promise.all([1, 2, 3].map(() => fetch(base + "/api/gh/discover", { headers: { Cookie: cookie } })));
      expect(again.map((x) => x.status)).toEqual([200, 200, 200]);
      expect(hits.filter((u) => u.startsWith("/user/repos")).length).toBe(before);
      expect(before).toBe(1);
    } finally { fakeApi.close(); }
  });
  it("토큰이 없으면 400", async () => {
    const s = await startServer({ token: "", projects: { projects: [{ id: "here", name: "여기" }] } });
    expect((await fetch(s.base + "/api/gh/discover", { headers: { Cookie: s.cookie } })).status).toBe(400);
  });
});

describe("호출 제한 보강(이전부터 있던 문제)", () => {
  const projects = { projects: [{ id: "here", name: "여기" }] };
  const post = (s, p, body, cookie = s.cookie) => fetch(s.base + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: s.base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const relogin = async (s) => { await new Promise((r) => setTimeout(r, 15)); return (await post(s, "/api/login", { password: "pw-x-1234" }, "")).headers.get("set-cookie").split(";")[0]; };
  it("로그인을 다시 해 새 세션을 만들어도 전체 합산 한도(세션 한도의 5배)로 막힌다", async () => {
    const s = await startServer({ projects, env: { GH_RATE_LIMIT: "1", GH_RATE_WINDOW_MS: "60000" } });
    let ok = 0, blocked = 0, cookie = s.cookie;
    for (let i = 0; i < 8; i++) {
      const r = await fetch(s.base + "/api/gh/status.json?repo=own/priv", { headers: { Cookie: cookie } });
      if (r.status === 200) ok++; else { blocked++; expect(r.status).toBe(429); expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(1); }
      cookie = await relogin(s);
    }
    expect(ok).toBe(5); expect(blocked).toBe(3);
  });
  it("지시 API: 한도 초과 429에 Retry-After가 붙고, 숫자가 아닌 CMD_RATE_LIMIT는 기본값(10)을 쓴다", async () => {
    const s = await startServer({ projects, env: { CMD_RATE_LIMIT: "abc" } });
    let last;
    for (let i = 0; i < 11; i++) last = await post(s, "/api/command", { to: "chief", text: "확인 " + i });
    expect(last.status).toBe(429);
    const ra = Number(last.headers.get("retry-after")); expect(ra).toBeGreaterThanOrEqual(1); expect(ra).toBeLessThanOrEqual(60);
    expect(await last.json()).toMatchObject({ code: "TOO_MANY", retryAfterSec: ra });
  });
  it("지시 API도 새 세션으로 우회되지 않는다(전체 합산 5배)", async () => {
    const s = await startServer({ projects, env: { CMD_RATE_LIMIT: "1" } });
    let cookie = s.cookie, ok = 0;
    for (let i = 0; i < 7; i++) { const r = await post(s, "/api/command", { to: "chief", text: "확인 " + i }, cookie); if (r.status === 201) ok++; cookie = await relogin(s); }
    expect(ok).toBe(5);
  });
  it("로그인 실패 한도 429에도 Retry-After가 붙는다", async () => {
    const s = await startServer({ projects });
    let last;
    for (let i = 0; i < 6; i++) last = await post(s, "/api/login", { password: "틀림" }, "");
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
