import { validateStatus, validateBoard, crossCheck } from "../shared/validate.js";

/**
 * status.json을 주기적으로 읽는다(DATA.md 5장).
 * - 파일이 없거나 깨졌거나 검증에 실패하면 직전 상태를 유지한다.
 * - 첫 로드의 기존 이벤트는 재생하지 않고, 이후 id가 더 큰 이벤트만 알린다.
 */
export function createStore({ url = "status.json", boardUrl = "board.json", intervalMs = 3000, boardIntervalMs = 30000, fetchFn = (...a) => fetch(...a) } = {}) {
  let state = null;
  let board = null;
  let timerB = null;
  let lastEventId = null;
  let lastError = null;
  const listeners = { state: [], board: [], events: [], error: [] };
  const emit = (name, payload) => listeners[name].forEach((fn) => fn(payload));
  let timer = null;
  let local = false; // loadLocal 뒤에는 파일 폴링 결과가 화면을 덮어쓰지 못한다

  async function poll() {
    if (local) return;
    try {
      const res = await fetchFn(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (local) return; // 응답을 기다리는 사이 loadLocal이 불렸으면 버린다
      const errs = validateStatus(next);
      if (errs.length) throw new Error("검증 실패: " + errs[0]);
      const firstLoad = state === null;
      const prev = state;
      state = next;
      lastError = null;
      const maxId = next.events.reduce((m, e) => Math.max(m, e.id), 0);
      if (firstLoad) lastEventId = maxId;
      const fresh = firstLoad ? [] : next.events.filter((e) => e.id > lastEventId);
      if (!firstLoad && maxId > lastEventId) lastEventId = maxId;
      emit("state", { state: next, prev });
      if (fresh.length) emit("events", fresh);
    } catch (err) {
      lastError = err.message;
      emit("error", err.message); // 직전 상태는 그대로 둔다
    }
  }

  async function pollBoard() {
    if (local) return;
    try {
      const res = await fetchFn(`${boardUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (local) return;
      const errs = validateBoard(next);
      if (errs.length) throw new Error("board 검증 실패: " + errs[0]);
      board = next;
      emit("board", { board: next });
    } catch (err) {
      emit("error", "board.json: " + err.message); // 직전 board 유지
    }
  }

  /**
   * 방문자가 고른 파일의 내용을 화면에 넣는다(브라우저 안에서만, 서버로 보내지 않는다).
   * status와 board가 둘 다 검증을 통과해야 반영하고, 하나라도 틀리면 아무것도 바꾸지 않고 이유를 돌려준다.
   * 반영하면 폴링을 멈추고 이벤트는 재생하지 않는다.
   */
  function loadLocal(nextStatus, nextBoard) {
    let st, bd;
    try { st = structuredClone(nextStatus); bd = structuredClone(nextBoard); } catch { return { ok: false, errors: ["파일 내용을 읽을 수 없다"] }; }
    const errors = [...validateStatus(st).map((e) => `status.json: ${e}`), ...validateBoard(bd).map((e) => `board.json: ${e}`)];
    if (errors.length) return { ok: false, errors };
    const warnings = crossCheck(st, bd) ?? [];
    local = true; clearInterval(timer); clearInterval(timerB);
    const prev = state;
    state = st; board = bd; lastError = null;
    lastEventId = st.events.reduce((m, e) => Math.max(m, e.id), 0);
    emit("state", { state: st, prev });
    emit("board", { board: bd });
    return { ok: true, warnings };
  }

  return {
    on(name, fn) { listeners[name].push(fn); },
    get state() { return state; },
    get board() { return board; },
    get lastError() { return lastError; },
    poll,
    pollBoard,
    loadLocal,
    get isLocal() { return local; },
    start() { poll(); pollBoard(); timer = setInterval(poll, intervalMs); timerB = setInterval(pollBoard, boardIntervalMs); },
    stop() { clearInterval(timer); clearInterval(timerB); },
  };
}
