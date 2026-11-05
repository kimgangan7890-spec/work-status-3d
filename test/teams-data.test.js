// 에이전트·팀 확장의 데이터 쪽(DESIGN4.md §5·§7): 검증, update.js, 지시 대상 team:<id>, 서버 저장.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateStatus, validateBoard } from "../src/shared/validate.js";
import { seedStatus, seedBoard } from "../src/shared/seed.js";
import { checkTarget, targetsOf } from "../src/shared/inbox.js";

const agent = (id, teamId) => ({ id, name: id, role: "r", status: "idle", currentTaskId: null, note: "n", ...(teamId ? { teamId } : {}) });
const withTeams = () => { const s = seedStatus(); s.teams = [{ id: "main", name: "코딩" }, { id: "review", name: "검수" }]; s.agents.push(agent("rev1", "review"), agent("rev2", "review")); return s; };

describe("validateStatus: teams·teamId·id 패턴", () => {
  it("teams 없는 seed는 그대로 통과하고 키 순서도 그대로다", () => { const s = seedStatus(); expect(validateStatus(s)).toEqual([]); expect("teams" in s).toBe(false); });
  it("팀 2개(코딩 3명 + 검수 2명)는 통과한다", () => expect(validateStatus(withTeams())).toEqual([]));
  it("teamId 없는 에이전트는 기본 팀 main에 속한다", () => { const s = withTeams(); expect(s.agents.filter((a) => !a.teamId).length).toBe(3); expect(validateStatus(s)).toEqual([]); });
  it("없는 팀 id·teams 없는 teamId는 거부", () => {
    const s = withTeams(); s.agents[0].teamId = "nope"; expect(validateStatus(s).join()).toContain("없는 팀");
    const t = seedStatus(); t.agents[0].teamId = "main"; expect(validateStatus(t).join()).toContain("teams도 있어야");
  });
  it("새 에이전트 id 패턴, 중복(팀이 달라도)·예약어(board·team·all)·대문자·25자 거부", () => {
    for (const id of ["Rev1", "1rev", "rev 1", "a".repeat(25), "board", "team", "all", ""]) { const s = withTeams(); s.agents.push(agent(id, "review")); expect(validateStatus(s).length, id).toBeGreaterThan(0); }
    const d = withTeams(); d.agents.push(agent("gpt", "review")); expect(validateStatus(d).join()).toContain("중복");
    const ok = withTeams(); ok.agents.push(agent("a".repeat(24), "review")); expect(validateStatus(ok)).toEqual([]);
  });
  it("한도: 팀 9개, 팀당 9명, 전체 25명은 거부, 8개·8명은 통과", () => {
    const t = seedStatus(); t.teams = Array.from({ length: 9 }, (_, i) => ({ id: "t" + i, name: "팀" + i })); expect(validateStatus(t).join()).toContain("팀은 최대 8개");
    const ok = seedStatus(); ok.teams = Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, name: "팀" + i })); expect(validateStatus(ok)).toEqual([]);
    const p = seedStatus(); p.teams = [{ id: "main", name: "기본" }]; for (let i = 0; i < 6; i++) p.agents.push(agent("m" + i)); expect(p.agents.length).toBe(9);
    expect(validateStatus(p).join()).toContain("최대 8명");
    p.agents.pop(); expect(validateStatus(p)).toEqual([]);
    const all = seedStatus(); all.teams = Array.from({ length: 4 }, (_, i) => ({ id: "t" + i, name: "팀" + i })); all.agents = [];
    for (let i = 0; i < 25; i++) all.agents.push(agent("x" + i, "t" + (i % 4)));
    expect(validateStatus(all).join()).toContain("최대 24명");
  });
  it("팀 id 중복·이름 21자·order 소수·알 수 없는 키 거부", () => {
    const a = withTeams(); a.teams[1].id = "main"; expect(validateStatus(a).join()).toContain("중복");
    const b = withTeams(); b.teams[1].name = "가".repeat(21); expect(validateStatus(b).length).toBeGreaterThan(0);
    const c = withTeams(); c.teams[1].order = 1.5; expect(validateStatus(c).length).toBeGreaterThan(0);
    const d = withTeams(); d.teams[1].color = "red"; expect(validateStatus(d).length).toBeGreaterThan(0);
  });
  it("새 에이전트도 작업 담당·이벤트 끝점으로 쓸 수 있다", () => {
    const s = withTeams(); s.tasks[0].ownerAgentId = "rev1";
    s.events.push({ id: (s.events.at(-1)?.id ?? 0) + 1, at: s.meta.updatedAt, from: "rev1", to: "claude", title: "t", summary: "s", taskId: null, kind: "ask" });
    expect(validateStatus(s)).toEqual([]);
  });
});

