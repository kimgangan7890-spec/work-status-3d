import * as THREE from "three";
import { teamsOf, pickTeam } from "../shared/teams.js";
import { agentColors } from "../shared/colors.js";
import { layoutRooms, ROOM } from "./floor.js";

// 사양: DESIGN3.md (사무실 §4, 캐릭터 §5, 카메라 §3). 근거 없는 요소는 넣지 않는다.
// 장면: 여러 팀은 층 평면도에서 방으로 확대(DESIGN5), 한 팀은 기존 화면 그대로. 문서는 해당 방 화이트보드로 도착한다.

const COLORS = { // DESIGN3 §4·§5
  wall: 0xf2efe9, carpet: 0x9a968f, partition: 0x6f8696, deskTop: 0xf4f3ef, deskLeg: 0x1d1d20,
  pants: 0x3a3a40, skin: 0xf1c9a5, hair: 0x2b2420, shoe: 0x222226,
  shirtDefault: 0x77777d, // 실제 옷색은 shared/colors.js의 agentColors가 정한다(보드 색 막대와 같은 함수)
};
const SCREEN = { working: 0x6fa8ff, idle: 0x1a2230, blocked: 0xff4d4d }; // 모니터 발광색(상태)
const STATUS_WORD = { blocked: "막힘" };
const KIND_COLOR = { doc: 0xffffff, ask: 0xffe27a, reply: 0x9ad7ff, report: 0xb6f2a2 };

const FOV = 32, PITCH = (32 * Math.PI) / 180, FILL = 0.8; // 책상이 장면 가로의 80%
const FLOOR_PITCH = (50 * Math.PI) / 180;
const ROOM_TINTS = [0xe0ddd6, 0xd5dce0, 0xdce0d5, 0xe0d8d5, 0xdcd8e0, 0xd5dfdd, 0xe0dfd5, 0xd9dadd];
const PITCH_X = 2.87, PITCH_2 = 2.87, ROW_DZ = 3.5, ROW_MAX = 4, TEAM_MAX = 8, DESK_W = 2.6, DESK_D = 1.4, YAW = (70 * Math.PI) / 180;
const NAME_MAX = 6, NAME_ABBR = 2; // 이름표 최대 글자 수(초과 시 …), 폰 두 줄(5~8명)의 약칭 글자 수
const SHOULDER = 0.62, L_UP = 0.42, L_FORE = 0.42;

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const box = (w, h, d, color, extra) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra)); m.castShadow = true; m.receiveShadow = true; return m; };
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

function noiseTexture(base, { speck = 0.06, seams = 0, repeat = [1, 1], size = 256 } = {}) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.18; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * speck})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  }
  g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 1;
  for (let i = 1; i <= seams; i++) { g.beginPath(); g.moveTo(0, (size * i) / (seams + 1)); g.lineTo(size, (size * i) / (seams + 1)); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  return t;
}

// 팔 2마디 역운동학(평면): 어깨에서 손까지 앞(f)·아래(d) 거리로 윗팔·아래팔 각도를 구한다. 각도는 "아래로 늘어진 상태에서 앞으로 든 각도".
function armAngles(f, d) {
  const D = Math.min(Math.hypot(f, d), L_UP + L_FORE - 0.01);
  const beta = Math.atan2(f, d), gamma = Math.acos(D / (2 * L_UP));
  const upper = beta - gamma, fore = beta + gamma;
  return { upper, foreRel: fore - upper };
}
const KEY_Z = 0.28, KEY_Y = 1.18, REST_Z = 0.5, REST_Y = 1.16, HIP_Y = 0.78, HIP_Z = 1.0;
function handPose(lean, handZ, handY) { // lean: 앞으로 숙인 각(+) 또는 뒤로 기댄 각(-)
  const shY = HIP_Y + SHOULDER * Math.cos(lean), shZ = HIP_Z - SHOULDER * Math.sin(lean);
  const a = armAngles(shZ - handZ, shY - handY);
  return { upper: a.upper + lean, foreRel: a.foreRel }; // 몸통이 기운 만큼 보정(자식 좌표)
}
const POSES = (() => {
  const work = handPose(0.14, KEY_Z, KEY_Y), idle = handPose(-0.16, REST_Z, REST_Y), rest = handPose(0.32, REST_Z, REST_Y);
  return {
    working: { lean: 0.14, uaL: work.upper, faL: work.foreRel, uaR: work.upper, faR: work.foreRel, headX: 0.12 },
    idle: { lean: -0.16, uaL: idle.upper, faL: idle.foreRel, uaR: idle.upper, faR: idle.foreRel, headX: -0.02 },
    // 막힘: 상체를 숙이고 한 손은 머리를 받친다(근거 없음, 사양서의 단순화)
    blocked: { lean: 0.32, uaL: rest.upper, faL: rest.foreRel, uaR: 1.15, faR: 2.1, headX: 0.22 },
  };
})();

