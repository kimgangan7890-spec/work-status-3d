import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const SECRET_PW = "pw-for-test-9X7qLm";
let dir, proc, base, out;

async function start(extraEnv = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-srv-"));
  fs.mkdirSync(path.join(dir, "dist/assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist/index.html"), "<html>ok</html>");
  fs.writeFileSync(path.join(dir, "dist/status.json"), '{"leak":true}');
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data/status.json"), '{"live":1}');
  fs.writeFileSync(path.join(dir, "data/board.json"), '{"mvp":[],"zones":[]}');
  const env = { ...process.env, PORT: "0", DASH_PASSWORD: SECRET_PW, DIST_DIR: path.join(dir, "dist"), DATA_DIR: path.join(dir, "data"), INBOX_FILE: path.join(dir, "inbox.json"), ...extraEnv };
  proc = spawn("node", [path.resolve("server.js")], { env });
  out = "";
  proc.stdout.on("data", (d) => (out += d)); proc.stderr.on("data", (d) => (out += d));
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("서버 시작 시간 초과")), 5000); proc.stdout.on("data", () => { if (/http:\/\/127\.0\.0\.1:(\d+)/.test(out)) { clearTimeout(t); resolve(); } }); });
  base = `http://127.0.0.1:${/127\.0\.0\.1:(\d+)/.exec(out)[1]}`;
}
afterEach(() => { proc?.kill(); });

const post = (p, body, { cookie, origin = base, type = "application/json" } = {}) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": type, ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (p, cookie) => fetch(base + p, { headers: cookie ? { Cookie: cookie } : {} });
async function login() { const r = await post("/api/login", { password: SECRET_PW }); expect(r.status).toBe(200); return r.headers.get("set-cookie").split(";")[0]; }

