import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateProjects, sourcesOf, summarize } from "../src/shared/projects.js";
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
async function startServer({ token = "tok-SECRET-123", projects }) {
  const hits = [];
  fake = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization, accept: req.headers.accept });
    if (req.url.includes("/repos/own/priv/")) {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(404); return res.end("{}"); }
      res.writeHead(200); return res.end(JSON.stringify(seedStatus()));
    }
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
  const env = { ...process.env, PORT: "0", DASH_PASSWORD: "pw-x-1234", GITHUB_TOKEN: token, GITHUB_API_BASE: `http://127.0.0.1:${fake.address().port}`, GITHUB_CACHE_MS: "0", DIST_DIR: path.join(dir, "dist"), DATA_DIR: path.join(dir, "data"), INBOX_FILE: path.join(dir, "inbox.json") };
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
    expect(checkSample(mk({ projects: [{ id: "a", name: "firebase팀", repo: "my-org/status" }] })).join()).toMatch(/금지어/);
  });
});
