import { describe, it, expect } from "vitest";
import { projectIdOf, reposToProjects, mergeProjects, projectKey, ownerFromLocation, discoverPublic, TOPIC } from "../src/shared/discover.js";
import { validateProjects } from "../src/shared/projects.js";
import { seedStatus } from "../src/shared/seed.js";

const ok = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
const no = (status = 404) => ({ ok: false, status, json: async () => ({}) });

describe("자동 찾기 순수 함수", () => {
  it("id는 projects.json 규칙을 지킨다", () => {
    for (const n of ["own/My Repo.v2", "own/한글저장소", "own/" + "a".repeat(80), "own/_x"]) {
      const id = projectIdOf(n); expect(validateProjects({ projects: [{ id, name: "x" }] }), n + " → " + id).toEqual([]);
    }
  });
  it("저장소를 프로젝트로 바꾸고 이름이 겹치면 번호를 붙인다", () => {
    const ps = reposToProjects([{ repo: "a/web", dir: "status" }, { repo: "b/web" }, { repo: "bad repo" }]);
    expect(ps.map((p) => p.id)).toEqual(["gh-web", "gh-web-2"]); expect(ps[0].sources.url).toBe("https://raw.githubusercontent.com/a/web/main/status/status.json");
    expect(reposToProjects([{ repo: "a/web" }], { viaServer: true })[0].sources.url).toContain("/api/gh/status.json?repo=a%2Fweb");
  });
  it("합칠 때 같은 저장소는 중복되지 않고 id 충돌은 피한다", () => {
    const cur = [{ id: "gh-web", name: "web", repo: "a/web", dir: "status" }];
    const found = reposToProjects([{ repo: "a/web", dir: "status" }, { repo: "c/web" }]);
    const m = mergeProjects(cur, found); expect(m.map((p) => p.repo)).toEqual(["a/web", "c/web"]); expect(new Set(m.map((p) => p.id)).size).toBe(2);
  });
  it("브랜치 생략(main)·폴더 생략은 같은 저장소로 보고, id가 바뀌어도 키로 찾는다", () => {
    const cur = [{ id: "gh-web", name: "다른 것", repo: "z/other" }, { id: "site", name: "site", repo: "a/site" }];
    const found = reposToProjects([{ repo: "a/site", branch: "main", dir: "" }, { repo: "b/web" }]);
    const m = mergeProjects(cur, found);
    expect(m.map((p) => p.repo)).toEqual(["z/other", "a/site", "b/web"]);
    const keys = new Set(found.map(projectKey)), hit = m.filter((p) => keys.has(projectKey(p)));
    expect(hit.map((p) => p.id)).toEqual(["site", "gh-web-2"]); // 첫 찾은 것의 원래 id(gh-site)는 목록에 없고, gh-web은 다른 저장소
  });
  it("목록이 꽉 차면 찾은 것은 더하지 않는다", () => {
    const cur = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `p${i}`, repo: `o/p${i}` }));
    expect(mergeProjects(cur, reposToProjects([{ repo: "b/web" }])).some((p) => p.repo === "b/web")).toBe(false);
  });
  it("주소와 ?owner= 에서 소유자를 알아낸다", () => {
    expect(ownerFromLocation({ hostname: "kim.github.io", search: "" })).toBe("kim");
    expect(ownerFromLocation({ hostname: "x.com", search: "?owner=abc" })).toBe("abc");
    expect(ownerFromLocation({ hostname: "x.com", search: "?owner=../x" })).toBe("");
  });
});

describe("discoverPublic (브라우저)", () => {
  const st = seedStatus();
  it("토픽 검색 결과에서 status.json이 있는 폴더를 찾는다", async () => {
    const calls = [];
    const fetchFn = async (u) => {
      calls.push(u);
      if (u.startsWith("https://api.github.com/search/repositories")) return ok({ items: [{ full_name: "own/web", default_branch: "dev", private: false }, { full_name: "own/none", default_branch: "main" }, { full_name: "own/secret", private: true }] });
      if (u.includes("own/web/dev/status/status.json")) return ok(st);
      return no();
    };
    const r = await discoverPublic("own", fetchFn);
    expect(r.ok).toBe(true); expect(r.projects.map((p) => [p.repo, p.dir])).toEqual([["own/web", "status"]]);
    expect(decodeURIComponent(calls[0])).toContain(`topic:${TOPIC} user:own`);
    expect(calls.some((u) => u.includes("own/secret"))).toBe(false); // 비공개는 건너뜀
  });
  it("입력·한도·네트워크 오류를 알려 준다", async () => {
    for (const bad of ["bad name", "own topic:x", "own:x", "", undefined]) expect((await discoverPublic(bad, async () => { throw new Error("호출하면 안 됨"); })).ok).toBe(false); // 검색 쿼리 오염 방지
  });
  it("검색 결과의 이름·브랜치가 형식에 맞지 않으면 주소에 쓰지 않는다", async () => {
    const calls = [];
    const r = await discoverPublic("own", async (u) => { calls.push(u); return u.startsWith("https://api.github.com/") ? ok({ items: [{ full_name: "own/../x", default_branch: "main" }, { full_name: "own/w", default_branch: "a/../b" }] }) : no(); });
    expect(r.projects).toEqual([]); expect(calls.length).toBe(1);
    expect((await discoverPublic("own", async () => no(403))).error).toMatch(/한도/);
    expect((await discoverPublic("own", async () => { throw new Error("x"); })).error).toMatch(/연결/);
  });
});
