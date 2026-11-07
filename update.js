#!/usr/bin/env node
// 사용법은 `node update.js help`. 검증에 실패하면 파일을 바꾸지 않고 종료 코드 1로 끝난다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStatus, validateBoard, crossCheck, MAX_EVENTS, DEFAULT_TEAM, MAX_TEAM_NAME } from "./src/shared/validate.js";
import { seedStatus, seedBoard } from "./src/shared/seed.js";
import { looksSecret } from "./src/shared/secret.js";
import { transition } from "./src/shared/inbox.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = process.env.STATUS_FILE || path.join(ROOT, "public", "status.json");
const BOARD_FILE = process.env.BOARD_FILE || path.join(path.dirname(STATUS_FILE), "board.json");
const INBOX_FILE = process.env.INBOX_FILE || path.join(ROOT, "data", "inbox.json");
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(ROOT, "data", "events.jsonl");
const LOCK_FILE = STATUS_FILE + ".lock";

const fail = (msg) => { console.error("오류: " + msg); process.exit(1); };

export function nowKst(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().replace(/\.\d+Z$/, "+09:00");
}

// 토큰·키·이메일처럼 보이는 문자열은 저장하지 않고 거부한다.
export function cleanText(label, v, max = 80) {
  if (typeof v !== "string") fail(`${label}이(가) 필요하다`);
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) fail(`${label}이(가) 비어 있다`);
  if (looksSecret(t)) fail(`${label}에 토큰·키·이메일처럼 보이는 문자열이 있어 저장하지 않는다`);
  return [...t].length > max ? [...t].slice(0, max - 1).join("") + "…" : t;
}

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { flags[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]);
  }
  return { pos, flags };
}

function withLock(fn) {
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  const start = Date.now();
  for (;;) {
    try { fs.closeSync(fs.openSync(LOCK_FILE, "wx")); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 10000) fs.unlinkSync(LOCK_FILE); } catch {}
      if (Date.now() - start > 8000) fail("다른 갱신이 끝나지 않는다(잠금 대기 초과)");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  // fail()이 process.exit로 끝내도 잠금이 남지 않게 한다.
  const release = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
  process.on("exit", release);
  try { return fn(); } finally { release(); process.off("exit", release); }
}

function readStatus() {
  if (!fs.existsSync(STATUS_FILE)) fail(`${STATUS_FILE}이 없다. 먼저 \`node update.js init\`을 실행한다`);
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch { fail("status.json이 깨져 있다. 파일을 바꾸지 않았다"); }
}