export function createOffice(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.wall);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const target = new THREE.Vector3(0, 1.0, 0.2);

  // 조명: 선형 조명은 천장이 카메라 밖이라 빛으로만 표현, 창 쪽(오른쪽 뒤) 자연광
  const hemi = new THREE.HemisphereLight(0xf4f6fb, 0x9a968f, 1.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e2, 1.5);
  sun.position.set(9, 10, -3); sun.target.position.set(0, 0, 0); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const lights = [-4.5, 0, 4.5].map((x) => { const p = new THREE.PointLight(0xfff8ee, 9, 14, 1.6); p.position.set(x, 4.6, 0.5); scene.add(p); return p; });

  // 바닥(회색 카펫, 줄무늬 없음)과 벽(오프화이트, 왼쪽 벽 한 면만 노출 콘크리트)
  const legacy = new THREE.Group(); scene.add(legacy);
  const carpet = noiseTexture("#9a968f", { speck: 0.16, repeat: [10, 6] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 14), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0); floor.receiveShadow = true; legacy.add(floor);
  const BACK_Z = -5.2, LEFT_X = -6.4;
  const back = box(26, 6, 0.3, COLORS.wall); back.position.set(0, 3, BACK_Z - 0.15); legacy.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 14), new THREE.MeshStandardMaterial({ map: noiseTexture("#a9a69f", { speck: 0.3, seams: 3, repeat: [1, 1] }), roughness: 1 }));
  left.position.set(LEFT_X - 0.15, 3, 1.5); left.receiveShadow = true; legacy.add(left);

  // 뒷벽: 화이트보드(문서 도착점), 작은 창, 벽 액자
  function buildDecor(parent) {
    const wb = new THREE.Group(); wb.position.set(-1.2, 2.5, BACK_Z + 0.04); parent.add(wb);
    wb.add(box(5.0, 2.1, 0.06, 0xdcdcdc), at(box(4.8, 1.9, 0.04, 0xffffff), 0, 0, 0.04), at(box(2.0, 0.07, 0.12, 0xb9b9b9), 0, -1.12, 0.07));
    const win = new THREE.Group(); win.position.set(4.3, 2.8, BACK_Z + 0.03); parent.add(win);
    win.add(box(2.3, 1.7, 0.06, 0xe8e6e1), at(new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.5), new THREE.MeshBasicMaterial({ color: 0xcfe8ff })), 0, 0, 0.04));
    win.add(at(box(0.05, 1.5, 0.05, 0xe8e6e1), 0, 0, 0.06));
    for (const [x, c] of [[-5.4, 0xa9bccd], [-4.6, 0xc9b79c], [6.3, 0xb4c4b2]]) {
      const fr = new THREE.Group(); fr.position.set(x, 3.0, BACK_Z + 0.04);
      fr.add(box(0.7, 0.9, 0.05, 0x2a2a2e), at(new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.78), new THREE.MeshBasicMaterial({ color: c })), 0, 0, 0.03));
      parent.add(fr);
    }
    parent.add(plant(-5.7, -3.4, 1.9), plant(5.7, -3.4, 1.9));
    return new THREE.Vector3(-1.2, 2.5, BACK_Z + 0.25);
  }
  function plant(x, z, h, potColor = 0xe4dfd6) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(h * 0.18, h * 0.14, h * 0.32, 18), mat(potColor)), 0, h * 0.16, 0));
    const leaf = mat(0x3f7d4e);
    for (const [px, py, pz, r] of [[0, 0.58, 0, 0.26], [0.16, 0.74, 0.05, 0.2], [-0.15, 0.7, -0.06, 0.2], [0.02, 0.9, 0.0, 0.17]]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(h * r, 14, 12), leaf); s.position.set(px * h, py * h, pz * h); s.castShadow = true; g.add(s);
    }
    return g;
  }
  const boardAnchor = buildDecor(legacy);

  // 방은 팀 id로 재사용하고 바닥 재질만 따로 둔다.
  const rooms = new Map();
  const corridor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(0x55575c));
  corridor.rotation.x = -Math.PI / 2; corridor.position.y = -0.01; corridor.receiveShadow = true; corridor.visible = false; scene.add(corridor);
  function ensureRoom(teamId) {
    if (rooms.has(teamId)) return rooms.get(teamId);
    const group = new THREE.Group(); scene.add(group);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D), new THREE.MeshStandardMaterial({ map: carpet, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.01, (ROOM.BACK + ROOM.FRONT) / 2); floor.receiveShadow = true; group.add(floor);
    group.add(at(box(ROOM.W + ROOM.WALL, ROOM.WALL_BACK, 0.3, COLORS.wall), 0, ROOM.WALL_BACK / 2, ROOM.BACK - 0.15));
    for (const sx of [-1, 1]) group.add(at(box(0.15, ROOM.WALL_LOW, ROOM.D, COLORS.wall), sx * (ROOM.W / 2 + 0.075), ROOM.WALL_LOW / 2, (ROOM.BACK + ROOM.FRONT) / 2));
    const front = new THREE.Group(); front.position.z = ROOM.FRONT + 0.15; group.add(front);
    const side = (ROOM.W + ROOM.WALL - ROOM.DOOR) / 2;
    for (const sx of [-1, 1]) front.add(at(box(side, ROOM.WALL_LOW, 0.3, COLORS.wall), sx * (ROOM.DOOR + side) / 2, ROOM.WALL_LOW / 2, 0));
    const board = buildDecor(group);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(ROOM.W + ROOM.WALL, ROOM.WALL_BACK, ROOM.D + 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, ROOM.WALL_BACK / 2, (ROOM.BACK + ROOM.FRONT) / 2); hit.userData.teamId = teamId; group.add(hit);
    const room = { group, floor, front, board, hit }; rooms.set(teamId, room); return room;
  }

  // 책상 구성: 흰 상판 + 가는 검정 다리, 낮은 회청색 칸막이, 검정 모니터, 메시 의자(상태 모양은 syncState)
  const deskGroup = new THREE.Group(); scene.add(deskGroup);
  const desks = new Map();
  const tagsRoot = document.createElement("div");
  Object.assign(tagsRoot.style, { position: "fixed", pointerEvents: "none", overflow: "hidden", fontFamily: "system-ui, 'Noto Sans KR', sans-serif" });
  document.body.appendChild(tagsRoot);

  function buildPerson(shirtColor, hairKind) {
    const p = new THREE.Group(); p.position.set(0, HIP_Y, HIP_Z);
    const shirt = mat(shirtColor), skin = mat(COLORS.skin); // shirt: 몸통·팔이 함께 쓰는 재질(색이 바뀌면 한 번에 바뀐다)
    const sbox = (w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shirt); m.castShadow = true; m.receiveShadow = true; return m; };
    const torso = new THREE.Group(); p.add(torso);
    torso.add(at(sbox(0.64, 0.7, 0.36), 0, 0.35, 0));
    const head = new THREE.Group(); head.position.set(0, 0.7, 0); torso.add(head);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 20), skin); headMesh.position.y = 0.27; headMesh.castShadow = true; head.add(headMesh);
    // 머리카락: 짧게, 옆을 정리(사양 §5). 앞쪽(-z)으로 이마가 보이도록 위·뒤·옆만 덮는다.
    const hairM = mat(COLORS.hair), capH = hairKind === "claude" ? 0.2 : hairKind === "gpt" ? 0.1 : hairKind === "alt1" ? 0.18 : hairKind === "alt2" ? 0.12 : 0.15;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hairM); cap.position.set(0, 0.28, 0.03); cap.scale.y = 1 + capH; head.add(cap);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.285, 20, 14, 0, Math.PI, Math.PI * 0.3, Math.PI * 0.32), hairM); back.position.set(0, 0.27, 0.06); back.scale.set(1, 1, 0.92); head.add(back);
    for (const sx of [-1, 1]) head.add(at(box(0.05, 0.16, 0.2, COLORS.hair), sx * 0.26, 0.28, 0.02));
    if (hairKind === "chief") head.add(at(box(0.5, 0.05, 0.1, COLORS.hair), 0.04, 0.5, -0.12)); // 옆가르마
    for (const sx of [-1, 1]) head.add(at(box(0.05, 0.07, 0.03, 0x1b1b1f), sx * 0.1, 0.29, -0.255)); // 눈(시선 방향 표시)
    const arms = {};
    for (const [side, sx] of [["L", -1], ["R", 1]]) {
      const up = new THREE.Group(); up.position.set(sx * 0.4, SHOULDER, 0); torso.add(up);
      up.add(at(sbox(0.15, L_UP, 0.15), 0, -L_UP / 2, 0));
      const fore = new THREE.Group(); fore.position.set(0, -L_UP, 0); up.add(fore);
      fore.add(at(sbox(0.13, L_FORE, 0.13), 0, -L_FORE / 2, 0), at(box(0.13, 0.11, 0.15, COLORS.skin), 0, -L_FORE - 0.04, 0));
      arms[side] = { up, fore };
    }
    for (const sx of [-1, 1]) { // 다리 2마디: 허벅지는 앞으로, 종아리는 아래로
      const th = new THREE.Group(); th.position.set(sx * 0.17, 0, 0); th.rotation.x = Math.PI / 2; p.add(th);
      th.add(at(box(0.2, 0.42, 0.2, COLORS.pants), 0, -0.21, 0));
      const sh = new THREE.Group(); sh.position.set(0, -0.42, 0); sh.rotation.x = -Math.PI / 2; th.add(sh);
      sh.add(at(box(0.17, 0.66, 0.17, COLORS.pants), 0, -0.33, 0), at(box(0.2, 0.08, 0.3, COLORS.shoe), 0, -0.7, -0.05));
    }
    return { p, torso, head, arms, shirt };
  }

  function buildDesk(id, name, index, shirtColor) {
    const g = new THREE.Group(); g.rotation.y = YAW;
    const top = box(DESK_W, 0.08, DESK_D, COLORS.deskTop); top.position.y = 1.1; g.add(top);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.6, 0.6]) g.add(at(box(0.06, 1.06, 0.06, COLORS.deskLeg), dx, 0.53, dz));
    g.add(at(box(DESK_W - 0.1, 0.05, 0.05, COLORS.deskLeg), 0, 0.2, -0.6));
    g.add(at(box(DESK_W, 0.6, 0.08, COLORS.partition), 0, 1.44, -0.78)); // 책상 사이 낮은 칸막이
    // 모니터: 검정, 얇은 베젤, 화면 면은 상태색 발광
    const mon = new THREE.Group(); mon.position.set(0, 0, -0.4); mon.rotation.y = -0.45; g.add(mon); // 모니터를 살짝 비스듬히([A])
    mon.add(at(box(0.08, 0.3, 0.08, 0x151519), 0, 1.3, 0), at(box(0.4, 0.04, 0.24, 0x151519), 0, 1.16, 0), at(box(1.1, 0.66, 0.05, 0x101013), 0, 1.78, 0));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.56), new THREE.MeshBasicMaterial({ color: SCREEN.idle })); screen.position.set(0, 1.78, 0.028); mon.add(screen);
    g.add(at(box(0.62, 0.03, 0.22, 0x1a1a1e), 0, 1.15, 0.22)); // 키보드
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.14, 16), mat(0xf5f5f2)); mug.position.set(0.95, 1.18, 0.15); mug.castShadow = true; g.add(mug);
    g.add(at(box(0.34, 0.015, 0.44, 0xffffff), -0.95, 1.15, 0.15), at(box(0.34, 0.015, 0.44, 0xf0f0ec), -0.93, 1.165, 0.12));
    if (index === 2) g.add(at(box(0.6, 0.45, 0.7, 0xe8c547), -1.9, 0.225, 0.1)); // 책상 끝 노란 수납 상자
    if (index === 1) g.add(at(plant(0, 0, 0.55), 1.05, 1.14, -0.2)); // 책상 위 작은 화분
    // 메시 의자: 방석, 등받이, 머리받침, 기둥, 5발 바퀴
    const chairC = 0x3a3d42;
    g.add(at(box(0.72, 0.1, 0.72, chairC), 0, 0.64, 1.02), at(box(0.7, 0.85, 0.08, chairC), 0, 1.15, 1.4), at(box(0.34, 0.2, 0.08, chairC), 0, 1.7, 1.42), at(box(0.07, 0.4, 0.07, 0x222226), 0, 0.4, 1.02));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, arm = box(0.4, 0.04, 0.05, 0x222226); arm.position.set(Math.cos(a) * 0.2, 0.16, 1.02 + Math.sin(a) * 0.2); arm.rotation.y = -a; g.add(arm); g.add(at(box(0.07, 0.07, 0.07, 0x111114), Math.cos(a) * 0.4, 0.07, 1.02 + Math.sin(a) * 0.4)); }
    const person = buildPerson(shirtColor, ["chief", "claude", "gpt"].includes(id) ? id : ["alt1", "alt2", "other"][index % 3]);
    g.add(person.p);
    deskGroup.add(g);
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", transform: "translate(-50%,-100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", whiteSpace: "nowrap" });
    const bubble = document.createElement("div");
    Object.assign(bubble.style, { display: "none", background: "#d93c3c", color: "#fff", font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "3px 10px", borderRadius: "10px" });
    const nameEl = document.createElement("div");
    Object.assign(nameEl.style, { background: "rgba(20,25,40,.82)", color: "#fff", font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "4px 10px", borderRadius: "8px" });
    nameEl.textContent = name; el.append(bubble, nameEl); tagsRoot.appendChild(el);
    const d = { id, group: g, screen, person, el, bubble, nameEl, team: undefined, status: "idle", anchor: new THREE.Vector3(), phase: index * 2.1, pose: { ...POSES.idle }, top, shirtHex: shirtColor };
    desks.set(id, d); return d;
  }

  const papers = [];
  function playEvent(ev) {
    const vis = (id) => { const d = desks.get(id); return d && d.group.visible ? d.anchor : null; }; // 보고 있는 팀 안의 문서만 그린다
    const boardFor = (id) => {
      if (!multi) return boardAnchor;
      const room = rooms.get(desks.get(id)?.team);
      return room?.group.visible ? room.board.clone().add(room.group.position) : null;
    };
    const from = ev.from === "board" ? boardFor(ev.to) : vis(ev.from);
    const to = ev.to === "board" ? boardFor(ev.from) : vis(ev.to);
    if (!from || !to) return;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.4), new THREE.MeshStandardMaterial({ color: KIND_COLOR[ev.kind] ?? 0xffffff, side: THREE.DoubleSide, emissive: KIND_COLOR[ev.kind] ?? 0xffffff, emissiveIntensity: 0.25 }));
    const clipColor = desks.get(ev.from)?.shirtHex ?? 0x888888;
    mesh.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.06), new THREE.MeshBasicMaterial({ color: clipColor })), 0, 0.12, 0.01));
    mesh.position.copy(from); scene.add(mesh);
    papers.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: 1.8, ev, landed: 0, arrived: false });
  }

  // 팀 선택: 팀 탭이 setTeam(id)을 부른다. 모르는 팀이면 첫 팀. 팀이 없으면 전원이 기본 팀 하나다.
  let wanted = null, lastState = null, layoutKey = "", reqMode = "floor";
  let teams = [], multi = false, floorLayout = layoutRooms(0);
  let shown = null, anim = null, cur = null, goal = null;
  const canFloor = () => multi && canvas.clientWidth >= 600;
  const effMode = () => reqMode === "floor" && canFloor() ? "floor" : "room";
  const selectedTeam = () => {
    const id = pickTeam(lastState, wanted);
    return teams.find((t) => t.id === id)?.id ?? teams[0]?.id ?? null;
  };
  const hex = (c) => parseInt(String(c).replace("#", ""), 16);
  // 팀 안 인원 n의 책상 자리(x, z). n<=4 한 줄(예전 간격), 5~8 앞줄 4명 + 뒷줄은 앞줄 사이 칸에 어긋나게.
  function slots(n) {
    if (n <= ROW_MAX) return Array.from({ length: n }, (_, i) => ({ x: (i - (n - 1) / 2) * PITCH_X, z: 0 }));
    const m = n - ROW_MAX, P = PITCH_2, out = [];
    const frontShift = m === ROW_MAX ? -0.25 * P : 0, backShift = m === ROW_MAX ? 0.25 * P : 0;
    for (let i = 0; i < ROW_MAX; i++) out.push({ x: (i - (ROW_MAX - 1) / 2) * P + frontShift, z: 0 });
    const back = m === 1 ? [0] : m === 2 ? [-P, P] : m === 3 ? [-P, 0, P] : [0, 1, 2, 3].map((i) => (i - 1.5) * P + backShift);
    for (const x of back) out.push({ x, z: -ROW_DZ });
    return out;
  }
  function syncState(state) { lastState = state; applyState(); }
  function applyState() {
    const state = lastState; if (!state) return;
    for (const d of desks.values()) d.team = undefined;
    teams = teamsOf(state).slice(0, TEAM_MAX); multi = teams.length >= 2;
    floorLayout = layoutRooms(teams.length);
    const colors = agentColors(state);
    const keys = [];
    teams.forEach((team, index) => {
      const room = multi ? ensureRoom(team.id) : null, q = floorLayout.rooms[index];
      if (room) { room.group.position.set(q.x, 0, q.z); room.floor.material.color.setHex(ROOM_TINTS[index]); }
      const host = room ? room.group : deskGroup;
      const ids = new Set(team.agentIds.slice(0, TEAM_MAX));
      const members = state.agents.filter((a) => ids.has(a.id)), sl = slots(members.length);
      keys.push(`${team.id}:${sl.map((q) => q.x + ":" + q.z).join(",")}`);
      members.forEach((a, i) => {
        const col = hex(colors.get(a.id) ?? "#77777d");
        const d = desks.get(a.id) ?? buildDesk(a.id, a.name, i, col);
        if (d.shirtHex !== col) { d.shirtHex = col; d.person.shirt.color.setHex(col); }
        if (d.group.parent !== host) host.add(d.group);
        d.team = team.id;
        d.group.position.set(sl[i].x, 0, sl[i].z); d.anchor.set(host.position.x + sl[i].x, 1.5, host.position.z + sl[i].z + 0.3);
        d.name = a.name; d.status = a.status in POSES ? a.status : "idle";
        paintTag(d);
      });
    });
    if (multi) {
      const b = floorLayout.bounds;
      corridor.scale.set(b.maxX - b.minX, b.maxZ - b.minZ, 1);
      corridor.position.set((b.minX + b.maxX) / 2, -0.01, (b.minZ + b.maxZ) / 2);
    }
    const key = `${multi}|${keys.join("|")}`;
    if (key !== layoutKey) { layoutKey = key; resize(); } else syncView(true);
    applyVisibility();
  }
  function applyVisibility() {
    const showAll = multi && (shown?.mode === "floor" || !!anim), sel = shown?.teamId ?? selectedTeam();
    for (const d of desks.values()) {
      d.group.visible = d.team !== undefined && (showAll || d.team === sel);
      d.el.style.display = d.group.visible ? "flex" : "none";
    }
    for (const [id, room] of rooms) {
      room.group.visible = multi && teams.some((t) => t.id === id) && (showAll || id === sel);
      room.front.visible = !(shown?.mode === "room" && id === sel);
    }
    legacy.visible = !multi; corridor.visible = multi;
    tagsRoot.style.visibility = anim || shown?.mode === "floor" ? "hidden" : "visible";
    if (anim || shown?.mode !== "floor" || !rooms.get(hovered)?.group.visible) setHover(null);
  }
  // 이름표에 보일 이름. 숫자로 끝나면 첫 글자+숫자(검수 5 → 검5), 아니면 앞 2글자.
  function tagName(name, abbr) {
    const chars = Array.from(name);
    if (abbr) {
      const m = /^(.*?)\s*(\d+)$/.exec(name);
      if (m && m[1]) return Array.from(m[1])[0] + m[2];
      return chars.slice(0, NAME_ABBR).join("");
    }
    return chars.length > NAME_MAX ? chars.slice(0, NAME_MAX).join("") + "…" : name;
  }
  // 이름표 그리기. 폰 두 줄에서는 막힘 말풍선을 따로 띄우지 않고 이름표 한 줄(빨간 바탕)에 합쳐서 앞줄·뒷줄 이름표가 겹치지 않게 한다.
  function paintTag(d) {
    const blocked = d.status === "blocked", merged = d.small && blocked;
    d.bubble.style.display = blocked && !d.small ? "block" : "none"; if (blocked) d.bubble.textContent = STATUS_WORD.blocked;
    const shown = tagName(d.name ?? "", d.small); // 폰 5~8명 두 줄은 2자 약칭, 그 밖에는 전체 이름(6자 초과는 …). 전체 이름은 카드에서
    const text = merged ? `${shown}!` : shown; // 폰 두 줄은 약칭 뒤에 느낌표만 붙여 빨간 이름표를 좁게 유지(전체 이름·막힘 글자는 카드에서)
    if (d.nameEl.textContent !== text) d.nameEl.textContent = text;
    d.nameEl.style.background = merged ? "#d93c3c" : "rgba(20,25,40,.82)";
  }
  function setTeam(id) { wanted = typeof id === "string" ? id : null; applyState(); }
  function setView({ mode, teamId } = {}) {
    if (typeof teamId === "string") wanted = teamId;
    if (mode === "floor" || mode === "room") reqMode = mode;
    applyState();
  }
  function getView() {
    const mode = shown?.mode ?? effMode();
    return { mode, teamId: mode === "room" ? (shown?.teamId ?? selectedTeam()) : null };
  }
  function syncBoard() {} // 메인 보드는 HTML 패널이 그린다. 장면에서는 쓰지 않는다.

  // 카메라: 책상이 장면 가로의 FILL(80%)을 채우도록 거리를 정한다. 회전은 막고 크기 변화에만 반응한다.
  function deskCorners(list) {
    const pts = [];
    for (const d of list) {
      d.group.updateMatrixWorld(true);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push(d.top.localToWorld(new THREE.Vector3(sx * DESK_W / 2, 0, sz * DESK_D / 2)));
    }
    return pts;
  }
  function span(w, list = [...desks.values()].filter((d) => d.group.visible)) {
    const pts = deskCorners(list); if (!pts.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { const v = p.clone().project(camera); lo = Math.min(lo, v.x); hi = Math.max(hi, v.x); }
    return { frac: (hi - lo) / 2, left: ((lo + 1) / 2) * w, right: ((hi + 1) / 2) * w };
  }
  function placePose(p) {
    camera.position.set(p.tx, p.ty + p.dist * Math.sin(p.pitch), p.tz + p.dist * Math.cos(p.pitch));
    target.set(p.tx, p.ty, p.tz); camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  }
  function roomPose(teamId, w, h) {
    scene.updateMatrixWorld(true);
    const vis = [...desks.values()].filter((d) => d.team === teamId), n = Math.max(vis.length, 3);
    const rows = vis.some((d) => d.group.position.z < -1);
    const width = rows ? (ROW_MAX - 1) * PITCH_2 + 2.4 + 0.25 * PITCH_2 * 2 : (n - 1) * PITCH_X + 2.4;
    const offset = multi ? rooms.get(teamId)?.group.position : null, ox = offset?.x ?? 0, oz = offset?.z ?? 0;
    const p = { tx: ox, ty: rows ? 1.3 : 1.0, tz: oz + (rows ? 0.2 - ROW_DZ * 0.55 : 0.2), ox, oz,
      dist: width / (FILL * 2 * Math.tan((FOV * Math.PI) / 360) * (w / h)), pitch: PITCH };
    placePose(p);
    const s = span(w, vis); if (s && s.frac > 0) { p.dist *= s.frac / FILL; placePose(p); }
    return p;
  }
  function floorPose(w, h) {
    const b = floorLayout.bounds, ox = (b.minX + b.maxX) / 2, oz = (b.minZ + b.maxZ) / 2;
    const p = { tx: ox, ty: 0, tz: oz, ox, oz, dist: (b.maxX - b.minX) / (0.9 * 2 * Math.tan((FOV * Math.PI) / 360) * (w / h)), pitch: FLOOR_PITCH };
    const pts = [];
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) pts.push(new THREE.Vector3(x, 0, z));
    for (const q of floorLayout.rooms) for (const sx of [-1, 1]) for (const dz of [-ROOM.WALL, 0]) pts.push(new THREE.Vector3(q.x + sx * (ROOM.W + ROOM.WALL) / 2, ROOM.WALL_BACK, q.z + ROOM.BACK + dz));
    for (let i = 0; i < 4; i++) {
      placePose(p);
      const extent = Math.max(...pts.map((q) => { const v = q.clone().project(camera); return Math.max(Math.abs(v.x), Math.abs(v.y)); }));
      p.dist *= extent / 0.9;
    }
    return p;
  }
  function computeGoal(w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720) {
    camera.far = multi ? 1000 : 100;
    return shown?.mode === "floor" ? floorPose(w, h) : roomPose(shown?.teamId ?? selectedTeam(), w, h);
  }
  function cameraEvent(moving) {
    canvas.dispatchEvent(new CustomEvent("office:camera", { bubbles: true, detail: { moving, mode: shown.mode, teamId: shown.mode === "room" ? shown.teamId : null } }));
  }
  function syncView(animate) {
    if (!lastState) return false;
    const mode = effMode(), next = { mode, teamId: mode === "room" ? selectedTeam() : null };
    if (shown?.mode === next.mode && shown.teamId === next.teamId) return false;
    const prev = shown; shown = next; goal = computeGoal();
    if (animate && prev && prev.mode !== next.mode && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      anim = { t: 0, from: { ...cur }, to: goal }; placePose(cur);
      applyVisibility(); cameraEvent(true);
    } else {
      anim = null; cur = { ...goal }; placePose(cur);
      applyVisibility(); layoutTags(); cameraEvent(false);
    }
    return true;
  }
  function layoutTags() {
    const r = canvas.getBoundingClientRect();
    Object.assign(tagsRoot.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const v = new THREE.Vector3();
    const rows = [...desks.values()].some((d) => d.group.visible && d.group.position.z < -1);
    const small = rows && r.width < 600; // 폰에서 두 줄이면 이름표 여백을 줄여(글자는 16px 유지) 앞줄·뒷줄 이름표가 겹치지 않게
    const placed = [];
    for (const d of desks.values()) {
      if (!d.group.visible) continue;
      if (d.small !== small) {
        d.small = small;
        Object.assign(d.nameEl.style, small ? { font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "1px 5px" } : { font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "4px 10px" });
        Object.assign(d.bubble.style, small ? { font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "0 5px" } : { font: "700 16px system-ui, 'Noto Sans KR', sans-serif", padding: "3px 10px" });
        d.el.style.gap = small ? "1px" : "4px";
        paintTag(d);
      }
      d.person.head.getWorldPosition(v); v.y += 0.62; v.project(camera);
      // 이름표가 장면 위로 벗어나면(책상 1개 방은 카메라가 가까워 머리 위 이름표가 화면 밖으로 간다) 위쪽 안으로만 밀어 넣는다. 안에 있는 이름표는 그대로다.
      const top = Math.max(((1 - v.y) / 2) * r.height, d.el.offsetHeight + 4);
      placed.push({ d, cx: ((v.x + 1) / 2) * r.width, top });
    }
    // 같은 줄 이름표가 장면 좌우 밖으로 잘리면 안쪽으로 밀고, 밀려서 겹치는 이름표는 왼쪽으로 함께 민다. 안에 있고 겹치지 않는 이름표는 그대로다.
    const rowsOf = [];
    for (const it of placed.sort((a, b) => a.top - b.top)) {
      const row = rowsOf.find((g) => Math.abs(g[0].top - it.top) < 20);
      if (row) row.push(it); else rowsOf.push([it]);
    }
    const EDGE_PX = 2, GAP_PX = 4;
    const half = (it) => it.d.el.offsetWidth / 2;
    for (const row of rowsOf) {
      row.sort((a, b) => a.cx - b.cx);
      for (const it of row) it.d.nameEl.style.maxWidth = ""; // 이전 프레임의 줄이기를 풀고 원래 폭으로 다시 잰다
      const avail = r.width - 2 * EDGE_PX - GAP_PX * (row.length - 1);
      if (row.reduce((sum, it) => sum + 2 * half(it), 0) > avail) {
        // 한 줄 이름표 폭의 합이 장면 폭보다 크면 밀어서는 겹침을 못 없앤다: 폭을 똑같이 나눠 말줄임으로 줄인다.
        const each = Math.max(24, Math.floor(avail / row.length));
        for (const it of row) Object.assign(it.d.nameEl.style, { boxSizing: "border-box", maxWidth: `${each}px`, overflow: "hidden", textOverflow: "ellipsis" });
      }
      for (const it of row) it.cx = Math.min(it.cx, r.width - half(it) - EDGE_PX);
      for (let i = row.length - 2; i >= 0; i--) row[i].cx = Math.min(row[i].cx, row[i + 1].cx - half(row[i + 1]) - GAP_PX - half(row[i]));
      for (let i = 0; i < row.length; i++) row[i].cx = Math.max(row[i].cx, i ? row[i - 1].cx + half(row[i - 1]) + GAP_PX + half(row[i]) : half(row[i]) + EDGE_PX); // 왼쪽 끝을 맞추고 왼쪽부터 다시 밀어 겹침을 남기지 않는다
    }
    // 팀 탭이 보이는 화면(폭 601 이상은 탭이 장면 위에 겹친다)에서는 탭에 가리는 이름표를 탭 아래로 내린다. 폰은 장면이 탭 아래에서 시작해 해당 없다.
    const tabs = document.querySelector(".teamtabs");
    const tr = tabs && !tabs.hidden ? tabs.getBoundingClientRect() : null;
    if (tr && tr.width > 0) {
      for (const it of placed) {
        const w = it.d.el.offsetWidth, h = it.d.el.offsetHeight;
        const absL = r.left + it.cx - w / 2, absT = r.top + it.top - h;
        if (absL < tr.right && absL + w > tr.left && absT < tr.bottom + 4 && absT + h > tr.top) it.top = tr.bottom + 4 - r.top + h;
      }
    }
    for (const { d, cx, top } of placed) { d.el.style.left = `${cx}px`; d.el.style.top = `${top}px`; }
  }

  // 층 화면의 투명 상자로 방을 고른다.
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), roomClicks = new Set();
  let hovered = null;
  function setHover(teamId) {
    hovered = teamId;
    for (const [id, room] of rooms) room.floor.material.emissive.setHex(id === teamId ? 0x1c2733 : 0);
    canvas.style.cursor = teamId === null ? "" : "pointer";
  }
  function hitRoom(ev) {
    if (!multi || shown?.mode !== "floor" || anim) return null;
    const r = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
    scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
    const hits = [...rooms.values()].filter((room) => room.group.visible).map((room) => room.hit);
    return raycaster.intersectObjects(hits, false)[0]?.object.userData.teamId ?? null;
  }
  function pointerMove(ev) { setHover(hitRoom(ev)); }
  function pointerLeave() { setHover(null); }
  function clickRoom(ev) {
    const teamId = hitRoom(ev); if (teamId === null) return;
    setView({ mode: "room", teamId });
    for (const cb of roomClicks) cb(teamId);
  }
  function onRoomClick(cb) { roomClicks.add(cb); return () => roomClicks.delete(cb); }
  function roomAnchors() {
    if (!multi || shown?.mode !== "floor") return [];
    const w = canvas.clientWidth, h = canvas.clientHeight, z = ROOM.FRONT + ROOM.WALL;
    const project = (room, x, y) => {
      const v = new THREE.Vector3(x, y, z).add(room.group.position).project(camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    };
    return teams.map((team) => {
      const room = rooms.get(team.id), p = project(room, 0, ROOM.WALL_LOW);
      const l = project(room, -(ROOM.W + ROOM.WALL) / 2, 0), r = project(room, (ROOM.W + ROOM.WALL) / 2, 0);
      return { teamId: team.id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(Math.hypot(r.x - l.x, r.y - l.y)) };
    });
  }
  function resize() {
    const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    const changed = syncView(false); goal = computeGoal(w, h);
    if (anim) { anim.to = goal; placePose(cur); } else { cur = { ...goal }; placePose(cur); }
    applyVisibility(); layoutTags();
    if (!changed && shown && !anim) cameraEvent(false);
  }
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("click", clickRoom);
  addEventListener("resize", resize);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null; ro?.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let running = true;
  const lerp = (a, b, k) => a + (b - a) * k;
  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime, k = Math.min(1, dt * 6);
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / 0.7);
      const e = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
      for (const key of Object.keys(goal)) cur[key] = lerp(anim.from[key], anim.to[key], e);
      placePose(cur);
      if (anim.t === 1) {
        cur = { ...goal }; anim = null; placePose(cur);
        applyVisibility(); layoutTags(); cameraEvent(false);
      }
    }
    const kf = THREE.MathUtils.clamp((cur.pitch - PITCH) / (FLOOR_PITCH - PITCH), 0, 1);
    hemi.intensity = lerp(1.5, 2.6, kf);
    lights.forEach((p, i) => { p.intensity = 9 * (1 - kf); p.position.set(cur.ox + [-4.5, 0, 4.5][i], 4.6, cur.oz + 0.5); });
    sun.position.set(cur.ox + 9, 10, cur.oz - 3); sun.target.position.set(cur.ox, 0, cur.oz); sun.castShadow = kf < 0.5;
    for (const d of desks.values()) {
      if (!d.group.visible) continue;
      const goal = POSES[d.status], ps = d.pose;
      for (const key of Object.keys(goal)) ps[key] = lerp(ps[key], goal[key], k);
      const { torso, head, arms } = d.person;
      let tapL = 0, tapR = 0, nod = 0, shake = 0;
      if (d.status === "working") { tapL = Math.sin(t * 16 + d.phase) * 0.05; tapR = Math.cos(t * 16 + d.phase) * 0.05; nod = Math.pow(Math.max(0, Math.sin(t * 0.9 + d.phase)), 6) * 0.1; }
      torso.rotation.x = -ps.lean;
      head.rotation.x = ps.headX + nod; head.rotation.y = shake;
      arms.L.up.rotation.x = ps.uaL; arms.L.fore.rotation.x = ps.faL + tapL;
      arms.R.up.rotation.x = ps.uaR; arms.R.fore.rotation.x = ps.faR + tapR;
      const c = SCREEN[d.status] ?? SCREEN.idle;
      d.screen.material.color.setHex(c);
      if (d.status === "blocked") d.screen.material.color.multiplyScalar(0.65 + 0.35 * Math.abs(Math.sin(t * 5)));
    }
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i];
      if (p.t < 1) {
        p.t = Math.min(1, p.t + dt / p.dur);
        const e = p.t < 0.5 ? 2 * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 2) / 2;
        p.mesh.position.lerpVectors(p.from, p.to, e); p.mesh.position.y += Math.sin(Math.PI * e) * 1.6;
        p.mesh.rotation.set(-0.4 * Math.sin(Math.PI * e), e * Math.PI * 2 * 0.5 * (1 - e), 0.3 * Math.sin(e * 8));
      } else {
        if (!p.arrived) {
          p.arrived = true; p.mesh.rotation.set(0, 0, 0);
          if (p.ev.to === "board") dispatchEvent(new CustomEvent("office:arrive", { detail: { taskId: p.ev.taskId } }));
        }
        p.landed += dt; p.mesh.scale.setScalar(Math.max(0, 1 - Math.max(0, p.landed - 1.5) * 2));
        if (p.landed > 2) { scene.remove(p.mesh); papers.splice(i, 1); }
      }
    }
    layoutTags();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();

  return {
    syncState, syncBoard, playEvent, setTeam, setView, getView, roomAnchors, onRoomClick,
    get paperCount() { return papers.length; },
    // 확인용: 보이는 책상마다 바닥 발자국(책상+의자) 네 모서리의 월드 x,z와 이름표 화면 사각형
    deskInfo: () => [...desks.values()].filter((d) => d.group.visible).map((d) => {
      d.group.updateMatrixWorld(true);
      const foot = [[-1.3, -0.8], [1.3, -0.8], [1.3, 1.5], [-1.3, 1.5]].map(([x, z]) => { const v = d.group.localToWorld(new THREE.Vector3(x, 0, z)); return [v.x, v.z]; });
      const r = d.el.getBoundingClientRect();
      return { id: d.id, foot, tag: { l: r.left, t: r.top, r: r.right, b: r.bottom } };
    }),
    deskSpan: () => span(canvas.clientWidth || 1280), // 확인용: 책상이 장면 가로에서 차지하는 비율과 좌우 픽셀
    dispose() {
      running = false; removeEventListener("resize", resize); ro?.disconnect();
      canvas.removeEventListener("pointermove", pointerMove); canvas.removeEventListener("pointerleave", pointerLeave); canvas.removeEventListener("click", clickRoom);
      roomClicks.clear(); setHover(null); tagsRoot.remove(); renderer.dispose();
    },
  };
}
