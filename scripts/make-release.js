// 공개 저장소 폴더 만들기: node scripts/make-release.js <대상폴더>
// dist-public의 내용을 최상위로 펴고 README.md, ADOPT.md를 넣은 뒤 공개 검사를 돌린다. 업로드는 하지 않는다.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { checkRelease } from "./check-public.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) { console.error("사용법: node scripts/make-release.js <대상폴더>"); process.exit(1); }
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(`대상 폴더가 비어 있지 않음: ${out} (지운 뒤 다시 실행하세요)`); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "dist-public"), out, { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "PUBLIC_README.md"), path.join(out, "README.md"));
fs.copyFileSync(path.join(root, "ADOPT.md"), path.join(out, "ADOPT.md"));
const problems = checkRelease(out, path.join(root, "public-sample"));
if (problems.length) { console.error("공개 폴더 검사 실패:\n- " + problems.join("\n- ")); process.exit(1); }
const list = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : list.push(p); } })(out);
console.log("공개 폴더 검사 통과. 올릴 파일:"); for (const f of list.sort()) console.log(`${fs.statSync(f).size}\t${path.relative(out, f)}`);
