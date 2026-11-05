// 프로젝트 목록(projects.json) 규칙. 프로젝트 하나 = 사무동 하나.
// 브라우저(단지 화면)와 서버(비공개 저장소 중계)가 같은 코드를 쓴다. 토큰은 여기에 없다 — 서버 환경변수로만 다룬다.
import { TEAM_ID_RE } from "./validate.js";

export const MAX_PROJECTS = 12;
export const MAX_PROJECT_NAME = 20;
const REPO_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,99}$/;
const DIR_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const KEYS = ["id", "name", "repo", "branch", "dir", "private"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** @returns {string[]} 오류 목록. 비어 있으면 통과 */
export function validateProjects(p, { allowPrivate = true } = {}) {
  if (!isObj(p) || !Array.isArray(p.projects)) return ["projects 배열이 필요하다"];
  const e = [];
  if (p.projects.length < 1) e.push("프로젝트가 하나도 없다");
  if (p.projects.length > MAX_PROJECTS) e.push(`프로젝트는 최대 ${MAX_PROJECTS}개`);
  const seen = new Set();
  p.projects.forEach((x, i) => {
    const at = `projects[${i}]`;
    if (!isObj(x)) return e.push(`${at}: 객체가 아니다`);
    for (const k of Object.keys(x)) if (!KEYS.includes(k)) e.push(`${at}: 허용되지 않은 키 ${k}`);
    if (typeof x.id !== "string" || !TEAM_ID_RE.test(x.id)) e.push(`${at}: id 형식 오류(영소문자로 시작, 24자 이하)`);
    else if (seen.has(x.id)) e.push(`${at}: id 중복 ${x.id}`);
    else seen.add(x.id);
    if (typeof x.name !== "string" || !x.name.trim() || [...x.name].length > MAX_PROJECT_NAME) e.push(`${at}: name은 1~${MAX_PROJECT_NAME}자`);
    if (x.repo !== undefined && !(typeof x.repo === "string" && REPO_RE.test(x.repo))) e.push(`${at}: repo는 "소유자/저장소" 형식`);
    if (x.branch !== undefined && !(typeof x.branch === "string" && BRANCH_RE.test(x.branch) && !x.branch.includes(".."))) e.push(`${at}: branch 형식 오류`);
    if (x.dir !== undefined && !(typeof x.dir === "string" && DIR_RE.test(x.dir) && !x.dir.split("/").some((s) => s === "." || s === ".."))) e.push(`${at}: dir 형식 오류`);
    if (x.private === true && !allowPrivate) e.push(`${at}: 공개판에서는 private를 쓸 수 없다(서버 모드에서만)`);
    if (x.private !== undefined && typeof x.private !== "boolean") e.push(`${at}: private는 true/false`);
    if (x.repo === undefined && (x.branch !== undefined || x.dir !== undefined || x.private !== undefined)) e.push(`${at}: repo 없이 branch·dir·private를 쓸 수 없다`);
  });
  return e;
}

/** GitHub 안의 파일 경로. dir이 없으면 저장소 맨 위. */
export const filePathOf = (project, file) => (project.dir ? `${project.dir}/${file}` : file);

/**
 * 프로젝트의 데이터 주소.
 * - repo 없음: 이 화면과 같은 곳의 status.json/board.json(기존 동작).
 * - 공개 저장소: 브라우저가 raw.githubusercontent.com에서 직접 읽는다(토큰 없음).
 * - 비공개 저장소(private:true) 또는 서버 모드: 서버 중계 /api/p/<id>/…(토큰은 서버만 안다).
 * @param {{id:string, repo?:string, branch?:string, dir?:string, private?:boolean}} project
 * @param {{base?:string, viaServer?:boolean}} opts
 */
export function sourcesOf(project, { base = "./", viaServer = false } = {}) {
  if (!project.repo) return { url: `${base}status.json`, boardUrl: `${base}board.json`, intervalMs: 3000, remote: false };
  if (viaServer || project.private) {
    return { url: `/api/p/${project.id}/status.json`, boardUrl: `/api/p/${project.id}/board.json`, intervalMs: 10000, remote: true };
  }
  const root = `https://raw.githubusercontent.com/${project.repo}/${project.branch || "main"}`;
  return { url: `${root}/${filePathOf(project, "status.json")}`, boardUrl: `${root}/${filePathOf(project, "board.json")}`, intervalMs: 20000, remote: true };
}

/** 단지 카드에 보여 줄 요약. 검증을 통과한 status만 넣는다. */
export function summarize(status) {
  const agents = status.agents ?? [];
  return {
    project: status.meta?.project ?? "",
    updatedAt: status.meta?.updatedAt ?? "",
    agents: agents.length,
    working: agents.filter((a) => a.status === "working").length,
    blocked: agents.filter((a) => a.status === "blocked").length,
    teams: (status.teams ?? []).length || 1,
  };
}
