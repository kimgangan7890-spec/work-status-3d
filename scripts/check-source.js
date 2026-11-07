// 공개용 소스 폴더 검사: node scripts/check-source.js <폴더>
// 개인 표기(이름·계정·프로젝트명)는 이 파일에 적지 않는다. 필요하면 환경변수 SOURCE_DENY에 쉼표로 구분해 넘긴다.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const BAD_NAME = [/^\.env/, /\.(png|jpe?g|gif|webp|mp4|mov|log)$/i, /^inbox.*\.json$/i, /^events\.jsonl?$/i, /^DESIGN.*\.md$/i, /^PORTING\.md$/i, /\.local$/];
const BAD_DIR = new Set(["node_modules", "dist", "dist-public", "data", "reference_office", ".git", "verify_chief"]);
const TEXT = /\.(js|mjs|json|jsonl|md|html|css|txt|yml|yaml)$|^\.gitignore$/i;
const PATH_OK = new Set(["scripts/check-public.js", "scripts/check-source.js", "test/public.test.js"]); // 금지 경로를 일부러 적어 두는 파일
const FAKE = [/abcdefghijklmnopqrstuvwx/, /pw-for-test-/, /틀린암호/, /someone\/repo/, /fixture-[\w-]+/, /test-password/, /pw-x-1234/, /tok-SECRET-123/, /not-a-status-fi/, new RegExp("01234" + "56789")]; // 테스트가 일부러 쓰는 가짜 값
const EMAIL_OK = /@(example\.(com|org|net)|users\.noreply\.example)$/i;
const URL_OK = /^https?:\/\/(localhost|127\.0\.0\.1|api\.github\.com|github\.com|raw\.githubusercontent\.com|[\w.-]*example\.(com|org|net)|[\w.-]*\.example|registry\.npmjs\.org|www\.w3\.org|nodejs\.org|\$\{\w+\})([:/]|$)/i;

const RULES = [
  ["절대 경로", /(\/home\/|\/workspace|\/Users\/|\/root\/|(?<![\w/])[A-Za-z]:\\(?!\/))/, true],
  ["이메일", /[\w.+-]+@[\w-]+\.[\w.-]+/g, "email"],
  ["전화번호", /(?<![\d.])0\d{1,2}-\d{3,4}-\d{4}(?!\d)|(?<![\d.])01\d{8,9}(?!\d)/, "fake"],
  ["토큰·키 모양", /sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z_-]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY/, "fake"],
  ["고정 비밀번호 대입", /((?:[Pp]ass(?:word|wd)|PASS(?:WORD|WD)|[Ss]ecret|SECRET|[Aa]pi[_-]?[Kk]ey|API[_-]?KEY|[Tt]oken|TOKEN))["']?\s*[:=]\s*["'](?![A-Z][A-Z_]+["'])[^"'\s]{8,}["']/, "fake"],
];

export function privateTerms() {
  const t = (process.env.SOURCE_DENY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const f = process.env.SOURCE_DENY_FILE; // 저장소 밖에 둔 개인 금지어 파일(한 줄에 하나)
  if (f) t.push(...fs.readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")));
  return t.map((s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(base, p).split(path.sep).join("/");
    if (e.isDirectory()) { if (BAD_DIR.has(e.name)) out.bad.push(`금지 폴더: ${rel}/`); else walk(p, base, out); }
    else { if (BAD_NAME.some((re) => re.test(e.name))) out.bad.push(`금지 파일: ${rel}`); out.files.push([p, rel]); }
  }
  return out;
}

export function checkSource(dir, terms = privateTerms()) {
  const problems = [], found = walk(dir, dir, { files: [], bad: [] });
  problems.push(...found.bad);
  for (const [file, rel] of found.files) {
    if (!TEXT.test(path.basename(file))) { if (!found.bad.some((b) => b.endsWith(rel))) problems.push(`예상 밖 파일 형식: ${rel}`); continue; }
    if (rel === "package-lock.json") { // 잠금 파일은 의존성 주소만 확인한다
      for (const m of fs.readFileSync(file, "utf8").matchAll(/"resolved":\s*"([^"]+)"/g)) if (!URL_OK.test(m[1])) problems.push(`${rel}: 허용 밖 주소 ${m[1].slice(0, 60)}`);
      continue;
    }
    fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      for (const [name, re, mode] of RULES) {
        if (name === "절대 경로" && PATH_OK.has(rel)) continue;
        for (const m of line.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
          if (mode === "email" && EMAIL_OK.test(m[0])) continue;
          if (mode === "fake" && rel.startsWith("test/") && FAKE.some((f) => f.test(line))) continue;
          problems.push(`${at}: ${name} → "${m[0].slice(0, 24)}"`);
        }
      }
      for (const m of line.matchAll(/https?:\/\/[^\s"'`)<>\]]+/g)) if (!URL_OK.test(m[0]) && !(rel.startsWith("test/") && FAKE.some((f) => f.test(line)))) problems.push(`${at}: 허용 밖 주소 → "${m[0].slice(0, 50)}"`);
      for (const re of terms) if (re.test(line)) problems.push(`${at}: 개인 표기가 남아 있음`);
    });
  }
  return problems;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? "");
  if (!process.argv[2] || !fs.existsSync(dir)) { console.error("사용법: node scripts/check-source.js <폴더>  (개인 표기는 환경변수 SOURCE_DENY에 쉼표로 구분해 넘김)"); process.exit(1); }
  const p = checkSource(dir);
  if (p.length) { console.error(`소스 검사 실패 (${p.length}건):\n- ` + p.join("\n- ")); process.exit(1); }
  console.log(`소스 검사 통과 (개인 표기 검사 ${privateTerms().length}개 적용)`);
}
