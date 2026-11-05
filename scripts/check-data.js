#!/usr/bin/env node
// 저장소에 올리기 전에 status.json·board.json이 형식에 맞는지 확인한다: npm run check:data -- <폴더>
import fs from "node:fs"; import path from "node:path";
import { validateStatus, validateBoard, crossCheck } from "../src/shared/validate.js";

const dir = process.argv[2];
if (!dir) { console.error("사용법: npm run check:data -- <status.json과 board.json이 있는 폴더>"); process.exit(2); }
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return { __err: `${f}: 읽지 못함(${e.code || "JSON 오류"})` }; } };
const st = read("status.json"), bd = read("board.json");
const problems = [];
if (st.__err) problems.push(st.__err); else problems.push(...validateStatus(st).map((e) => `status.json: ${e}`));
if (bd.__err) problems.push(bd.__err); else problems.push(...validateBoard(bd).map((e) => `board.json: ${e}`));
const warns = !problems.length ? crossCheck(st, bd) ?? [] : [];
for (const w of warns) console.log("확인할 점:", w);
if (problems.length) { for (const p of problems) console.error("오류:", p); process.exit(1); }
console.log("통과: 이 폴더를 저장소에 올려도 된다.");
