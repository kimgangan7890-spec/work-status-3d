import { pickLocalFiles, localErrorLines, checkLocalSize, LOCAL_BADGE, LOCAL_NEED_BOTH } from "./model.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * '내 데이터 불러오기' UI. 파일은 File.text()로 브라우저 안에서만 읽고 어디에도 보내거나 저장하지 않는다.
 * @returns {{root: HTMLElement}}
 */
export function createLoadLocal(store) {
  const root = el("div", "ll");
  const btn = el("button", "ll-btn", "내 데이터 불러오기");
  btn.type = "button";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.multiple = true;
  input.hidden = true;
  const msg = el("div", "ll-msg");
  msg.setAttribute("role", "status");
  const list = el("ul", "ll-errors");
  const badge = el("div", "ll-badge");
  badge.hidden = true;
  const warn = document.createElement("details");
  warn.className = "ll-warn";
  warn.hidden = true;
  root.append(btn, input, msg, list, badge, warn);

  const clear = () => { msg.textContent = ""; list.replaceChildren(); };
  const fail = (lines, head) => {
    clear();
    if (head) msg.textContent = head;
    for (const l of localErrorLines(lines)) list.append(el("li", "", l));
  };

  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const picked = Array.from(input.files || []);
    input.value = ""; // 같은 파일을 다시 고를 수 있게
    if (!picked.length) return;
    if (picked.length === 1) { fail([], LOCAL_NEED_BOTH); return; }
    if (picked.length > 2) { fail([], "파일은 두 개까지만 고를 수 있어요. " + LOCAL_NEED_BOTH); return; }
    const files = [];
    for (const f of picked) {
      const sz = checkLocalSize(f.name, f.size);
      let text = "";
      if (sz.ok) {
        try { text = await f.text(); } catch { fail([`${f.name}: 파일을 읽지 못했어요`]); return; }
      }
      files.push({ name: f.name, size: f.size, text });
    }
    const res = pickLocalFiles(files);
    if (!res.ok) { fail(res.reasons); return; }
    const out = store.loadLocal(res.status, res.board);
    if (!out || !out.ok) { fail(out?.errors ?? ["불러오지 못했어요"], "데이터를 바꾸지 않았어요. 아래를 고쳐서 다시 골라 주세요."); return; }
    clear();
    badge.textContent = LOCAL_BADGE;
    badge.hidden = false;
    warn.replaceChildren();
    const w = Array.isArray(out.warnings) ? out.warnings : [];
    warn.hidden = w.length === 0;
    if (w.length) {
      warn.append(el("summary", "", `확인할 점 ${w.length}건`));
      const ul = el("ul");
      for (const t of w) ul.append(el("li", "", String(t)));
      warn.append(ul);
    }
  });

  return { root };
}