function atomicWrite(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function readBoard() {
  if (!fs.existsSync(BOARD_FILE)) fail(`${BOARD_FILE}이 없다. 먼저 \`node update.js init\`을 실행한다`);
  try { return JSON.parse(fs.readFileSync(BOARD_FILE, "utf8")); } catch { fail("board.json이 깨져 있다. 파일을 바꾸지 않았다"); }
}

function warn(status) {
  if (!fs.existsSync(BOARD_FILE)) return;
  try { for (const w of crossCheck(status, JSON.parse(fs.readFileSync(BOARD_FILE, "utf8")))) console.warn("경고: " + w); } catch {}
}

function writeStatus(s) {
  s.meta.updatedAt = nowKst();
  const errs = validateStatus(s);
  if (errs.length) fail("검증 실패, 파일을 바꾸지 않았다:\n - " + errs.join("\n - "));
  atomicWrite(STATUS_FILE, s);
  warn(s);
}

function writeBoard(b) {
  const errs = validateBoard(b);
  if (errs.length) fail("board 검증 실패, 파일을 바꾸지 않았다:\n - " + errs.join("\n - "));
  atomicWrite(BOARD_FILE, b);
}

function lastLoggedEventId() {
  if (!fs.existsSync(EVENTS_FILE)) return 0;
  const lines = fs.readFileSync(EVENTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  try { return lines.length ? JSON.parse(lines[lines.length - 1]).id : 0; } catch { return 0; }
}

const stateFromProgress = (p, prev) => (prev === "blocked" ? "blocked" : p >= 100 ? "done" : p > 0 ? "doing" : "todo");

function parseOrder(v) { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 999) fail("--order는 1~999 정수"); return n; }
const commands = {
  init(_pos, flags) {
    withLock(() => {
      if (fs.existsSync(STATUS_FILE) && flags.force !== "yes") fail("이미 status.json이 있다. 덮어쓰려면 `--force yes`");
      writeStatus(seedStatus());
      writeBoard(seedBoard());
    });
    console.log("초기화 완료: " + STATUS_FILE + ", " + BOARD_FILE);
  },
  event(_pos, f) {
    const from = f.from, to = f.to;
    withLock(() => {
      const s = readStatus();
      const id = Math.max(s.events.at(-1)?.id ?? 0, lastLoggedEventId()) + 1;
      const ev = {
        id, at: nowKst(), from, to,
        title: cleanText("--title", f.title), summary: cleanText("--summary", f.summary ?? f.title),
        taskId: f.task ?? null, kind: f.kind ?? "doc",
      };
      s.events.push(ev);
      while (s.events.length > MAX_EVENTS) s.events.shift();
      writeStatus(s); // 검증 통과 후에만 기록용 파일에 남긴다
      fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
      fs.appendFileSync(EVENTS_FILE, JSON.stringify(ev) + "\n");
      console.log(`이벤트 #${id} 기록: ${from} → ${to}`);
    });
  },
  progress(pos) {
    const [taskId, raw] = pos;
    const p = Number(raw);
    if (!taskId || !/^\d{1,3}$/.test(String(raw ?? "")) || p > 100) fail("사용법: progress <작업ID> <0~100 정수>");
    withLock(() => {
      const s = readStatus();
      const t = s.tasks.find((x) => x.id === taskId);
      if (!t) fail(`없는 작업: ${taskId}`);
      t.progress = p; t.state = stateFromProgress(p, t.state); t.updatedAt = nowKst();
      writeStatus(s);
      console.log(`${taskId} 진행도 ${p}% (${t.state})`);
    });
  },
  state(pos, f) {
    const [agentId, status, ...noteParts] = pos;
    withLock(() => {
      const s = readStatus();
      const a = s.agents.find((x) => x.id === agentId);
      if (!a) fail(`없는 에이전트: ${agentId} (있는 에이전트: ${s.agents.map((x) => x.id).join(", ")})`);
      a.status = status;
      if (noteParts.length) a.note = cleanText("note", noteParts.join(" "));
      if ("task" in f) a.currentTaskId = f.task === "none" ? null : f.task;
      writeStatus(s);
      console.log(`${agentId} 상태: ${status}`);
    });
  },
  task(pos, f) {
    const [taskId] = pos;
    if (!taskId) fail("사용법: task <ID> [--title ..] [--owner ..] [--zone ..] [--state ..]");
    withLock(() => {
      const s = readStatus();
      let t = s.tasks.find((x) => x.id === taskId);
      if (!t) {
        if (!f.title || !f.owner || !f.zone) fail("새 작업은 --title --owner --zone이 모두 필요하다");
        t = { id: taskId, title: "", ownerAgentId: f.owner, zone: f.zone, progress: 0, state: "todo", updatedAt: nowKst() };
        s.tasks.push(t);
        const b = readBoard();
        const z = b.zones.find((x) => x.id === f.zone);
        if (!z) fail(`board.json에 없는 구역: ${f.zone}`);
        if (!z.taskIds.includes(taskId)) { z.taskIds.push(taskId); writeBoard(b); }
      }
      if (f.title) t.title = cleanText("--title", f.title);
      if (f.owner) t.ownerAgentId = f.owner;
      if (f.state) { t.state = f.state; if (f.state === "done") t.progress = 100; }
      t.updatedAt = nowKst();
      writeStatus(s);
      console.log(`작업 ${taskId} 갱신`);
    });
  },
  mvp(pos, f) {
    const [id, status] = pos;
    if (!id || !status) fail("사용법: mvp <ID> <in|out|pending> [--title '제목']");
    withLock(() => {
      const b = readBoard();
      let m = b.mvp.find((x) => x.id === id);
      if (!m) { if (!f.title) fail("새 MVP 항목은 --title이 필요하다"); m = { id, title: "", status }; b.mvp.push(m); }
      m.status = status;
      if (f.title) m.title = cleanText("--title", f.title);
      if (f.order !== undefined) m.order = parseOrder(f.order);
      if (f.tasks !== undefined) m.taskIds = String(f.tasks).split(",").map((x) => x.trim()).filter(Boolean); // 구현 진행도를 재는 연결 작업
      writeBoard(b);
      console.log(`MVP ${id}: ${status}`);
    });
  },
  order(pos) { // 작업 순서 지정: order <mvp|bp> M2,M1,M3  → 나열한 순서대로 1,2,3. 나열하지 않은 항목은 순서를 지운다(맨 뒤).
    const [kind, list] = pos;
    if (!["mvp", "bp"].includes(kind) || !list) fail("사용법: order <mvp|bp> <ID,ID,…>  (앞에 쓴 것이 먼저)");
    const ids = list.split(",").map((x) => x.trim()).filter(Boolean);
    if (new Set(ids).size !== ids.length) fail("같은 ID를 두 번 쓸 수 없다");
    withLock(() => {
      const b = readBoard();
      const items = b[kind] ?? [];
      for (const id of ids) if (!items.some((x) => x.id === id)) fail(`없는 ${kind.toUpperCase()} 항목: ${id}`);
      for (const x of items) { const i = ids.indexOf(x.id); if (i >= 0) x.order = i + 1; else delete x.order; }
      writeBoard(b);
      console.log(`${kind.toUpperCase()} 순서: ${ids.join(" → ")}`);
    });
  },
  prd(pos, f) { // PRD(요구사항 문서) 항목의 확정 단계: draft|review|approved
    const [id, status] = pos;
    if (!id || !status) fail("사용법: prd <ID> <draft|review|approved> [--title '제목']");
    withLock(() => {
      const b = readBoard();
      b.prd ??= [];
      let p = b.prd.find((x) => x.id === id);
      if (!p) { if (!f.title) fail("새 PRD 항목은 --title이 필요하다"); p = { id, title: "", status }; b.prd.push(p); }
      p.status = status;
      if (f.title) p.title = cleanText("--title", f.title);
      writeBoard(b);
      console.log(`PRD ${id}: ${status}`);
    });
  },
  bp(pos, f) { // BP(사업계획) 항목: draft|review|approved
    const [id, status] = pos;
    if (!id || !status) fail("사용법: bp <ID> <draft|review|approved> [--area market|customer|…] [--title '제목'] [--note '메모'|none]");
    withLock(() => {
      const b = readBoard();
      b.bp ??= [];
      let x = b.bp.find((y) => y.id === id);
      if (!x) { if (!f.title || !f.area) fail("새 BP 항목은 --title과 --area가 필요하다"); x = { id, area: f.area, title: "", status }; b.bp.push(x); }
      x.status = status;
      if (f.area) x.area = f.area;
      if (f.title) x.title = cleanText("--title", f.title);
      if (f.order !== undefined) x.order = parseOrder(f.order);
      if (f.note !== undefined) { if (f.note === "none") delete x.note; else x.note = cleanText("--note", f.note); }
      writeBoard(b);
      console.log(`BP ${id}: ${status}`);
    });
  },
  "command-state"(pos, f) {
    const [rawId, state] = pos;
    if (!/^\d+$/.test(rawId ?? "") || !["delivered", "done"].includes(state)) fail("사용법: command-state <id> delivered|done [--note '메모']");
    const note = f.note === undefined ? undefined : cleanText("--note", f.note);
    try {
      const c = transition(INBOX_FILE, Number(rawId), state, { at: nowKst(), note });
      console.log(`지시 #${c.id} (${c.kind === "team" ? "공동·모두에게" : "개인·" + c.to}): ${c.state}`);
    } catch (e) { fail(e.message); }
  },
  // 팀·에이전트 추가(DESIGN4.md). 한도·중복·없는 팀은 validateStatus가 거절하고, 그러면 파일은 바뀌지 않는다.
  team(pos, f) {
    const [sub, id] = pos;
    if (!["add", "rename"].includes(sub) || !id) fail("사용법: team add <팀id> --name '이름' [--order 정수] / team rename <팀id> --name '새 이름'");
    withLock(() => {
      const s = readStatus();
      if (typeof f.name === "string" && [...f.name.trim()].length > MAX_TEAM_NAME) fail(`--name은 ${MAX_TEAM_NAME}자 이하`);
      const name = cleanText("--name", f.name, MAX_TEAM_NAME);
      if (sub === "add") {
        if (!Array.isArray(s.teams)) {
          // 처음 팀을 만들면 지금 에이전트 전원이 들어갈 기본 팀(main)을 함께 만든다.
          s.teams = id === DEFAULT_TEAM ? [] : [{ id: DEFAULT_TEAM, name: "기본" }];
        }
        if (s.teams.some((t) => t.id === id)) fail(`이미 있는 팀: ${id}`);
        const t = { id, name };
        if (f.order !== undefined) { if (!/^-?\d+$/.test(f.order)) fail("--order는 정수"); t.order = Number(f.order); }
        s.teams.push(t);
      } else {
        const t = (s.teams ?? []).find((x) => x.id === id);
        if (!t) fail(`없는 팀: ${id}`);
        t.name = name;
      }
      writeStatus(s);
      console.log(`팀 ${sub === "add" ? "추가" : "이름 변경"}: ${id} (${name})`);
    });
  },
  agent(pos, f) {
    const [sub, id] = pos;
    if (!["add", "move"].includes(sub) || !id) fail("사용법: agent add <id> --name '이름' --role '역할' [--team 팀id] [--model '모델'] / agent move <id> --team 팀id");
    withLock(() => {
      const s = readStatus();
      if (sub === "add") {
        if (s.agents.some((a) => a.id === id)) fail(`이미 있는 에이전트 id: ${id}`);
        const a = { id, name: cleanText("--name", f.name, 20), role: cleanText("--role", f.role), status: "idle", currentTaskId: null, note: "대기" };
        if (f.model) a.model = cleanText("--model", f.model);
        if (f.team) a.teamId = f.team;
        s.agents.push(a);
      } else {
        const a = s.agents.find((x) => x.id === id);
        if (!a) fail(`없는 에이전트: ${id}`);
        if (!f.team) fail("--team이 필요하다");
        a.teamId = f.team;
      }
      writeStatus(s);
      console.log(sub === "add" ? `에이전트 추가: ${id}${f.team ? ` (팀 ${f.team})` : ""}` : `에이전트 팀 이동: ${id} → ${f.team}`);
    });
  },
  help() {
    console.log(`사용법
  node update.js init [--force yes]
  node update.js event --from gpt --to claude --title '제목' [--summary '한 줄'] [--task T6] [--kind doc|ask|reply|report]
  node update.js progress T6 60
  node update.js state gpt working '메모' [--task T6|none]
  node update.js command-state 7 delivered|done [--note '메모']\n  node update.js team add review --name '검수팀' [--order 2]   (처음이면 기본 팀 main도 함께 만든다)\n  node update.js team rename review --name '새 이름'\n  node update.js agent add rev1 --name '검수 1' --role '검수' [--team review] [--model '모델']\n  node update.js agent move rev1 --team review\n  node update.js mvp M5 in [--title '제목'] [--tasks T1,T2]\n  node update.js order mvp M2,M1,M3   (또는 bp B1,B2…: 앞에 쓴 것이 먼저. --order N으로 하나씩도 가능)\n  node update.js prd P1 approved [--title '제목']\n  node update.js bp B1 approved [--area revenue] [--title '제목'] [--note '메모']\n  node update.js task W5 --title '제목' --owner gpt --zone z-3d [--state doing]`);
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (!commands[cmd]) { commands.help(); process.exit(cmd ? 1 : 0); }
  const { pos, flags } = parseArgs(rest);
  commands[cmd](pos, flags);
}
