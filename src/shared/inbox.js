// 작업 지시 저장소(inbox.json: 객체 배열, 최신 200개). 임시 파일에 쓴 뒤 이름을 바꿔 저장한다.
import fs from "node:fs";
import path from "node:path";
import { isAgentId, isTeamId, DEFAULT_TEAM } from "./validate.js";

export const TO_VALUES = ["chief", "claude", "gpt"];
export const KIND_VALUES = ["solo", "team"]; // 개인 작업 지시 / 공동 작업 지시(to는 "team")
export const TEAM_TO = "team";
export const MAX_COMMAND_CHARS = 300;
export const MAX_KEEP = 200;
const NEXT = { pending: "delivered", delivered: "done" };
const APPROVAL_KO = /삭제|지우|지워|제거|초기화(?!면)|덮어쓰|배포|결제|구매|입금|송금|발송|업로드|푸시(?!\s*알림)|공개\s*(해|하|로\s*(전환|바꿔))/;
const APPROVAL_EN = /\b(rm|rmdir|del|delete|remove|drop|truncate|wipe|purge|destroy|deploy|release|publish|push|upload|payment|pay|purchase|buy|checkout|sudo|chmod|chown)\b|reset\s+--hard|clean\s+-[a-z]*f|force[- ]push|--force|send\s+(an?\s+)?(mail|email|message)|git\s+push/i;

export const TEAM_PREFIX = "team:";

/** status.json에서 지시 대상으로 쓸 수 있는 에이전트·팀 id를 뽑는다. 읽을 수 없으면 null(형식만 검사). */
export function targetsOf(status) {
  if (!status || !Array.isArray(status.agents)) return null;
  const agentIds = status.agents.map((a) => a?.id).filter((v) => typeof v === "string");
  const declared = Array.isArray(status.teams) ? status.teams.map((t) => t?.id).filter((v) => typeof v === "string") : [];
  return { agentIds, teamIds: declared.length ? declared : [DEFAULT_TEAM] };
}

/**
 * 계약 검사. kind 생략=solo. 오류 코드(INVALID_KIND|INVALID_TO)를 돌려주고, 통과하면 null.
 * solo: to는 에이전트 id. team: to는 "team"(전체) 또는 "team:<팀id>".
 * targets({agentIds, teamIds})를 주면 실제 있는 id만 통과시키고, 없으면 id 형식만 본다.
 */
export function checkTarget(kind, to, targets = null) {
  if (kind === undefined) kind = "solo";
  if (!KIND_VALUES.includes(kind)) return "INVALID_KIND";
  if (kind === "solo") return isAgentId(to) && (!targets || targets.agentIds.includes(to)) ? null : "INVALID_TO";
  if (to === TEAM_TO) return null;
  if (typeof to === "string" && to.startsWith(TEAM_PREFIX)) {
    const id = to.slice(TEAM_PREFIX.length);
    return isTeamId(id) && (!targets || targets.teamIds.includes(id)) ? null : "INVALID_TO";
  }
  return "INVALID_TO";
}

export const needsApproval = (text) => APPROVAL_KO.test(text) || APPROVAL_EN.test(text);

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

export function withInboxLock(file, fn) {
  const lock = file + ".lock";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const start = Date.now();
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, "wx")); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch {}
      if (Date.now() - start > 5000) throw new Error("inbox 잠금 대기 초과");
      sleepMs(20);
    }
  }
  const release = () => { try { fs.unlinkSync(lock); } catch {} };
  process.on("exit", release);
  try { return fn(); } finally { release(); process.off("exit", release); }
}

/** id 오름차순 배열. 파일이 없거나 깨졌으면 빈 배열. */
export function readAll(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(file, "utf8"));
    // kind가 없는 옛 기록은 solo로 읽는다.
    return Array.isArray(arr) ? arr.filter((c) => c && Number.isInteger(c.id)).map((c) => (c.kind === undefined ? { ...c, kind: "solo" } : c)).sort((a, b) => a.id - b.id) : [];
  } catch { return []; }
}

function writeAll(file, list) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX_KEEP), null, 1) + "\n");
  fs.renameSync(tmp, file);
}

export function recent(file, n = 50) { return readAll(file).slice(-n).reverse(); }

export function addCommand(file, { kind = "solo", to, text, at, targets = null, project }) {
  const bad = checkTarget(kind, to, targets);
  if (bad) throw new Error(`${bad}: kind=${kind}, to=${to}`);
  return withInboxLock(file, () => {
    const all = readAll(file);
    const cmd = { id: (all.at(-1)?.id ?? 0) + 1, at, kind, to, text, state: "pending", needsApproval: needsApproval(text), deliveredAt: null, doneAt: null, ...(project ? { project } : {}) };
    all.push(cmd); writeAll(file, all);
    return cmd;
  });
}

/** pending→delivered→done만 허용한다. 되돌리기·건너뛰기는 오류. */
export function transition(file, id, state, { at, note } = {}) {
  return withInboxLock(file, () => {
    const all = readAll(file);
    const cur = all.find((c) => c.id === id);
    if (!cur) throw new Error(`없는 지시: ${id}`);
    if (NEXT[cur.state] !== state) throw new Error(`허용되지 않는 전이: ${cur.state} → ${state}`);
    Object.assign(cur, { state }, state === "delivered" ? { deliveredAt: at } : { doneAt: at });
    if (note !== undefined) cur.note = note;
    writeAll(file, all);
    return cur;
  });
}
