// 공개 전 검사: 샘플 데이터에 실제 내용이 섞였는지, 공개 빌드에 서버 호출·지시 기능이 남았는지 본다.
// 사용: node scripts/check-public.js [샘플폴더=public-sample] [빌드폴더=dist-public]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { validateStatus, validateBoard, crossCheck, AGENT_IDS } from "../src/shared/validate.js";
import { validateProjects } from "../src/shared/projects.js";
import { looksSecret } from "../src/shared/secret.js";

// 공개되면 안 되는 말(도구·모델명·경로). 사람·프로젝트명 같은 개인 표기는 코드에 적지 않고 아래 privateDeny()로 받는다.
const DENY = [/claude/i, /gpt/i, /openai/i, /anthropic/i, /sonnet|opus|haiku/i, /codex/i, /\/workspace/, /\/home\//, /[A-Za-z]:\\/, /firebase/i, /총괄/, /DASH_PASSWORD/, /inbox/i];

// 개인 금지어(사람·프로젝트명)는 코드에 적지 않는다. 환경변수 SOURCE_DENY(쉼표 구분)·SOURCE_DENY_FILE(한 줄에 하나)이나, 비공개 복사본의 scripts/.source-deny.local에서 읽는다.
const LOCAL_DENY = path.join(path.dirname(fileURLToPath(import.meta.url)), ".source-deny.local");
function privateDeny() {
  const t = (process.env.SOURCE_DENY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const f = process.env.SOURCE_DENY_FILE || (fs.existsSync(LOCAL_DENY) ? LOCAL_DENY : ""); // 비공개 복사본에서만 있는 파일(공개 복사본에는 없음)
  if (f) t.push(...fs.readFileSync(f, "utf8").split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("#")));
  return t.map((x) => new RegExp(x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
const denyList = () => [...DENY, ...privateDeny()];

function strings(v, out = []) {
  if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => { out.push(k); strings(x, out); });
  return out;
}

export function checkSample(dir) {
  const problems = [];
  const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")); } catch (e) { problems.push(`${n}: 읽기 실패(${e.message})`); return null; } };
  const status = read("status.json"), board = read("board.json");
  const se = status ? validateStatus(status) : [], be = board ? validateBoard(board) : [];
  problems.push(...se.map((e) => `status.json: ${e}`), ...be.map((e) => `board.json: ${e}`));
  if (status && board && !se.length && !be.length) { const w = crossCheck(status, board); if (w?.length) problems.push(...w.map((e) => `교차 점검: ${e}`)); }
  for (const [name, data] of [["status.json", status], ["board.json", board]]) {
    if (!data) continue;
    for (const s of strings(data)) {
      if (AGENT_IDS.includes(s)) continue; // 에이전트 ID(chief|claude|gpt)는 형식상 필요한 키 값
      for (const re of denyList()) if (re.test(s)) problems.push(`${name}: 공개 금지어(${re}) → "${s.slice(0, 40)}"`);
      if (looksSecret(s)) problems.push(`${name}: 키·토큰·이메일 모양 → "${s.slice(0, 20)}…"`);
    }
  }
  // 공개판의 projects.json(선택): 형식 통과, 비공개 저장소(private) 없음, 금지어·비밀 모양 없음
  if (fs.existsSync(path.join(dir, "projects.json"))) {
    const pj = read("projects.json");
    if (pj) {
      problems.push(...validateProjects(pj).map((e) => `projects.json: ${e}`));
      for (const x of Array.isArray(pj.projects) ? pj.projects : []) if (x && x.private) problems.push(`projects.json: 공개판에 private 프로젝트(${x.id})는 쓸 수 없다`);
      for (const t of strings(pj)) {
        for (const re of denyList()) if (re.test(t)) problems.push(`projects.json: 공개 금지어(${re}) → "${t.slice(0, 40)}"`);
        if (looksSecret(t)) problems.push(`projects.json: 키·토큰·이메일 모양 → "${t.slice(0, 20)}…"`);
      }
    }
  }
  for (const f of fs.readdirSync(dir)) if (!["status.json", "board.json", "projects.json"].includes(f)) problems.push(`샘플 폴더에 예상 밖 파일: ${f}`);
  return problems;
}

// 빌드 폴더 안의 모든 텍스트 파일을 훑는다.
function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : out.push(p); } return out; }

export function checkBuild(buildDir, sampleDir) {
  const problems = [];
  if (!fs.existsSync(buildDir)) return [`빌드 폴더 없음: ${buildDir}`];
  const files = walk(buildDir);
  for (const n of ["status.json", "board.json"]) {
    const a = path.join(buildDir, n), b = path.join(sampleDir, n);
    if (!fs.existsSync(a)) problems.push(`빌드에 ${n} 없음`);
    else if (fs.readFileSync(a, "utf8") !== fs.readFileSync(b, "utf8")) problems.push(`빌드의 ${n}이 샘플과 다름(실제 데이터가 섞였을 수 있음)`);
  }
  for (const f of files) {
    const rel = path.relative(buildDir, f);
    if (/\.(mp4|png|jpe?g|gif|webp)$/i.test(f) && !/^assets\//.test(rel)) problems.push(`예상 밖 미디어 파일: ${rel}`);
    if (/(^|\/)(inbox|\.env|.*\.lock|.*\.tmp)/.test(rel)) problems.push(`공개 금지 파일: ${rel}`);
    if (!/\.(html|js|css|json|svg|txt|map)$/i.test(f)) continue;
    const text = fs.readFileSync(f, "utf8");
    if (/\/api\/(login|session|command)/.test(text)) problems.push(`${rel}: 서버 API 호출 코드가 남아 있음`);
    if (/DASH_PASSWORD|inbox\.json|\/workspace\/|\/home\/box/.test(text)) problems.push(`${rel}: 내부 이름·경로가 남아 있음`);
    if (/\.map$/.test(f)) problems.push(`소스맵 포함: ${rel}`);
    if (rel.endsWith(".html")) for (const re of denyList()) if (re.test(text)) problems.push(`${rel}: 공개 금지어(${re})`);
  }
  return problems;
}

// 공개 문서(README, ADOPT)용 검사. 에이전트 id(claude, gpt)와 환경변수 이름은 사용법에 꼭 필요해서 허용하고,
// 실제 프로젝트명·사람·내부 경로·키·이메일만 막는다.
const DOC_DENY = [/openai/i, /anthropic/i, /sonnet|opus|haiku/i, /codex/i, /\/workspace/, /\/home\//, /[A-Za-z]:\\/, /firebase/i, /총괄/, /github\.com\/[\w-]+/i];
export function checkDoc(file) {
  const problems = [], name = path.basename(file);
  if (!fs.existsSync(file)) return [`${name}: 파일 없음`];
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    for (const re of [...DOC_DENY, ...privateDeny()]) if (re.test(line)) problems.push(`${name}:${i + 1}: 공개 금지어(${re}) → "${line.trim().slice(0, 40)}"`);
    for (const tok of line.split(/[\s`"'()<>,]+/)) if (tok && !/^[가-힣]+$/.test(tok) && looksSecret(tok)) problems.push(`${name}:${i + 1}: 키·토큰·이메일 모양 → "${tok.slice(0, 20)}…"`);
  });
  return problems;
}

// 공개 저장소 폴더 검사(GitHub Pages용 평평한 구조): 최상위에 index.html, assets/, 샘플 json 두 개, README.md, ADOPT.md만 있어야 한다.
export const RELEASE_ITEMS = ["index.html", "assets", "status.json", "board.json", "README.md", "ADOPT.md"];
export const OPTIONAL_RELEASE_ITEMS = ["projects.json"]; // 여러 프로젝트를 읽는 공개판만 둔다
export function checkRelease(dir, sampleDir) {
  const problems = [];
  if (!fs.existsSync(dir)) return [`폴더 없음: ${dir}`];
  const found = fs.readdirSync(dir);
  for (const f of found) if (!RELEASE_ITEMS.includes(f) && !OPTIONAL_RELEASE_ITEMS.includes(f)) problems.push(`올리면 안 되는 항목: ${f}`);
  for (const f of RELEASE_ITEMS) if (!found.includes(f)) problems.push(`빠진 항목: ${f}`);
  problems.push(...checkBuild(dir, sampleDir));
  for (const f of ["README.md", "ADOPT.md"]) if (found.includes(f)) problems.push(...checkDoc(path.join(dir, f)));
  return problems;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url) && process.argv[2] === "--release") {
  const problems = checkRelease(path.resolve(process.argv[3] ?? ""), path.resolve(process.argv[4] ?? "public-sample"));
  if (problems.length) { console.error("공개 폴더 검사 실패:\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("공개 폴더 검사 통과: index.html·assets·샘플 json·README.md·ADOPT.md만 있고 금지어·내부 경로·키가 없음");
} else if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const sample = path.resolve(process.argv[2] ?? "public-sample"), build = path.resolve(process.argv[3] ?? "dist-public");
  const problems = [...checkSample(sample), ...checkBuild(build, sample)];
  if (problems.length) { console.error("공개 검사 실패:\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("공개 검사 통과: 샘플 데이터와 빌드에 실제 내용·서버 호출이 없음");
}