describe("server.js", () => {
  it("/favicon.ico는 404가 아니라 204", async () => { await start(); const r = await get("/favicon.ico"); expect(r.status).toBe(204); });
  it("암호 환경변수가 없으면 시작하지 않는다", () => {
    const env = { ...process.env }; delete env.DASH_PASSWORD;
    const r = spawnSync("node", [path.resolve("server.js")], { env, encoding: "utf8", timeout: 5000 });
    expect(r.status).toBe(1);
  });
  it("127.0.0.1에서만 열고 로그인 전에는 API와 데이터가 막힌다", async () => {
    await start();
    expect(out).toContain("127.0.0.1");
    for (const [m, p] of [["GET", "/api/session"], ["GET", "/api/commands"], ["GET", "/status.json"], ["GET", "/board.json"]]) expect((await get(p)).status, p).toBe(401);
    expect((await post("/api/command", { to: "gpt", text: "x" })).status).toBe(401);
    expect(await (await get("/")).text()).toContain("ok"); // 화면 파일은 공개(데이터 없음)
  });
  it("잘못된 암호는 401, 5번 틀리면 429", async () => {
    await start();
    for (let i = 0; i < 5; i++) { const r = await post("/api/login", { password: "wrong" + i }); expect(r.status).toBe(401); expect((await r.json()).code).toBe("BAD_PASSWORD"); }
    const r = await post("/api/login", { password: SECRET_PW });
    expect(r.status).toBe(429); expect((await r.json()).retryAfterSec).toBeGreaterThan(0);
  });
  it("로그인 후 세션·최신 데이터 파일이 열리고 dist의 복사본은 쓰이지 않는다", async () => {
    await start();
    const c = await login();
    expect((await get("/api/session", c)).status).toBe(200);
    expect(await (await get("/status.json", c)).json()).toEqual({ live: 1 });
    const setCookie = (await post("/api/login", { password: SECRET_PW })).headers.get("set-cookie");
    expect(setCookie).toMatch(/HttpOnly/); expect(setCookie).toMatch(/SameSite=Strict/);
  });
  it("조작된 쿠키는 거부", async () => {
    await start();
    const c = await login(); const bad = c.slice(0, -2) + (c.endsWith("aa") ? "bb" : "aa");
    expect((await get("/api/session", bad)).status).toBe(401);
    expect((await get("/api/session", "sid=9999999999999.AAAA")).status).toBe(401);
  });
  it("POST는 같은 출처만: Origin 없음·다른 출처는 403, JSON이 아니면 415", async () => {
    await start();
    const c = await login();
    expect((await post("/api/command", { to: "gpt", text: "안녕" }, { cookie: c, origin: null })).status).toBe(403);
    expect((await post("/api/command", { to: "gpt", text: "안녕" }, { cookie: c, origin: "http://evil.example" })).status).toBe(403);
    expect((await post("/api/login", { password: SECRET_PW }, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post("/api/command", "to=gpt", { cookie: c, type: "text/plain" })).status).toBe(415);
  });
  it("지시 입력 검증: to·빈 값·300자 초과·비밀 모양", async () => {
    await start();
    const c = await login(); const send = (b) => post("/api/command", b, { cookie: c });
    let r = await send({ to: "user", text: "x" }); expect([r.status, (await r.json()).code]).toEqual([400, "INVALID_TO"]);
    r = await send({ to: "gpt", text: "   " }); expect([r.status, (await r.json()).code]).toEqual([400, "EMPTY_TEXT"]);
    r = await send({ to: "gpt", text: "가".repeat(301) }); expect([r.status, (await r.json()).code]).toEqual([400, "TEXT_TOO_LONG"]);
    r = await send({ to: "gpt", text: "가".repeat(300) }); expect(r.status).toBe(201);
    r = await send({ to: "gpt", text: "키는 sk-abcdefghijklmnopqrstuvwx 입니다" }); expect([r.status, (await r.json()).code]).toEqual([400, "SECRET_LIKE"]);
    r = await send({ to: "gpt", text: "메일 a.b@example.com 로" }); expect((await r.json()).code).toBe("SECRET_LIKE");
    r = await send({ to: "gpt" }); expect((await r.json()).code).toBe("EMPTY_TEXT");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")).length).toBe(1);
  });
  it("개인·공동 지시: kind 생략=solo, 잘못된 kind·조합은 400이고 저장 안 함", async () => {
    await start();
    const c = await login(); const send = (b) => post("/api/command", b, { cookie: c });
    const code = async (b) => { const r = await send(b); return [r.status, (await r.json()).code]; };
    expect(await code({ kind: "solo", to: "team", text: "x" })).toEqual([400, "INVALID_TO"]);
    expect(await code({ to: "team", text: "x" })).toEqual([400, "INVALID_TO"]);
    expect(await code({ kind: "team", to: "gpt", text: "x" })).toEqual([400, "INVALID_TO"]);
    expect(await code({ kind: "team", text: "x" })).toEqual([400, "INVALID_TO"]);
    expect(await code({ kind: "group", to: "team", text: "x" })).toEqual([400, "INVALID_KIND"]);
    expect(await code({ kind: null, to: "gpt", text: "x" })).toEqual([400, "INVALID_KIND"]);
    expect(await code({ kind: "", to: "gpt", text: "x" })).toEqual([400, "INVALID_KIND"]);
    expect(fs.existsSync(path.join(dir, "inbox.json"))).toBe(false);
    let r = await send({ kind: "solo", to: "chief", text: "개인 지시" }); expect(r.status).toBe(201);
    expect((await r.json()).command).toMatchObject({ kind: "solo", to: "chief" });
    r = await send({ kind: "team", to: "team", text: "공동 지시 삭제 포함" }); expect(r.status).toBe(201);
    expect((await r.json()).command).toMatchObject({ id: 2, kind: "team", to: "team", state: "pending", needsApproval: true });
    r = await send({ to: "claude", text: "kind 생략" }); expect((await r.json()).command).toMatchObject({ kind: "solo", to: "claude" });
    const list = (await (await get("/api/commands", c)).json()).commands;
    expect(list.map((x) => [x.kind, x.to])).toEqual([["solo", "claude"], ["team", "team"], ["solo", "chief"]]);
  });
  it("옛 기록(kind 없음)도 목록에서는 solo", async () => {
    await start();
    fs.writeFileSync(path.join(dir, "inbox.json"), JSON.stringify([{ id: 1, at: "2026-11-05T10:00:00+09:00", to: "gpt", text: "옛", state: "pending", needsApproval: false, deliveredAt: null, doneAt: null }]));
    const c = await login();
    expect((await (await get("/api/commands", c)).json()).commands[0]).toMatchObject({ kind: "solo", to: "gpt" });
  });
  it("지시 저장, 승인 필요 표시, 최신순 조회", async () => {
    await start();
    const c = await login();
    const a = await (await post("/api/command", { to: "claude", text: "게시판 문구 다듬어 줘" }, { cookie: c })).json();
    const b = await (await post("/api/command", { to: "gpt", text: "오래된 로그 파일 삭제해 줘" }, { cookie: c })).json();
    expect(a.command).toMatchObject({ id: 1, to: "claude", state: "pending", needsApproval: false, deliveredAt: null, doneAt: null });
    expect(b.command).toMatchObject({ id: 2, needsApproval: true });
    expect(a.command.at).toMatch(/\+09:00$/);
    const list = (await (await get("/api/commands", c)).json()).commands;
    expect(list.map((x) => x.id)).toEqual([2, 1]);
  });
  it("분당 10개를 넘으면 429", async () => {
    await start();
    const c = await login(); let last;
    for (let i = 0; i < 11; i++) last = await post("/api/command", { to: "gpt", text: "n" + i }, { cookie: c });
    expect(last.status).toBe(429); expect((await last.json()).code).toBe("TOO_MANY");
  });
  it("동시에 20개를 보내도 id가 겹치지 않고 모두 저장된다", async () => {
    await start({ CMD_RATE_LIMIT: "100" });
    const c = await login();
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post("/api/command", { to: "chief", text: "동시 " + i }, { cookie: c })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const ids = (await Promise.all(rs.map((r) => r.json()))).map((j) => j.command.id);
    expect(new Set(ids).size).toBe(20); expect(Math.max(...ids)).toBe(20);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".lock"))).toEqual([]);
  });
  it("경로 탈출과 숨김 파일은 404", async () => {
    await start();
    fs.writeFileSync(path.join(dir, "secret.txt"), "nope"); fs.writeFileSync(path.join(dir, "dist/.env"), "A=1");
    for (const p of ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/.env", "/assets/../../secret.txt"]) expect((await get(p)).status, p).toBe(404);
    expect((await fetch(base + "/", { method: "PUT" })).status).toBe(405);
  });
  it("update.js command-state는 pending→delivered→done만 허용하고 API에 반영된다", async () => {
    await start();
    const c = await login();
    await post("/api/command", { to: "gpt", text: "전이 시험" }, { cookie: c });
    const run = (...a) => spawnSync("node", [path.resolve("update.js"), "command-state", ...a], { env: { ...process.env, INBOX_FILE: path.join(dir, "inbox.json") }, encoding: "utf8" });
    expect(run("1", "done").status).toBe(1);
    expect(run("1", "delivered", "--note", "GPT에게 전달함").status).toBe(0);
    expect(run("1", "delivered").status).toBe(1);
    expect(run("1", "done").status).toBe(0);
    expect(run("9", "done").status).toBe(1);
    const cmd = (await (await get("/api/commands", c)).json()).commands[0];
    expect(cmd).toMatchObject({ id: 1, state: "done", note: "GPT에게 전달함" });
    expect(cmd.deliveredAt).toMatch(/\+09:00$/); expect(cmd.doneAt).toMatch(/\+09:00$/);
  });
  it("암호는 출력과 저장 파일 어디에도 남지 않는다", async () => {
    await start();
    const c = await login(); await post("/api/login", { password: "틀린암호-zzz" });
    await post("/api/command", { to: "gpt", text: "기록 확인" }, { cookie: c });
    expect(out).not.toContain(SECRET_PW);
    for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) expect(fs.readFileSync(path.join(dir, f), "utf8")).not.toContain(SECRET_PW);
  });
});
