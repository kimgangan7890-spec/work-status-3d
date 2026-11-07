import { describe, it, expect } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { build } from "vite";
import { bundleIdHits, checkBuild } from "../scripts/check-public.js";
import { writeSample } from "../scripts/public-sample.js";
import { hairKindFor, FIXED_HAIR, FIXED_COLOR, HAIR_CAP } from "../src/shared/colors.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "w3d-bundle-"));

describe("JS 번들의 고정 에이전트 id 검사(bundleIdHits)", () => {
  it("문자열·속성 키·점 접근 자리의 id는 잡는다", () => {
    for (const bad of ["var j={chief:`#2E3A59`,claude:`#3E5A45`}", "u=t===`claude`?.2:1", "[`chief`,`claude`,`gpt`].includes(e)", 'x="GPT-5"', "a='Claude'", "o.gpt", '"총괄·claude"', "{gpt:1}", "{\n\tchief: \"#2E3A59\",\n\tclaude: 1\n}"])
      expect(bundleIdHits(bad).length, bad).toBeGreaterThan(0);
  });
  it("압축된 변수 이름·다른 낱말의 일부는 잡지 않는다(오탐 없음)", () => {
    for (const ok of ["function gpt(a){return gpt}", "var chief=1;chief+1", "a=gpt(b),c=[gpt]", "x-gpt", "a?b:gpt", "mischief", '"gptx"', "`claudes`", "encrypt", "{part:`a`,tall:`b`,crop:`c`}", "a ? b :\n gpt"])
      expect(bundleIdHits(ok), ok).toEqual([]);
  });
  it("checkBuild가 assets의 JS에서 id를 찾아 실패시킨다", () => {
    const s = tmp(), b = tmp(); writeSample(s); fs.mkdirSync(path.join(b, "assets"));
    for (const n of ["status.json", "board.json"]) fs.copyFileSync(path.join(s, n), path.join(b, n));
    fs.writeFileSync(path.join(b, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(b, "assets", "a.js"), "let u=S(r,[`alt1`,`alt2`,`other`][n%3]);function gpt(){}");
    expect(checkBuild(b, s)).toEqual([]);
    fs.writeFileSync(path.join(b, "assets", "a.js"), "var j={chief:`#2E3A59`}");
    expect(checkBuild(b, s).join()).toContain("고정 에이전트 id");
  });
});

// colors.js를 공개/비공개 정의로 실제 번들링해 본다: 공개판에는 id가 남지 않고 비공개판에는 남는다.
async function bundle(isPublic) {
  const out = await build({
    configFile: false, logLevel: "silent", define: { __PUBLIC__: JSON.stringify(isPublic) },
    build: { write: false, minify: true, lib: { entry: path.resolve("src/shared/colors.js"), formats: ["es"], fileName: "c" } },
  });
  return (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).map((c) => c.code ?? "").join("\n");
}
describe("공개 빌드의 colors.js", () => {
  it("__PUBLIC__=true면 고정 id가 번들에 없고, false면 그대로 있다", async () => {
    expect(bundleIdHits(await bundle(true))).toEqual([]);
    expect(bundleIdHits(await bundle(false)).length).toBeGreaterThan(0);
  }, 30000);
});

describe("머리 모양(hairKindFor)", () => {
  it("비공개판 고정 3명은 예전 모양 그대로(옆가르마·높은 머리·짧은 머리)", () => {
    expect(hairKindFor("chief", 0)).toBe("part");
    expect(hairKindFor("claude", 0)).toBe("tall");
    expect(hairKindFor("gpt", 2)).toBe("crop");
    expect(HAIR_CAP.tall).toBe(0.2); expect(HAIR_CAP.crop).toBe(0.1);
    expect(FIXED_COLOR.claude).toBe("#3E5A45");
  });
  it("그 밖의 id는 책상 순번으로 돌아간다(공개 샘플 lead/designer/developer)", () => {
    expect(["lead", "designer", "developer", "x"].map((id, i) => hairKindFor(id, i))).toEqual(["alt1", "alt2", "other", "alt1"]);
    expect(hairKindFor("constructor", 1)).toBe("alt2"); // 객체 기본 속성 이름에 속지 않는다
  });
  it("모양 이름은 에이전트 id와 겹치지 않는다", () => {
    for (const k of [...Object.values(FIXED_HAIR), ...Object.keys(HAIR_CAP)]) expect(["chief", "claude", "gpt"]).not.toContain(k);
  });
});