describe("validateBoard: zones[].teamId", () => {
  it("선택 필드이고 형식만 본다", () => {
    const b = seedBoard(); b.zones[0].teamId = "review"; expect(validateBoard(b)).toEqual([]);
    b.zones[0].teamId = "Bad Id"; expect(validateBoard(b).length).toBeGreaterThan(0);
    const c = seedBoard(); c.zones[0].ownerAgentId = "rev1"; expect(validateBoard(c)).toEqual([]);
  });
});

describe("checkTarget: solo 에이전트 id, team / team:<팀id>", () => {
  const targets = targetsOf(withTeams());
  it("형식만 볼 때", () => {
    expect(checkTarget("team", "team:review")).toBeNull();
    for (const to of ["team:", "team:Review", "team:a b", "teams:review", "team:" + "a".repeat(25)]) expect(checkTarget("team", to), to).toBe("INVALID_TO");
    expect(checkTarget("solo", "team:review")).toBe("INVALID_TO");
    expect(checkTarget("solo", "rev1")).toBeNull();
    for (const to of ["team", "board", "all", "Rev", ""]) expect(checkTarget("solo", to), to).toBe("INVALID_TO");
  });
  it("실제 있는 id만(targets가 있을 때)", () => {
    expect(checkTarget("team", "team:review", targets)).toBeNull();
    expect(checkTarget("team", "team", targets)).toBeNull();
    expect(checkTarget("team", "team:ghost", targets)).toBe("INVALID_TO");
    expect(checkTarget("solo", "rev2", targets)).toBeNull();
    expect(checkTarget("solo", "ghost", targets)).toBe("INVALID_TO");
  });
  it("teams가 없으면 team:main만", () => {
    const t = targetsOf(seedStatus());
    expect(checkTarget("team", "team:main", t)).toBeNull(); expect(checkTarget("team", "team:review", t)).toBe("INVALID_TO");
  });
});

describe("update.js team/agent", () => {
  let dir, env;
  const run = (...a) => spawnSync("node", [path.resolve("update.js"), ...a], { env, encoding: "utf8" });
  const raw = () => fs.readFileSync(env.STATUS_FILE, "utf8");
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-team-"));
    env = { ...process.env, STATUS_FILE: path.join(dir, "status.json"), EVENTS_FILE: path.join(dir, "e.jsonl"), BOARD_FILE: path.join(dir, "board.json") };
    expect(run("init").status).toBe(0);
  });
  it("team add: 처음이면 main도 함께 만들고 기존 3명은 그대로", () => {
    expect(run("team", "add", "review", "--name", "검수팀").status).toBe(0);
    const s = JSON.parse(raw()); expect(s.teams).toEqual([{ id: "main", name: "기본" }, { id: "review", name: "검수팀" }]);
    expect(s.agents.every((a) => !a.teamId)).toBe(true); expect(validateStatus(s)).toEqual([]);
  });
  it("agent add --team / agent move / team rename", () => {
    run("team", "add", "review", "--name", "검수팀");
    expect(run("agent", "add", "rev1", "--name", "검수 1", "--role", "검수", "--team", "review").status).toBe(0);
    const a = JSON.parse(raw()).agents.find((x) => x.id === "rev1"); expect(a).toMatchObject({ teamId: "review", status: "idle", currentTaskId: null });
    expect(run("agent", "move", "rev1", "--team", "main").status).toBe(0); expect(JSON.parse(raw()).agents.find((x) => x.id === "rev1").teamId).toBe("main");
    expect(run("team", "rename", "review", "--name", "품질팀").status).toBe(0); expect(JSON.parse(raw()).teams[1].name).toBe("품질팀");
    expect(run("state", "rev1", "working", "검수 중").status).toBe(0);
  });
  it("중복 id·없는 팀·팀 없이 --team·잘못된 id·팀 중복은 거절하고 파일이 바뀌지 않는다", () => {
    run("team", "add", "review", "--name", "검수팀");
    const before = raw();
    const bad = [
      ["agent", "add", "gpt", "--name", "x", "--role", "r", "--team", "review"],
      ["agent", "add", "z1", "--name", "x", "--role", "r", "--team", "nope"],
      ["agent", "add", "Bad", "--name", "x", "--role", "r"],
      ["agent", "add", "board", "--name", "x", "--role", "r"],
      ["agent", "move", "gpt", "--team", "nope"],
      ["team", "add", "review", "--name", "또"],
      ["team", "add", "Bad", "--name", "x"],
      ["team", "add", "t2", "--name", "가".repeat(30)],
    ];
    for (const a of bad) { const r = run(...a); expect(r.status, a.join(" ")).toBe(1); expect(raw(), a.join(" ")).toBe(before); }
    const fresh = spawnSync("node", [path.resolve("update.js"), "agent", "add", "z", "--name", "x", "--role", "r", "--team", "review"], { env: { ...env, STATUS_FILE: path.join(dir, "s2.json"), BOARD_FILE: path.join(dir, "b2.json") }, encoding: "utf8" });
    expect(fresh.status).toBe(1); // 파일 없음
  });
  it("팀 8개·팀당 8명·전체 24명 한도: 넘기면 거절하고 파일 그대로", () => {
    for (let i = 1; i < 8; i++) expect(run("team", "add", "t" + i, "--name", "팀" + i).status, "t" + i).toBe(0); // main + 7 = 8
    const before = raw();
    expect(run("team", "add", "t8", "--name", "9번째").status).toBe(1); expect(raw()).toBe(before);
    for (let i = 0; i < 5; i++) expect(run("agent", "add", "q" + i, "--name", "q", "--role", "r", "--team", "t1").status).toBe(0);
    const full = raw();
    // t1에 이미 5명, 3명 더 가능
    for (let i = 5; i < 8; i++) expect(run("agent", "add", "q" + i, "--name", "q", "--role", "r", "--team", "t1").status).toBe(0);
    const eight = raw(); expect(run("agent", "add", "q9", "--name", "q", "--role", "r", "--team", "t1").status).toBe(1); expect(raw()).toBe(eight);
    expect(full).not.toBe(eight);
  });
});

