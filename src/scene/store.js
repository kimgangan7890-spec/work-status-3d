import { validateStatus, validateBoard, crossCheck } from "../shared/validate.js";

/**
 * status.json을 주기적으로 읽는다(DATA.md 5장).
 * - 파일이 없거나 깨졌거나 검증에 실패하면 직전 상태를 유지한다.
 * - 첫 로드의 기존 이벤트는 재생하지 않고, 이후 id가 더 큰 이벤트만 알린다.
 */
export function createStore({ url: url0 = "status.json", boardUrl: boardUrl0 = "board.json", intervalMs: intervalMs0 = 3000, boardIntervalMs = 30000, fetchFn = (...a) => fetch(...a) } = {}) {
  let url = url0, boardUrl = boardUrl0, intervalMs = intervalMs0;
  let state = null;
  let board = null;
  let timerB = null;
  let lastEventId = null;
  let lastError = null;
  const listeners = { state: [], board: [], events: [], error: [], reset: [] };
  const emit = (name, payload) => listeners[name].forEach((fn) => fn(payload));
  let timer = null;
  let gen = 0; // setSource마다 올라가는 세대 번호
  let local = false; // loadLocal 뒤에는 파일 폴링 결과가 화면을 덮어쓰지 못한다
  let stateSig = null, boardSig = null; // 직전에 받은 내용(JSON 문자열). 같으면 객체를 바꾸지 않는다

  async function poll() {
    if (local) return;
    const my = gen;
    try {
      const res = await fetchFn(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (local || my !== gen) return; // 응답을 기다리는 사이 loadLocal·프로젝트 전환이 있었으면 버린다
      const errs = validateStatus(next);
      if (errs.length) throw new Error("검증 실패: " + errs[0]);
      const firstLoad = state === null;
      const prev = state;
      // 내용이 직전과 같으면 직전 객체를 그대로 쓴다. 받는 쪽(보드·장면)은 같은 객체면 다시 그리지 않는다.
      const sig = JSON.stringify(next);
      if (sig !== stateSig) { state = next; stateSig = sig; }
      lastError = null;
      const maxId = next.events.reduce((m, e) => Math.max(m, e.id), 0);
      if (firstLoad) lastEventId = maxId;
      const fresh = firstLoad ? [] : next.events.filter((e) => e.id > lastEventId);
      if (!firstLoad && maxId > lastEventId) lastEventId = maxId;
      emit("state", { state, prev });
      if (fresh.length) emit("events", fresh);
    } catch (err) {
      if (my !== gen) return;
      lastError = err.message;
      emit("error", err.message); // 직전 상태는 그대로 둔다
    }
  }

  async function pollBoard() {
    if (local) return;
    const my = gen;
    try {
      const res = await fetchFn(`${boardUrl}${boardUrl.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (local || my !== gen) return;
      const errs = validateBoard(next);
      if (errs.length) throw new Error("board 검증 실패: " + errs[0]);
      const sig = JSON.stringify(next);
      if (sig !== boardSig) { board = next; boardSig = sig; }
      emit("board", { board });
    } catch (err) {
      if (my !== gen) return;
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
    state = st; board = bd; lastError = null; stateSig = null; boardSig = null;
    lastEventId = st.events.reduce((m, e) => Math.max(m, e.id), 0);
    emit("state", { state: st, prev });
    emit("board", { board: bd });
    return { ok: true, warnings };
  }

  /**
   * 다른 프로젝트(사무동)로 바꾼다: 폴링을 멈추고 직전 프로젝트의 상태·보드·이벤트 기준을 모두 비운 뒤 새 주소로 다시 시작한다.
   * 이전 주소의 늦은 응답이 새 프로젝트를 덮지 못하게 세대 번호로 막는다.
   */
  function setSource(src) {
    clearInterval(timer); clearInterval(timerB);
    gen++;
    url = src.url; boardUrl = src.boardUrl; if (src.intervalMs) intervalMs = src.intervalMs;
    state = null; board = null; lastEventId = null; lastError = null; local = false; stateSig = null; boardSig = null;
    emit("reset", { url });
    timer = setInterval(poll, intervalMs); timerB = setInterval(pollBoard, boardIntervalMs);
    poll(); pollBoard();
  }

  return {
    setSource,
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
