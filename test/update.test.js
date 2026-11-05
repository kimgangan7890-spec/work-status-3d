import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateStatus } from "../src/shared/validate.js";
import { addCommand } from "../src/shared/inbox.js";

const SCRIPT = path.resolve("update.js");
let dir, env;
const run = (...args) => spawnSync("node", [SCRIPT, ...args], { env, encoding: "utf8" });
const read = () => JSON.parse(fs.readFileSync(env.STATUS_FILE, "utf8"));
const readBoard = () => JSON.parse(fs.readFileSync(env.BOARD_FILE, "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-"));
  env = { ...process.env, STATUS_FILE: path.join(dir, "status.json"), EVENTS_FILE: path.join(dir, "events.jsonl"), BOARD_FILE: path.join(dir, "board.json") };
  expect(run("init").status).toBe(0);
});

describe("update.js", () => {
  it("event는 status.json과 events.jsonl 둘 다에 id 순서로 남는다", () => {
    expect(run("event", "--from", "gpt", "--to", "board", "--title", "a", "--task", "T6").status).toBe(0);
    expect(run("event", "--from", "claude", "--to", "gpt", "--title", "b").status).toBe(0);
    expect(read().events.map((e) => e.id)).toEqual([1, 2]);
    expect(fs.readFileSync(env.EVENTS_FILE, "utf8").trim().split("\n").length).toBe(2);
    expect(validateStatus(read())).toEqual([]);
  });
  it("최근 30개만 status.json에 두고 전체는 jsonl에 남고 id는 이어진다", () => {
    for (let i = 0; i < 33; i++) run("event", "--from", "gpt", "--to", "board", "--title", "e" + i);
    const ev = read().events;
    expect(ev.length).toBe(30); expect(ev[0].id).toBe(4); expect(ev.at(-1).id).toBe(33);
    expect(fs.readFileSync(env.EVENTS_FILE, "utf8").trim().split("\n").length).toBe(33);
  });
  it("init은 status.json과 board.json 두 파일을 만들고 status에 board 키가 없다", () => {
    expect(Object.keys(read())).toEqual(["meta", "agents", "tasks", "events"]);
    expect(Object.keys(readBoard())).toEqual(["mvp", "zones"]);
  });
  it("mvp와 task 추가는 board.json에 반영된다", () => {
    expect(run("mvp", "M5", "in").status).toBe(0); expect(readBoard().mvp.find((m) => m.id === "M5").status).toBe("in");
    expect(run("task", "W9", "--title", "새 작업", "--owner", "gpt", "--zone", "z-scene").status).toBe(0);
    expect(readBoard().zones.find((z) => z.id === "z-scene").taskIds).toContain("W9");
    expect(read().tasks.find((t) => t.id === "W9").zone).toBe("z-scene");
  });
  it("progress가 상태를 바꾼다", () => {
    run("progress", "T2", "40"); expect(read().tasks.find((t) => t.id === "T2")).toMatchObject({ progress: 40, state: "doing" });
    run("progress", "T2", "100"); expect(read().tasks.find((t) => t.id === "T2").state).toBe("done");
  });
  it("잘못된 입력은 파일을 바꾸지 않고 실패한다", () => {
    const before = fs.readFileSync(env.STATUS_FILE, "utf8"), beforeBoard = fs.readFileSync(env.BOARD_FILE, "utf8");
    for (const args of [["progress", "T2", "150"], ["progress", "NOPE", "5"], ["event", "--from", "ghost", "--to", "board", "--title", "x"], ["state", "gpt", "sleeping"], ["state", "gpt", "waiting"], ["mvp", "M1", "maybe"], ["task", "X1", "--title", "t", "--owner", "gpt", "--zone", "z-nope"], ["event", "--from", "gpt", "--to", "board", "--title", "sk-abcdefghijklmnopqrstuvwx"], ["event", "--from", "gpt", "--to", "board", "--title", "연락 a.b@example.com"]]) {
      expect(run(...args).status, args.join(" ")).toBe(1);
    }
    expect(fs.readFileSync(env.STATUS_FILE, "utf8")).toBe(before);
    expect(fs.readFileSync(env.BOARD_FILE, "utf8")).toBe(beforeBoard);
    expect(fs.existsSync(env.EVENTS_FILE)).toBe(false);
  });
  it("동시에 20개를 호출해도 파일이 깨지지 않고 모두 기록된다", async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => new Promise((res) => { const p = spawn("node", [SCRIPT, "event", "--from", "gpt", "--to", "board", "--title", "c" + i], { env }); p.on("close", res); }));
    const codes = await Promise.all(jobs);
    expect(codes.every((c) => c === 0)).toBe(true);
    const ev = read().events; expect(ev.length).toBe(20);
    expect(new Set(ev.map((e) => e.id)).size).toBe(20);
    expect(validateStatus(read())).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock"))).toEqual([]);
  });
  it("command-state는 개인·공동 종류를 알려 주고 kind 없는 옛 기록도 처리한다", () => {
    const inbox = path.join(dir, "inbox.json"); const e = { ...env, INBOX_FILE: inbox };
    const go = (...a) => spawnSync("node", [SCRIPT, ...a], { env: e, encoding: "utf8" });
    const at = "2026-11-05T15:00:00+09:00";
    addCommand(inbox, { kind: "team", to: "team", text: "공동", at }); addCommand(inbox, { kind: "solo", to: "gpt", text: "개인", at });
    let r = go("command-state", "1", "delivered"); expect([r.status, r.stdout.trim()]).toEqual([0, "지시 #1 (공동·모두에게): delivered"]);
    r = go("command-state", "2", "delivered"); expect(r.stdout.trim()).toBe("지시 #2 (개인·gpt): delivered");
    fs.writeFileSync(inbox, JSON.stringify([{ id: 5, at, to: "claude", text: "옛", state: "pending", needsApproval: false, deliveredAt: null, doneAt: null }]));
    r = go("command-state", "5", "delivered"); expect(r.stdout.trim()).toBe("지시 #5 (개인·claude): delivered");
    expect(JSON.parse(fs.readFileSync(inbox, "utf8"))[0].kind).toBe("solo");
  });
});