describe("서버: team:<id> 지시는 inbox.json에 그대로 저장", () => {
  const PW = "pw-for-test-Zq81"; let dir, proc, base;
  afterEach(() => proc?.kill());
  async function boot(status) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-srvt-"));
    fs.mkdirSync(path.join(dir, "dist")); fs.writeFileSync(path.join(dir, "dist/index.html"), "ok"); fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data/status.json"), JSON.stringify(status)); fs.writeFileSync(path.join(dir, "data/board.json"), '{"mvp":[],"zones":[]}');
    const env = { ...process.env, PORT: "0", DASH_PASSWORD: PW, DIST_DIR: path.join(dir, "dist"), DATA_DIR: path.join(dir, "data"), INBOX_FILE: path.join(dir, "inbox.json") };
    proc = spawn("node", [path.resolve("server.js")], { env }); let out = "";
    proc.stdout.on("data", (d) => (out += d)); proc.stderr.on("data", (d) => (out += d));
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("시작 시간 초과")), 5000); const i = setInterval(() => { if (/127\.0\.0\.1:(\d+)/.test(out)) { clearTimeout(t); clearInterval(i); res(); } }, 20); });
    base = `http://127.0.0.1:${/127\.0\.0\.1:(\d+)/.exec(out)[1]}`;
    const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password: PW }) });
    return r.headers.get("set-cookie").split(";")[0];
  }
  it("있는 팀은 201과 함께 저장, 없는 팀·solo에 team:은 400, 새 에이전트 solo는 201, 비밀 문구는 400", async () => {
    const c = await boot(withTeams());
    const send = (b) => fetch(base + "/api/command", { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: c }, body: JSON.stringify(b) });
    let r = await send({ kind: "team", to: "team:review", text: "검수 부탁" }); expect(r.status).toBe(201);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")); expect(saved[0]).toMatchObject({ kind: "team", to: "team:review", state: "pending" });
    r = await send({ kind: "team", to: "team:ghost", text: "x" }); expect([r.status, (await r.json()).code]).toEqual([400, "INVALID_TO"]);
    r = await send({ kind: "solo", to: "team:review", text: "x" }); expect(r.status).toBe(400);
    r = await send({ kind: "solo", to: "rev2", text: "개인 지시" }); expect(r.status).toBe(201);
    r = await send({ kind: "solo", to: "ghost", text: "x" }); expect(r.status).toBe(400);
    r = await send({ kind: "team", to: "team:review", text: "token sk-abcdefghijklmnopqrstuvwx1234" }); expect([r.status, (await r.json()).code]).toEqual([400, "SECRET_LIKE"]);
    r = await send({ kind: "team", to: "team", text: "전체" }); expect(r.status).toBe(201);
  });
});

describe("예약어 팀 id (검수 수정)", () => {
  it("팀 id가 board·team·all이면 validateStatus가 거부하고 지시 대상도 거부한다", () => {
    for (const id of ["board", "team", "all"]) {
      const s = withTeams(); s.teams.push({ id, name: "예약" }); expect(validateStatus(s).join(), id).toContain("불가");
      expect(checkTarget("team", "team:" + id, targetsOf(withTeams())), id).toBe("INVALID_TO");
      const b = seedBoard(); b.zones[0].teamId = id; expect(validateBoard(b).length, id).toBeGreaterThan(0);
    }
  });
  it("update.js team add all은 거부되고 파일은 그대로다", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-upd-")); const f = path.join(d, "status.json"); fs.writeFileSync(f, JSON.stringify(seedStatus()));
    const before = fs.readFileSync(f, "utf8");
    const r = spawnSync("node", [path.resolve("update.js"), "team", "add", "all", "--name", "전체"], { env: { ...process.env, DATA_DIR: d }, encoding: "utf8" });
    expect(r.status).toBe(1); expect(r.stderr).toContain("board·team·all 불가"); expect(fs.readFileSync(f, "utf8")).toBe(before);
  });
});
