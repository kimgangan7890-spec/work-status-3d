// 초기 데이터: 샘플 프로젝트 T1~T8과 자체 작업 W1~W4. 진행도는 실제 상태 기준.
const T = "2026-11-05T14:50:00+09:00";
const task = (id, title, ownerAgentId, zone, progress, state) => ({ id, title, ownerAgentId, zone, progress, state, updatedAt: T });

export function seedStatus() {
  return {
    meta: { project: "샘플 프로젝트 · 작업현황", updatedAt: T, schemaVersion: 1 },
    agents: [
      { id: "chief", name: "총괄", role: "조율·검수", status: "working", currentTaskId: "T2", note: "범위·분담 확정, 교차 검증 관리", model: "coordinator" },
      { id: "claude", name: "Claude", role: "설계·문서·패널", status: "working", currentTaskId: "T1", note: "화면 이전 진행", model: "sample-model-a" },
      { id: "gpt", name: "GPT", role: "구현·3D 장면", status: "working", currentTaskId: "W1", note: "장면·CLI 작성, 교차 검증 대기", model: "sample-model-b" },
    ],
    tasks: [
      task("T1", "Vite+React 이전 (일·주·월 보기)", "claude", "z-web", 5, "doing"),
      task("T2", "백엔드 프로젝트 생성 (사용자 직접)", "chief", "z-plan", 0, "todo"),
      task("T3", "인증 로그인 연결", "gpt", "z-server", 0, "todo"),
      task("T4", "Firestore 일정 저장", "gpt", "z-server", 0, "todo"),
      task("T5", "Capacitor·Android 빌드", "claude", "z-web", 0, "todo"),
      task("T6", "사용량 카운터 뼈대", "gpt", "z-server", 90, "doing"),
      task("T7", "스토어 개발자 계정 (사용자 직접)", "chief", "z-plan", 0, "todo"),
      task("T8", "통합 점검", "chief", "z-plan", 0, "todo"),
      task("W1", "update.js 작성", "gpt", "z-scene", 90, "doing"),
      task("W2", "3D 장면·파일 로더", "gpt", "z-scene", 90, "doing"),
      task("W3", "메인보드·게시판·로그 패널", "claude", "z-panel", 0, "todo"),
      task("W4", "DATA.md 형식 문서", "claude", "z-panel", 100, "done"),
    ],
    events: [],
  };
}

export function seedBoard() {
  return {
    mvp: [
      { id: "M1", title: "메일·메신저 일정 추출", status: "in" },
      { id: "M2", title: "출발 알림", status: "in" },
      { id: "M3", title: "무료 한도 카운터 (서버)", status: "in" },
      { id: "M4", title: "Gmail 직접 연동·캘린더 반영", status: "out" },
      { id: "M5", title: "할 일·준비물 화면", status: "pending" },
    ],
    zones: [
      { id: "z-plan", name: "샘플 프로젝트 계획·사용자 몫", ownerAgentId: "chief", taskIds: ["T2", "T7", "T8"] },
      { id: "z-web", name: "샘플 프로젝트 앱 화면", ownerAgentId: "claude", taskIds: ["T1", "T5"] },
      { id: "z-server", name: "샘플 프로젝트 서버·데이터베이스", ownerAgentId: "gpt", taskIds: ["T3", "T4", "T6"] },
      { id: "z-scene", name: "3D 장면", ownerAgentId: "gpt", taskIds: ["W1", "W2"] },
      { id: "z-panel", name: "패널·문서", ownerAgentId: "claude", taskIds: ["W3", "W4"] },
    ],
  };
}
