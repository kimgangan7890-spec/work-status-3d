// 공개용 샘플 데이터 생성기. 실제 프로젝트명·이름·경로·모델명을 쓰지 않는다.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const T = "2026-01-01T09:00:00+09:00";
const task = (id, title, ownerAgentId, zone, progress, state) => ({ id, title, ownerAgentId, zone, progress, state, updatedAt: T });

export function publicStatus() {
  return {
    meta: { project: "샘플 프로젝트 · 작업현황", updatedAt: T, schemaVersion: 1 },
    // 샘플 팀 3개: 팀이 2개 이상이면 층 평면도가 첫 화면이다. 팀 이름·수는 예시일 뿐이고 형식은 DATA.md 10장.
    teams: [
      { id: "design", name: "디자인팀", order: 1 },
      { id: "dev", name: "개발팀", order: 2 },
      { id: "ops", name: "운영팀", order: 3 },
    ],
    agents: [
      { id: "lead", name: "팀장", role: "조율·검수", status: "working", currentTaskId: "S3", note: "범위 정리와 점검", model: "샘플", teamId: "ops" },
      { id: "designer", name: "디자이너", role: "화면·문서", status: "working", currentTaskId: "S1", note: "화면 초안 작성 중", model: "샘플", teamId: "design" },
      { id: "developer", name: "개발자", role: "구현·테스트", status: "idle", currentTaskId: null, note: "다음 작업 대기", model: "샘플", teamId: "dev" },
      { id: "sample-d2", name: "디자이너 2", role: "아이콘·문구", status: "idle", currentTaskId: null, note: "다음 작업 대기", model: "샘플", teamId: "design" },
      { id: "sample-v2", name: "개발자 2", role: "테스트", status: "blocked", currentTaskId: "S5", note: "확인 필요", model: "샘플", teamId: "dev" },
    ],
    tasks: [
      task("S1", "화면 초안", "designer", "z-a", 40, "doing"),
      task("S2", "문서 정리", "designer", "z-a", 100, "done"),
      task("S3", "범위 점검", "lead", "z-c", 20, "doing"),
      task("S4", "데이터 저장 만들기", "developer", "z-b", 0, "todo"),
      task("S5", "테스트 작성", "developer", "z-b", 60, "doing"),
      task("S6", "배포 준비", "lead", "z-c", 0, "todo"),
    ],
    events: [],
  };
}

export function publicBoard() {
  return {
    prd: [
      { id: "P1", title: "사용자와 문제 정의", status: "approved" },
      { id: "P2", title: "핵심 기능 요구사항", status: "review" },
      { id: "P3", title: "성공 기준", status: "draft" },
    ],
    bp: [
      { id: "B1", order: 3, area: "market", title: "목표 시장 규모 추정", status: "draft" },
      { id: "B2", order: 1, area: "customer", title: "첫 고객군 정의", status: "approved", note: "예시 메모" },
      { id: "B3", order: 4, area: "revenue", title: "수익 모델 초안", status: "review" },
      { id: "B4", order: 5, area: "cost", title: "월 운영비 추정", status: "draft" },
      { id: "B5", order: 2, area: "schedule", title: "출시 일정", status: "approved" },
    ],
    mvp: [
      { id: "M1", order: 2, title: "핵심 기능 A", status: "in", taskIds: ["S1", "S2"] },
      { id: "M2", order: 1, title: "핵심 기능 B", status: "in", taskIds: ["S4"] },
      { id: "M3", title: "나중에 할 기능", status: "pending" },
      { id: "M4", title: "이번에는 제외", status: "out" },
    ],
    zones: [
      { id: "z-a", name: "화면·문서", ownerAgentId: "designer", taskIds: ["S1", "S2"] },
      { id: "z-b", name: "구현·테스트", ownerAgentId: "developer", taskIds: ["S4", "S5"] },
      { id: "z-c", name: "조율·점검", ownerAgentId: "lead", taskIds: ["S3", "S6"] },
    ],
  };
}

export function writeSample(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(publicStatus(), null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify(publicBoard(), null, 2) + "\n");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? "public-sample");
  writeSample(dir); console.log("샘플 데이터 작성:", dir);
}
