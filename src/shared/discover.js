// 저장소 자동 찾기: GitHub 저장소에 토픽 "work-status-3d"를 붙여 두면 화면이 알아서 사무동으로 연결한다(손으로 저장소를 적지 않는다).
// 공개판은 브라우저가 GitHub 검색으로, 서버 모드는 서버가 토큰 계정의 저장소 목록에서 찾는다. 이 파일은 순수 함수만 둔다.
import { adhocSourcesOf, MAX_PROJECTS, MAX_PROJECT_NAME } from "./projects.js";
import { validateStatus } from "./validate.js";

export const TOPIC = "work-status-3d";
export const DIR_CANDIDATES = ["", "status", "public", "data"]; // status.json이 있을 만한 폴더(맨 위 먼저)

/** "own/Some Repo.v2" → "gh-some-repo-v2" (projects.json id 규칙: 영소문자 시작, 24자 이하) */
export function projectIdOf(fullName) {
  const name = String(fullName).split("/").pop().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return ("gh-" + (name || "repo")).slice(0, 24).replace(/-+$/, "");
}

/** 찾은 저장소들 → 단지 카드용 프로젝트 목록. items: [{repo, branch?, dir?}]. 형식이 틀린 것은 건너뛴다. */
export function reposToProjects(items, { viaServer = false } = {}) {
  const out = [], used = new Set();
  for (const it of items ?? []) {
    const a = adhocSourcesOf({ repo: it.repo, branch: it.branch, dir: it.dir }, { viaServer });
    if (!a.ok) continue;
    let id = projectIdOf(it.repo), n = 2;
    while (used.has(id)) { const suffix = `-${n++}`; id = projectIdOf(it.repo).slice(0, 24 - suffix.length) + suffix; }
    used.add(id);
    out.push({ id, name: [...String(it.repo).split("/").pop()].slice(0, MAX_PROJECT_NAME).join(""), repo: a.project.repo, branch: a.project.branch, dir: a.project.dir, adhoc: true, sources: a.sources });
    if (out.length >= MAX_PROJECTS) break;
  }
  return out;
}

/** 같은 저장소·브랜치·폴더인지 비교하는 키. 브랜치 생략은 main, 폴더 생략은 맨 위로 본다(projects.json과 자동 찾기 결과를 같게 본다). */
export const projectKey = (p) => `${p.repo ?? ""}|${p.branch || "main"}|${p.dir || ""}`;

/** 현재 목록에 찾은 것을 합친다(같은 저장소·폴더는 하나로). 기존 항목이 앞에 온다. */
export function mergeProjects(current, found) {
  const key = projectKey;
  const seen = new Set((current ?? []).map(key)), ids = new Set((current ?? []).map((p) => p.id));
  const add = [];
  for (const p of found ?? []) {
    if (seen.has(key(p))) continue;
    let id = p.id, n = 2; while (ids.has(id)) { const suffix = `-${n++}`; id = p.id.slice(0, 24 - suffix.length) + suffix; }
    ids.add(id); seen.add(key(p)); add.push({ ...p, id });
  }
  return [...(current ?? []), ...add].slice(0, MAX_PROJECTS);
}

/** GitHub Pages 주소(<소유자>.github.io)나 ?owner= 에서 소유자를 알아낸다. 모르면 "". */
export function ownerFromLocation(loc) {
  try {
    const q = new URLSearchParams(loc.search ?? "").get("owner");
    if (q && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(q)) return q;
    const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\.github\.io$/i.exec(loc.hostname ?? "");
    return m ? m[1] : "";
  } catch { return ""; }
}

/** 공개판(브라우저): 토픽이 붙은 저장소를 GitHub 검색으로 찾고, status.json이 있는 폴더를 알아낸다. */
export async function discoverPublic(owner, fetchFn = (...a) => fetch(...a)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner ?? "")) return { ok: false, error: "GitHub 사용자(또는 조직) 이름을 적어 주세요" };
  let res;
  try { res = await fetchFn(`https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${TOPIC} user:${owner}`)}&per_page=${MAX_PROJECTS}`, { headers: { Accept: "application/vnd.github+json" } }); }
  catch { return { ok: false, error: "GitHub에 연결하지 못했어요" }; }
  if (res.status === 403 || res.status === 429) return { ok: false, error: "GitHub 검색 한도에 걸렸어요. 잠시 뒤 다시 해 주세요" };
  if (!res.ok) return { ok: false, error: `GitHub 검색에 실패했어요(HTTP ${res.status})` };
  let body; try { body = await res.json(); } catch { return { ok: false, error: "GitHub 응답을 읽지 못했어요" }; }
  const items = [];
  for (const r of Array.isArray(body.items) ? body.items : []) {
    if (r.private || typeof r.full_name !== "string") continue;
    const branch = typeof r.default_branch === "string" ? r.default_branch : "main";
    for (const dir of DIR_CANDIDATES) {
      const a = adhocSourcesOf({ repo: r.full_name, branch, dir });
      if (!a.ok) break;
      try { const f = await fetchFn(a.sources.url, { cache: "no-store" }); if (f.ok && !validateStatus(await f.json()).length) { items.push({ repo: r.full_name, branch, dir }); break; } } catch { /* 다음 폴더 */ }
    }
  }
  return { ok: true, projects: reposToProjects(items), total: Array.isArray(body.items) ? body.items.length : 0 };
}
