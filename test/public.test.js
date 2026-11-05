import { describe, it, expect } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { writeSample, publicStatus } from "../scripts/public-sample.js";
import { checkSample, checkBuild, checkDoc, checkRelease } from "../scripts/check-public.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "w3d-pub-"));
const sampleDir = () => { const d = tmp(); writeSample(d); return d; };

describe("공개 샘플 검사", () => {
  it("만들어 둔 샘플은 통과한다", () => expect(checkSample(sampleDir())).toEqual([]));
  it("저장소의 public-sample도 생성기 결과와 같다", () => {
    const d = sampleDir();
    for (const n of ["status.json", "board.json"]) expect(fs.readFileSync(path.resolve("public-sample", n), "utf8")).toBe(fs.readFileSync(path.join(d, n), "utf8"));
  });
  it("실제 프로젝트명·모델명·경로·이메일·키가 섞이면 잡는다", () => {
    for (const bad of ["claude-sonnet-5-5", "/workspace/projects/x", "me@example.com", "sk-abcdefghijklmnopqrstuvwx", "OpenAI 연동", "총괄 확인"]) {
      const d = sampleDir(); const s = publicStatus(); s.tasks[0].title = bad.slice(0, 80);
      fs.writeFileSync(path.join(d, "status.json"), JSON.stringify(s));
      expect(checkSample(d).length, bad).toBeGreaterThan(0);
    }
  });
  it("형식이 틀리거나 예상 밖 파일이 있으면 잡는다", () => {
    const d = sampleDir(); fs.writeFileSync(path.join(d, "inbox.json"), "[]");
    expect(checkSample(d).join()).toContain("예상 밖 파일");
    const e = sampleDir(); fs.writeFileSync(path.join(e, "board.json"), "{}");
    expect(checkSample(e).length).toBeGreaterThan(0);
  });
});

describe("공개 빌드 검사", () => {
  const build = (extra = {}) => {
    const s = sampleDir(), b = tmp(); fs.mkdirSync(path.join(b, "assets"));
    for (const n of ["status.json", "board.json"]) fs.copyFileSync(path.join(s, n), path.join(b, n));
    fs.writeFileSync(path.join(b, "index.html"), "<html></html>");
    for (const [k, v] of Object.entries(extra)) fs.writeFileSync(path.join(b, k), v);
    return [b, s];
  };
  it("깨끗한 빌드는 통과", () => expect(checkBuild(...build())).toEqual([]));
  it("서버 API 호출·내부 경로가 남으면 잡는다", () => {
    expect(checkBuild(...build({ "assets/a.js": 'fetch("/api/login")' })).join()).toContain("서버 API");
    expect(checkBuild(...build({ "assets/a.js": "x='/workspace/projects'" })).join()).toContain("내부 이름");
  });
  it("실제 데이터 파일이 들어가거나 inbox가 있으면 잡는다", () => {
    const [b, s] = build(); fs.writeFileSync(path.join(b, "status.json"), '{"real":1}');
    expect(checkBuild(b, s).join()).toContain("샘플과 다름");
    expect(checkBuild(...build({ "inbox.json": "[]" })).join()).toContain("공개 금지 파일");
  });
  it("소스맵·예상 밖 영상은 잡는다", () => {
    expect(checkBuild(...build({ "assets/a.js.map": "{}" })).join()).toContain("소스맵");
    expect(checkBuild(...build({ "demo.mp4": "x" })).join()).toContain("미디어");
  });
});

describe("checkDoc / checkRelease", () => {
  const doc = (text) => { const f = path.join(tmp(), "D.md"); fs.writeFileSync(f, text); return f; };
  it("에이전트 id·환경변수 이름이 있는 일반 안내는 통과", () => {
    expect(checkDoc(doc("id는 `chief` / `claude` / `gpt`. `DASH_PASSWORD=내암호 npm start`, `data/inbox.json`"))).toEqual([]);
  });
  it("실제 이름·내부 경로·이메일·키는 잡는다", () => {
    for (const bad of ["/workspace/projects/x", "/home/box/a", "C:\\Users\\a", "총괄이 말한", "me@example.com", "sk-abcdefghijklmnopqrstuvwxyz0123456789", "https://github.com/someone/repo"])
      expect(checkDoc(doc(bad)).length, bad).toBeGreaterThan(0);
  });
  it("없는 파일은 실패", () => expect(checkDoc("/nonexistent/x.md").length).toBe(1));
  it("공개 폴더는 정해진 항목만 허용하고 모두 있어야 한다", () => {
    const s = sampleDir(), d = tmp();
    for (const n of ["status.json", "board.json"]) fs.copyFileSync(path.join(s, n), path.join(d, n));
    fs.writeFileSync(path.join(d, "index.html"), "<html></html>"); fs.mkdirSync(path.join(d, "assets")); fs.writeFileSync(path.join(d, "assets", "a.js"), "1");
    fs.writeFileSync(path.join(d, "README.md"), "소개"); fs.writeFileSync(path.join(d, "ADOPT.md"), "안내");
    expect(checkRelease(d, s)).toEqual([]);
    fs.writeFileSync(path.join(d, "server.js"), "x"); expect(checkRelease(d, s).join()).toContain("올리면 안 되는 항목: server.js");
    fs.rmSync(path.join(d, "server.js")); fs.rmSync(path.join(d, "ADOPT.md")); expect(checkRelease(d, s).join()).toContain("빠진 항목: ADOPT.md");
    fs.writeFileSync(path.join(d, "ADOPT.md"), "/workspace/x"); expect(checkRelease(d, s).join()).toContain("공개 금지어");
  });
});

describe("개인 금지어(SOURCE_DENY)", () => {
  it("환경변수로 준 금지어가 샘플·문서 검사에 걸린다", () => {
    const old = process.env.SOURCE_DENY;
    try {
      process.env.SOURCE_DENY = "zzprivate";
      const d = sampleDir(); const f = path.join(d, "status.json"); const j = JSON.parse(fs.readFileSync(f, "utf8")); j.agents[0].note = "zzprivate 메모"; fs.writeFileSync(f, JSON.stringify(j));
      expect(checkSample(d).join()).toContain("공개 금지어");
      const doc = path.join(tmp(), "README.md"); fs.writeFileSync(doc, "zzprivate 사용법"); expect(checkDoc(doc).join()).toContain("공개 금지어");
    } finally { if (old === undefined) delete process.env.SOURCE_DENY; else process.env.SOURCE_DENY = old; }
  });
});
