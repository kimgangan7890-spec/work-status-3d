// 2D 사무동 카드의 GitHub 지표 (DESIGN9 §6, M2 S3). 서버 모드 전용 — main.js가 공개판이 아닐 때만 동적 import 한다.
// 지표 상태는 DOM이 아니라 이 모듈의 변수에 둔다. 같은 내용이면 카드를 다시 그리지 않는다.
import { GH_API } from "../shared/ghcontract.js";
import { toBuildingLook } from "../scene/ghlook.js";

export const POLL_MS = 45_000; // 서버 폴링 60초보다 짧게, 너무 잦지 않게
export const CI_TEXT = { passing: "통과", failing: "실패", running: "실행 중", pending: "대기", unknown: "알 수 없음", none: "없음" };
const SYNC_NOTE = { stale: "오래됨", error: "오류" };

/**
 * 층수 결합 규칙(S0 승인): GitHub 연결이 없으면 기존 값, ok/syncing이면 GitHub 층수,
 * stale/error면 마지막 성공 층수 유지(없으면 서버가 가진 스냅샷, 그것도 없으면 null).
 * @returns {number|null}
 */
export function resolveFloors({ existing = null, metrics, last = null }) {
  if (!metrics) return existing;
  const st = metrics.sync?.status;
  const floors = toBuildingLook(metrics).floors;
  if (st === "ok" || st === "syncing") return floors;
  if (last != null) return last;
  return metrics.sync?.lastSuccessfulSyncAt ? floors : null;
}

/** 지표 하나 → 카드에 붙일 {text, cls, floors}. 순수 함수. */
export function cardText(metrics, last = null) {
  const look = toBuildingLook(metrics);
  const floors = resolveFloors({ metrics, last });
  const note = SYNC_NOTE[metrics.sync?.status];
  const parts = [floors == null ? "GitHub 층수 –" : `GitHub ${floors}층`, `PR ${metrics.openPRs ?? 0}`, `이슈 ${metrics.openIssues ?? 0}`, `CI ${CI_TEXT[metrics.ci] ?? CI_TEXT.unknown}`];
  if (note) parts.push(note);
  const cls = [look.roof === "alert" ? "alert" : "", look.dim ? "dim" : ""].filter(Boolean).join(" ");
  return { text: parts.join(" · "), cls, floors };
}

const CI_RANK = { failing: 4, running: 3, pending: 3, passing: 2 };
/** 연결된 프로젝트들의 CI 최악값 → "failing"|"running"|"passing"|"none"(상태실 랙 색). 지표가 하나도 없으면 null. */
export function worstCi(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) return null;
  let best = 0, name = "none";
  for (const m of metrics) { const r = CI_RANK[m?.ci] ?? 0; if (r > best) { best = r; name = r === 4 ? "failing" : r === 3 ? "running" : "passing"; } }
  return name;
}

/**
 * @param {{campus:{decorate:Function,list:Function}, onLook?:(projectId:string,look:object|null)=>void, onCi?:(worst:string|null)=>void, fetch?:Function, intervalMs?:number, win?:EventTarget}} o
 */
export function startGhCards({ campus, onLook, onCi, fetch: fetchFn = (...a) => globalThis.fetch(...a), intervalMs = POLL_MS, win = globalThis.window }) {
  const lastFloors = new Map(); // projectId → 마지막 성공(ok/syncing) 층수
  const sigs = new Map();       // projectId → 마지막에 그린 내용(같으면 다시 그리지 않는다)
  let connected = false, timer = null, stopped = false, busy = null;

  const getJson = async (url) => {
    const res = await fetchFn(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    try { return await res.json(); } catch { return null; }
  };
  const clearAll = () => { for (const id of sigs.keys()) { campus.decorate(id, null); onLook?.(id, null); } sigs.clear(); lastFloors.clear(); onCi?.(null); };

  function paint(metrics) {
    onCi?.(worstCi(metrics));
    const seen = new Set();
    for (const m of metrics) {
      if (!m?.projectId) continue;
      seen.add(m.projectId);
      const st = m.sync?.status;
      const prev = lastFloors.get(m.projectId) ?? null;
      const out = cardText(m, prev);
      if ((st === "ok" || st === "syncing") && out.floors != null) lastFloors.set(m.projectId, out.floors);
      const sig = out.text + "|" + out.cls;
      if (sigs.get(m.projectId) === sig) continue; // 같은 데이터면 건드리지 않는다
      sigs.set(m.projectId, sig);
      campus.decorate(m.projectId, { text: out.text, cls: out.cls });
      if (onLook) { const l = toBuildingLook(m); onLook(m.projectId, { floors: out.floors, litRatio: l.litRatio, roof: l.roof, dim: l.dim }); } // 3D 단지: 바뀐 건물만 (floors null이면 기존 층수)
    }
    for (const id of [...sigs.keys()]) if (!seen.has(id)) { sigs.delete(id); campus.decorate(id, null); onLook?.(id, null); }
  }

  async function poll() {
    if (stopped || !connected) return;
    try { const d = await getJson(GH_API.metrics); if (d && Array.isArray(d.metrics)) paint(d.metrics); } catch { /* 직전 표시 유지 */ }
  }
  async function check() { // 세션이 없거나(401) 기능이 꺼졌거나(503) 연결이 없으면 지표 조회를 하지 않는다
    let info = null;
    try { info = await getJson(GH_API.connection); } catch { info = null; }
    connected = !!info?.connected;
    if (!connected) { clearAll(); return; }
    await poll();
  }
  const refresh = () => (busy ??= check().finally(() => { busy = null; }));
  const onChange = () => { refresh(); };
  win?.addEventListener?.("gh:changed", onChange);
  timer = setInterval(() => { if (!globalThis.document?.hidden) (connected ? poll() : refresh()); }, intervalMs);
  refresh();
  return { refresh, stop() { stopped = true; clearInterval(timer); win?.removeEventListener?.("gh:changed", onChange); clearAll(); }, isConnected: () => connected };
}
