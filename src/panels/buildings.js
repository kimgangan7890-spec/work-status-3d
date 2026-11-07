// 이름은 textContent로만 쓴다. 이름표는 카드와 같은 동작이며 탭 순서에는 중복으로 넣지 않는다.
export function hasNewEvent(summary, seen) {
  return !!seen && Number.isFinite(Date.parse(summary?.latestAt)) && Date.parse(summary.latestAt) > Date.parse(seen);
}
export function createBuildings(office, enter) {
  const root = document.createElement("div"); root.id = "building-tags"; root.setAttribute("aria-hidden", "true"); document.body.append(root);
  const nodes = new Map(), summaries = new Map(), seen = new Map();
  function lastSeen(id) { try { return localStorage.getItem(`office.seen.${id}`); } catch { return null; } }
  function paint(id) {
    const n = nodes.get(id); if (!n) return;
    const data = summaries.get(id), s = data?.summary;
    const fresh = hasNewEvent(s, seen.get(id));
    office.updateCampus({ ...data, id, fresh });
    n.dot.hidden = !fresh;
    n.detail.textContent = data?.error ? "읽지 못함" : !s ? "읽는 중…" : nodes.size >= 9
      ? `${s.progress == null ? "—" : s.progress + "%"} · 막힘 ${s.blocked}`
      : `${s.progress == null ? "진행 정보 없음" : s.progress + "%"} · 일 ${s.working} · 막힘 ${s.blocked}${fresh ? " · 새 이벤트" : ""}`;
    n.button.className = `building-tag${data?.error ? " error" : s?.blocked ? " blocked" : ""}${fresh ? " new" : ""}`;
  }
  function setProjects(list) {
    root.dataset.dense = String(list.length >= 9);
    root.replaceChildren(); nodes.clear(); const ids = new Set(list.map(p => p.id));
    for (const id of summaries.keys()) if (!ids.has(id)) summaries.delete(id);
    for (const p of list) {
      seen.set(p.id, lastSeen(p.id));
      const button = document.createElement("button"); button.type = "button"; button.tabIndex = -1; button.dataset.projectId = p.id; button.title = p.name;
      const name = document.createElement("strong"), detail = document.createElement("span"), dot = document.createElement("i"); dot.className = "building-new"; name.textContent = p.name; button.append(name, detail, dot); button.addEventListener("click", () => enter(p.id));
      root.append(button); nodes.set(p.id, { button, detail, dot }); paint(p.id);
    }
  }
  const unsubscribe = office.onCampusFrame(() => {
    const anchors = office.buildingAnchors();
    const byId = new Map(anchors.map(a => [a.id, a]));
    for (const [id, n] of nodes) {
      const a = byId.get(id);
      if (!a) { if (!n.button.hidden) n.button.hidden = true; continue; }
      if (n.button.hidden) n.button.hidden = false;
      const x = a.x.toFixed(1) + "px", y = a.y.toFixed(1) + "px", width = Math.max(60, Math.min(170, a.w)).toFixed(1) + "px";
      if (n.button.style.left !== x) n.button.style.left = x;
      if (n.button.style.top !== y) n.button.style.top = y;
      if (n.button.style.maxWidth !== width) n.button.style.maxWidth = width;
    }
  });
  return { setProjects, update(data) { summaries.set(data.id, data); paint(data.id); },
    visit(id) { const at = new Date().toISOString(); try { localStorage.setItem(`office.seen.${id}`, at); seen.set(id, at); } catch { seen.delete(id); } paint(id); },
    dispose() { unsubscribe(); root.remove(); nodes.clear(); summaries.clear(); },
  };
}
