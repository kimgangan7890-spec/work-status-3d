import { describe, it, expect } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { addCommand, transition, readAll, recent, checkTarget, MAX_KEEP, needsApproval } from "../src/shared/inbox.js";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "w3d-inbox-")), "inbox.json");
const AT = "2026-11-05T15:00:00+09:00";

describe("inbox.json", () => {
  it("DATA.md의 지시 예시(공개판 점검 등)와 흔한 화면 문구는 승인 필요가 아니다", () => {
    for (const t of ["오늘 안에 공개판 점검을 끝내 줘", "게시판 문구를 더 짧게 다듬어 줘", "공개 폴더 점검해 줘", "푸시 알림 문구 수정", "초기화면 디자인 손봐 줘"]) expect(needsApproval(t), t).toBe(false);
  });
  it("배열로 저장하고 임시 파일을 남기지 않는다", () => {
    const f = tmp(); addCommand(f, { to: "gpt", text: "a", at: AT });
    expect(Array.isArray(JSON.parse(fs.readFileSync(f, "utf8")))).toBe(true);
    expect(fs.readdirSync(path.dirname(f)).sort()).toEqual(["inbox.json"]);
  });
  it("최신 200개까지만 보관하고 id는 이어진다", () => {
    const f = tmp();
    for (let i = 0; i < MAX_KEEP + 5; i++) addCommand(f, { to: "gpt", text: "n" + i, at: AT });
    const all = readAll(f);
    expect(all.length).toBe(MAX_KEEP); expect(all[0].id).toBe(6); expect(all.at(-1).id).toBe(MAX_KEEP + 5);
    expect(recent(f, 50)[0].id).toBe(MAX_KEEP + 5); expect(recent(f, 50).length).toBe(50);
  });
  it("pending→delivered→done만 허용", () => {
    const f = tmp(); addCommand(f, { to: "claude", text: "x", at: AT });
    expect(() => transition(f, 1, "done", { at: AT })).toThrow();
    expect(transition(f, 1, "delivered", { at: AT, note: "전달" })).toMatchObject({ state: "delivered", deliveredAt: AT, note: "전달" });
    expect(() => transition(f, 1, "delivered", { at: AT })).toThrow();
    expect(() => transition(f, 1, "pending", { at: AT })).toThrow();
    expect(transition(f, 1, "done", { at: AT }).doneAt).toBe(AT);
    expect(() => transition(f, 2, "delivered", { at: AT })).toThrow(/없는 지시/);
  });
  it("깨진 파일은 빈 목록으로 읽는다", () => {
    const f = tmp(); fs.writeFileSync(f, "{not json"); expect(readAll(f)).toEqual([]);
    fs.writeFileSync(f, '{"a":1}'); expect(readAll(f)).toEqual([]);
  });
  it("승인 필요 단어", () => {
    for (const t of ["로그 삭제해", "배포해 줘", "결제 진행", "메일 발송", "deploy it"]) expect(needsApproval(t), t).toBe(true);
    for (const t of ["rm -rf dist 해 줘", "git reset --hard HEAD~1", "DROP TABLE users", "git push origin main", "git push --force", "Deploy to prod", "npm publish", "sudo reboot", "git clean -fd", "결제 페이지 열어", "저장소에 푸시해", "초기화 해 줘", "저장소를 공개해 줘"]) expect(needsApproval(t), t).toBe(true);
    for (const t of ["문구를 다듬어 줘", "Please confirm the format", "the dropdown looks off", "Remove는 말고 rename만 생각해줘".replace("Remove", "R"), "premium 탭 색상 변경", "pushy tone 줄여 줘", "hard 모드 문구", "공개판 점검을 끝내 줘", "결과를 전송 버튼 옆에 보여 줘", "위로 올려 줘"]) expect(needsApproval(t), t).toBe(false);
  });
});

describe("개인(solo)·공동(team) 지시 계약", () => {
  it("kind·to 조합 검사", () => {
    for (const to of ["chief", "claude", "gpt"]) { expect(checkTarget("solo", to)).toBeNull(); expect(checkTarget(undefined, to)).toBeNull(); }
    expect(checkTarget("team", "team")).toBeNull();
    expect(checkTarget("solo", "team")).toBe("INVALID_TO");
    expect(checkTarget(undefined, "team")).toBe("INVALID_TO");
    for (const to of ["chief", "gpt", "all", "", undefined, null]) expect(checkTarget("team", to), String(to)).toBe("INVALID_TO");
    for (const k of ["group", "SOLO", "", null, 1]) expect(checkTarget(k, "gpt"), String(k)).toBe("INVALID_KIND");
  });
  it("kind를 생략하면 solo로 저장하고, team은 to가 team이다", () => {
    const f = tmp();
    expect(addCommand(f, { to: "gpt", text: "a", at: AT })).toMatchObject({ kind: "solo", to: "gpt" });
    expect(addCommand(f, { kind: "team", to: "team", text: "b", at: AT })).toMatchObject({ id: 2, kind: "team", to: "team", state: "pending" });
  });
  it("잘못된 조합은 저장하지 않고 던진다", () => {
    const f = tmp();
    expect(() => addCommand(f, { kind: "solo", to: "team", text: "x", at: AT })).toThrow(/INVALID_TO/);
    expect(() => addCommand(f, { kind: "team", to: "gpt", text: "x", at: AT })).toThrow(/INVALID_TO/);
    expect(() => addCommand(f, { kind: "all", to: "team", text: "x", at: AT })).toThrow(/INVALID_KIND/);
    expect(readAll(f)).toEqual([]);
  });
  it("kind가 없는 옛 기록은 solo로 읽고, 상태 전이 뒤에도 같은 종류다", () => {
    const f = tmp();
    fs.writeFileSync(f, JSON.stringify([{ id: 1, at: AT, to: "claude", text: "옛 지시", state: "pending", needsApproval: false, deliveredAt: null, doneAt: null }]));
    expect(readAll(f)[0].kind).toBe("solo");
    expect(transition(f, 1, "delivered", { at: AT })).toMatchObject({ kind: "solo", to: "claude" });
    expect(recent(f, 5)[0].kind).toBe("solo");
  });
});
