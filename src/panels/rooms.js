import { buildRoomCards, teamsOf } from "./model.js";

// 방 이름표(#room-tags)와 폰 요약 카드(.room-cards). DESIGN5-panels.md §3~§4. 사용자 문자열은 textContent로만 넣는다.
const FLASH_MS = 1200;
const COMPACT_W = 220;
const EDGE = 4;

/**
 * deps: {office?, doc?, win?, cardsHost?, tagsHost?, camTarget?}
 *  - office.roomAnchors() → [{teamId,x,y,w}] (없으면 이름표는 숨김)
 *  - cardsHost: 폰 요약 카드를 맨 위에 넣을 요소(없으면 카드 없음)
 */
export function createRooms(store, view, deps = {}) {
  const doc = deps.doc ?? document;
  const win = deps.win ?? globalThis.window;
  const office = deps.office;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const layer = el("div"); layer.id = "room-tags";
  layer.setAttribute("role", "group"); layer.setAttribute("aria-label", "방");
  (deps.tagsHost ?? doc.body).append(layer);
  const cardsBox = el("div", "room-cards");
  cardsBox.setAttribute("aria-label", "방 목록");
  cardsBox.hidden = true;
  deps.cardsHost?.prepend(cardsBox);

  const flashUntil = new Map();
  let moving = false;
  let lastSig = null;
  let tagEls = new Map(); // teamId -> button

  const isFlash = (id, now) => (flashUntil.get(id) ?? 0) > now;

  function makeBody(btn, c) {
    const dot = el("i", "rt-dot");
    const name = el("span", "rt-name", c.name);
    const n = el("span", "rt-count", `${c.count}명`);
    btn.append(dot, name, n);
    if (c.empty) btn.append(el("span", "rt-sum", "빈 방"));
    else if (c.summary) btn.append(el("span", "rt-sum", c.summary));
    btn.title = c.name;
    btn.setAttribute("aria-label", c.ariaLabel);
  }
  function makeBtn(cls, c, flash) {
    const b = el("button", `${cls} ${c.dot}${flash ? " flash" : ""}`);
    b.type = "button";
    b.dataset.teamId = c.id;
    makeBody(b, c);
    b.addEventListener("click", () => view.enter(c.id));
    return b;
  }

  function draw() {
    const status = store.state;
    const cards = status ? buildRoomCards(status) : [];
    const now = Date.now();
    const sig = JSON.stringify(cards.map((c) => [c.id, c.name, c.count, c.working, c.blocked, c.dot, isFlash(c.id, now)]));
    if (sig !== lastSig) {
      lastSig = sig;
      layer.replaceChildren();
      cardsBox.replaceChildren();
      tagEls = new Map();
      for (const c of cards) {
        const tag = makeBtn("room-tag", c, isFlash(c.id, now));
        layer.append(tag);
        tagEls.set(c.id, tag);
        cardsBox.append(makeBtn("room-card", c, isFlash(c.id, now)));
      }
    }
    refresh();
  }

  // 위치·표시. DOM을 다시 만들지 않는다.
  function refresh() {
    const floor = view.get().mode === "floor" && tagEls.size > 0;
    cardsBox.hidden = !floor;
    layer.hidden = !floor || moving;
    if (layer.hidden) return;
    const anchors = office?.roomAnchors?.() ?? [];
    const W = layer.clientWidth || deps.camTarget?.clientWidth || 0;
    const H = layer.clientHeight || 0;
    const byId = new Map(anchors.map((a) => [a.teamId, a]));
    for (const [id, btn] of tagEls) {
      const a = byId.get(id);
      if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)) { btn.hidden = true; continue; }
      btn.hidden = false;
      const maxW = Math.max(0, (Number.isFinite(a.w) ? a.w : W) - 8);
      btn.style.maxWidth = maxW + "px";
      if (maxW < COMPACT_W) btn.dataset.compact = "1"; else delete btn.dataset.compact; // 좁은 방: 이름 우선, 요약 숨김
      const half = Math.min(btn.offsetWidth || 0, maxW) / 2;
      const halfH = (btn.offsetHeight || 0) / 2;
      let x = a.x, y = a.y;
      if (W) x = Math.min(Math.max(x, half + EDGE), Math.max(half + EDGE, W - half - EDGE));
      if (H) y = Math.min(Math.max(y, halfH + EDGE), Math.max(halfH + EDGE, H - halfH - EDGE));
      btn.style.left = x + "px";
      btn.style.top = y + "px";
    }
  }

  // 카메라가 움직이는 동안은 숨기고, 멈추면 위치를 다시 읽어 보인다.
  (deps.camTarget ?? doc).addEventListener("office:camera", (e) => {
    moving = e?.detail?.moving === true;
    refresh();
  }, true);
  win?.addEventListener?.("resize", () => refresh());
  view.onChange(() => refresh());

  store.on("state", draw);
  // 다른 팀 사이에 문서가 오가면 두 방 이름표가 1.2초 깜빡인다(teams.js의 flashUntil과 같은 규칙).
  store.on("events", (events) => {
    const status = store.state;
    if (!status) return;
    const ts = teamsOf(status);
    const teamOf = (id) => ts.find((t) => t.agentIds.includes(id))?.id;
    for (const ev of events) {
      const f = teamOf(ev.from), t = teamOf(ev.to);
      if (f && t && f !== t) { flashUntil.set(f, Date.now() + FLASH_MS); flashUntil.set(t, Date.now() + FLASH_MS); }
    }
    draw();
    setTimeout(draw, FLASH_MS + 50);
  });
  if (store.state) draw();

  return { layer, cardsBox, draw, refresh };
}
